/**
 * Migration drift detection.
 *
 * The test suite builds its schema from `src/schema` directly on PGlite, so a migration that
 * was never applied to the real database passes every test and then fails in the browser —
 * which is exactly how `documents.uploaded_at` shipped missing. CI's `db:generate` check only
 * proves the migration *files* match the code, not that anyone ran them.
 *
 * This closes that gap at the one moment it can be closed cheaply: startup. A process that
 * refuses to boot and says which migration is missing costs a deploy; one that boots and
 * 500s on a single route costs an afternoon of looking in the wrong place.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import type { Database } from './client';

interface JournalEntry {
  readonly idx: number;
  readonly when: number;
  readonly tag: string;
}

export const MIGRATIONS_FOLDER = resolve(dirname(fileURLToPath(import.meta.url)), '../migrations');

function readJournal(folder: string): JournalEntry[] {
  const raw = readFileSync(join(folder, 'meta', '_journal.json'), 'utf8');
  return (JSON.parse(raw) as { entries: JournalEntry[] }).entries;
}

/**
 * The migrations on disk that the database has not run.
 *
 * Compared by `created_at`, which is what Drizzle's migrator writes from the journal's
 * `when` — the tag is not stored, so counting how many have been applied and taking the
 * journal's tail is the only mapping available. That holds because migrations are immutable
 * once applied (§66): the journal only ever grows at the end.
 */
export async function pendingMigrations(
  db: Database,
  folder = MIGRATIONS_FOLDER,
): Promise<string[]> {
  const entries = readJournal(folder);

  let applied: number;
  try {
    const result = await db.execute(
      sql`select count(*)::int as count from drizzle.__drizzle_migrations`,
    );
    /*
     * `execute` returns a different shape per driver — an array on postgres-js, `{ rows }`
     * on PGlite — and this runs against both. Normalising here rather than picking one is
     * the whole reason the repositories use the driver-agnostic `Database` type.
     */
    const rows = (
      Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? [])
    ) as { count: number | string }[];
    applied = Number(rows[0]?.count ?? 0);
  } catch {
    // No migrations table at all: nothing has ever been applied to this database.
    applied = 0;
  }

  return entries.slice(applied).map((entry) => entry.tag);
}

export class MigrationDriftError extends Error {
  constructor(readonly pending: readonly string[]) {
    super(
      `The database is behind the code by ${pending.length} ` +
        `${pending.length === 1 ? 'migration' : 'migrations'}: ${pending.join(', ')}. ` +
        'Run `pnpm db:migrate`.',
    );
    this.name = 'MigrationDriftError';
  }
}

/** Throws unless every migration on disk has been applied. */
export async function assertNoMigrationDrift(
  db: Database,
  folder = MIGRATIONS_FOLDER,
): Promise<void> {
  const pending = await pendingMigrations(db, folder);
  if (pending.length > 0) throw new MigrationDriftError(pending);
}
