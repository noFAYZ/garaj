/**
 * Database client. One pool per process; `postgres.js` over `pg` because Drizzle's
 * prepared-statement support and its transaction API are both better exercised there.
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import postgres from 'postgres';
import * as schema from './schema/index';

/**
 * Deliberately the driver-agnostic base type, not `PostgresJsDatabase`.
 *
 * Repositories only ever issue queries, so pinning them to one driver buys nothing and
 * costs the ability to run the same code against PGlite in tests — real Postgres, in
 * process, no container to wait for.
 */
export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

/** A transaction handle. Repositories accept `Database | Transaction` so the same method
 * works standalone or inside a unit of work (Architecture.md §51). */
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export type Executor = Database | Transaction;

export interface CreateDatabaseOptions {
  readonly url: string;
  readonly maxConnections?: number;
  readonly onNotice?: (notice: unknown) => void;
}

export function createDatabase(options: CreateDatabaseOptions): {
  db: Database;
  close: () => Promise<void>;
} {
  const sql = postgres(options.url, {
    max: options.maxConnections ?? 10,
    // Drizzle builds its own parameterised statements; letting postgres.js also prepare
    // them breaks behind transaction-mode poolers such as PgBouncer.
    prepare: false,
    /*
     * No `pg_type` lookup on every new connection. postgres.js uses it only to parse Postgres
     * array columns, and this schema has none — while against a hosted database the lookup
     * added a round trip to each connection the pool opened.
     */
    fetch_types: false,
    onnotice: options.onNotice ?? (() => {}),
    /*
     * `SQL_DEBUG=1` prints every statement the process issues.
     *
     * Kept because the question it answers — "how many round trips does one request cost?" —
     * is the one that matters against a hosted database, and counting them by reading code
     * is how you miss the two the auth layer adds.
     */
    debug: process.env.SQL_DEBUG
      ? // eslint-disable-next-line no-console -- a debug hook is exactly what stdout is for
        (_connection, query) => console.log('SQL>', query.replace(/\s+/g, ' ').slice(0, 100))
      : undefined,
  });

  return {
    db: drizzle(sql, { schema }),
    close: () => sql.end({ timeout: 5 }),
  };
}

export { schema };
