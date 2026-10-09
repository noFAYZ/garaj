import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import { and, count, desc, eq, isNull } from 'drizzle-orm';
import { schema } from '@vehicle-os/database';
import {
  ApiKey,
  ApiKeyIdParam,
  CreateApiKey,
  CreatedApiKey,
  StandardErrors,
} from '@vehicle-os/contracts';
import type { ActorContext } from '@vehicle-os/domain';
import { recordAudit } from '../../infrastructure/audit';
import { ConflictError, ForbiddenError, NotFoundError } from '../../infrastructure/errors';
import { mintApiKey } from './api-key-token';
import { forgetApiKey } from '../../plugins/actor-context';

/** Enough for every device and integration a person runs; more is a key nobody tracks. */
const MAX_ACTIVE_KEYS = 20;

const DAY_MS = 24 * 60 * 60 * 1000;

const toApiKey = (row: typeof schema.apiKeys.$inferSelect) => ({
  id: row.id,
  name: row.name,
  prefix: row.prefix,
  createdAt: row.createdAt.toISOString(),
  lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
  expiresAt: row.expiresAt?.toISOString() ?? null,
});

/**
 * Managing keys takes a session, not a key: otherwise one leaked key could mint the next and
 * outlive every revocation. Listing is allowed either way — it shows no secret.
 */
function requireSession(actor: ActorContext): void {
  if (actor.credential === 'api-key') {
    throw new ForbiddenError('API keys cannot create or revoke API keys. Sign in to manage them.');
  }
}

export const apiKeyRoutes: FastifyPluginAsyncTypebox = async (fastify) => {
  fastify.get(
    '/',
    {
      schema: {
        tags: ['api-keys'],
        summary: 'Your active API keys',
        description:
          'Keys that are neither revoked nor expired. The keys themselves are never returned — only their prefix.',
        response: { 200: Type.Array(ApiKey), ...StandardErrors },
      },
    },
    async (request) => {
      const actor = await fastify.requireAuth(request);
      const rows = await fastify.db
        .select()
        .from(schema.apiKeys)
        .where(and(eq(schema.apiKeys.userId, actor.userId), isNull(schema.apiKeys.revokedAt)))
        .orderBy(desc(schema.apiKeys.createdAt));
      const now = Date.now();
      return rows.filter((row) => !row.expiresAt || row.expiresAt.getTime() > now).map(toApiKey);
    },
  );

  fastify.post(
    '/',
    {
      schema: {
        tags: ['api-keys'],
        summary: 'Create an API key',
        description:
          'Returns the key in full, once. Store it: it cannot be shown again. Send it as `Authorization: Bearer <key>`. Requires a signed-in session.',
        body: CreateApiKey,
        response: { 201: CreatedApiKey, ...StandardErrors },
      },
    },
    async (request, reply) => {
      const actor = await fastify.requireAuth(request);
      requireSession(actor);

      const [active] = await fastify.db
        .select({ total: count() })
        .from(schema.apiKeys)
        .where(and(eq(schema.apiKeys.userId, actor.userId), isNull(schema.apiKeys.revokedAt)));
      if ((active?.total ?? 0) >= MAX_ACTIVE_KEYS) {
        throw new ConflictError(
          'API_KEY_LIMIT',
          `You have ${MAX_ACTIVE_KEYS} active keys. Revoke one you no longer use first.`,
        );
      }

      const { token, tokenHash, prefix } = mintApiKey();
      const created = await fastify.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(schema.apiKeys)
          .values({
            userId: actor.userId,
            name: request.body.name.trim(),
            prefix,
            tokenHash,
            expiresAt: request.body.expiresInDays
              ? new Date(Date.now() + request.body.expiresInDays * DAY_MS)
              : null,
          })
          .returning();
        await recordAudit(tx, {
          actorId: actor.userId,
          actorEmail: actor.email,
          action: 'api_key.created',
          resourceType: 'api_key',
          resourceId: row!.id,
          metadata: { name: row!.name, prefix },
          requestId: request.id,
          ipAddress: request.ip,
        });
        return row!;
      });

      reply.status(201);
      return { ...toApiKey(created), token };
    },
  );

  fastify.delete(
    '/:keyId',
    {
      schema: {
        tags: ['api-keys'],
        summary: 'Revoke an API key',
        description: 'Takes effect immediately on this server. Requires a signed-in session.',
        params: ApiKeyIdParam,
        response: { 204: Type.Null(), ...StandardErrors },
      },
    },
    async (request, reply) => {
      const actor = await fastify.requireAuth(request);
      requireSession(actor);

      await fastify.db.transaction(async (tx) => {
        const [row] = await tx
          .update(schema.apiKeys)
          .set({ revokedAt: new Date() })
          .where(
            and(
              eq(schema.apiKeys.id, request.params.keyId),
              eq(schema.apiKeys.userId, actor.userId),
              isNull(schema.apiKeys.revokedAt),
            ),
          )
          .returning();
        // Someone else's key and a made-up id answer the same way.
        if (!row) throw new NotFoundError('API key');
        forgetApiKey(row.tokenHash);
        await recordAudit(tx, {
          actorId: actor.userId,
          actorEmail: actor.email,
          action: 'api_key.revoked',
          resourceType: 'api_key',
          resourceId: row.id,
          metadata: { name: row.name, prefix: row.prefix },
          requestId: request.id,
          ipAddress: request.ip,
        });
      });

      reply.status(204);
      return null;
    },
  );
};
