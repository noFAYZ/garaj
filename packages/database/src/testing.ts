/**
 * Test database (Architecture.md §72, "isolated test databases").
 *
 * PGlite is real PostgreSQL compiled to WebAssembly, running inside the test process. It
 * executes the same migrations as production, so constraints, enums, partial indexes and
 * `on conflict` behave identically — unlike an SQLite stand-in, which would quietly accept
 * schemas the real database rejects.
 *
 * Each call gets its own in-memory instance, so suites cannot see each other's rows.
 * Exported from a separate entry point so nothing in the API can import it by accident.
 */

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import * as schema from './schema/index';
import type { Database } from './client';

const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), '../migrations');

export interface TestDatabase {
  readonly db: Database;
  readonly close: () => Promise<void>;
  /** Empties every table but keeps the schema — far cheaper than rebuilding per test. */
  readonly truncateAll: () => Promise<void>;
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const client = new PGlite();
  const db = drizzle(client, { schema });

  await migrate(db, { migrationsFolder });

  return {
    db: db as unknown as Database,
    close: () => client.close(),
    async truncateAll() {
      /*
       * One statement for every table, with CASCADE so the foreign keys do not dictate a
       * delete order that has to be maintained by hand as tables are added. The table list
       * comes from the catalogue rather than a hardcoded array for the same reason.
       */
      const result = await client.query<{ tablename: string }>(
        `select tablename from pg_tables where schemaname = 'public' and tablename <> '__drizzle_migrations'`,
      );
      const tables = result.rows.map((row) => `"${row.tablename}"`).join(', ');
      if (tables) await client.exec(`truncate table ${tables} restart identity cascade`);
    },
  };
}
