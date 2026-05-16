'use client';

import { useState } from 'react';
import type { CoachReport, RiskSeverity } from '@/services/coach';
import type { BudgetStatus } from '@/services/coach-budget';

interface RunResponse {
  ok: boolean;
  error?: string;
  reportId?: string | null;
  observerMode?: boolean;
  narrated?: boolean;
  guardrail?: { passed: boolean; flagged: string[] } | null;
  budget?: BudgetStatus;
  costUsd?: number;
  report?: CoachReport;
}

function usd(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n);
}

const severityClasses: Record<RiskSeverity, string> = {
  info:  'border-line text-muted',
  warn:  'border-amber-300 text-amber-700',
  block: 'border-red-300 text-red-700',
};

function gbp(n: number): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(n);
}

export function RunCoachButton() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<RunResponse | null>(null);

  async function run() {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch('/api/coach/run', { method: 'POST' });
      const json = (await res.json()) as RunResponse;
      setResult(json);
    } catch (err) {
      setResult({ ok: false, error: err instanceof Error ? err.message : 'network error' });
    } finally {
      setLoading(false);
    }
  }

  const r = result?.report;

  return (
    <div>
      <button
        type="button"
        onClick={run}
        disabled={loading}
        className="rounded-md border border-line bg-ink px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
      >
        {loading ? 'Running…' : 'Run Wealth Coach'}
      </button>

      {result && !result.ok && (
        <p className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          Coach failed: {result.error ?? 'unknown error'}
        </p>
      )}

      {r && (
        <div className="mt-4 space-y-4">
          {result?.observerMode && (
            <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              Observer mode: report generated but not saved.
            </p>
          )}

          {result?.budget && (
            <p className={`rounded-md border p-3 text-sm ${
              result.budget.exceeded
                ? 'border-amber-200 bg-amber-50 text-amber-800'
                : 'border-line text-muted'
            }`}>
              Coach LLM spend this month: <strong>{usd(result.budget.monthSpentUsd)}</strong>
              {' / '}{usd(result.budget.monthCapUsd)} cap
              {result.costUsd && result.costUsd > 0 ? ` · this run ${usd(result.costUsd)}` : ''}
              {result.budget.exceeded && (
                <> · <strong>cap reached</strong> — narration skipped, deterministic report below is unaffected.</>
              )}
            </p>
          )}

          <p className="text-base">{r.summary}</p>

          <section>
            <h3 className="h3">Position</h3>
            <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-sm md:grid-cols-3">
              <div><dt className="text-muted">Net worth</dt><dd>{gbp(r.position.netWorthGbp)}</dd></div>
              <div><dt className="text-muted">Cash</dt><dd>{gbp(r.position.cashGbp)} ({r.position.cashMonthsBuffer?.toFixed(1) ?? '—'} mo)</dd></div>
              <div><dt className="text-muted">Investments</dt><dd>{gbp(r.position.investmentGbp)}</dd></div>
              <div><dt className="text-muted">Debt</dt><dd>{gbp(r.position.debtGbp)}</dd></div>
              <div><dt className="text-muted">ISA remaining</dt><dd>{gbp(r.position.isaRemainingGbp)}</dd></div>
              <div><dt className="text-muted">Days to 5 April</dt><dd>{r.position.daysUntilIsaYearEnd}</dd></div>
              <div><dt className="text-muted">Monthly spare</dt><dd>{gbp(r.position.monthlySpareGbp)}</dd></div>
              <div><dt className="text-muted">Pending approvals</dt><dd>{r.position.pendingApprovals}</dd></div>
              <div><dt className="text-muted">Confidence</dt><dd>{Math.round(r.confidence * 100)}%</dd></div>
            </dl>
          </section>

          {r.risks.length > 0 && (
            <section>
              <h3 className="h3">Risks</h3>
              <ul className="mt-2 space-y-2">
                {r.risks.map((risk) => (
                  <li key={risk.rule} className={`rounded-md border px-3 py-2 text-sm ${severityClasses[risk.severity]}`}>
                    <strong className="capitalize">{risk.severity}</strong> · {risk.rule}: {risk.message}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {r.suggestedActions.length > 0 && (
            <section>
              <h3 className="h3">Next steps (informational)</h3>
              <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm">
                {r.suggestedActions.map((a) => (
                  <li key={a.title}>
                    <strong>{a.title}</strong>
                    <div className="text-muted">{a.rationale}</div>
                  </li>
                ))}
              </ol>
            </section>
          )}

          {r.doNot.length > 0 && (
            <section>
              <h3 className="h3">Do not</h3>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted">
                {r.doNot.map((d) => <li key={d}>{d}</li>)}
              </ul>
            </section>
          )}

          {r.dataPresent.length > 0 && (
            <section>
              <h3 className="h3">Data the Coach used</h3>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted">
                {r.dataPresent.map((m) => <li key={m}>{m}</li>)}
              </ul>
            </section>
          )}

          {r.missingData.length > 0 && (
            <section>
              <h3 className="h3">Missing data</h3>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted">
                {r.missingData.map((m) => <li key={m}>{m}</li>)}
              </ul>
            </section>
          )}

          {r.llmNarration && (
            <section>
              <h3 className="h3">Narration</h3>
              <p className="mt-2 whitespace-pre-wrap text-sm">{r.llmNarration}</p>
            </section>
          )}

          {r.guardrail && !r.guardrail.passed && (
            <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              Narration blocked by guardrail ({r.guardrail.flagged.join(', ')}). The deterministic report above is unaffected.
            </p>
          )}

          <p className="text-xs text-muted">{r.disclaimer}</p>
        </div>
      )}
    </div>
  );
}
