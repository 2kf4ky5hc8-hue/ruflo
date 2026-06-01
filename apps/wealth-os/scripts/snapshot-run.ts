// One-shot daily snapshot runner. Designed for cron:
//   0 18 * * *   tsx scripts/snapshot-run.ts   # 18:00 UK every day
// Also useful as a manual smoke trigger:
//   pnpm snapshot:run [--force]
//
// Exits 0 on success, non-zero on failure.

import { runDailySnapshotForAllUsers } from '../src/services/portfolio-snapshots';
import { ukDayKey } from '../src/services/portfolio-snapshots';

const force = process.argv.includes('--force');

async function main(): Promise<void> {
  const now = new Date();
  const day = ukDayKey(now);
  console.log(`[snapshot:run] UK day=${day}  force=${force}`);

  const results = await runDailySnapshotForAllUsers({ now, force });
  const taken = results.filter((r) => !r.skipped);
  const skipped = results.filter((r) => r.skipped);

  for (const r of taken) {
    const m = r.metrics!;
    console.log(
      `  ✓ ${r.userId}  mv=£${m.totalMvGbp.toFixed(2)}  hwm=£${m.highWaterMarkGbp.toFixed(2)}` +
      `  dd=${(m.drawdownPct * 100).toFixed(2)}% (£${m.drawdownGbp.toFixed(2)})`,
    );
  }
  for (const r of skipped) {
    console.log(`  · ${r.userId}  skipped (${r.reason ?? 'idempotent'})`);
  }
  console.log(`[snapshot:run] done — ${taken.length} taken, ${skipped.length} skipped`);
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('[snapshot:run] failed:', err);
  process.exit(1);
});
