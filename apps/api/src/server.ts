/**
 * Process entry point. Everything about *what* the app is lives in `app.ts`; this file only
 * starts it and stops it cleanly.
 */

import { env, loadEnvFile } from '@vehicle-os/config';
import { assertNoMigrationDrift } from '@vehicle-os/database';
import { buildApp } from './app';

async function main(): Promise<void> {
  // Before `env()`, which parses and caches on first call.
  loadEnvFile();
  const config = env();
  const app = await buildApp();

  /*
   * Refuse to serve against a database that is behind the code.
   *
   * The test suite builds its schema from `src/schema` on PGlite, so a migration nobody ran
   * passes every test and then 500s on one route in the browser. Failing here names the
   * missing migration instead; the alternative is finding out from a user.
   *
   * Checked after `buildApp` so the database plugin has opened its pool, and before
   * `listen`, so a process in this state never takes traffic.
   */
  await assertNoMigrationDrift(app.db);

  /*
   * Graceful shutdown. Without it a rolling deploy kills the process mid-request: the
   * client sees a connection reset, and an in-flight transaction is abandoned rather than
   * rolled back deliberately. `app.close()` drains connections and fires the `onClose`
   * hooks that end the database pool and the Redis client.
   */
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      app.log.info({ signal }, 'Shutting down');
      void app
        .close()
        .then(() => process.exit(0))
        .catch((error: unknown) => {
          app.log.error({ err: error }, 'Error during shutdown');
          process.exit(1);
        });
    });
  }

  await app.listen({ host: config.API_HOST, port: config.API_PORT });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
