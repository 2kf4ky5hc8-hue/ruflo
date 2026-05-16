// Singleton Drizzle client. Reused across the app and the seed/check scripts.

import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../db/schema/index';
import { env } from './env';

const sqlClient = postgres(env.DATABASE_URL, { max: 10 });
export const db = drizzle(sqlClient, { schema });
export { schema };
