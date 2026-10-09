/**
 * The console's analytics: product activity by day, what the paid providers (the model, email,
 * push) were used for, and the live state of Redis, the job queues and the outbox.
 *
 * Registered inside `adminRoutes`, so its admin gate covers these too.
 *
 * Days are UTC days. Everything is read on request — nothing here is cached or precomputed,
 * which is right at this scale and wrong at a much larger one (ponytail: roll the logs up into
 * daily totals from the scheduler once these queries show up in the slow log).
 */

import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import {
  and,
  count,
  countDistinct,
  desc,
  eq,
  gte,
  isNotNull,
  isNull,
  sql,
  sum,
  type SQL,
} from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import { env } from '@vehicle-os/config';
import { schema } from '@vehicle-os/database';

const {
  users,
  sessions,
  garages,
  vehicles,
  vehicleEvents,
  notifications,
  notificationDeliveries: deliveries,
  aiRequests,
  deviceTokens,
  outboxMessages: outbox,
} = schema;

const WindowQuery = Type.Object({
  days: Type.Integer({ minimum: 7, maximum: 90, default: 30 }),
});

/** Midnight UTC, `days - 1` days ago: the window includes today. */
export function windowStart(days: number, now = new Date()): Date {
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return start;
}

/** Every UTC day from `start` to today, as `YYYY-MM-DD`, so a quiet day is a 0 and not a gap. */
export function daysFrom(start: Date, now = new Date()): string[] {
  const out: string[] = [];
  for (let day = new Date(start); day <= now; day.setUTCDate(day.getUTCDate() + 1)) {
    out.push(day.toISOString().slice(0, 10));
  }
  return out;
}

const dayOf = (column: PgColumn) =>
  sql<string>`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD')`;

/** `INFO` as a flat map. Sections are dropped: the field names are unique across them. */
export function parseInfo(info: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const line of info.split(/\r?\n/)) {
    const at = line.indexOf(':');
    if (at > 0 && !line.startsWith('#')) fields[line.slice(0, at)] = line.slice(at + 1).trim();
  }
  return fields;
}

const num = (value: string | undefined) => (value === undefined ? null : Number(value));

