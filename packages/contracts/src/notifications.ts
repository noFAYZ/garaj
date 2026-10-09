import { Type, type Static } from '@sinclair/typebox';
import { NOTIFICATION_CHANNELS, NOTIFICATION_TYPES } from '@vehicle-os/domain';
import { IsoDateTime, Nullable, PaginationQuery, Uuid } from './common';

export const NotificationTypeSchema = Type.Union(
  NOTIFICATION_TYPES.map((type) => Type.Literal(type)),
);

export const Notification = Type.Object({
  id: Uuid,
  notificationType: NotificationTypeSchema,
  title: Type.String(),
  body: Type.String(),
  vehicleId: Nullable(Uuid),
  garageId: Nullable(Uuid),
  payload: Type.Record(Type.String(), Type.Unknown()),
  readAt: Nullable(IsoDateTime),
  createdAt: IsoDateTime,
});
export type Notification = Static<typeof Notification>;

export const ListNotificationsQuery = Type.Composite([
  PaginationQuery,
  Type.Object({ unreadOnly: Type.Optional(Type.Boolean()) }),
]);
export type ListNotificationsQuery = Static<typeof ListNotificationsQuery>;

export const NotificationIdParam = Type.Object({ notificationId: Uuid });

export const UnreadCount = Type.Object({ unread: Type.Integer() });

export const NotificationChannelSchema = Type.Union(
  NOTIFICATION_CHANNELS.map((channel) => Type.Literal(channel)),
);

/**
 * One switch: a type of notification on one channel.
 *
 * The full grid is returned, defaults included, so a settings screen draws every switch from
 * one response rather than inferring "on" from a row that is not there.
 */
export const NotificationPreference = Type.Object({
  notificationType: NotificationTypeSchema,
  channel: NotificationChannelSchema,
  enabled: Type.Boolean(),
});
export type NotificationPreference = Static<typeof NotificationPreference>;

export const UpdateNotificationPreferences = Type.Object(
  { preferences: Type.Array(NotificationPreference, { minItems: 1, maxItems: 100 }) },
  { additionalProperties: false },
);
export type UpdateNotificationPreferences = Static<typeof UpdateNotificationPreferences>;

/** A phone registering where its push notifications should go. */
export const RegisterDevice = Type.Object(
  {
    // Expo tokens look like `ExponentPushToken[...]`; bounded, not pattern-matched, so a
    // change in Expo's format does not silently stop every new install from registering.
    token: Type.String({ minLength: 10, maxLength: 300 }),
    platform: Type.Union([Type.Literal('ios'), Type.Literal('android'), Type.Literal('web')]),
  },
  { additionalProperties: false },
);
export type RegisterDevice = Static<typeof RegisterDevice>;
