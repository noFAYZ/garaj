/**
 * ActorContext (Architecture.md §12).
 *
 * The adapter between "who is authenticated" and "what may they do". Routes read
 * `request.actor` and never touch the auth provider, so replacing Better Auth changes
 * `auth.ts` and this file only.
 *
 * Memberships are loaded from the database on each authenticated request. That is the
 * security-critical part: a `garageId` in a URL or body is an argument to be checked
 * against this list, never evidence of access (§13).
 */

import fp from 'fastify-plugin';
import { eq } from 'drizzle-orm';
import { schema } from '@vehicle-os/database';
import { can, type ActorContext, type Capability } from '@vehicle-os/domain';
import { ForbiddenError, NotFoundError, UnauthorizedError } from '../infrastructure/errors';
import { hashApiKey, isApiKey } from '../modules/api-keys/api-key-token';

declare module 'fastify' {
  interface FastifyRequest {
    /** Present only after `requireAuth`; undefined on public routes. */
    actor?: ActorContext;
  }
  interface FastifyInstance {
    requireAuth: (request: FastifyRequest) => Promise<ActorContext>;
    /** Throws unless the actor holds `capability` in `garageId`. */
    requireCapability: (
      request: FastifyRequest,
      capability: Capability,
      garageId: string,
    ) => ActorContext;
  }
}

import type { FastifyRequest } from 'fastify';

/*
 * Who a credential belongs to, remembered briefly in this process.
 *
 * The web's session rides a signed cookie cache (see `auth.ts`), but the phone authenticates
 * with a bearer token that cache never sees — so every mobile request paid two database round
 * trips (sessions, then users) before doing anything, over a second against a hosted Postgres
 * in another region. This removes them for repeat requests.
 *
 * Only the identity is cached, never memberships: those are read fresh below, so a garage
 * created a moment ago is usable on the next request. The cost is revocation lag — a session
 * ended from another device stays accepted here for up to `SESSION_TTL_MS`, shorter than the
 * cookie cache's five minutes. Signing out through this API forgets the entry at once.
 *
 * ponytail: per-process Map with a size cap, not Redis. Each API instance warms its own; the
 * upgrade is a shared cache if instances multiply and the misses start to show.
 */
const SESSION_TTL_MS = 60_000;
const SESSION_CACHE_MAX = 5_000;

interface CachedSession {
  readonly userId: string;
  readonly email: string;
  readonly sessionId: string;
  readonly expiresAt: number;
}

const sessionCache = new Map<string, CachedSession>();

interface CachedKey {
  readonly keyId: string;
  readonly userId: string;
  readonly email: string;
  readonly expiresAt: number;
}

/*
 * Personal API keys, by the hash of the key — never the key itself, even in memory longer than
 * the request. Same lifetime and cap as sessions; revoking through this API drops the entry at
 * once (`forgetApiKey`), so the lag only applies to a revocation made by another instance.
 */
const keyCache = new Map<string, CachedKey>();

export function forgetApiKey(tokenHash: string): void {
  keyCache.delete(tokenHash);
}

function remember<T>(cache: Map<string, T>, key: string, value: T): void {
  if (cache.size >= SESSION_CACHE_MAX) {
    // Oldest first: a Map iterates in insertion order.
    cache.delete(cache.keys().next().value!);
  }
  cache.set(key, value);
}

/*
 * Who is online: the last time each person made a signed-in request. Sessions cannot say —
 * one lives seven days and its `updated_at` moves at most daily — so the count comes from
 * requests, recorded here where every one is already identified. API keys are scripts, not
 * people, and are left out.
 *
 * ponytail: per-process, like the caches above; with several API instances each sees only
 * its own traffic. The upgrade is a Redis sorted set (ZADD on request, ZCOUNT to read).
 */
export const ONLINE_WINDOW_MS = 5 * 60_000;
const lastSeen = new Map<string, number>();

/** People with a signed-in request in the last five minutes; forgets everyone older. */
export function onlineCount(now = Date.now()): number {
  for (const [userId, at] of lastSeen) {
    if (now - at > ONLINE_WINDOW_MS) lastSeen.delete(userId);
  }
  return lastSeen.size;
}

export function markSeen(userId: string, now = Date.now()): void {
  lastSeen.set(userId, now);
}

/** The credential a request carries: the bearer token, else the session cookie. */
function credentialOf(request: FastifyRequest): string | null {
  const authorization = request.headers.authorization;
  if (authorization?.startsWith('Bearer ')) return authorization;
  const cookie = request.headers.cookie;
  const token = cookie?.match(/(?:^|;\s*)((?:__Secure-)?better-auth\.session_token=[^;]+)/)?.[1];
  return token ?? null;
}

