/**
 * Transport-level protections (Architecture.md §55, §56).
 */

import fp from 'fastify-plugin';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { env, isProduction } from '@vehicle-os/config';

export default fp(
  async (fastify) => {
    const config = env();

    await fastify.register(helmet, {
      // The API serves JSON and the Swagger UI; CSP here would only govern the docs page,
      // and the web app sets its own. Left off so it is not two half-configured policies.
      contentSecurityPolicy: false,
    });

    await fastify.register(cors, {
      origin: [config.WEB_URL, config.ADMIN_URL],
      // Sessions ride in a cookie, so the browser only sends them when this is on — and it
      // is why `origin` must stay an explicit list rather than `true`.
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    });

    await fastify.register(rateLimit, {
      max: isProduction(config) ? 300 : 10_000,
      timeWindow: '1 minute',
      /*
       * Shared counter across instances, in production only.
       *
       * A per-process limit multiplies by the replica count and stops meaning anything once
       * the API scales horizontally — but every check is a round trip to Redis, and against
       * a hosted Redis in another region that is ~250 ms added to every single request.
       * Development runs one process, where the in-process LRU is both accurate and free;
       * production pays for the shared counter and should keep its Redis in the same region
       * as the API.
       */
      redis: isProduction(config) ? (fastify.redis ?? undefined) : undefined,
      /*
       * A Redis that errors (down, or a hosted plan out of quota) lets the request through
       * unlimited rather than failing it. The default is to throw, which turned one exhausted
       * Redis quota into a 500 on every route of an API that otherwise never needs Redis.
       */
      skipOnError: true,
      // Falls back to the socket address when there is no actor: an unauthenticated flood
      // is precisely the case the limit exists for.
      keyGenerator: (request) => request.actor?.userId ?? request.ip,
      errorResponseBuilder: (request, context) => ({
        error: {
          code: 'RATE_LIMITED',
          message: `Too many requests. Retry in ${context.after}.`,
          requestId: request.id,
        },
      }),
    });
  },
  { name: 'security', dependencies: ['redis'] },
);
