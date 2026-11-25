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
import { runDue, startRunner } from './dispatcher';
import { enqueueSlot, lastSlot, SCHEDULED_JOBS, startScheduler } from './scheduler';

/** How long one `--once` pass may run: under the 5-minute schedule, so runs rarely overlap. */
const ONCE_BUDGET_MS = 4 * 60_000;

async function main(): Promise<void> {
  loadEnvFile();
  const config = env();
  const log = pino({ level: config.LOG_LEVEL, name: 'worker' });

  const { db, close: closeDb } = createDatabase({
    url: config.DATABASE_URL,
    maxConnections: config.DATABASE_POOL_MAX,
  });

  /*
   * One pass and exit, for a Cloud Run job started every 5 minutes (scripts/deploy-gcp.sh):
   * free-tier hosting instead of an always-on process. Queues any scheduled job whose slot has
   * passed (the key dedupes it), then drains the outbox until a pass finds nothing due.
   * ponytail: a job can wait up to 5 minutes; run the loop below instead when that matters.
   */
  if (process.argv.includes('--once')) {
    const until = Date.now() + ONCE_BUDGET_MS;
    for (const job of SCHEDULED_JOBS) await enqueueSlot(db, log, job, lastSlot(job, new Date()));
    let ran = Infinity;
    while (ran > 0 && Date.now() < until) {
      const result = await runDue({ db, log }, 8);
      ran = result.completed + result.failed + result.deadLettered;
      if (ran > 0) log.info(result, 'Worker pass');
    }
    await closeDb();
    return;
  }

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
