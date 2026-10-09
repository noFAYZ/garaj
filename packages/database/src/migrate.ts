/**
 * Migration runner. Separate from the API process so a deploy can run migrations as a
 * distinct step and fail before any new application container starts serving (§66).
 *
 * Builds its own postgres-js handle rather than reusing `createDatabase`: the migrator is
 * driver-specific, while `Database` is deliberately the driver-agnostic type the rest of
 * the codebase queries through.
 */

import { loadEnvFile } from '@vehicle-os/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), '../migrations');

async function main(): Promise<void> {
  loadEnvFile();
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set. Copy .env.example to .env at the repo root.');

  // A single connection: DDL spread across a pool can interleave and deadlock on the same
  // table, and there is nothing to gain from concurrency here anyway.
  const sql = postgres(url, { max: 1 });
  try {
    await migrate(drizzle(sql), { migrationsFolder });
    console.warn('Migrations applied.');
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