export const insightsRoutes: FastifyPluginAsyncTypebox = async (fastify) => {
  const db = fastify.db;

  /** Rows per UTC day in the window, for one table. */
  const perDay = async (table: PgTable, column: PgColumn, start: Date, where?: SQL) => {
    const rows = await db
      .select({ day: dayOf(column), count: sql<number>`count(*)::int` })
      .from(table)
      .where(and(gte(column, start), where))
      .groupBy(dayOf(column));
    return new Map(rows.map((row) => [row.day, Number(row.count)]));
  };

  // --- Activity: the product, by day -----------------------------------------

  fastify.get(
    '/activity',
    { schema: { tags: ['admin'], querystring: WindowQuery } },
    async (request) => {
      const start = windowStart(request.query.days);
      const ago = (days: number) => new Date(Date.now() - days * 86_400_000);
      const activeSince = (days: number) =>
        db
          .select({ n: countDistinct(sessions.userId) })
          .from(sessions)
          .where(gte(sessions.updatedAt, ago(days)))
          .then(([row]) => Number(row?.n ?? 0));

      const [
        signups,
        newGarages,
        newVehicles,
        records,
        asks,
        tokens,
        emails,
        pushes,
        failures,
        emailFailures,
        pushFailures,
        active1,
        active7,
        active30,
      ] = await Promise.all([
        perDay(users, users.createdAt, start),
        perDay(garages, garages.createdAt, start),
        perDay(vehicles, vehicles.createdAt, start),
        perDay(vehicleEvents, vehicleEvents.createdAt, start),
        perDay(aiRequests, aiRequests.createdAt, start),
        db
          .select({
            day: dayOf(aiRequests.createdAt),
            tokens: sql<number>`sum(${aiRequests.inputTokens} + ${aiRequests.outputTokens})::int`,
          })
          .from(aiRequests)
          .where(gte(aiRequests.createdAt, start))
          .groupBy(dayOf(aiRequests.createdAt))
          .then((rows) => new Map(rows.map((row) => [row.day, Number(row.tokens)]))),
        perDay(
          deliveries,
          deliveries.createdAt,
          start,
          and(eq(deliveries.channel, 'EMAIL'), eq(deliveries.status, 'sent')),
        ),
        perDay(
          deliveries,
          deliveries.createdAt,
          start,
          and(eq(deliveries.channel, 'PUSH'), eq(deliveries.status, 'sent')),
        ),
        perDay(deliveries, deliveries.createdAt, start, eq(deliveries.status, 'failed')),
        perDay(
          deliveries,
          deliveries.createdAt,
          start,
          and(eq(deliveries.channel, 'EMAIL'), eq(deliveries.status, 'failed')),
        ),
        perDay(
          deliveries,
          deliveries.createdAt,
          start,
          and(eq(deliveries.channel, 'PUSH'), eq(deliveries.status, 'failed')),
        ),
        activeSince(1),
        activeSince(7),
        activeSince(30),
      ]);

      return {
        /*
         * Approximate: a session's `updated_at` moves at most once a day (Better Auth's
         * `updateAge`), so this counts people seen that day, not every visit.
         */
        activeUsers: { day: active1, week: active7, month: active30 },
        days: daysFrom(start).map((day) => ({
          day,
          signups: signups.get(day) ?? 0,
          garages: newGarages.get(day) ?? 0,
          vehicles: newVehicles.get(day) ?? 0,
          records: records.get(day) ?? 0,
          aiRequests: asks.get(day) ?? 0,
          aiTokens: tokens.get(day) ?? 0,
          emails: emails.get(day) ?? 0,
          pushes: pushes.get(day) ?? 0,
          deliveryFailures: failures.get(day) ?? 0,
          emailFailures: emailFailures.get(day) ?? 0,
          pushFailures: pushFailures.get(day) ?? 0,
        })),
      };
    },
  );

  // --- Usage: the model, email and push ---------------------------------------

  fastify.get(
    '/usage',
    { schema: { tags: ['admin'], querystring: WindowQuery } },
    async (request) => {
      const config = env();
      const start = windowStart(request.query.days);
      const inWindow = gte(aiRequests.createdAt, start);
      const deliveredInWindow = gte(deliveries.createdAt, start);

      const [aiTotals, topUsers, aiErrors, byChannel, byType, recentFailures, devices, sent] =
        await Promise.all([
          db
            .select({
              requests: count(),
              errors: sql<number>`count(*) filter (where ${aiRequests.status} = 'error')::int`,
              inputTokens: sum(aiRequests.inputTokens),
              outputTokens: sum(aiRequests.outputTokens),
              turns: sum(aiRequests.turns),
              avgLatencyMs: sql<number | null>`avg(${aiRequests.latencyMs})::int`,
              p95LatencyMs: sql<
                number | null
              >`(percentile_cont(0.95) within group (order by ${aiRequests.latencyMs}))::int`,
            })
            .from(aiRequests)
            .where(inWindow),
          db
            .select({
              userId: aiRequests.userId,
              email: users.email,
              name: users.name,
              requests: count(),
              tokens: sql<number>`sum(${aiRequests.inputTokens} + ${aiRequests.outputTokens})::int`,
            })
            .from(aiRequests)
            .leftJoin(users, eq(users.id, aiRequests.userId))
            .where(inWindow)
            .groupBy(aiRequests.userId, users.email, users.name)
            .orderBy(desc(count()))
            .limit(5),
          db
            .select({
              createdAt: aiRequests.createdAt,
              error: aiRequests.error,
              email: users.email,
            })
            .from(aiRequests)
            .leftJoin(users, eq(users.id, aiRequests.userId))
            .where(and(inWindow, eq(aiRequests.status, 'error')))
            .orderBy(desc(aiRequests.createdAt))
            .limit(5),
          db
            .select({ channel: deliveries.channel, status: deliveries.status, count: count() })
            .from(deliveries)
            .where(deliveredInWindow)
            .groupBy(deliveries.channel, deliveries.status),
          db
            .select({
              type: deliveries.notificationType,
              channel: deliveries.channel,
              count: count(),
            })
            .from(deliveries)
            .where(and(deliveredInWindow, eq(deliveries.status, 'sent')))
            .groupBy(deliveries.notificationType, deliveries.channel),
          db
            .select({
              createdAt: deliveries.createdAt,
              channel: deliveries.channel,
              type: deliveries.notificationType,
              error: deliveries.error,
              email: users.email,
            })
            .from(deliveries)
            .leftJoin(users, eq(users.id, deliveries.userId))
            .where(and(deliveredInWindow, eq(deliveries.status, 'failed')))
            .orderBy(desc(deliveries.createdAt))
            .limit(10),
          db
            .select({ platform: deviceTokens.platform, count: count() })
            .from(deviceTokens)
            .groupBy(deviceTokens.platform),
          db
            .select({
              created: count(),
              read: sql<number>`count(${notifications.readAt})::int`,
            })
            .from(notifications)
            .where(gte(notifications.createdAt, start)),
        ]);

      const totals = aiTotals[0];
      const tally = (channel: string, status: string) =>
        Number(
          byChannel.find((row) => row.channel === channel && row.status === status)?.count ?? 0,
        );

      return {
        ai: {
          configured: Boolean(config.AI_API_KEY),
          model: config.AI_MODEL,
          requests: Number(totals?.requests ?? 0),
          errors: Number(totals?.errors ?? 0),
          turns: Number(totals?.turns ?? 0),
          inputTokens: Number(totals?.inputTokens ?? 0),
          outputTokens: Number(totals?.outputTokens ?? 0),
          avgLatencyMs: totals?.avgLatencyMs ?? null,
          p95LatencyMs: totals?.p95LatencyMs ?? null,
          topUsers: topUsers.map((row) => ({
            ...row,
            requests: Number(row.requests),
            tokens: Number(row.tokens),
          })),
          recentErrors: aiErrors,
        },
        email: {
          configured: Boolean(config.RESEND_API_KEY),
          from: config.EMAIL_FROM,
          sent: tally('EMAIL', 'sent'),
          failed: tally('EMAIL', 'failed'),
        },
        push: {
          sent: tally('PUSH', 'sent'),
          failed: tally('PUSH', 'failed'),
          devices: devices.map((row) => ({ platform: row.platform, count: Number(row.count) })),
        },
        notifications: {
          created: Number(sent[0]?.created ?? 0),
          read: Number(sent[0]?.read ?? 0),
          byType: byType.map((row) => ({ ...row, count: Number(row.count) })),
        },
        recentFailures,
      };
    },
  );

  // --- System: Redis, queues, outbox ------------------------------------------

  /*
   * Read on request and never polled: on a per-request Redis plan (Upstash) every command is
   * billed, and this costs about 5 + 7 per queue. The console refreshes it only when asked.
   */
  fastify.get('/system', { schema: { tags: ['admin'] } }, async () => {
    const [pending, deadLettered, processedDay, recentDead] = await Promise.all([
      db
        .select({ n: count(), oldest: sql<string | null>`min(${outbox.createdAt})` })
        .from(outbox)
        .where(and(isNull(outbox.processedAt), isNull(outbox.deadLetteredAt))),
      db.$count(outbox, isNotNull(outbox.deadLetteredAt)),
      db.$count(outbox, gte(outbox.processedAt, new Date(Date.now() - 86_400_000))),
      db
        .select({
          id: outbox.id,
          queue: outbox.queue,
          jobName: outbox.jobName,
          attempts: outbox.attempts,
          lastError: outbox.lastError,
          deadLetteredAt: outbox.deadLetteredAt,
        })
        .from(outbox)
        .where(isNotNull(outbox.deadLetteredAt))
        .orderBy(desc(outbox.deadLetteredAt))
        .limit(5),
    ]);

    return {
      redis: await redisState(),
      outbox: {
        pending: Number(pending[0]?.n ?? 0),
        oldestPendingAt: pending[0]?.oldest ?? null,
        deadLettered,
        processedLastDay: processedDay,
        recentDeadLetters: recentDead,
      },
    };
  });

  async function redisState() {
    const redis = fastify.redis;
    const url = env().REDIS_URL;
    if (!redis) return { configured: false as const };
    const provider = url?.includes('upstash') ? 'Upstash' : 'Redis';

    try {
      const started = performance.now();
      await redis.ping();
      const pingMs = Math.round(performance.now() - started);
      const [info, keys] = await Promise.all([redis.info(), redis.dbsize()]);
      const fields = parseInfo(info);

      // BullMQ's own bookkeeping names every queue it has ever held: `bull:<name>:meta`.
      const names = new Set<string>();
      let cursor = '0';
      for (let pass = 0; pass < 10; pass++) {
        const [next, found] = await redis.scan(cursor, 'MATCH', 'bull:*:meta', 'COUNT', 1000);
        for (const key of found) names.add(key.slice('bull:'.length, -':meta'.length));
        cursor = next;
        if (cursor === '0') break;
      }

      const queues = await Promise.all(
        [...names].sort().map(async (name) => {
          const k = (suffix: string) => `bull:${name}:${suffix}`;
          const results = await redis
            .pipeline()
            .llen(k('wait'))
            .llen(k('active'))
            .zcard(k('delayed'))
            .zcard(k('prioritized'))
            .zcard(k('failed'))
            .zcard(k('completed'))
            .llen(k('paused'))
            .exec();
          const [waiting, active, delayed, prioritized, failed, completed, paused] = (
            results ?? []
          ).map(([, value]) => Number(value ?? 0));

          // Why the latest jobs failed — the only place that reason is kept.
          const failedIds = failed ? await redis.zrevrange(k('failed'), 0, 2) : [];
          const recentFailures = await Promise.all(
            failedIds.map(async (id) => {
              const [jobName, reason, finishedOn, attempts] = await redis.hmget(
                k(id),
                'name',
                'failedReason',
                'finishedOn',
                'attemptsMade',
              );
              return {
                id,
                name: jobName,
                reason: reason?.slice(0, 300) ?? null,
                at: finishedOn ? new Date(Number(finishedOn)).toISOString() : null,
                attempts: num(attempts ?? undefined),
              };
            }),
          );

          return {
            name,
            waiting: (waiting ?? 0) + (prioritized ?? 0) + (paused ?? 0),
            active: active ?? 0,
            delayed: delayed ?? 0,
            failed: failed ?? 0,
            completed: completed ?? 0,
            recentFailures,
          };
        }),
      );

      const hits = num(fields.keyspace_hits);
      const misses = num(fields.keyspace_misses);
      return {
        configured: true as const,
        provider,
        pingMs,
        version: fields.redis_version ?? null,
        uptimeSeconds: num(fields.uptime_in_seconds),
        usedMemory: num(fields.used_memory),
        peakMemory: num(fields.used_memory_peak),
        maxMemory: num(fields.maxmemory) || null,
        clients: num(fields.connected_clients),
        opsPerSecond: num(fields.instantaneous_ops_per_sec),
        totalCommands: num(fields.total_commands_processed),
        hitRate:
          hits !== null && misses !== null && hits + misses > 0 ? hits / (hits + misses) : null,
        evictedKeys: num(fields.evicted_keys),
        keys,
        queues,
      };
    } catch (error) {
      return {
        configured: true as const,
        provider,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
};
