// Verify the wealth-os database is bootstrapped correctly.
// Exits non-zero on failure. Prints a coloured checklist.

import postgres from 'postgres';

const url = process.env.DATABASE_URL ?? 'postgres://wealth_os:wealth_os@localhost:5432/wealth_os';
const sql = postgres(url, { max: 1, idle_timeout: 5 });

const GREEN = '\x1b[32m', RED = '\x1b[31m', DIM = '\x1b[2m', RESET = '\x1b[0m';

interface CheckResult { name: string; ok: boolean; detail: string; }
const results: CheckResult[] = [];

async function check(name: string, fn: () => Promise<string>): Promise<void> {
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail });
  } catch (err) {
    results.push({ name, ok: false, detail: (err as Error).message });
  }
}

const EXPECTED_TABLES = [
  'users', 'sessions', 'audit_events', 'recovery_codes',
  'institutions', 'connections', 'accounts',
  'categories', 'category_rules', 'transactions',
  'instruments', 'holdings', 'lots', 'corporate_actions', 'prices', 'fundamentals',
  'isa_years', 'isa_deposits',
  'businesses', 'business_metrics', 'business_obligations',
  'debt_items', 'insurance_policies', 'fee_schedules',
  'risk_profiles', 'risk_breaches', 'allocation_rules', 'spare_cash_events',
  'opportunities', 'research_notes', 'proposed_actions', 'goals', 'reports', 'agent_runs',
  'paper_positions', 'paper_fills', 'portfolio_snapshots',
];

const EXPECTED_USER_COLUMNS = [
  'password_hash', 'totp_secret_encrypted', 'totp_enrolled_at',
  'monthly_income_gbp', 'monthly_expenses_gbp', 'onboarded_at',
];

async function main() {
  await check('database connection', async () => {
    const [row] = await sql`SELECT 1 AS ok`;
    if (row?.ok !== 1) throw new Error('SELECT 1 returned unexpected value');
    return 'SELECT 1 ok';
  });

  await check('expected tables exist', async () => {
    const rows = await sql<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public'
    `;
    const have = new Set(rows.map((r) => r.table_name));
    const missing = EXPECTED_TABLES.filter((t) => !have.has(t));
    if (missing.length) throw new Error(`missing tables: ${missing.join(', ')}`);
    return `${have.size} public tables (all ${EXPECTED_TABLES.length} expected present)`;
  });

  await check('auth + onboarding columns on users', async () => {
    const rows = await sql<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'users'
    `;
    const have = new Set(rows.map((r) => r.column_name));
    const missing = EXPECTED_USER_COLUMNS.filter((c) => !have.has(c));
    if (missing.length) throw new Error(`missing columns on users: ${missing.join(', ')}`);
    return `users has ${EXPECTED_USER_COLUMNS.length}/${EXPECTED_USER_COLUMNS.length} auth+onboarding columns`;
  });

  await check('seed user exists', async () => {
    const rows = await sql<{ id: string; email: string; risk_profile: string }[]>`
      SELECT id, email, risk_profile FROM users ORDER BY created_at LIMIT 1
    `;
    if (!rows.length) throw new Error('no users seeded');
    return `${rows[0]!.email}  (risk_profile=${rows[0]!.risk_profile})`;
  });

  await check('aggressive risk profile is active', async () => {
    const rows = await sql<{ name: string; active: boolean }[]>`
      SELECT name, active FROM risk_profiles WHERE active = true
    `;
    if (rows.length !== 1) throw new Error(`expected 1 active profile, got ${rows.length}`);
    if (rows[0]!.name !== 'aggressive') throw new Error(`active profile is ${rows[0]!.name}, not aggressive`);
    return 'aggressive is the sole active risk profile';
  });

  await check('three risk profile presets seeded', async () => {
    const rows = await sql<{ name: string }[]>`
      SELECT name FROM risk_profiles ORDER BY name
    `;
    const names = rows.map((r) => r.name).join(', ');
    const required = ['aggressive', 'balanced', 'conservative'];
    for (const r of required) if (!names.includes(r)) throw new Error(`missing preset: ${r}`);
    return names;
  });

  await check('aggressive allocation rule is active', async () => {
    const rows = await sql<{ preset: string; active: boolean }[]>`
      SELECT preset, active FROM allocation_rules WHERE active = true
    `;
    if (rows.length !== 1) throw new Error(`expected 1 active allocation rule, got ${rows.length}`);
    if (rows[0]!.preset !== 'aggressive') throw new Error(`active allocation is ${rows[0]!.preset}, not aggressive`);
    return 'aggressive allocation is active';
  });

  await check('current UK ISA year seeded (2026/27)', async () => {
    const rows = await sql<{ tax_year: number; allowance: string; remaining: string }[]>`
      SELECT tax_year, allowance::text, remaining::text FROM isa_years
       ORDER BY tax_year DESC LIMIT 1
    `;
    if (!rows.length) throw new Error('no isa_years row');
    const r = rows[0]!;
    if (r.tax_year !== 2026) throw new Error(`active tax year is ${r.tax_year}, expected 2026 (2026/27)`);
    if (Number(r.allowance) !== 20000) throw new Error(`ISA allowance is ${r.allowance}, expected 20000`);
    if (Number(r.remaining) !== 20000) throw new Error(`ISA remaining is ${r.remaining}, expected 20000`);
    return `tax_year=${r.tax_year}/${(r.tax_year + 1).toString().slice(2)}  allowance=£${Number(r.allowance).toFixed(0)}  remaining=£${Number(r.remaining).toFixed(0)}`;
  });

  await check('institutions seeded (UK banks + brokers)', async () => {
    const rows = await sql<{ count: string }[]>`
      SELECT count(*)::text FROM institutions
    `;
    const n = Number(rows[0]!.count);
    if (n < 5) throw new Error(`only ${n} institutions seeded`);
    return `${n} institutions seeded`;
  });

  await check('default categories seeded', async () => {
    const rows = await sql<{ kind: string; n: string }[]>`
      SELECT kind, count(*)::text AS n FROM categories GROUP BY kind ORDER BY kind
    `;
    if (rows.length < 3) throw new Error('expected income/expense/transfer/investment categories');
    const summary = rows.map((r) => `${r.kind}=${r.n}`).join('  ');
    return summary;
  });

  await check('audit_events table is writable (smoke)', async () => {
    await sql`
      INSERT INTO audit_events (actor, action, entity_type)
      VALUES ('db-check', 'verify', 'system')
    `;
    const [row] = await sql<{ n: string }[]>`SELECT count(*)::text AS n FROM audit_events`;
    return `audit_events rows: ${row!.n}`;
  });

  // Print
  let allOk = true;
  console.log(`${DIM}database: ${url.replace(/:[^/@]+@/, ':****@')}${RESET}`);
  for (const r of results) {
    const tag = r.ok ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
    console.log(`  ${tag} ${r.name.padEnd(42)} ${DIM}${r.detail}${RESET}`);
    if (!r.ok) allOk = false;
  }

  await sql.end();
  if (!allOk) {
    console.error(`\n${RED}db:check FAILED${RESET}`);
    process.exit(1);
  }
  console.log(`\n${GREEN}db:check OK${RESET}`);
}

main().catch(async (err) => {
  console.error(err);
  await sql.end().catch(() => {});
  process.exit(1);
});
