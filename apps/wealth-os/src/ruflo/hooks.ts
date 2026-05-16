// Scheduled jobs for wealth-os, registered against @claude-flow/hooks daemon.
// Each job is a pure handler that the hooks daemon invokes on its own cron.
// We keep job logic in wealth-os and only export the registration manifest
// — the daemon owns scheduling, retries, and observability.

export type CronExpression = string; // standard 5-field cron in UTC

export interface WealthJob {
  id: string;
  description: string;
  cron: CronExpression;            // UTC. Sunday 18:00 UK BST = 17:00 UTC.
  priority: 'low' | 'normal' | 'high' | 'critical';
  handler: () => Promise<void>;
  killSwitchEnv?: string;
}

// Handlers are imported lazily so registration has no side-effects.
async function runWeeklyReview() {
  const { generateWeeklyReview } = await import('../jobs/weekly-review');
  await generateWeeklyReview();
}

async function runIsaRecompute() {
  const { recomputeIsaYear } = await import('../jobs/isa-recompute');
  await recomputeIsaYear();
}

async function runDailyBreachScan() {
  const { scanForRiskBreaches } = await import('../jobs/breach-scan');
  await scanForRiskBreaches();
}

async function runOpportunityScan() {
  const { scanOpportunities } = await import('../jobs/opportunity-scan');
  await scanOpportunities();
}

async function runSpareCashCheck() {
  const { detectSpareCash } = await import('../jobs/spare-cash-check');
  await detectSpareCash();
}

async function runConsentExpiryReminder() {
  const { remindExpiringConsents } = await import('../jobs/consent-expiry');
  await remindExpiringConsents();
}

export const wealthJobs: WealthJob[] = [
  {
    id: 'wealth.weekly-review',
    description: 'Assemble weekly wealth review, persist as report, send email.',
    cron: '0 17 * * 0',                 // 17:00 UTC Sunday = 18:00 BST / 17:00 GMT
    priority: 'normal',
    handler: runWeeklyReview,
    killSwitchEnv: 'WEALTH_DISABLE_WEEKLY_REVIEW',
  },
  {
    id: 'wealth.isa-recompute',
    description: 'Recompute ISA year remaining allowance from deposits.',
    cron: '0 2 * * *',                  // 02:00 UTC daily
    priority: 'normal',
    handler: runIsaRecompute,
  },
  {
    id: 'wealth.daily-breach-scan',
    description: 'Scan portfolio against active risk profile; record breaches.',
    cron: '15 2 * * *',
    priority: 'high',
    handler: runDailyBreachScan,
  },
  {
    id: 'wealth.opportunity-scan',
    description: 'Run opportunity scanner v1 and persist top 20 daily.',
    cron: '30 6 * * 1-5',               // weekdays 06:30 UTC
    priority: 'normal',
    handler: runOpportunityScan,
  },
  {
    id: 'wealth.spare-cash-check',
    description: 'Detect spare-cash events above emergency-fund threshold.',
    cron: '0 7 * * *',
    priority: 'normal',
    handler: runSpareCashCheck,
  },
  {
    id: 'wealth.consent-expiry',
    description: 'Alert user 7 days before Open Banking consent expires.',
    cron: '0 8 * * *',
    priority: 'high',
    handler: runConsentExpiryReminder,
  },
];

export async function registerWealthJobs() {
  // The @claude-flow/hooks daemon's registry API: we resolve it dynamically so
  // wealth-os doesn't fail to load if the package isn't installed.
  let registry: { register?: (job: WealthJob) => Promise<void> | void } | null = null;
  try {
    const hooks = await import('@claude-flow/hooks');
    const r = (hooks as Record<string, unknown>).workerRegistry
      ?? (hooks as Record<string, unknown>).registry;
    registry = (r as { register?: (job: WealthJob) => Promise<void> | void }) ?? null;
  } catch {
    // hooks package not present; fall back to logging the manifest.
  }

  if (!registry?.register) {
    console.warn('[wealth-os] @claude-flow/hooks registry unavailable — jobs not scheduled');
    console.warn('[wealth-os] would have registered:', wealthJobs.map((j) => j.id).join(', '));
    return;
  }

  for (const job of wealthJobs) {
    if (job.killSwitchEnv && process.env[job.killSwitchEnv]) {
      console.warn(`[wealth-os] skipping ${job.id} (${job.killSwitchEnv} set)`);
      continue;
    }
    await registry.register(job);
  }
}

// Global kill switch — when WEALTH_MODE=observer, every job is a no-op.
export function isObserverMode(): boolean {
  return process.env.WEALTH_MODE === 'observer';
}
