// Wealth Coach — decision-support, not regulated financial advice.
//
// Architecture (deliberately boring):
//
//   loadSnapshot() ──► buildCoachReport() ──► [optional] narrator ──► guardrail ──► DB
//      deterministic     PURE FUNCTION         LLM rewrites prose      blocks bad     reports + agent_runs
//
// The LLM is a NARRATOR. It is never given freedom to invent numbers,
// recommend trades, or generate executable actions. The deterministic
// report is the only source of truth; the narrator can only retell it
// in prose using those numbers.
//
// What the Coach can do:
//   * read the user's snapshot (cash, ISA, holdings, pending approvals…)
//   * surface deterministic risks (cash below floor, ISA-year-end, etc.)
//   * suggest informational actions
//
// What the Coach NEVER does:
//   * place a trade, transfer funds, or call a broker
//   * bypass evaluateRisk for any monetary suggestion
//   * see PII in its prompt — redactForLLM is applied
//   * persist anything when WEALTH_MODE=observer

import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { reports, agentRuns } from '../db/schema/index';
import { loadSnapshot, type FinanceSnapshot } from '../lib/finance';
import {
  getTaxRules,
  isaStatus,
  daysUntilTaxYearEnd,
  taxYearFor,
  type TaxRules,
} from '../tax';
import { redactForLLM, evaluateGuardrail } from '../security/security';
import { env, coachEnabled } from '../lib/env';

const DISCLAIMER =
  'Decision-support, not regulated financial advice. Verify against gov.uk ' +
  'before acting. For personalised advice consult an FCA-authorised adviser.';

// ────────────────────────────────────────────────────────────────────────────
// Output shape

export type RiskSeverity = 'info' | 'warn' | 'block';

export interface CoachRiskNote {
  rule: string;
  severity: RiskSeverity;
  message: string;
}

export interface CoachSuggestedAction {
  title: string;
  rationale: string;
  /** True = display only; false = ready to enter the approval inbox via submitProposedAction. */
  informationalOnly: boolean;
}

export interface CoachReport {
  generatedAt: string;
  summary: string;
  position: {
    netWorthGbp: number;
    cashGbp: number;
    cashMonthsBuffer: number | null;
    investmentGbp: number;
    debtGbp: number;
    isaUsedPct: number;
    isaRemainingGbp: number;
    daysUntilIsaYearEnd: number;
    pendingApprovals: number;
    monthlyIncomeGbp: number;
    monthlyExpensesGbp: number;
    monthlySpareGbp: number;
  };
  risks: CoachRiskNote[];
  opportunities: Array<{ title: string; rationale: string }>;
  suggestedActions: CoachSuggestedAction[];
  doNot: string[];
  missingData: string[];
  /** 0..1 — falls as missingData grows. */
  confidence: number;
  /** Optional readable retelling produced by the LLM narrator. */
  llmNarration?: string;
  guardrail?: { passed: boolean; flagged: string[] };
  disclaimer: string;
  taxRulesVersion: string;
}

// ────────────────────────────────────────────────────────────────────────────
// Pure deterministic builder

const N_SUGGESTED_ACTIONS = 3;

