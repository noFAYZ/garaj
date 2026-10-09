/**
 * The admin console's API (apps/admin).
 *
 * Deployment-wide management: every account, garage and vehicle, the audit trail, and the
 * feature flags both apps run under. Access is `ADMIN_USER_IDS` — a list in the environment
 * rather than a column, so no request, bug or SQL injection can make someone an admin; only a
 * redeploy can.
 *
 * Every write lands in the audit log with an `admin.` action, in the same transaction.
 *
 * ponytail: offset pagination and `ilike` search. Fine to tens of thousands of rows; past that,
 * keyset cursors and a trigram index on email/name.
 */

import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import type { FastifyRequest } from 'fastify';
import { Type } from '@sinclair/typebox';
import {
  and,
  asc,
  countDistinct,
  desc,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import {
  defaultFlags,
  env,
  FEATURE_FLAGS,
  flagAvailable,
  flagOverrides,
  objectStorage,
  resolveFlags,
  setFlagOverrides,
  type FlagOverrides,
} from '@vehicle-os/config';
import { Nullable, UpdateUserProfile } from '@vehicle-os/contracts';
import { schema } from '@vehicle-os/database';
import { PLAN_TIERS, VEHICLE_STATUSES, VEHICLE_TYPES } from '@vehicle-os/domain';
import { recordAudit } from '../../../../infrastructure/audit';
import { onlineCount } from '../../../../plugins/actor-context';
import { ConflictError, ForbiddenError, NotFoundError } from '../../../../infrastructure/errors';

/** A subscription the provider is still billing, or retrying. */
const LIVE_STATUSES = new Set(['ACTIVE', 'TRIALING', 'PAST_DUE']);
import { deleteGarage } from '../../../garages/infrastructure/repositories/garage-repository';
import { getCurrentUser } from '../../../users/application/queries/get-current-user';
import { updateUserPreferences } from '../../../users/application/commands/update-user-preferences';
import { serializeUser } from '../../../users/http/serializers/user-serializer';
import { daysFrom, insightsRoutes, windowStart } from './insights.routes';

const {
  users,
  sessions,
  subscriptions,
  garages,
  garageMembers,
  vehicles,
  vehicleEvents,
  vehiclePhotos,
  expenses,
  documents,
  tasks,
  maintenancePlans,
  auditLogs,
  aiRequests,
  notificationDeliveries: deliveries,
  outboxMessages: outbox,
} = schema;

/** A signed photo link is good for an hour: longer than anyone keeps a sheet open. */
const PHOTO_TTL_SECONDS = 3600;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function adminIds(): Set<string> {
  return new Set(
    env()
      .ADMIN_USER_IDS.split(',')
      .map((id) => id.trim())
      .filter(Boolean),
  );
}

const IdParam = Type.Object({ id: Type.String({ format: 'uuid' }) });
const ListQuery = Type.Object({
  q: Type.Optional(Type.String({ maxLength: 120 })),
  limit: Type.Integer({ minimum: 1, maximum: 100, default: 50 }),
  offset: Type.Integer({ minimum: 0, default: 0 }),
});
const literals = <T extends string>(values: readonly T[]) =>
  Type.Union(values.map((value) => Type.Literal(value)));

const UserListQuery = Type.Object({
  ...ListQuery.properties,
  /** A tier, or `PAID` for any tier above Free. */
  plan: Type.Optional(literals([...PLAN_TIERS, 'PAID'])),
  verified: Type.Optional(Type.Boolean()),
  sort: Type.Optional(literals(['newest', 'oldest', 'seen', 'name'])),
});
const GarageListQuery = Type.Object({
  ...ListQuery.properties,
  sort: Type.Optional(literals(['newest', 'vehicles', 'members', 'name'])),
});
const VehicleListQuery = Type.Object({
  ...ListQuery.properties,
  type: Type.Optional(literals(VEHICLE_TYPES)),
  status: Type.Optional(literals(VEHICLE_STATUSES)),
});
/** `q` matches the action or the actor; `action` is a prefix (`garage.`); `actor` an exact email. */
const AuditFilter = {
  q: Type.Optional(Type.String({ maxLength: 120 })),
  action: Type.Optional(Type.String({ maxLength: 60 })),
  actor: Type.Optional(Type.String({ maxLength: 200 })),
};
const AuditQuery = Type.Object({ ...ListQuery.properties, ...AuditFilter });
const AuditVolumeQuery = Type.Object({
  ...AuditFilter,
  days: Type.Integer({ minimum: 7, maximum: 90, default: 30 }),
});
const ERROR_SOURCES = ['ai', 'email', 'push', 'outbox'] as const;
const ErrorsQuery = Type.Object({
  limit: ListQuery.properties.limit,
  offset: ListQuery.properties.offset,
  source: Type.Optional(literals(ERROR_SOURCES)),
});

const UpdateUser = Type.Object(
  {
    ...UpdateUserProfile.properties,
    emailVerified: Type.Optional(Type.Boolean()),
    plan: Type.Optional(Type.Union(PLAN_TIERS.map((tier) => Type.Literal(tier)))),
  },
  { additionalProperties: false },
);

const UpdateFlags = Type.Object(
  Object.fromEntries(FEATURE_FLAGS.map((flag) => [flag, Type.Optional(Nullable(Type.Boolean()))])),
  { additionalProperties: false },
);

/** `%` and `_` typed into the search box are letters, not wildcards. */
const escapeLike = (q: string) => q.replace(/[\\%_]/g, (c) => `\\${c}`);
const like = (q: string) => `%${escapeLike(q)}%`;

/** One page, plus whether there is another — fetched as `limit + 1` rows. */
function page<T>(rows: T[], limit: number) {
  return { data: rows.slice(0, limit), hasMore: rows.length > limit };
}

/** The audit log's filters, shared by the list and its volume by day. */
function auditWhere({ q, action, actor }: { q?: string; action?: string; actor?: string }) {
  const term = q?.trim();
  return and(
    term
      ? or(ilike(auditLogs.action, like(term)), ilike(auditLogs.actorEmail, like(term)))
      : undefined,
    action ? ilike(auditLogs.action, `${escapeLike(action)}%`) : undefined,
    actor ? eq(auditLogs.actorEmail, actor) : undefined,
  );
}

/** When each user last made a signed-in request, as far as their sessions say. */
const lastSeen = sql<
  string | null
>`(select max(${sessions.updatedAt}) from ${sessions} where ${sessions.userId} = ${users.id})`;

function flagState() {
  const config = env();
  const defaults = defaultFlags(config);
  const effective = resolveFlags(config);
  const overrides = flagOverrides();
  return FEATURE_FLAGS.map((flag) => ({
    flag,
    enabled: effective[flag],
    default: defaults[flag],
    override: overrides[flag] ?? null,
    available: flagAvailable(config, flag),
  }));
}

export const adminRoutes: FastifyPluginAsyncTypebox = async (fastify) => {
  const db = fastify.db;

  /*
   * Overrides are loaded once the app is ready. A database that has not run the migration yet
   * boots with the defaults and says why, rather than refusing to start over a toggle.
   */
  fastify.addHook('onReady', async () => {
    try {
      const [row] = await db
        .select({ value: schema.appSettings.value })
        .from(schema.appSettings)
        .where(eq(schema.appSettings.key, 'flags'));
      setFlagOverrides((row?.value ?? {}) as FlagOverrides);
    } catch (error) {
      fastify.log.warn({ err: error }, 'Flag overrides not loaded — run `pnpm db:migrate`');
    }
  });

  // Before validation, so a non-admin learns nothing about the shapes these routes accept.
  fastify.addHook('onRequest', async (request) => {
    const actor = await fastify.requireAuth(request);
    if (!adminIds().has(actor.userId)) throw new ForbiddenError('Admin access required');
  });

  // Analytics and system state, behind the same gate (a child plugin inherits the hook above).
  await fastify.register(insightsRoutes);

  const audit = (
    request: FastifyRequest,
    action: string,
    resourceType: string,
    resourceId: string | null,
    metadata: Record<string, unknown> = {},
  ) => ({
    actorId: request.actor!.userId,
    actorEmail: request.actor!.email,
    action: `admin.${action}`,
    resourceType,
    resourceId,
    metadata,
    requestId: request.id,
    ipAddress: request.ip,
  });

  const vehicleColumns = {
    id: vehicles.id,
    nickname: vehicles.nickname,
    make: vehicles.make,
    model: vehicles.model,
    year: vehicles.year,
    vehicleType: vehicles.vehicleType,
    status: vehicles.status,
    registrationIdentifier: vehicles.registrationIdentifier,
    currentOdometer: vehicles.currentOdometer,
    odometerUnit: vehicles.odometerUnit,
    createdAt: vehicles.createdAt,
  };

  // --- Overview -------------------------------------------------------------

  fastify.get('/overview', { schema: { tags: ['admin'] } }, async () => {
    const config = env();
    const weekAgo = new Date(Date.now() - 7 * 86_400_000);
    const people = (query: Promise<{ n: number }[]>) => query.then(([row]) => Number(row?.n ?? 0));
    const [
      userCount,
      newUsers,
      unverified,
      garageCount,
      vehicleCount,
      plans,
      inGarage,
      withVehicle,
      withRecord,
      fleet,
    ] = await Promise.all([
      db.$count(users),
      db.$count(users, gt(users.createdAt, weekAgo)),
      db.$count(users, eq(users.emailVerified, false)),
      db.$count(garages),
      db.$count(vehicles, isNull(vehicles.deletedAt)),
      db
        .select({ plan: subscriptions.plan, count: sql<number>`count(*)::int` })
        .from(subscriptions)
        .where(sql`${subscriptions.plan} <> 'FREE'`)
        .groupBy(subscriptions.plan),
      /*
       * Activation, as the steps a new account takes: in a garage, with a vehicle in it, and
       * something written in a logbook. Each step counts people, not rows.
       */
      people(db.select({ n: countDistinct(garageMembers.userId) }).from(garageMembers)),
      people(
        db
          .select({ n: countDistinct(garageMembers.userId) })
          .from(garageMembers)
          .innerJoin(
            vehicles,
            and(eq(vehicles.garageId, garageMembers.garageId), isNull(vehicles.deletedAt)),
          ),
      ),
      people(db.select({ n: countDistinct(vehicleEvents.createdBy) }).from(vehicleEvents)),
      db
        .select({ type: vehicles.vehicleType, count: sql<number>`count(*)::int` })
        .from(vehicles)
        .where(isNull(vehicles.deletedAt))
        .groupBy(vehicles.vehicleType)
        .orderBy(sql`count(*) desc`),
    ]);

    return {
      counts: {
        users: userCount,
        newUsers,
        unverified,
        garages: garageCount,
        vehicles: vehicleCount,
        // People, not sessions: a signed-in request in the last five minutes.
        online: onlineCount(),
      },
      funnel: { garage: inGarage, vehicle: withVehicle, record: withRecord },
      vehicleTypes: fleet.map((row) => ({ type: row.type, count: Number(row.count) })),
      plans: Object.fromEntries(plans.map((row) => [row.plan, Number(row.count)])),
      environment: config.NODE_ENV,
      // Configured or not — never the values.
      integrations: [
        {
          name: 'Object storage',
          detail: 'Photos and documents',
          on: objectStorage(config) !== null,
        },
        { name: 'Redis', detail: 'Shared rate limits, job queue', on: Boolean(config.REDIS_URL) },
        { name: 'AI provider', detail: config.AI_MODEL, on: Boolean(config.AI_API_KEY) },
        { name: 'Stripe', detail: 'Billing and plans', on: Boolean(config.STRIPE_SECRET_KEY) },
        {
          name: 'Stripe webhook',
          detail: 'Plan changes from Stripe',
          on: Boolean(config.STRIPE_WEBHOOK_SECRET),
        },
        { name: 'Resend', detail: 'Email notifications', on: Boolean(config.RESEND_API_KEY) },
        {
          name: 'Expo push',
          detail: 'Mobile push (optional token)',
          on: Boolean(config.EXPO_ACCESS_TOKEN),
        },
        {
          name: 'Background removal',
          detail: 'Vehicle thumbnails',
          on: Boolean(config.BG_REMOVAL_API_KEY),
        },
        { name: 'Sentry', detail: 'Error reporting', on: Boolean(config.SENTRY_DSN) },
        { name: 'PostHog', detail: 'Product analytics', on: Boolean(config.POSTHOG_KEY) },
      ],
    };
  });

  // --- Users ----------------------------------------------------------------

  fastify.get(
    '/users',
    { schema: { tags: ['admin'], querystring: UserListQuery } },
    async (request) => {
      const { q, limit, offset, plan, verified, sort = 'newest' } = request.query;
      const term = q?.trim();
      const tier = sql`coalesce(${subscriptions.plan}, 'FREE')`;
      const where = and(
        term ? or(ilike(users.email, like(term)), ilike(users.name, like(term))) : undefined,
        plan === 'PAID' ? sql`${tier} <> 'FREE'` : plan ? sql`${tier} = ${plan}` : undefined,
        verified === undefined ? undefined : eq(users.emailVerified, verified),
      );
      const order = {
        newest: [desc(users.createdAt)],
        oldest: [asc(users.createdAt)],
        seen: [sql`${lastSeen} desc nulls last`, desc(users.createdAt)],
        name: [asc(sql`lower(${users.name})`), asc(users.email)],
      }[sort];
      const rows = await db
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
          image: users.image,
          emailVerified: users.emailVerified,
          createdAt: users.createdAt,
          plan: sql<string>`${tier}`,
          garages: sql<number>`(select count(*)::int from ${garageMembers} where ${garageMembers.userId} = ${users.id})`,
          lastSeenAt: lastSeen,
        })
        .from(users)
        .leftJoin(subscriptions, eq(subscriptions.userId, users.id))
        .where(where)
        .orderBy(...order)
        .limit(limit + 1)
        .offset(offset);
      const admins = adminIds();
      return page(
        rows.map((row) => ({ ...row, isAdmin: admins.has(row.id) })),
        limit,
      );
    },
  );

  fastify.get('/users/:id', { schema: { tags: ['admin'], params: IdParam } }, async (request) => {
    const { id } = request.params;
    const [account] = await db
      .select({ emailVerified: users.emailVerified, createdAt: users.createdAt })
      .from(users)
      .where(eq(users.id, id));
    if (!account) throw new NotFoundError('User');

    const [profile, [subscription], memberships, activeSessions, [usage], devices] =
      await Promise.all([
        getCurrentUser(db, id),
        db
          .select({
            plan: subscriptions.plan,
            status: subscriptions.status,
            stripeCustomerId: subscriptions.stripeCustomerId,
            stripeSubscriptionId: subscriptions.stripeSubscriptionId,
            currentPeriodEnd: subscriptions.currentPeriodEnd,
            cancelAtPeriodEnd: subscriptions.cancelAtPeriodEnd,
          })
          .from(subscriptions)
          .where(eq(subscriptions.userId, id)),
        db
          .select({
            garageId: garages.id,
            name: garages.name,
            role: garageMembers.role,
            vehicles: sql<number>`(select count(*)::int from ${vehicles} where ${vehicles.garageId} = ${garages.id} and ${vehicles.deletedAt} is null)`,
          })
          .from(garageMembers)
          .innerJoin(garages, eq(garages.id, garageMembers.garageId))
          .where(eq(garageMembers.userId, id))
          .orderBy(garages.name),
        // The token never leaves the server: it is the credential itself.
        db
          .select({
            id: sessions.id,
            ipAddress: sessions.ipAddress,
            userAgent: sessions.userAgent,
            createdAt: sessions.createdAt,
            updatedAt: sessions.updatedAt,
            expiresAt: sessions.expiresAt,
          })
          .from(sessions)
          .where(and(eq(sessions.userId, id), gt(sessions.expiresAt, new Date())))
          .orderBy(desc(sessions.updatedAt)),
        // The last 30 days of what this account cost in provider calls.
        db
          .select({
            aiRequests: sql<number>`(select count(*)::int from ${schema.aiRequests} where ${schema.aiRequests.userId} = ${id} and ${schema.aiRequests.createdAt} > now() - interval '30 days')`,
            aiTokens: sql<number>`(select coalesce(sum(${schema.aiRequests.inputTokens} + ${schema.aiRequests.outputTokens}), 0)::int from ${schema.aiRequests} where ${schema.aiRequests.userId} = ${id} and ${schema.aiRequests.createdAt} > now() - interval '30 days')`,
            emails: sql<number>`(select count(*)::int from ${schema.notificationDeliveries} where ${schema.notificationDeliveries.userId} = ${id} and ${schema.notificationDeliveries.channel} = 'EMAIL' and ${schema.notificationDeliveries.status} = 'sent' and ${schema.notificationDeliveries.createdAt} > now() - interval '30 days')`,
            pushes: sql<number>`(select count(*)::int from ${schema.notificationDeliveries} where ${schema.notificationDeliveries.userId} = ${id} and ${schema.notificationDeliveries.channel} = 'PUSH' and ${schema.notificationDeliveries.status} = 'sent' and ${schema.notificationDeliveries.createdAt} > now() - interval '30 days')`,
            notifications: sql<number>`(select count(*)::int from ${schema.notifications} where ${schema.notifications.userId} = ${id} and ${schema.notifications.createdAt} > now() - interval '30 days')`,
          })
          .from(sql`(select 1) as one`),
        db
          .select({
            platform: schema.deviceTokens.platform,
            createdAt: schema.deviceTokens.createdAt,
          })
          .from(schema.deviceTokens)
          .where(eq(schema.deviceTokens.userId, id)),
      ]);

    return {
      ...serializeUser(profile),
      ...account,
      isAdmin: adminIds().has(id),
      subscription: subscription ?? null,
      memberships,
      sessions: activeSessions,
      usage,
      devices,
    };
  });

  fastify.patch(
    '/users/:id',
    { schema: { tags: ['admin'], params: IdParam, body: UpdateUser } },
    async (request, reply) => {
      const { id } = request.params;
      const { emailVerified, plan, ...preferences } = request.body;

      /*
       * Never over a live subscription. A plan set here does not reach Stripe, so it would
       * disagree with what the person is billed for — a paying Plus account set to Free kept
       * paying, lost its features, and the next upgrade asked Stripe to change a subscription
       * to the price it already had. Change or cancel it in Stripe, and the webhook brings it here.
       */
      if (plan !== undefined) {
        const [paying] = await db
          .select({
            status: subscriptions.status,
            stripeSubscriptionId: subscriptions.stripeSubscriptionId,
          })
          .from(subscriptions)
          .where(eq(subscriptions.userId, id))
          .limit(1);
        if (paying?.stripeSubscriptionId && LIVE_STATUSES.has(paying.status)) {
          throw new ConflictError(
            'PAID_THROUGH_STRIPE',
            'This person pays through Stripe. Change or cancel their plan there, not here.',
          );
        }
      }

      if (Object.keys(preferences).length > 0) await updateUserPreferences(db, id, preferences);

      await db.transaction(async (tx) => {
        if (emailVerified !== undefined) {
          const updated = await tx
            .update(users)
            .set({ emailVerified, updatedAt: new Date() })
            .where(eq(users.id, id))
            .returning({ id: users.id });
          if (updated.length === 0) throw new NotFoundError('User');
        }
        if (plan !== undefined) {
          /*
           * A comped plan: no provider ids, so nothing bills for it. If the person also pays
           * through Stripe, the next webhook from there wins — which is right, since that is
           * what they are actually paying for.
           */
          await tx
            .insert(subscriptions)
            .values({ userId: id, plan, status: 'ACTIVE' })
            .onConflictDoUpdate({
              target: subscriptions.userId,
              set: { plan, updatedAt: new Date() },
            });
        }
        await recordAudit(
          tx,
          audit(request, 'user.updated', 'user', id, { fields: Object.keys(request.body) }),
        );
      });

      return reply.status(204).send();
    },
  );

  fastify.delete(
    '/users/:id/sessions',
    { schema: { tags: ['admin'], params: IdParam } },
    async (request, reply) => {
      const { id } = request.params;
      await db.transaction(async (tx) => {
        const ended = await tx
          .delete(sessions)
          .where(eq(sessions.userId, id))
          .returning({ id: sessions.id });
        await recordAudit(
          tx,
          audit(request, 'user.sessions_revoked', 'user', id, { count: ended.length }),
        );
      });
      return reply.status(204).send();
    },
  );

  fastify.delete(
    '/users/:id',
    { schema: { tags: ['admin'], params: IdParam } },
    async (request, reply) => {
      const { id } = request.params;
      if (id === request.actor!.userId) {
        throw new ConflictError(
          'ADMIN_SELF_DELETE',
          'You cannot delete your own account from here',
        );
      }

      const [account] = await db.select({ email: users.email }).from(users).where(eq(users.id, id));
      if (!account) throw new NotFoundError('User');

      // Refused rather than cascaded: a garage has other members whose records would go with it.
      const owned = await db.$count(garages, eq(garages.ownerId, id));
      if (owned > 0) {
        throw new ConflictError(
          'USER_OWNS_GARAGES',
          `They own ${owned} garage${owned === 1 ? '' : 's'}. Delete or transfer ${owned === 1 ? 'it' : 'them'} first.`,
        );
      }

      // Deleting the row does not stop Stripe charging the card.
      const [paid] = await db
        .select({ status: subscriptions.status })
        .from(subscriptions)
        .where(
          and(eq(subscriptions.userId, id), sql`${subscriptions.stripeSubscriptionId} is not null`),
        );
      if (paid && paid.status !== 'CANCELED') {
        throw new ConflictError(
          'USER_HAS_SUBSCRIPTION',
          'They have a live Stripe subscription. Cancel it in Stripe first.',
        );
      }

      await db.transaction(async (tx) => {
        await recordAudit(tx, audit(request, 'user.deleted', 'user', id, { email: account.email }));
        await tx.delete(users).where(eq(users.id, id));
      });
      return reply.status(204).send();
    },
  );

  // --- Garages --------------------------------------------------------------

  fastify.get(
    '/garages',
    { schema: { tags: ['admin'], querystring: GarageListQuery } },
    async (request) => {
      const { q, limit, offset, sort = 'newest' } = request.query;
      const where = q?.trim()
        ? or(ilike(garages.name, like(q.trim())), ilike(users.email, like(q.trim())))
        : undefined;
      const members = sql<number>`(select count(*)::int from ${garageMembers} where ${garageMembers.garageId} = ${garages.id})`;
      const fleet = sql<number>`(select count(*)::int from ${vehicles} where ${vehicles.garageId} = ${garages.id} and ${vehicles.deletedAt} is null)`;
      const order = {
        newest: [desc(garages.createdAt)],
        vehicles: [desc(fleet), desc(garages.createdAt)],
        members: [desc(members), desc(garages.createdAt)],
        name: [asc(sql`lower(${garages.name})`)],
      }[sort];
      const rows = await db
        .select({
          id: garages.id,
          name: garages.name,
          description: garages.description,
          defaultCurrency: garages.defaultCurrency,
          createdAt: garages.createdAt,
          ownerId: garages.ownerId,
          ownerEmail: users.email,
          ownerName: users.name,
          ownerImage: users.image,
          members,
          vehicles: fleet,
        })
        .from(garages)
        .innerJoin(users, eq(users.id, garages.ownerId))
        .where(where)
        .orderBy(...order)
        .limit(limit + 1)
        .offset(offset);
      return page(rows, limit);
    },
  );

  fastify.get('/garages/:id', { schema: { tags: ['admin'], params: IdParam } }, async (request) => {
    const { id } = request.params;
    const [garage] = await db
      .select({
        id: garages.id,
        name: garages.name,
        description: garages.description,
        defaultCurrency: garages.defaultCurrency,
        costReporting: garages.costReporting,
        ownerId: garages.ownerId,
        createdAt: garages.createdAt,
      })
      .from(garages)
      .where(eq(garages.id, id));
    if (!garage) throw new NotFoundError('Garage');

    const [members, fleet] = await Promise.all([
      db
        .select({
          userId: users.id,
          name: users.name,
          email: users.email,
          image: users.image,
          role: garageMembers.role,
        })
        .from(garageMembers)
        .innerJoin(users, eq(users.id, garageMembers.userId))
        .where(eq(garageMembers.garageId, id))
        .orderBy(garageMembers.createdAt),
      db
        .select(vehicleColumns)
        .from(vehicles)
        .where(and(eq(vehicles.garageId, id), isNull(vehicles.deletedAt)))
        .orderBy(desc(vehicles.createdAt)),
    ]);
    return { ...garage, members, vehicles: fleet };
  });

  fastify.delete(
    '/garages/:id',
    { schema: { tags: ['admin'], params: IdParam } },
    async (request, reply) => {
      const { id } = request.params;
      const [garage] = await db
        .select({ name: garages.name })
        .from(garages)
        .where(eq(garages.id, id));
      if (!garage) throw new NotFoundError('Garage');
      await db.transaction(async (tx) => {
        // garageId stays null: the garage row is about to go, and the FK would null it anyway.
        await recordAudit(
          tx,
          audit(request, 'garage.deleted', 'garage', id, { name: garage.name }),
        );
        await deleteGarage(tx, id);
      });
      return reply.status(204).send();
    },
  );

  // --- Vehicles -------------------------------------------------------------

  fastify.get(
    '/vehicles',
    { schema: { tags: ['admin'], querystring: VehicleListQuery } },
    async (request) => {
      const { q, limit, offset, type, status } = request.query;
      const term = q?.trim();
      const conditions: SQL[] = [isNull(vehicles.deletedAt)];
      if (type) conditions.push(eq(vehicles.vehicleType, type));
      if (status) conditions.push(eq(vehicles.status, status));
      if (term) {
        conditions.push(
          or(
            ilike(vehicles.make, like(term)),
            ilike(vehicles.model, like(term)),
            ilike(vehicles.nickname, like(term)),
            ilike(vehicles.registrationIdentifier, like(term)),
            ilike(vehicles.identificationNumber, like(term)),
            ilike(garages.name, like(term)),
          )!,
        );
      }
      const rows = await db
        .select({ ...vehicleColumns, garageId: garages.id, garageName: garages.name })
        .from(vehicles)
        .innerJoin(garages, eq(garages.id, vehicles.garageId))
        .where(and(...conditions))
        .orderBy(desc(vehicles.createdAt))
        .limit(limit + 1)
        .offset(offset);
      return page(rows, limit);
    },
  );

  /**
   * One vehicle, with what an operator asks about it: whose it is, what it looks like, what has
   * been written in its logbook and what it has cost. Read-only, like the rest of the vehicle
   * views here — the owners keep their own records.
   */
  fastify.get(
    '/vehicles/:id',
    { schema: { tags: ['admin'], params: IdParam } },
    async (request) => {
      const { id } = request.params;
      const [vehicle] = await db
        .select({
          ...vehicleColumns,
          variant: vehicles.variant,
          color: vehicles.color,
          identificationNumber: vehicles.identificationNumber,
          currentEngineHours: vehicles.currentEngineHours,
          purchaseDate: vehicles.purchaseDate,
          purchasePriceAmountMinor: vehicles.purchasePriceAmountMinor,
          purchasePriceCurrency: vehicles.purchasePriceCurrency,
          primaryPhotoId: vehicles.primaryPhotoId,
          createdBy: vehicles.createdBy,
          garageId: garages.id,
          garageName: garages.name,
          garageCurrency: garages.defaultCurrency,
          ownerId: garages.ownerId,
        })
        .from(vehicles)
        .innerJoin(garages, eq(garages.id, vehicles.garageId))
        .where(and(eq(vehicles.id, id), isNull(vehicles.deletedAt)));
      if (!vehicle) throw new NotFoundError('Vehicle');

      const person = (userId: string | null) =>
        userId
          ? db
              .select({ id: users.id, name: users.name, email: users.email, image: users.image })
              .from(users)
              .where(eq(users.id, userId))
              .then(([row]) => row ?? null)
          : Promise.resolve(null);

      const [owner, addedBy, photo, counts, spending, recentEvents, maintenance] =
        await Promise.all([
          person(vehicle.ownerId),
          person(vehicle.createdBy),
          vehicle.primaryPhotoId
            ? db
                .select({
                  storageKey: vehiclePhotos.storageKey,
                  cutoutKey: vehiclePhotos.cutoutKey,
                })
                .from(vehiclePhotos)
                .where(
                  and(
                    eq(vehiclePhotos.id, vehicle.primaryPhotoId),
                    isNull(vehiclePhotos.deletedAt),
                  ),
                )
                .then(([row]) => row ?? null)
            : null,
          Promise.all([
            db.$count(vehicleEvents, eq(vehicleEvents.vehicleId, id)),
            db.$count(documents, and(eq(documents.vehicleId, id), isNull(documents.deletedAt))),
            db.$count(
              vehiclePhotos,
              and(eq(vehiclePhotos.vehicleId, id), isNull(vehiclePhotos.deletedAt)),
            ),
            db.$count(
              tasks,
              and(
                eq(tasks.vehicleId, id),
                isNull(tasks.deletedAt),
                inArray(tasks.status, ['TODO', 'IN_PROGRESS', 'BLOCKED']),
              ),
            ),
            db.$count(
              maintenancePlans,
              and(eq(maintenancePlans.vehicleId, id), eq(maintenancePlans.isActive, true)),
            ),
          ]).then(([events, docs, photos, openTasks, plans]) => ({
            events,
            documents: docs,
            photos,
            openTasks,
            plans,
          })),
          // A cost written on the timeline is mirrored into `expenses`, so this is the whole bill.
          db
            .select({
              currency: expenses.currency,
              category: expenses.category,
              amountMinor: sql<number>`sum(${expenses.amountMinor})::bigint`,
            })
            .from(expenses)
            .where(eq(expenses.vehicleId, id))
            .groupBy(expenses.currency, expenses.category),
          db
            .select({
              id: vehicleEvents.id,
              eventType: vehicleEvents.eventType,
              title: vehicleEvents.title,
              occurredAt: vehicleEvents.occurredAt,
              odometer: vehicleEvents.odometer,
              costAmountMinor: vehicleEvents.costAmountMinor,
              costCurrency: vehicleEvents.costCurrency,
              provider: vehicleEvents.provider,
            })
            .from(vehicleEvents)
            .where(eq(vehicleEvents.vehicleId, id))
            .orderBy(desc(vehicleEvents.occurredAt))
            .limit(8),
          db
            .select({
              id: maintenancePlans.id,
              title: maintenancePlans.title,
              nextDueDate: maintenancePlans.nextDueDate,
              nextDueOdometer: maintenancePlans.nextDueOdometer,
              lastPerformedAt: maintenancePlans.lastPerformedAt,
            })
            .from(maintenancePlans)
            .where(and(eq(maintenancePlans.vehicleId, id), eq(maintenancePlans.isActive, true)))
            .orderBy(sql`${maintenancePlans.nextDueDate} asc nulls last`)
            .limit(6),
        ]);

      // The cutout (the vehicle on transparency) when there is one; storage that is not set up
      // just means no picture.
      const key = photo?.cutoutKey ?? photo?.storageKey;
      let photoUrl: string | null = null;
      if (key) {
        try {
          photoUrl = await fastify.storage.createDownloadUrl(key, PHOTO_TTL_SECONDS);
        } catch {
          photoUrl = null;
        }
      }

      const {
        primaryPhotoId: _photo,
        createdBy: _by,
        garageName,
        garageCurrency,
        ownerId: _owner,
        ...fields
      } = vehicle;
      return {
        ...fields,
        photoUrl,
        isCutout: Boolean(photo?.cutoutKey),
        garage: { id: vehicle.garageId, name: garageName, defaultCurrency: garageCurrency },
        owner,
        addedBy,
        counts,
        spending: spending.map((row) => ({ ...row, amountMinor: Number(row.amountMinor) })),
        recentEvents,
        maintenance,
      };
    },
  );

  // --- Audit ----------------------------------------------------------------

  fastify.get(
    '/audit',
    { schema: { tags: ['admin'], querystring: AuditQuery } },
    async (request) => {
      const { limit, offset } = request.query;
      const rows = await db
        .select({
          id: auditLogs.id,
          action: auditLogs.action,
          resourceType: auditLogs.resourceType,
          resourceId: auditLogs.resourceId,
          actorEmail: auditLogs.actorEmail,
          garageId: auditLogs.garageId,
          metadata: auditLogs.metadata,
          requestId: auditLogs.requestId,
          ipAddress: auditLogs.ipAddress,
          createdAt: auditLogs.createdAt,
        })
        .from(auditLogs)
        .where(auditWhere(request.query))
        .orderBy(desc(auditLogs.createdAt))
        .limit(limit + 1)
        .offset(offset);
      return page(rows, limit);
    },
  );

  /** How many entries each UTC day held, under the same filters as the list. */
  fastify.get(
    '/audit/volume',
    { schema: { tags: ['admin'], querystring: AuditVolumeQuery } },
    async (request) => {
      const start = windowStart(request.query.days);
      const day = sql<string>`to_char(${auditLogs.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`;
      const rows = await db
        .select({ day, count: sql<number>`count(*)::int` })
        .from(auditLogs)
        .where(and(gte(auditLogs.createdAt, start), auditWhere(request.query)))
        .groupBy(day);
      const counts = new Map(rows.map((row) => [row.day, Number(row.count)]));
      return { days: daysFrom(start).map((d) => ({ day: d, count: counts.get(d) ?? 0 })) };
    },
  );

  // --- Errors ---------------------------------------------------------------

  /*
   * Everything that failed, newest first, in one stream: questions the model did not answer,
   * notifications that did not go out, and jobs the outbox gave up on.
   *
   * ponytail: each source is read to `offset + limit` and merged here, so a deep page reads
   * every row above it. Fine for a console paging through dozens; a UNION with keyset cursors
   * when failures run into the thousands.
   */
  fastify.get(
    '/errors',
    { schema: { tags: ['admin'], querystring: ErrorsQuery } },
    async (request) => {
      const { limit, offset, source } = request.query;
      const take = offset + limit + 1;
      const want = (name: (typeof ERROR_SOURCES)[number]) => !source || source === name;
      const channel = source === 'email' ? 'EMAIL' : source === 'push' ? 'PUSH' : undefined;

      const [asked, sent, dead] = await Promise.all([
        want('ai')
          ? db
              .select({
                id: aiRequests.id,
                at: aiRequests.createdAt,
                kind: aiRequests.feature,
                message: aiRequests.error,
                userId: aiRequests.userId,
                email: users.email,
              })
              .from(aiRequests)
              .leftJoin(users, eq(users.id, aiRequests.userId))
              .where(eq(aiRequests.status, 'error'))
              .orderBy(desc(aiRequests.createdAt))
              .limit(take)
          : [],
        want('email') || want('push')
          ? db
              .select({
                id: deliveries.id,
                at: deliveries.createdAt,
                channel: deliveries.channel,
                kind: deliveries.notificationType,
                message: deliveries.error,
                userId: deliveries.userId,
                email: users.email,
              })
              .from(deliveries)
              .leftJoin(users, eq(users.id, deliveries.userId))
              .where(
                and(
                  eq(deliveries.status, 'failed'),
                  channel ? eq(deliveries.channel, channel) : undefined,
                ),
              )
              .orderBy(desc(deliveries.createdAt))
              .limit(take)
          : [],
        want('outbox')
          ? db
              .select({
                id: outbox.id,
                at: outbox.deadLetteredAt,
                queue: outbox.queue,
                jobName: outbox.jobName,
                attempts: outbox.attempts,
                message: outbox.lastError,
              })
              .from(outbox)
              .where(isNotNull(outbox.deadLetteredAt))
              .orderBy(desc(outbox.deadLetteredAt))
              .limit(take)
          : [],
      ]);

      const rows = [
        ...asked.map((row) => ({ ...row, source: 'ai' as const, attempts: null })),
        ...sent.map(({ channel: via, ...row }) => ({
          ...row,
          source: via === 'EMAIL' ? ('email' as const) : ('push' as const),
          attempts: null,
        })),
        ...dead.map(({ queue, jobName, at, ...row }) => ({
          ...row,
          at: at!,
          kind: `${queue} · ${jobName}`,
          source: 'outbox' as const,
          userId: null,
          email: null,
        })),
      ].sort((a, b) => b.at.getTime() - a.at.getTime());
      return page(rows.slice(offset), limit);
    },
  );

  // --- Console access -------------------------------------------------------

  /** Who `ADMIN_USER_IDS` lets in — and any id in it that matches no account. */
  fastify.get('/admins', { schema: { tags: ['admin'] } }, async () => {
    const ids = [...adminIds()];
    // An id that is not a uuid would fail the query's cast; it simply matches nobody.
    const valid = ids.filter((id) => UUID.test(id));
    const [accounts, seen] = valid.length
      ? await Promise.all([
          db
            .select({ id: users.id, name: users.name, email: users.email, image: users.image })
            .from(users)
            .where(inArray(users.id, valid)),
          db
            .select({ id: sessions.userId, at: sql<Date>`max(${sessions.updatedAt})` })
            .from(sessions)
            .where(inArray(sessions.userId, valid))
            .groupBy(sessions.userId),
        ])
      : [[], []];
    return ids.map((id) => {
      const account = accounts.find((row) => row.id === id);
      return account
        ? { ...account, lastSeenAt: seen.find((row) => row.id === id)?.at ?? null }
        : { id, name: null, email: null, image: null, lastSeenAt: null };
    });
  });

  // --- Feature flags --------------------------------------------------------

  fastify.get('/flags', { schema: { tags: ['admin'] } }, async () => flagState());

  fastify.patch('/flags', { schema: { tags: ['admin'], body: UpdateFlags } }, async (request) => {
    const next: FlagOverrides = { ...flagOverrides() };
    for (const [flag, value] of Object.entries(request.body) as [
      keyof FlagOverrides,
      boolean | null,
    ][]) {
      // null clears the override: the flag goes back to following its dependency.
      if (value === null) delete next[flag];
      else next[flag] = value;
    }

    await db.transaction(async (tx) => {
      await tx
        .insert(schema.appSettings)
        .values({ key: 'flags', value: next, updatedBy: request.actor!.userId })
        .onConflictDoUpdate({
          target: schema.appSettings.key,
          set: { value: next, updatedBy: request.actor!.userId, updatedAt: new Date() },
        });
      await recordAudit(tx, audit(request, 'flags.updated', 'settings', null, request.body));
    });
    setFlagOverrides(next);
    return flagState();
  });
};
