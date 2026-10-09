/**
 * Outbox writer (Architecture.md §38).
 *
 * Call this inside the same transaction as the domain write. If the transaction rolls back
 * the message disappears with it, and if it commits the message is durably queued — the two
 * cannot diverge, which is the whole point.
 */

import { schema, type Executor } from '@vehicle-os/database';

export const QUEUES = [
  'notifications',
  'email',
  'push',
  'ocr',
  'image-processing',
  'ai',
  'valuation',
  'maintenance',
  'analytics',
  'telemetry',
] as const;

export type QueueName = (typeof QUEUES)[number];

export interface OutboxMessage {
  readonly queue: QueueName;
  readonly jobName: string;
  readonly payload: Record<string, unknown>;
  /**
   * Stable identity for the work, not for the message. Two enqueues of
   * `maintenance-due:{planId}:{dueOdometer}` are the same job, so the second is dropped by
   * BullMQ rather than sending a second reminder for the same service (§39).
   */
  readonly jobKey: string;
}

/** One message or a batch; a batch is one INSERT. */
export async function enqueue(
  tx: Executor,
  messages: OutboxMessage | readonly OutboxMessage[],
): Promise<void> {
  const rows = [messages].flat();
  if (rows.length === 0) return;
  await tx
    .insert(schema.outboxMessages)
    .values(
      rows.map(({ queue, jobName, payload, jobKey }) => ({ queue, jobName, payload, jobKey })),
    );
}