export function buildCoachReport(args: {
  snap: FinanceSnapshot;
  rules: TaxRules;
  now: Date;
}): CoachReport {
  const { snap, rules, now } = args;

  const monthlyExpenses = snap.monthlyExpensesGbp;
  const monthlyIncome = snap.monthlyIncomeGbp;
  const monthlySpare = Math.max(0, monthlyIncome - monthlyExpenses);
  const cashMonthsBuffer = monthlyExpenses > 0 ? snap.cashGbp / monthlyExpenses : null;

  const cashFloorMonths = snap.activeRiskProfile?.cashFloorMonths ?? 3;
  const cashFloorGbp = cashFloorMonths * monthlyExpenses;
  const cashGap = Math.max(0, cashFloorGbp - snap.cashGbp);

  const isa = isaStatus(rules, {
    depositedGbp: snap.isa?.deposited ?? 0,
    now,
  });
  const daysToYearEnd = daysUntilTaxYearEnd(now);
  const taxYear = taxYearFor(now);

  const investment = snap.isaValueGbp + snap.giaValueGbp;

  // ── Missing-data detection — drives confidence
  const missingData: string[] = [];
  if (!snap.activeRiskProfile) missingData.push('No active risk profile.');
  if (!snap.activeAllocation) missingData.push('No active allocation rule.');
  if (monthlyIncome === 0) missingData.push('Monthly income not set.');
  if (monthlyExpenses === 0) missingData.push('Monthly expenses not set.');
  if (snap.goals.length === 0) missingData.push('No goals recorded.');
  if (!snap.isa) missingData.push('No ISA year tracked for this tax year.');

  // ── Risks (deterministic only, never LLM-driven)
  const risks: CoachRiskNote[] = [];

  if (monthlyExpenses > 0 && cashGap > 0) {
    risks.push({
      rule: 'cash_floor',
      severity: cashMonthsBuffer !== null && cashMonthsBuffer < cashFloorMonths / 2 ? 'block' : 'warn',
      message:
        `Cash buffer is £${snap.cashGbp.toFixed(0)} — ` +
        `${cashMonthsBuffer?.toFixed(1) ?? '—'} months vs a ${cashFloorMonths}-month floor. ` +
        `Gap: £${cashGap.toFixed(0)}.`,
    });
  }

  if (snap.debtGbp > 0) {
    const debtVsInvestment = investment > 0 ? snap.debtGbp / investment : Infinity;
    if (debtVsInvestment > 0.5) {
      risks.push({
        rule: 'debt_load',
        severity: debtVsInvestment > 1 ? 'warn' : 'info',
        message:
          `Debt £${snap.debtGbp.toFixed(0)} vs investments £${investment.toFixed(0)} — ` +
          `consider whether paying down high-rate debt beats new investing.`,
      });
    }
  }

  if (snap.pendingApprovals > 0) {
    risks.push({
      rule: 'pending_approvals',
      severity: 'info',
      message: `${snap.pendingApprovals} proposal${snap.pendingApprovals === 1 ? '' : 's'} waiting in your Approval Centre.`,
    });
  }

  if (isa.remainingGbp > 0 && daysToYearEnd <= 30) {
    risks.push({
      rule: 'isa_year_end',
      severity: 'warn',
      message: `£${isa.remainingGbp.toFixed(0)} of ISA allowance unused with ${daysToYearEnd} day${daysToYearEnd === 1 ? '' : 's'} left — it doesn't roll over.`,
    });
  }

  // ── Suggested actions — strictly informational, never executable
  const suggested: CoachSuggestedAction[] = [];

  if (cashGap > 0 && monthlySpare > 0) {
    const months = Math.ceil(cashGap / monthlySpare);
    suggested.push({
      title: `Build emergency fund to floor (${cashFloorMonths} months of expenses)`,
      rationale: `Route monthly spare into easy-access cash for ~${months} month${months === 1 ? '' : 's'} until £${cashFloorGbp.toFixed(0)} is reached.`,
      informationalOnly: true,
    });
  }

  if (isa.remainingGbp > 0 && monthlySpare > 0) {
    const pace = isa.evenPaceMonthlyGbp;
    suggested.push({
      title: `Use this year's ISA allowance before 5 April`,
      rationale: `£${isa.remainingGbp.toFixed(0)} remaining for tax year ${taxYear.number}/${(taxYear.number + 1) % 100}. Even-pace contribution: £${pace.toFixed(0)}/month.`,
      informationalOnly: true,
    });
  }

  if (snap.pendingApprovals > 0) {
    suggested.push({
      title: `Review ${snap.pendingApprovals} pending proposal${snap.pendingApprovals === 1 ? '' : 's'}`,
      rationale: `Each waiting action has a risk evaluation attached. Approve, snooze, or reject in the Approval Centre.`,
      informationalOnly: true,
    });
  }

  if (snap.goals.length > 0) {
    const nearest = [...snap.goals].sort(
      (a, b) => (a.target - a.current) - (b.target - b.current),
    )[0];
    if (nearest && nearest.target > nearest.current && monthlySpare > 0) {
      const gap = nearest.target - nearest.current;
      const months = Math.ceil(gap / monthlySpare);
      suggested.push({
        title: `Stay on pace for "${nearest.name}"`,
        rationale: `£${gap.toFixed(0)} to go. At your current spare you'd reach it in ~${months} months (linear, no growth assumed).`,
        informationalOnly: true,
      });
    }
  }

  // Trim to N (the user asked for "next 3"). Stable order: risks-driven first.
  const top = suggested.slice(0, N_SUGGESTED_ACTIONS);

  // ── Always-on guardrails ("do not")
  const doNot: string[] = [
    'Do not place trades that take cash below the floor.',
    'Do not use leverage, options, or spread bets.',
    `Do not act on this report without re-reading the numbers — version ${rules.version}, generated ${now.toISOString()}.`,
  ];
  if (snap.activeRiskProfile?.cashFloorMonths) {
    doNot.push(`Do not breach the ${snap.activeRiskProfile.cashFloorMonths}-month cash floor your risk profile enforces.`);
  }

  // ── Summary line
  const summaryParts: string[] = [];
  if (cashGap > 0) summaryParts.push(`cash buffer short by £${cashGap.toFixed(0)}`);
  if (isa.remainingGbp > 0 && daysToYearEnd <= 60) summaryParts.push(`£${isa.remainingGbp.toFixed(0)} ISA allowance unused`);
  if (snap.pendingApprovals > 0) summaryParts.push(`${snap.pendingApprovals} approval${snap.pendingApprovals === 1 ? '' : 's'} pending`);

  const summary = summaryParts.length > 0
    ? `This week: ${summaryParts.join(' · ')}.`
    : `Position is on track — no urgent moves needed.`;

  // ── Confidence — 1.0 minus a small penalty per missing item.
  const confidence = Math.max(0.2, 1 - missingData.length * 0.1);

  return {
    generatedAt: now.toISOString(),
    summary,
    position: {
      netWorthGbp: snap.netWorthGbp,
      cashGbp: snap.cashGbp,
      cashMonthsBuffer,
      investmentGbp: investment,
      debtGbp: snap.debtGbp,
      isaUsedPct: isa.utilisedPct,
      isaRemainingGbp: isa.remainingGbp,
      daysUntilIsaYearEnd: daysToYearEnd,
      pendingApprovals: snap.pendingApprovals,
      monthlyIncomeGbp: monthlyIncome,
      monthlyExpensesGbp: monthlyExpenses,
      monthlySpareGbp: monthlySpare,
    },
    risks,
    opportunities: [], // wealth-os doesn't have an opportunity feed yet; honest empty
    suggestedActions: top,
    doNot,
    missingData,
    confidence,
    disclaimer: DISCLAIMER,
    taxRulesVersion: rules.version,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Optional LLM narration

export interface NarratorRequest {
  systemPrompt: string;
  userPrompt: string;
}

export interface NarratorResponse {
  text: string;
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
}

export type Narrator = (req: NarratorRequest) => Promise<NarratorResponse>;

export function buildNarratorPrompt(report: CoachReport): NarratorRequest {
  // The system prompt is strict on purpose. The narrator is not a calculator.
  const systemPrompt = [
    'You are the Wealth Coach narrator. You retell a deterministic report in clear UK English prose.',
    '',
    'STRICT RULES:',
    '- All numbers in your output MUST come from the JSON report below. Never invent or change numbers.',
    '- Do not recommend specific trades, securities, brokers, or asset allocations.',
    '- Do not use phrases like "guaranteed return", "risk-free", "best buy", or "easy money".',
    '- Do not provide tax advice — flag tax topics as worth checking with a chartered accountant.',
    '- Always end with the disclaimer text from the report.',
    '- UK English. No emojis. No promotional language.',
    '- This is decision-support, not regulated financial advice.',
  ].join('\n');

  const userPrompt = [
    'Rewrite this Coach report as a short readable note (no more than ~300 words).',
    'Cover: position, risks, the suggested actions, the do-not list, missing data, confidence.',
    '',
    'Report JSON:',
    JSON.stringify(report, null, 2),
  ].join('\n');

  return { systemPrompt, userPrompt };
}

export function createAnthropicNarrator(opts: {
  apiKey: string;
  model: string;
  maxTokens: number;
}): Narrator {
  // Imported lazily so importing this module is free in tests / scripts that
  // never run the narrator path.
  return async (req) => {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: opts.apiKey });
    const resp = await client.messages.create({
      model: opts.model,
      max_tokens: opts.maxTokens,
      system: req.systemPrompt,
      messages: [{ role: 'user', content: req.userPrompt }],
    });
    const text = resp.content
      .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
      .map((c) => c.text)
      .join('\n');
    return {
      text,
      tokensIn: resp.usage?.input_tokens,
      tokensOut: resp.usage?.output_tokens,
    };
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Orchestrator — touches the DB

export interface RunCoachResult {
  report: CoachReport;
  reportId: string | null;       // null when observer mode skipped persistence
  agentRunId: string | null;     // null when observer mode skipped persistence
  observerMode: boolean;
  tokensIn?: number;
  tokensOut?: number;
}

export async function runCoach(args: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: PostgresJsDatabase<any>;
  userId: string;
  narrator?: Narrator | null;
  now?: Date;
  /** Override the env reading for tests. */
  modeOverride?: 'observer' | 'advisor';
}): Promise<RunCoachResult> {
  const now = args.now ?? new Date();
  const mode = args.modeOverride ?? (env.WEALTH_MODE === 'observer' ? 'observer' : 'advisor');

  // 1. Audit row — created up front so even a crash leaves a trace.
  let agentRunId: string | null = null;
  if (mode !== 'observer') {
    const [r] = await args.db
      .insert(agentRuns)
      .values({
        userId: args.userId,
        agent: 'wealth-coach',
        status: 'running',
        input: { mode },
      })
      .returning({ id: agentRuns.id });
    agentRunId = r?.id ?? null;
  }

  try {
    // 2. Deterministic snapshot + report
    const snap = await loadSnapshot(args.userId);
    const rules = getTaxRules();
    const report = buildCoachReport({ snap, rules, now });

    let tokensIn: number | undefined;
    let tokensOut: number | undefined;

    // 3. Optional LLM narration
    if (args.narrator && mode !== 'observer') {
      const prompt = buildNarratorPrompt(report);
      // Redact PII before sending to the model. The deterministic report
      // shouldn't contain raw PII either, but redact again as defence in depth.
      const safeUserPrompt = redactForLLM(prompt.userPrompt);
      const resp = await args.narrator({
        systemPrompt: prompt.systemPrompt,
        userPrompt: safeUserPrompt,
      });
      const guard = evaluateGuardrail(resp.text, true);
      const flagged = [
        ...guard.bannedHits,
        ...(guard.missingDisclaimer ? ['missing_disclaimer'] : []),
      ];
      report.guardrail = { passed: guard.ok, flagged };
      if (guard.ok) {
        report.llmNarration = resp.text;
      }
      tokensIn = resp.tokensIn;
      tokensOut = resp.tokensOut;
    }

    // 4. Persist
    let reportId: string | null = null;
    if (mode !== 'observer') {
      const [r] = await args.db
        .insert(reports)
        .values({
          userId: args.userId,
          kind: 'coach_summary',
          periodStart: now,
          periodEnd: now,
          content: report,
        })
        .returning({ id: reports.id });
      reportId = r?.id ?? null;

      if (agentRunId) {
        await args.db
          .update(agentRuns)
          .set({
            status: 'succeeded',
            endedAt: new Date(),
            tokensIn,
            tokensOut,
            output: { reportId },
          })
          .where(eq(agentRuns.id, agentRunId));
      }
    }

    return {
      report,
      reportId,
      agentRunId,
      observerMode: mode === 'observer',
      tokensIn,
      tokensOut,
    };
  } catch (err) {
    if (agentRunId) {
      await args.db
        .update(agentRuns)
        .set({
          status: 'failed',
          endedAt: new Date(),
          error: (err as Error).message,
        })
        .where(eq(agentRuns.id, agentRunId))
        .catch(() => { /* best-effort error capture */ });
    }
    throw err;
  }
}
