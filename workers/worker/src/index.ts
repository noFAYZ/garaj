/**
 * Worker process (Architecture.md §37).
 *
 * Deployed separately from the API so a slow job cannot consume the request-serving
 * process's event loop, and so the two scale independently. Needs Postgres and nothing else:
 * the outbox is the queue (`dispatcher.ts`).
 */

import pino from 'pino';
import { env, loadEnvFile } from '@vehicle-os/config';
import { createDatabase } from '@vehicle-os/database';
import { startRunner } from './dispatcher';
import { startScheduler } from './scheduler';

async function main(): Promise<void> {
  loadEnvFile();
  const config = env();
  const log = pino({ level: config.LOG_LEVEL, name: 'worker' });

  const { db, close: closeDb } = createDatabase({
    url: config.DATABASE_URL,
    maxConnections: config.DATABASE_POOL_MAX,
  });

  const stopScheduler = startScheduler(db, log);
  const stopRunner = startRunner({ db, log });
  log.info('Worker started');

  const shutdown = async (signal: string): Promise<void> => {
    log.info({ signal }, 'Shutting down worker');
    stopScheduler();
    // Waits for running jobs, so their database connection is not pulled out from under them.
    await stopRunner();
    await closeDb();
    process.exit(0);
  };

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => void shutdown(signal));
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
