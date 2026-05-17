// POST /api/coach/run
//
// Auth-gated trigger for the Wealth Coach. Builds the deterministic report,
// optionally narrates with Claude when ANTHROPIC_API_KEY is set, runs the
// guardrail on the narration, and persists a `reports` row + `agent_runs`
// audit row (unless WEALTH_MODE=observer, in which case nothing is written).
//
// The Coach NEVER places trades. The response is a JSON report; the UI
// renders it. Any monetary suggestion would have to flow through
// submitProposedAction to land in the Approval Centre — the Coach does
// not bypass evaluateRisk.

import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { createAnthropicNarrator, runCoach } from '@/services/coach';
import { CoachLimitError } from '@/services/coach-budget';
import { env, coachEnabled } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'unauthorised' }, { status: 401 });
  }
  const userId = (session.user as { id?: string }).id;
  if (!userId) {
    return NextResponse.json({ error: 'unauthorised' }, { status: 401 });
  }

  const narrator = coachEnabled() && env.ANTHROPIC_API_KEY
    ? createAnthropicNarrator({
        apiKey: env.ANTHROPIC_API_KEY,
        model: env.COACH_MODEL,
        maxTokens: env.COACH_MAX_TOKENS,
      })
    : null;

  try {
    const result = await runCoach({ db, userId, narrator });
    return NextResponse.json({
      ok: true,
      reportId: result.reportId,
      agentRunId: result.agentRunId,
      observerMode: result.observerMode,
      narrated: Boolean(result.report.llmNarration),
      guardrail: result.report.guardrail ?? null,
      budget: result.budget,
      costUsd: result.costUsd,
      report: result.report,
    });
  } catch (err) {
    if (err instanceof CoachLimitError) {
      const d = err.decision;
      const retryAfterSeconds = Math.max(1, Math.ceil((d.resetsAt.getTime() - Date.now()) / 1000));
      return NextResponse.json(
        {
          ok: false,
          error: 'coach_limit',
          reason: d.reason,
          usage: d.usage,
          caps: d.caps,
          resetsAt: d.resetsAt.toISOString(),
          message: d.message,
        },
        { status: 429, headers: { 'Retry-After': retryAfterSeconds.toString() } },
      );
    }
    const message = err instanceof Error ? err.message : 'unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
