// Long-running daily-snapshot daemon.
//
// Wakes up every hour, checks the UK calendar day, and takes the daily
// snapshot for every user IF they don't already have one for today.
// Idempotency is enforced by `runDailySnapshot` (UK day key).
//
//   pnpm snapshot:daemon            # runs forever, takes a snapshot at boot
//   pnpm snapshot:daemon --no-boot  # waits for the first hourly tick
//
// Production usage: run under systemd / pm2 / fly machines / etc. Or use cron
// to call `pnpm snapshot:run` once a day — both paths are equivalent.

import { runDailySnapshotForAllUsers, ukDayKey } from '../src/services/portfolio-snapshots';

const ONE_HOUR_MS = 60 * 60 * 1000;
const TICK_MS = Number(process.env.SNAPSHOT_TICK_MS ?? ONE_HOUR_MS);

let stopping = false;
let lastDay = '';

async function tick(): Promise<void> {
  if (stopping) return;
  const now = new Date();
  const day = ukDayKey(now);
  try {
    const results = await runDailySnapshotForAllUsers({ now });
    const taken = results.filter((r) => !r.skipped).length;
    const skipped = results.filter((r) => r.skipped).length;
    if (taken > 0 || day !== lastDay) {
      console.log(`[snapshot:daemon] ${now.toISOString()}  day=${day}  taken=${taken}  skipped=${skipped}`);
      lastDay = day;
    }
  } catch (err) {
    console.error('[snapshot:daemon] tick failed:', err);
  }
}

async function main(): Promise<void> {
  const noBoot = process.argv.includes('--no-boot');
  console.log(`[snapshot:daemon] starting (tick every ${(TICK_MS / 1000).toFixed(0)}s, no-boot=${noBoot})`);

  if (!noBoot) await tick();

  const interval = setInterval(() => { void tick(); }, TICK_MS);

  const shutdown = (sig: string) => {
    console.log(`[snapshot:daemon] ${sig} — shutting down`);
    stopping = true;
    clearInterval(interval);
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('[snapshot:daemon] fatal:', err);
  process.exit(1);
});
