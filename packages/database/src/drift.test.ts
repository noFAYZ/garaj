import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { sql } from 'drizzle-orm';
import * as schema from './schema/index';
import type { Database } from './client';
import { assertNoMigrationDrift, MigrationDriftError, pendingMigrations } from './drift';

/**
 * A database with nothing applied.
 *
 * Deliberately not `createTestDatabase`, which runs every migration — the state worth
 * testing here is the one that shipped a 500 to the browser: a database behind the code.
 */
const clients: PGlite[] = [];

function bareDatabase(): Database {
  const client = new PGlite();
  clients.push(client);
  return drizzle(client, { schema }) as unknown as Database;
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

/** A journal with `count` entries, in a throwaway folder. */
function journalWith(count: number): string {
  const folder = mkdtempSync(join(tmpdir(), 'drift-'));
  mkdirSync(join(folder, 'meta'), { recursive: true });
  writeFileSync(
    join(folder, 'meta', '_journal.json'),
    JSON.stringify({
      version: '7',
      dialect: 'postgresql',
      entries: Array.from({ length: count }, (_, index) => ({
        idx: index,
        version: '7',
        when: 1_700_000_000_000 + index,
        tag: `000${index}_migration`,
      })),
    }),
  );
  return folder;
}

async function markApplied(db: Database, count: number): Promise<void> {
  await db.execute(sql`create schema if not exists drizzle`);
  await db.execute(
    sql`create table if not exists drizzle.__drizzle_migrations (
          id serial primary key,
          hash text not null,
          created_at bigint
        )`,
  );
  for (let index = 0; index < count; index++) {
    await db.execute(
      sql`insert into drizzle.__drizzle_migrations (hash, created_at) values (${`h${index}`}, ${index})`,
    );
  }
}

describe('pendingMigrations', () => {
  /*
   * The exact state that shipped a 500: the code expects a column, and the database has
   * never had the migration that adds it.
   */
  it('reports every migration when the database has never been migrated', async () => {
    const pending = await pendingMigrations(bareDatabase(), journalWith(3));

    expect(pending).toEqual(['0000_migration', '0001_migration', '0002_migration']);
  });

  it('reports nothing when everything on disk has been applied', async () => {
    const db = bareDatabase();
    await markApplied(db, 2);

    expect(await pendingMigrations(db, journalWith(2))).toEqual([]);
  });

  /** Only the tail: migrations are immutable (§66), so the journal only grows at the end. */
  it('reports only the migrations added after the last applied one', async () => {
    const db = bareDatabase();
    await markApplied(db, 2);

    expect(await pendingMigrations(db, journalWith(4))).toEqual([
      '0002_migration',
      '0003_migration',
    ]);
  });

  it('does not complain when the database is ahead of the checkout', async () => {
    const db = bareDatabase();
    await markApplied(db, 5);

    // Someone on an older branch against a migrated database: nothing is *missing*, which
    // is the only question this guard is asking.
    expect(await pendingMigrations(db, journalWith(3))).toEqual([]);
  });
});

describe('assertNoMigrationDrift', () => {
  it('throws with the missing migrations named', async () => {
    const db = bareDatabase();
    await markApplied(db, 2);

    await expect(assertNoMigrationDrift(db, journalWith(4))).rejects.toBeInstanceOf(
      MigrationDriftError,
    );
    await expect(assertNoMigrationDrift(db, journalWith(4))).rejects.toThrow(
      /0002_migration, 0003_migration.*pnpm db:migrate/s,
    );
  });

  it('passes when the database is up to date', async () => {
    const db = bareDatabase();
    await markApplied(db, 2);

    await expect(assertNoMigrationDrift(db, journalWith(2))).resolves.toBeUndefined();
  });

  /** The real folder against a fully migrated database — the check this repo actually runs. */
  it('passes for this repository’s own migrations', async () => {
    const { createTestDatabase } = await import('./testing');
    const database = await createTestDatabase();
    try {
      await expect(assertNoMigrationDrift(database.db)).resolves.toBeUndefined();
    } finally {
      await database.close();
    }
  });
});