export default fp(
  (fastify) => {
    async function membershipsOf(userId: string) {
      return fastify.db
        .select({
          garageId: schema.garageMembers.garageId,
          role: schema.garageMembers.role,
        })
        .from(schema.garageMembers)
        .where(eq(schema.garageMembers.userId, userId));
    }

    /** A `gk_` key: its owner, in every garage they belong to, marked as acting by key. */
    async function loadKeyActor(token: string): Promise<ActorContext | null> {
      const tokenHash = hashApiKey(token);
      let identity = keyCache.get(tokenHash);
      if (!identity || identity.expiresAt <= Date.now()) {
        const [row] = await fastify.db
          .select({
            id: schema.apiKeys.id,
            userId: schema.apiKeys.userId,
            expiresAt: schema.apiKeys.expiresAt,
            revokedAt: schema.apiKeys.revokedAt,
            lastUsedAt: schema.apiKeys.lastUsedAt,
            email: schema.users.email,
          })
          .from(schema.apiKeys)
          .innerJoin(schema.users, eq(schema.users.id, schema.apiKeys.userId))
          .where(eq(schema.apiKeys.tokenHash, tokenHash))
          .limit(1);
        const now = Date.now();
        if (!row || row.revokedAt || (row.expiresAt && row.expiresAt.getTime() <= now)) {
          keyCache.delete(tokenHash);
          return null;
        }
        identity = {
          keyId: row.id,
          userId: row.userId,
          email: row.email,
          expiresAt: Math.min(now + SESSION_TTL_MS, row.expiresAt?.getTime() ?? Infinity),
        };
        remember(keyCache, tokenHash, identity);
        // At most once a minute: a write on every request would make every read a write.
        if (!row.lastUsedAt || now - row.lastUsedAt.getTime() > SESSION_TTL_MS) {
          void fastify.db
            .update(schema.apiKeys)
            .set({ lastUsedAt: new Date(now) })
            .where(eq(schema.apiKeys.id, row.id))
            .catch((error: unknown) => fastify.log.warn({ error }, 'api key last-used not saved'));
        }
      }
      return {
        userId: identity.userId,
        email: identity.email,
        sessionId: `api-key:${identity.keyId}`,
        credential: 'api-key',
        memberships: await membershipsOf(identity.userId),
      };
    }

    async function loadActor(request: FastifyRequest): Promise<ActorContext | null> {
      const authorization = request.headers.authorization;
      if (authorization?.startsWith('Bearer ')) {
        const token = authorization.slice('Bearer '.length).trim();
        // Told apart by shape, before the auth provider is asked about a token it never issued.
        if (isApiKey(token)) return loadKeyActor(token);
      }

      const credential = credentialOf(request);
      if (!credential) return null;

      // Signing out ends the session in the database; forget it here in the same request.
      if (request.url.startsWith('/api/auth/sign-out')) sessionCache.delete(credential);

      let identity = sessionCache.get(credential);
      if (!identity || identity.expiresAt <= Date.now()) {
        const headers = new Headers();
        for (const [key, value] of Object.entries(request.headers)) {
          if (typeof value === 'string') headers.append(key, value);
        }
        const session = await fastify.auth.api.getSession({ headers });
        if (!session?.user) {
          sessionCache.delete(credential);
          return null;
        }
        identity = {
          userId: session.user.id,
          email: session.user.email,
          sessionId: session.session.id,
          // Never past the session's own expiry.
          expiresAt: Math.min(
            Date.now() + SESSION_TTL_MS,
            new Date(session.session.expiresAt).getTime(),
          ),
        };
        remember(sessionCache, credential, identity);
      }

      return {
        userId: identity.userId,
        email: identity.email,
        sessionId: identity.sessionId,
        credential: 'session',
        memberships: await membershipsOf(identity.userId),
      };
    }

    /*
     * Resolved once per request and cached on it. Without the cache a route that checks
     * three capabilities issues three session lookups and three membership queries, which
     * shows up directly in the p95 target.
     */
    fastify.addHook('onRequest', async (request) => {
      const actor = await loadActor(request);
      if (actor) request.actor = actor;
      if (actor?.credential === 'session') markSeen(actor.userId);
    });

    fastify.decorate('requireAuth', async (request: FastifyRequest) => {
      if (!request.actor) throw new UnauthorizedError();
      return request.actor;
    });

    fastify.decorate(
      'requireCapability',
      (request: FastifyRequest, capability: Capability, garageId: string) => {
        const actor = request.actor;
        if (!actor) throw new UnauthorizedError();

        if (!can(actor, capability, garageId)) {
          /*
           * Two different failures, two different answers. A non-member must not learn the
           * garage exists, so they get 404 — the same response a made-up id produces. A
           * member who simply lacks the capability already knows it exists, so 403 is the
           * honest and more useful answer.
           */
          const isMember = actor.memberships.some((m) => m.garageId === garageId);
          if (!isMember) throw new NotFoundError('Garage');
          throw new ForbiddenError(`Missing capability: ${capability}`);
        }

        return actor;
      },
    );
  },
  { name: 'actor-context', dependencies: ['auth', 'database'] },
);
