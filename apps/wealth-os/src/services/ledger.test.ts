// Integration test for I-108 duplicate detection on CSV commit.
// Requires DATABASE_URL with the schema applied + seed (db:bootstrap).

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { users, transactions } from '../db/schema/index';
import { addAccount, commitImportedRows, deleteAccount, accountBalance } from './ledger';
import { detectAndParse } from './csv-import';

const URL = process.env.DATABASE_URL ?? 'postgres://wealth_os:wealth_os@localhost:5432/wealth_os';
let sqlClient: ReturnType<typeof postgres>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: PostgresJsDatabase<any>;
let userId: string;
let accountId: string;

const CSV = [
  'Date,Description,Money In,Money Out',
  '2026-05-01,Salary,3000.00,',
  '2026-05-02,Rent,,1200.00',
  '2026-05-03,Tesco,,85.40',
].join('\n');

beforeAll(async () => {
  sqlClient = postgres(URL, { max: 1 });
  db = drizzle(sqlClient);
  const [u] = await db.select({ id: users.id }).from(users).limit(1);
  if (!u) throw new Error('Run pnpm db:bootstrap first.');
  userId = u.id;
  accountId = await addAccount(userId, { name: 'Dedupe test acct', type: 'cash' });
});

afterAll(async () => {
  await deleteAccount(userId, accountId).catch(() => {});
  await sqlClient.end();
});

describe('commitImportedRows — I-108 dedupe', () => {
  it('inserts all rows on first import', async () => {
    const rows = detectAndParse(CSV).rows;
    const res = await commitImportedRows(userId, accountId, rows);
    expect(res.inserted).toBe(3);
    expect(res.skipped).toBe(0);
    expect(await accountBalance(accountId)).toBeCloseTo(3000 - 1200 - 85.4, 2);
  });

  it('skips all rows when the same statement is re-imported', async () => {
    const rows = detectAndParse(CSV).rows;
    const res = await commitImportedRows(userId, accountId, rows);
    expect(res.inserted).toBe(0);
    expect(res.skipped).toBe(3);
    // Balance unchanged — no double counting.
    expect(await accountBalance(accountId)).toBeCloseTo(3000 - 1200 - 85.4, 2);
  });

  it('imports only the genuinely new rows from an overlapping statement', async () => {
    const overlapping = [
      'Date,Description,Money In,Money Out',
      '2026-05-02,Rent,,1200.00',        // dup
      '2026-05-03,Tesco,,85.40',         // dup
      '2026-05-04,Refund,12.00,',        // new
    ].join('\n');
    const rows = detectAndParse(overlapping).rows;
    const res = await commitImportedRows(userId, accountId, rows);
    expect(res.inserted).toBe(1);
    expect(res.skipped).toBe(2);
  });

  it('dedupes within a single batch (same row twice in one file)', async () => {
    const dupBatch = [
      'Date,Description,Money In,Money Out',
      '2026-06-01,Bonus,500.00,',
      '2026-06-01,Bonus,500.00,',        // identical within the batch
    ].join('\n');
    const rows = detectAndParse(dupBatch).rows;
    const res = await commitImportedRows(userId, accountId, rows);
    expect(res.inserted).toBe(1);
    expect(res.skipped).toBe(1);
  });
});
