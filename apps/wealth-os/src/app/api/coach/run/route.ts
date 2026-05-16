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
      report: result.report,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
