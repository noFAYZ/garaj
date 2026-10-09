/**
 * The last hop: email and push (PRD §31, Architecture.md §36).
 *
 * The in-app notification row is already committed when this runs — the scans write it and
 * enqueue delivery in one transaction — so every failure here costs a channel, never the
 * notification itself.
 *
 * Senders sit behind two small ports, as the model does behind `ai-port.ts`: the vendor is
 * one adapter, and the rules about *whether* to send (preferences, quiet hours) never know
 * which one it is.
 */

import { and, eq, inArray } from 'drizzle-orm';
import { schema, type Database } from '@vehicle-os/database';
import type { NotificationChannel } from '@vehicle-os/domain';

export interface EmailMessage {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
}

/**
 * A provider refusal that retrying cannot fix — an unverified sender domain, a revoked key, a
 * malformed address. The worker fails the job once instead of spending five calls on the same no.
 */
export class DeliveryRefusedError extends Error {}

/** Anything but a 5xx, a timeout (408) or a rate limit (429) is the provider's final answer. */
async function providerError(provider: string, response: Response): Promise<Error> {
  const detail = (await response.text().catch(() => '')).slice(0, 300);
  const message = `${provider} provider returned ${response.status}: ${detail}`;
  const transient = response.status >= 500 || response.status === 408 || response.status === 429;
  return transient ? new Error(message) : new DeliveryRefusedError(message);
}

/*
 * Reserved names (RFC 2606, 6761) can never receive mail. Seeded and test accounts live there,
 * and sending to them is a guaranteed hard bounce — each one a provider call, and bounces count
 * against the sending domain's reputation.
 */
const UNDELIVERABLE = /\.(test|example|invalid|localhost)$|@example\.(com|net|org)$/i;

export function isDeliverableAddress(email: string): boolean {
  return !UNDELIVERABLE.test(email);
}

export interface EmailPort {
  send(message: EmailMessage): Promise<void>;
}

export interface PushMessage {
  readonly title: string;
  readonly body: string;
  readonly data: Record<string, unknown>;
}

export interface PushPort {
  /** Returns the tokens the platform says are dead, so they can be dropped. */
  send(tokens: readonly string[], message: PushMessage): Promise<{ invalid: string[] }>;
}

/**
 * Resend, over `fetch` — the call is one JSON POST, and an SDK would be a dependency for a
 * request body.
 */
export function createResendEmail(apiKey: string, from: string): EmailPort {
  return {
    async send(message) {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          from,
          to: message.to,
          subject: message.subject,
          text: message.text,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      // A 5xx or a timeout is retried; a refusal is final (see `providerError`).
      if (!response.ok) throw await providerError('Email', response);
    },
  };
}

/**
 * Expo's push service, which fronts both APNs and FCM — the phone registers an Expo token,
 * and this is the only place that knows it is not talking to Apple or Google directly.
 */
export function createExpoPush(accessToken?: string): PushPort {
  return {
    async send(tokens, message) {
      if (tokens.length === 0) return { invalid: [] };

      const response = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
        },
        // ponytail: one request for every token; Expo accepts up to 100, and nobody has 100 phones.
        body: JSON.stringify(
          tokens.map((to) => ({
            to,
            title: message.title,
            body: message.body,
            data: message.data,
          })),
        ),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw await providerError('Push', response);

      const body = (await response.json()) as {
        data?: { status: string; details?: { error?: string } }[];
      };
      const invalid = tokens.filter(
        (_token, index) => body.data?.[index]?.details?.error === 'DeviceNotRegistered',
      );
      return { invalid };
    },
  };
}

/**
 * Quiet hours, in the recipient's own zone.
 *
 * The scans run once at 07:00 UTC for everyone, which is fine for an in-app row nobody sees
 * until they open the app and wrong for a buzz on a phone — that is 03:00 in New York and
 * midnight in Los Angeles. Anything that would arrive outside 08:00–21:00 local is held until
 * the next 08:00 there.
 */
export const QUIET_START_HOUR = 21;
export const QUIET_END_HOUR = 8;

function localParts(at: Date, timeZone: string): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return { hour: read('hour'), minute: read('minute') };
}

/** When delivery may happen: `at` itself, or the next 08:00 in `timeZone`. */
export function nextSendableTime(at: Date, timeZone: string): Date {
  let zone = timeZone;
  try {
    localParts(at, zone);
  } catch {
    // An unknown zone on a profile is a data problem, not a reason to never send.
    zone = 'UTC';
  }

  const { hour, minute } = localParts(at, zone);
  if (hour >= QUIET_END_HOUR && hour < QUIET_START_HOUR) return at;

  // Minutes until 08:00 local, counted forward from now; whole minutes are precise enough
  // for a reminder, and stepping in local time avoids reconstructing a zone offset by hand.
  const minutesNow = hour * 60 + minute;
  const target = QUIET_END_HOUR * 60;
  const wait = minutesNow < target ? target - minutesNow : 24 * 60 - minutesNow + target;
  return new Date(at.getTime() + wait * 60_000);
}

