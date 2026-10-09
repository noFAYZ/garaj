/**
 * Database plugin: one pool for the process, closed on shutdown so a `tsx watch` restart
 * does not leak connections until Postgres refuses new ones.
 */

import fp from 'fastify-plugin';
import { createDatabase, type Database } from '@vehicle-os/database';
import { env } from '@vehicle-os/config';

declare module 'fastify' {
  interface FastifyInstance {
    db: Database;
  }
}

export interface DatabasePluginOptions {
  /** Supplied by integration tests; the caller then owns closing it. */
  db?: Database;
}

export default fp<DatabasePluginOptions>(
  async (fastify, options) => {
    if (options.db) {
      fastify.decorate('db', options.db);
      return;
    }

    const config = env();
    const { db, close } = createDatabase({
      url: config.DATABASE_URL,
      maxConnections: config.DATABASE_POOL_MAX,
      onNotice: (notice) => fastify.log.debug({ notice }, 'postgres notice'),
    });

    fastify.decorate('db', db);
    fastify.addHook('onClose', async () => {
      await close();
    });
  },
  { name: 'database' },
);
