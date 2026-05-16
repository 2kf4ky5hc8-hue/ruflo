// Lazy Drizzle client. The connection is only opened on first property
// access — importing this module is free, which keeps unit tests and
// pure-logic imports from accidentally hitting the network.
//
// Call sites continue to `import { db } from '../lib/db'` unchanged; the
// proxy forwards every access to the real client on first use.

import postgres, { type Sql } from 'postgres';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../db/schema/index';
import { env } from './env';

type Schema = typeof schema;
type Db = PostgresJsDatabase<Schema>;

let _client: Sql<{}> | null = null;
let _db: Db | null = null;

export function getDb(): Db {
  if (_db) return _db;
  _client = postgres(env.DATABASE_URL, { max: 10 });
  _db = drizzle(_client, { schema });
  return _db;
}

// For tests / scripts that want to close the connection cleanly.
export async function closeDb(): Promise<void> {
  if (_client) {
    await _client.end();
    _client = null;
    _db = null;
  }
}

// Proxy keeps the `db` import contract — every property access lazily
// constructs the underlying client and forwards to it. Functions are bound
// to the real instance so Drizzle's fluent chain ($-this) keeps working.
export const db: Db = new Proxy({} as Db, {
  get(_target, prop, receiver) {
    const inst = getDb() as unknown as Record<PropertyKey, unknown>;
    const v = Reflect.get(inst, prop, receiver);
    return typeof v === 'function' ? (v as Function).bind(inst) : v;
  },
});

export { schema };
