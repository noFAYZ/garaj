/**
 * Application assembly.
 *
 * Separate from `server.ts` so integration tests can build the whole app — plugins, routes,
 * validation, error handling — and drive it through `app.inject()` without binding a port
 * or racing another test suite for one.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import type { Database } from '@vehicle-os/database';
import type { Redis } from 'ioredis';
import type { StoragePort } from './infrastructure/storage/storage-port';
import type { AiProviderPort } from './modules/ai/infrastructure/ai-port';
import ajvFormats from 'ajv-formats';
import type { Plugin } from 'ajv';
import { env, isProduction } from '@vehicle-os/config';
import { newId } from '@vehicle-os/utils';

import errorHandler from './plugins/error-handler';
import databasePlugin from './plugins/database';
import redisPlugin from './plugins/redis';
import authPlugin from './plugins/auth';
import actorContext from './plugins/actor-context';
import requestContext from './plugins/request-context';
import security from './plugins/security';
import swagger from './plugins/swagger';
import storagePlugin from './plugins/storage';
import aiPlugin from './plugins/ai';
import planAccess from './plugins/plan-access';
import vehicleAccess from './plugins/vehicle-access';

import { healthRoutes } from './http/health.routes';
import { userRoutes } from './modules/users/http/routes/user.routes';
import { garageRoutes } from './modules/garages/http/routes/garage.routes';
import { vehicleRoutes } from './modules/vehicles/http/routes/vehicle.routes';
import { eventRoutes } from './modules/events/http/routes/event.routes';
import { billingRoutes } from './modules/billing/http/routes/billing.routes';
import { incomeRoutes } from './modules/income/http/routes/income.routes';
import { mileageRoutes } from './modules/events/http/routes/mileage.routes';
import { activityRoutes } from './modules/activity/http/routes/activity.routes';
import { photoRoutes } from './modules/photos/http/routes/photo.routes';
import { maintenanceRoutes } from './modules/maintenance/http/routes/maintenance.routes';
import { expenseRoutes } from './modules/expenses/http/routes/expense.routes';
import {
  documentRoutes,
  documentSummaryRoutes,
} from './modules/documents/http/routes/document.routes';
import { healthRoutes as vehicleHealthRoutes } from './modules/health/http/routes/health-score.routes';
import { searchRoutes } from './modules/search/http/routes/search.routes';
import { dashboardRoutes } from './modules/dashboard/http/routes/dashboard.routes';
import { conditionRoutes } from './modules/condition/http/routes/condition.routes';
import { valuationRoutes } from './modules/valuations/http/routes/valuation.routes';
import { publicPassportRoutes, sharingRoutes } from './modules/sharing/http/routes/sharing.routes';
import { taskRoutes } from './modules/tasks/http/routes/task.routes';
import { notificationRoutes } from './modules/notifications/http/routes/notification.routes';
import { aiRoutes } from './modules/ai/http/routes/ai.routes';
import { adminRoutes } from './modules/admin/http/routes/admin.routes';
import { apiKeyRoutes } from './modules/api-keys/api-key.routes';
import { mcpRoutes } from './modules/mcp/mcp.routes';
import {
  garageTransferRoutes,
  transferRoutes,
} from './modules/transfer/http/routes/transfer.routes';

export interface BuildAppOptions {
  /** Injected by integration tests, which own its lifetime. */
  db?: Database;
  /** `null` runs without Redis; rate limiting falls back to a per-process counter. */
  redis?: Redis | null;
  /** Injected by integration tests, which need to make an upload appear and disappear. */
  storage?: StoragePort;
  /** Supplied by integration tests, which must never reach a provider. */
  ai?: AiProviderPort;
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const config = env();

  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      // Pretty output locally; JSON lines in production where a log aggregator parses them.
      transport: isProduction(config)
        ? undefined
        : { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } },
      redact: {
        // These reach the logger through request headers and bodies on the auth routes.
        // Logging a session cookie makes the log file a set of live credentials.
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'res.headers["set-cookie"]',
          'req.body.password',
          'req.body.newPassword',
          'req.body.token',
        ],
        censor: '[redacted]',
      },
    },
    // Same v7 ids as the database, so a request id in a log line sorts chronologically
    // alongside the rows that request wrote.
    genReqId: () => newId(),
    // Behind a load balancer the socket address is the balancer's; the rate limiter and
    // audit log both need the real client, which arrives in X-Forwarded-For.
    trustProxy: isProduction(config),
    // Fastify's default 100 is generous for JSON but not for a base64 payload; documents
    // and photos never come through here, they go straight to object storage.
    bodyLimit: 1_048_576,
    ajv: {
      /*
       * `format` is an annotation in JSON Schema, not a constraint, so Ajv ignores every
       * `uuid`, `email` and `date-time` in the contracts until this plugin is registered.
       * Without it a malformed uuid reaches the database as a query parameter, and — worse
       * — the schemas read as if they validate something they do not.
       */
      plugins: [
        /*
         * Restricted to the formats the contracts actually use, so a typo like
         * `format: 'uri-reference'` fails loudly instead of silently validating nothing.
         *
         * The cast is an ajv-formats typing quirk: it declares its own `FormatsPlugin`
         * signature, which is structurally the same as Ajv's `Plugin` but not assignable
         * to it. Behaviour is unaffected.
         */
        [
          ajvFormats as unknown as Plugin<unknown>,
          { formats: ['uuid', 'email', 'date', 'date-time'] },
        ],
      ],
      customOptions: {
        /*
         * Fastify defaults this to `true`, which turns `additionalProperties: false` from a
         * rejection into a silent strip: a client sending `isAdmin: true` gets a 200 and no
         * hint that the field went nowhere. Explicitly off — rejecting is the honest answer
         * and it catches the client bug at the boundary.
         */
        removeAdditional: false,
        coerceTypes: 'array',
        useDefaults: true,
      },
    },
  });

  // Order matters: the error handler must be in place before anything that can fail, and
  // `security` needs Redis for its shared rate-limit counter.
  await app.register(errorHandler);
  await app.register(requestContext);
  await app.register(databasePlugin, { db: options.db });
  await app.register(redisPlugin, { client: options.redis });
  await app.register(security);
  await app.register(swagger);
  await app.register(storagePlugin, { storage: options.storage });
  await app.register(aiPlugin, { ai: options.ai });
  await app.register(authPlugin);
  await app.register(actorContext);
  await app.register(planAccess);
  await app.register(vehicleAccess);

  await app.register(
    async (api) => {
      await api.register(healthRoutes);
      await api.register(userRoutes, { prefix: '/users' });
      await api.register(garageRoutes, { prefix: '/garages' });
      await api.register(vehicleRoutes, { prefix: '/vehicles' });
      // Events and photos hang off a vehicle, so they share its prefix rather than
      // inventing a parallel top-level path that would need its own access resolution.
      await api.register(eventRoutes, { prefix: '/vehicles' });
      await api.register(incomeRoutes, { prefix: '/vehicles' });
      await api.register(billingRoutes, { prefix: '/billing' });
      await api.register(mileageRoutes, { prefix: '/vehicles' });
      await api.register(activityRoutes, { prefix: '/vehicles' });
      await api.register(photoRoutes, { prefix: '/vehicles' });
      await api.register(maintenanceRoutes, { prefix: '/vehicles' });
      await api.register(expenseRoutes, { prefix: '/vehicles' });
      await api.register(documentRoutes, { prefix: '/vehicles' });
      await api.register(documentSummaryRoutes, { prefix: '/documents' });
      await api.register(vehicleHealthRoutes, { prefix: '/vehicles' });
      await api.register(conditionRoutes, { prefix: '/vehicles' });
      await api.register(valuationRoutes, { prefix: '/vehicles' });
      await api.register(sharingRoutes, { prefix: '/vehicles' });
      await api.register(transferRoutes, { prefix: '/vehicles' });
      await api.register(garageTransferRoutes, { prefix: '/garages' });
      // The one unauthenticated read path in the system, kept under its own prefix so it is
      // obvious in the route table which endpoints do not require a session.
      await api.register(publicPassportRoutes, { prefix: '/public' });
      await api.register(searchRoutes, { prefix: '/search' });
      await api.register(dashboardRoutes, { prefix: '/dashboard' });
      await api.register(taskRoutes, { prefix: '/tasks' });
      await api.register(notificationRoutes, { prefix: '/notifications' });
      await api.register(aiRoutes, { prefix: '/ai' });
      await api.register(adminRoutes, { prefix: '/admin' });
      await api.register(apiKeyRoutes, { prefix: '/api-keys' });
      // Model Context Protocol: the API as tools an AI client can call, with the caller's key.
      await api.register(mcpRoutes, { prefix: '/mcp' });
      // The OpenAPI document, in every environment: the docs site and client generators read it.
      api.get('/openapi.json', { schema: { hide: true } }, async () => app.swagger());
    },
    { prefix: '/api/v1' },
  );

  return app;
}
