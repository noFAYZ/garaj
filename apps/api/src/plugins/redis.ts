/**
 * Redis plugin. Backs the shared rate-limit counter in production; jobs run from the Postgres
 * outbox, not Redis.
 *
 * Nullable on purpose: integration tests run the whole app in-process with no external
 * services, and rate limiting degrades to a per-process counter rather than the app
 * refusing to start.
 */

import fp from 'fastify-plugin';
import { Redis } from 'ioredis';
import { env } from '@vehicle-os/config';

declare module 'fastify' {
  interface FastifyInstance {
    redis: Redis | null;
  }
}

export interface RedisPluginOptions {
  /** `null` skips the connection entirely. */
  client?: Redis | null;
}

export default fp<RedisPluginOptions>(
  async (fastify, options) => {
    const url = env().REDIS_URL;
    if (options.client === null || (!options.client && !url)) {
      fastify.decorate('redis', null);
      fastify.log.warn('Redis not configured: rate limiting is per-process only.');
      return;
    }

    const client =
      options.client ??
      new Redis(url!, {
        /*
         * Fail fast. Every use here sits in front of a request (the rate limiter, health,
         * the admin console), so a dead connection must cost a request a moment, not hold it.
         * `null` — retry forever — is a BullMQ requirement, and the API runs no BullMQ.
         */
        maxRetriesPerRequest: 1,
        commandTimeout: 2000,
        lazyConnect: true,
        // Each connect otherwise spends billed commands before doing anything: an INFO for the
        // ready check and two CLIENT SETINFO calls. Dev restarts reconnect all day.
        enableReadyCheck: false,
        disableClientInfo: true,
      });

    client.on('error', (error) => fastify.log.error({ err: error }, 'Redis error'));
    // Not fatal: Redis is optional here, and ioredis keeps reconnecting in the background.
    if (client.status === 'wait') {
      await client
        .connect()
        .catch((error: unknown) => fastify.log.error({ err: error }, 'Redis unreachable at boot'));
    }

    fastify.decorate('redis', client);
    fastify.addHook('onClose', async () => {
      await client.quit();
    });
  },
  { name: 'redis' },
);
