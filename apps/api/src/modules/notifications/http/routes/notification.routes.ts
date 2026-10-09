import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { schema } from '@vehicle-os/database';
import {
  ListNotificationsQuery,
  Notification,
  NotificationIdParam,
  NotificationPreference,
  RegisterDevice,
  StandardErrors,
  UnreadCount,
  UpdateNotificationPreferences,
} from '@vehicle-os/contracts';
import { NOTIFICATION_CHANNELS, NOTIFICATION_TYPES } from '@vehicle-os/domain';
import { NotFoundError } from '../../../../infrastructure/errors';

export const notificationRoutes: FastifyPluginAsyncTypebox = async (fastify) => {
  fastify.get(
    '/',
    {
      schema: {
        tags: ['notifications'],
        summary: 'Notifications for the caller',
        querystring: ListNotificationsQuery,
        response: { 200: Type.Array(Notification), ...StandardErrors },
      },
    },
    async (request) => {
      const actor = await fastify.requireAuth(request);

      // Scoped to the caller's own user id, not to a garage: a notification is addressed to
      // a person, and there is no path that reads someone else's.
      const conditions = [eq(schema.notifications.userId, actor.userId)];
      if (request.query.unreadOnly) conditions.push(isNull(schema.notifications.readAt));

      const rows = await fastify.db
        .select()
        .from(schema.notifications)
        .where(and(...conditions))
        .orderBy(desc(schema.notifications.createdAt))
        .limit(Math.min(request.query.limit ?? 50, 100));

      return rows.map((row) => ({
        id: row.id,
        notificationType: row.notificationType,
        title: row.title,
        body: row.body,
        vehicleId: row.vehicleId,
        garageId: row.garageId,
        payload: row.payload,
        readAt: row.readAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
      }));
    },
  );

  fastify.get(
    '/unread-count',
    {
      schema: {
        tags: ['notifications'],
        summary: 'How many are unread — what the header badge reads',
        response: { 200: UnreadCount, ...StandardErrors },
      },
    },
    async (request) => {
      const actor = await fastify.requireAuth(request);

      const [row] = await fastify.db
        .select({ unread: sql<number>`count(*)::int` })
        .from(schema.notifications)
        .where(
          and(eq(schema.notifications.userId, actor.userId), isNull(schema.notifications.readAt)),
        );

      return { unread: row?.unread ?? 0 };
    },
  );

  fastify.post(
    '/:notificationId/read',
    {
      schema: {
        tags: ['notifications'],
        summary: 'Mark one as read',
        params: NotificationIdParam,
        response: { 204: Type.Null(), ...StandardErrors },
      },
    },
    async (request, reply) => {
      const actor = await fastify.requireAuth(request);

      const updated = await fastify.db
        .update(schema.notifications)
        .set({ readAt: new Date() })
        .where(
          and(
            eq(schema.notifications.id, request.params.notificationId),
            // The ownership check is part of the UPDATE, so there is no window between
            // finding the row and deciding whether the caller may touch it.
            eq(schema.notifications.userId, actor.userId),
          ),
        )
        .returning({ id: schema.notifications.id });

      if (updated.length === 0) throw new NotFoundError('Notification');
      return reply.status(204).send(null);
    },
  );

  fastify.post(
    '/read-all',
    {
      schema: {
        tags: ['notifications'],
        summary: 'Mark every unread notification as read',
        response: { 204: Type.Null(), ...StandardErrors },
      },
    },
    async (request, reply) => {
      const actor = await fastify.requireAuth(request);

      await fastify.db
        .update(schema.notifications)
        .set({ readAt: new Date() })
        .where(
          and(
            eq(schema.notifications.userId, actor.userId),
            // Only the unread ones, so this does not rewrite the timestamp on everything
            // the user read weeks ago.
            isNull(schema.notifications.readAt),
          ),
        );

      return reply.status(204).send(null);
    },
  );

  fastify.get(
    '/preferences',
    {
      schema: {
        tags: ['notifications'],
        summary: 'Which notifications arrive on which channel',
        description:
          'Every type on every channel, defaults included. A switch with no stored row is on.',
        response: { 200: Type.Array(NotificationPreference), ...StandardErrors },
      },
    },
    async (request) => {
      const actor = await fastify.requireAuth(request);

      const rows = await fastify.db
        .select()
        .from(schema.notificationPreferences)
        .where(eq(schema.notificationPreferences.userId, actor.userId));
      const stored = new Map(rows.map((row) => [`${row.notificationType}:${row.channel}`, row]));

      return NOTIFICATION_TYPES.flatMap((notificationType) =>
        NOTIFICATION_CHANNELS.map((channel) => ({
          notificationType,
          channel,
          enabled: stored.get(`${notificationType}:${channel}`)?.enabled ?? true,
        })),
      );
    },
  );

  fastify.put(
    '/preferences',
    {
      schema: {
        tags: ['notifications'],
        summary: 'Turn notification types on or off per channel',
        description: 'Only the switches sent are changed; the rest keep their value.',
        body: UpdateNotificationPreferences,
        response: { 204: Type.Null(), ...StandardErrors },
      },
    },
    async (request, reply) => {
      const actor = await fastify.requireAuth(request);

      await fastify.db
        .insert(schema.notificationPreferences)
        .values(
          request.body.preferences.map((preference) => ({ userId: actor.userId, ...preference })),
        )
        .onConflictDoUpdate({
          target: [
            schema.notificationPreferences.userId,
            schema.notificationPreferences.notificationType,
            schema.notificationPreferences.channel,
          ],
          set: { enabled: sql`excluded.enabled`, updatedAt: new Date() },
        });

      return reply.status(204).send(null);
    },
  );

  fastify.post(
    '/devices',
    {
      schema: {
        tags: ['notifications'],
        summary: 'Register this device for push notifications',
        description:
          'Idempotent. A token already registered to another account moves to the caller — ' +
          'the phone changed hands, and its previous owner must stop receiving reminders on it.',
        body: RegisterDevice,
        response: { 204: Type.Null(), ...StandardErrors },
      },
    },
    async (request, reply) => {
      const actor = await fastify.requireAuth(request);

      await fastify.db
        .insert(schema.deviceTokens)
        .values({ userId: actor.userId, ...request.body })
        .onConflictDoUpdate({
          target: schema.deviceTokens.token,
          set: { userId: actor.userId, platform: request.body.platform, updatedAt: new Date() },
        });

      return reply.status(204).send(null);
    },
  );

  fastify.delete(
    '/devices',
    {
      schema: {
        tags: ['notifications'],
        summary: 'Stop push notifications to this device',
        description: 'Called on sign-out. Only removes the token if it is the caller’s.',
        body: Type.Pick(RegisterDevice, ['token']),
        response: { 204: Type.Null(), ...StandardErrors },
      },
    },
    async (request, reply) => {
      const actor = await fastify.requireAuth(request);

      await fastify.db
        .delete(schema.deviceTokens)
        .where(
          and(
            eq(schema.deviceTokens.token, request.body.token),
            eq(schema.deviceTokens.userId, actor.userId),
          ),
        );

      return reply.status(204).send(null);
    },
  );
};
