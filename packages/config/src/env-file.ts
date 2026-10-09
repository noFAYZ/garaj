/**
 * Locates and loads the repository's `.env`.
 *
 * In a monorepo every process starts in its own package directory, so `dotenv/config` —
 * which looks only at `process.cwd()` — finds nothing and the app reports a missing
 * `DATABASE_URL` while the file sits three levels up. Walking upward means one `.env` at the
 * root serves the API, the worker, the migration runner and drizzle-kit alike.
 *
 * The search stops at the workspace root rather than continuing to the filesystem root, so
 * an unrelated `.env` in a parent directory can never be picked up by accident.
 */

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { config } from 'dotenv';

const WORKSPACE_MARKER = 'pnpm-workspace.yaml';

export function loadEnvFile(startDir: string = process.cwd()): string | null {
  let dir = resolve(startDir);

  for (;;) {
    const candidate = join(dir, '.env');
    if (existsSync(candidate)) {
      // `override: false` is dotenv's default and the one that matters here: a variable
      // already set in the real environment (CI secrets, a container's config) wins over
      // whatever a stray local file says.
      config({ path: candidate });
      return candidate;
    }

    if (existsSync(join(dir, WORKSPACE_MARKER))) return null;

    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
