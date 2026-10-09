/**
 * Email and push delivery for every notification the scans produce.
 *
 * One handler behind every `deliver-*` job name: what differs between a maintenance reminder
 * and an expiring document is already in the notification row, and the rules for sending —
 * preferences, quiet hours, dead tokens — are the same for both.
 */

import { env } from '@vehicle-os/config';
import { schema } from '@vehicle-os/database';
import {
  createExpoPush,
  createResendEmail,
  deliverNotification,
  DeliveryRefusedError,
  type DeliveryPorts,
} from '@vehicle-os/api/deliver';
import { PermanentError, type JobHandler } from './index';

let ports: DeliveryPorts | null = null;

/** Built once, from env: a channel with no credentials is `null` and skipped, not an error. */
function deliveryPorts(): DeliveryPorts {
  if (ports) return ports;
  const config = env();
  ports = {
    email: config.RESEND_API_KEY
      ? createResendEmail(config.RESEND_API_KEY, config.EMAIL_FROM)
      : null,
    // Expo push needs no credential until the project turns on push security.
    push: createExpoPush(config.EXPO_ACCESS_TOKEN),
  };
  return ports;
}

/** Test seam: handler tests must not reach a provider. */
export function __setDeliveryPorts(value: DeliveryPorts | null): void {
  ports = value;
}

export const deliverNotificationJob: JobHandler = async (job, { db, log }) => {
  const { userId, dedupeKey } = job.data as { userId?: string; dedupeKey?: string };

  // Jobs enqueued before delivery existed carry no key; the in-app row is all they had.
  if (!userId || !dedupeKey) {
    log.info({ jobId: job.id }, 'Delivery job without a dedupe key; in-app only');
    return;
  }

  const outcome = await deliverNotification(db, deliveryPorts(), { userId, dedupeKey }).catch(
    (error: unknown) => {
      // A refusal is final: fail once, not five times with the same answer.
      throw error instanceof DeliveryRefusedError ? new PermanentError(error.message) : error;
    },
  );

  if (outcome.status === 'deferred') {
    /*
     * Held, not dropped: a fresh outbox message due at 08:00 in the recipient's zone, and this
     * job ends. The key carries the time, so the held message is told apart from this one.
     */
    await db.insert(schema.outboxMessages).values({
      queue: 'notifications',
      jobName: job.name,
      payload: { userId, dedupeKey },
      jobKey: `deliver:${userId}:${dedupeKey}:at:${outcome.until.getTime()}`,
      availableAt: outcome.until,
    });
    log.info({ userId, until: outcome.until.toISOString() }, 'Delivery held for quiet hours');
    return;
  }

  if (outcome.status === 'sent' && outcome.failures.length > 0) {
    log.warn({ userId, dedupeKey, err: outcome.failures[0] }, 'A delivery channel failed');
  }
  log.info({ userId, dedupeKey, ...outcome }, 'Notification delivery');
};
