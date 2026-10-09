/**
 * Liveness and readiness. Not a domain module — it reports on the process, not the product.
 */

import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { sql } from 'drizzle-orm';
import { HealthResponse } from '@vehicle-os/contracts';

const startedAt = Date.now();

export const healthRoutes: FastifyPluginAsyncTypebox = async (fastify) => {
  fastify.get(
    '/health',
    {
      schema: {
        tags: ['system'],
        summary: 'Service health',
        security: [],
        response: { 200: HealthResponse, 503: HealthResponse },
      },
    },
    async (_request, reply) => {
      /*
       * Redis is read from the connection's state, not pinged. A load balancer probes every few
       * seconds and each PING is a billed command on a hosted plan — tens of thousands a day to
       * learn what the client already knows. The client reconnects on its own; `ready` is it
       * connected now.
       */
      const client = fastify.redis;
      const redis = !client ? 'disabled' : client.status === 'ready' ? 'up' : 'down';
      const database = await probe(() => fastify.db.execute(sql`select 1`));

      const status = database === 'up' && redis !== 'down' ? 'ok' : 'degraded';
      const body = {
        status,
        version: process.env.npm_package_version ?? '0.1.0',
        uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
        checks: { database, redis },
      } as const;

      return reply.status(status === 'ok' ? 200 : 503).send(body);
    },
  );
};

async function probe(check: () => Promise<unknown>): Promise<'up' | 'down'> {
  try {
    await check();
    return 'up';
  } catch {
    return 'down';
  }
}