export interface DeliveryPorts {
  readonly email: EmailPort | null;
  readonly push: PushPort | null;
}

export type DeliveryOutcome =
  | {
      readonly status: 'sent';
      readonly channels: NotificationChannel[];
      /** Channels that failed alongside ones that worked; not retried, see below. */
      readonly failures: unknown[];
    }
  | { readonly status: 'deferred'; readonly until: Date }
  | { readonly status: 'skipped'; readonly reason: string };

/**
 * Delivers one notification, identified by its recipient and dedupe key.
 *
 * Read back from the row rather than trusted from the job payload: the row is what the user
 * sees in-app, and an email that says something different from the bell is two answers to
 * one question. A row that has already been read in-app is not emailed about — the user has
 * seen it, which is what delivery was for.
 */
export async function deliverNotification(
  db: Database,
  ports: DeliveryPorts,
  input: { readonly userId: string; readonly dedupeKey: string; readonly now?: Date },
): Promise<DeliveryOutcome> {
  const now = input.now ?? new Date();

  const [row] = await db
    .select({
      notification: schema.notifications,
      email: schema.users.email,
      timezone: schema.userProfiles.timezone,
    })
    .from(schema.notifications)
    .innerJoin(schema.users, eq(schema.users.id, schema.notifications.userId))
    .leftJoin(schema.userProfiles, eq(schema.userProfiles.userId, schema.notifications.userId))
    .where(
      and(
        eq(schema.notifications.userId, input.userId),
        eq(schema.notifications.dedupeKey, input.dedupeKey),
      ),
    )
    .limit(1);

  if (!row) return { status: 'skipped', reason: 'notification no longer exists' };
  if (row.notification.readAt) return { status: 'skipped', reason: 'already read in-app' };

  const until = nextSendableTime(now, row.timezone ?? 'UTC');
  if (until.getTime() > now.getTime()) return { status: 'deferred', until };

  /*
   * No preference row means on: the table stores departures from the default, so a user who
   * has never opened notification settings gets reminders — which is why they installed a
   * reminder app.
   */
  const preferences = await db
    .select({ channel: schema.notificationPreferences.channel })
    .from(schema.notificationPreferences)
    .where(
      and(
        eq(schema.notificationPreferences.userId, input.userId),
        eq(schema.notificationPreferences.notificationType, row.notification.notificationType),
        eq(schema.notificationPreferences.enabled, false),
      ),
    );
  const off = new Set(preferences.map((preference) => preference.channel));

  const channels: NotificationChannel[] = [];
  const failures: unknown[] = [];
  const { title, body } = row.notification;

  /*
   * Each attempt is logged for the admin console. Swallowed on failure: a retry after a lost
   * log row would send the email a second time, and a metric is not worth a duplicate email.
   */
  const log = (channel: 'EMAIL' | 'PUSH', error?: unknown) =>
    db
      .insert(schema.notificationDeliveries)
      .values({
        notificationId: row.notification.id,
        userId: input.userId,
        notificationType: row.notification.notificationType,
        channel,
        status: error ? 'failed' : 'sent',
        error: error ? String(error instanceof Error ? error.message : error).slice(0, 500) : null,
      })
      .catch(() => undefined);

  /*
   * Each channel on its own: a push outage must not cost the email, and an email already sent
   * must not be sent again when the job retries over the push. So a retry is thrown only when
   * *nothing* went out — a partial send is final, and the channel that failed is logged by the
   * caller rather than retried into a duplicate on the one that worked.
   */
  if (ports.email && !off.has('EMAIL') && isDeliverableAddress(row.email)) {
    try {
      await ports.email.send({ to: row.email, subject: title, text: body });
      channels.push('EMAIL');
      await log('EMAIL');
    } catch (error) {
      failures.push(error);
      await log('EMAIL', error);
    }
  }

  if (ports.push && !off.has('PUSH')) {
    const devices = await db
      .select({ token: schema.deviceTokens.token })
      .from(schema.deviceTokens)
      .where(eq(schema.deviceTokens.userId, input.userId));

    if (devices.length > 0) {
      try {
        const { invalid } = await ports.push.send(
          devices.map((device) => device.token),
          {
            title,
            body,
            data: { notificationId: row.notification.id, vehicleId: row.notification.vehicleId },
          },
        );
        // A token the platform has retired will never deliver again; keeping it is a failed
        // send every morning for as long as the row lives.
        if (invalid.length > 0) {
          await db.delete(schema.deviceTokens).where(inArray(schema.deviceTokens.token, invalid));
        }
        channels.push('PUSH');
        await log('PUSH');
      } catch (error) {
        failures.push(error);
        await log('PUSH', error);
      }
    }
  }

  if (channels.length === 0 && failures.length > 0) throw failures[0];
  if (channels.length === 0)
    return { status: 'skipped', reason: 'no channel enabled or configured' };
  return { status: 'sent', channels, failures };
}
