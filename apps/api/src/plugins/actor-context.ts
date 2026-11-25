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
import {
  findVehicleById,
  type VehicleWithPhoto,
} from '../modules/vehicles/infrastructure/repositories/vehicle-repository';

declare module 'fastify' {
  interface FastifyRequest {
    /** Present only after `requireAuth`; undefined on public routes. */
    actor?: ActorContext;
    /** The route's vehicle, already asked for — taken once by `requireVehicleAccess`. */
    vehicleLookup?: { readonly id: string; readonly row: Promise<VehicleWithPhoto | null> };
    /** `membershipEpoch` when the request arrived; see `membershipCache`. */
    membershipEpoch?: number;
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
 * The cost is revocation lag — a session ended from another device stays accepted here for up
 * to `SESSION_TTL_MS`, shorter than the cookie cache's five minutes. Signing out through this
 * API forgets the entry at once.
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

/*
 * Lookups in flight, by credential. A phone opening a screen sends half a dozen requests at once;
 * when the cached entry has lapsed, each one asked Better Auth (two queries apiece) about the
 * same token. They now share the first one's answer.
 */
const sessionLookups = new Map<string, Promise<CachedSession | null>>();

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

/*
 * Each person's garages and roles, by user id, for the same minute.
 *
 * Read on every signed-in request, so it was a database query on every request: on Render's 0.1
 * CPU, one of the two or three each request makes. Every write to `garage_members` goes through
 * the garage repository, which clears the whole map (`forgetMemberships`), as do the two deletes
 * that cascade into it (a garage, a user). That clear lands mid-transaction, so a read in between
 * could still cache the old rows: every request that saw a clear happen while it ran clears again
 * once its response is ready, after the writer's commit.
 *
 * The promise is cached, not the rows, so a screen's parallel requests share one query.
 *
 * ponytail: per-process like the caches above. With several instances, a member removed on one
 * keeps their access on another for up to `SESSION_TTL_MS`; the upgrade is a Redis pub/sub clear.
 */
interface CachedMemberships {
  readonly memberships: Promise<ActorContext['memberships']>;
  readonly expiresAt: number;
}

const membershipCache = new Map<string, CachedMemberships>();
let membershipEpoch = 0;

export function forgetMemberships(): void {
  membershipEpoch++;
  membershipCache.clear();
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    function membershipsOf(userId: string): Promise<ActorContext['memberships']> {
      const cached = membershipCache.get(userId);
      if (cached && cached.expiresAt > Date.now()) return cached.memberships;
      const memberships = fastify.db
        .select({
          garageId: schema.garageMembers.garageId,
          role: schema.garageMembers.role,
        })
        .from(schema.garageMembers)
        .where(eq(schema.garageMembers.userId, userId))
        .then((rows) => rows);
      const entry = { memberships, expiresAt: Date.now() + SESSION_TTL_MS };
      remember(membershipCache, userId, entry);
      // A failed read is not remembered; the next request tries again.
      memberships.catch(() => {
        if (membershipCache.get(userId) === entry) membershipCache.delete(userId);
      });
      return memberships;
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

      /*
       * Signing out ends the session in the database; forget it here in the same request, and
       * do not look it up again — the provider still has it until this request's handler runs,
       * and caching it then kept a signed-out token working for another minute.
       */
      if (request.url.startsWith('/api/auth/sign-out')) {
        sessionCache.delete(credential);
        sessionLookups.delete(credential);
        return null;
      }

      let identity: CachedSession | null | undefined = sessionCache.get(credential);
      if (!identity || identity.expiresAt <= Date.now()) {
        let lookup = sessionLookups.get(credential);
        if (!lookup) {
          const headers = new Headers();
          for (const [key, value] of Object.entries(request.headers)) {
            if (typeof value === 'string') headers.append(key, value);
          }
          const pending: Promise<CachedSession | null> = fastify.auth.api
            .getSession({ headers })
            .then((session) =>
              session?.user
                ? {
                    userId: session.user.id,
                    email: session.user.email,
                    sessionId: session.session.id,
                    // Never past the session's own expiry.
                    expiresAt: Math.min(
                      Date.now() + SESSION_TTL_MS,
                      new Date(session.session.expiresAt).getTime(),
                    ),
                  }
                : null,
            );
          lookup = pending;
          sessionLookups.set(credential, pending);
          // Registered before anyone awaits it, so the cache is settled when they resume.
          pending.then(
            (found) => {
              // A sign-out while it was in flight dropped it; its answer is not kept.
              if (sessionLookups.get(credential) !== pending) return;
              sessionLookups.delete(credential);
              if (found) remember(sessionCache, credential, found);
              else sessionCache.delete(credential);
            },
            () => {
              if (sessionLookups.get(credential) === pending) sessionLookups.delete(credential);
            },
          );
        }
        identity = await lookup;
        if (!identity) return null;
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
      /*
       * A vehicle route's vehicle is read alongside the caller's memberships rather than after
       * them: the access check needs both, and neither depends on the other, so a phone opening
       * a vehicle — a dozen requests at once — pays one round trip to the database before the
       * work instead of two. Only for a signed-in request, and only a well-formed id; the check
       * itself still happens in `requireVehicleAccess`.
       */
      const vehicleId = (request.params as { vehicleId?: unknown } | undefined)?.vehicleId;
      if (typeof vehicleId === 'string' && UUID.test(vehicleId) && credentialOf(request)) {
        const row = findVehicleById(fastify.db, vehicleId);
        // Awaited by the route, or dropped with a request that is refused first.
        row.catch(() => undefined);
        request.vehicleLookup = { id: vehicleId, row };
      }

      request.membershipEpoch = membershipEpoch;
      const actor = await loadActor(request);
      if (actor) request.actor = actor;
      if (actor?.credential === 'session') markSeen(actor.userId);
    });

    // See `membershipCache`: a membership write while this request ran clears again, post-commit.
    fastify.addHook('onSend', async (request, _reply, payload) => {
      if (request.membershipEpoch !== membershipEpoch) membershipCache.clear();
      return payload;
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
