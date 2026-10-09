/**
 * Keeping the expense derived from a timeline event in step with it.
 *
 * A cost entered on the timeline has to reach the cost summary, and a cost corrected there
 * has to move with it — otherwise the two screens disagree and neither is obviously wrong.
 * The expense is linked by `event_id`, so the mirror is a lookup, not a guess.
 *
 * Called inside the caller's transaction: the event and its expense are one change.
 */

import { eq } from 'drizzle-orm';
import { schema, type Executor } from '@vehicle-os/database';
import type { EventType, ExpenseCategory } from '@vehicle-os/domain';
import { categoryAfterEdit, categoryForEventType } from '../../domain/event-category';

export interface MirroredEvent {
  readonly id: string;
  readonly vehicleId: string;
  readonly eventType: EventType;
  readonly title: string;
  readonly occurredAt: Date;
  readonly odometer: number | null;
  readonly odometerUnit: 'KM' | 'MI' | null;
  readonly costAmountMinor: number | null;
  readonly costCurrency: string | null;
  readonly provider: string | null;
}

async function findMirror(
  tx: Executor,
  eventId: string,
): Promise<{ id: string; category: ExpenseCategory } | null> {
  const [row] = await tx
    .select({ id: schema.expenses.id, category: schema.expenses.category })
    .from(schema.expenses)
    .where(eq(schema.expenses.eventId, eventId))
    .limit(1);
  return row ?? null;
}

/**
 * Creates, updates or removes the expense behind an event, to match its current cost.
 *
 * Returns nothing: the caller already has the event, and an expense that exists only as a
 * projection of it is not something any caller should be handed to edit directly.
 */
export async function mirrorEventExpense(
  tx: Executor,
  event: MirroredEvent,
  createdBy: string | null,
): Promise<void> {
  const existing = await findMirror(tx, event.id);
  const hasCost = event.costAmountMinor !== null && event.costCurrency !== null;

  if (!hasCost) {
    // The cost was cleared. The expense was only ever a projection of it, so it goes too —
    // leaving it would keep charging the owner for something the timeline says was free.
    if (existing) await tx.delete(schema.expenses).where(eq(schema.expenses.id, existing.id));
    return;
  }

  const values = {
    vehicleId: event.vehicleId,
    eventId: event.id,
    // An edit keeps the category the money was filed under unless the item's type changed to
    // one it no longer fits — see `categoryAfterEdit`.
    category: existing
      ? categoryAfterEdit(existing.category, event.eventType)
      : categoryForEventType(event.eventType),
    description: event.title,
    vendor: event.provider,
    amountMinor: event.costAmountMinor!,
    currency: event.costCurrency!,
    occurredAt: event.occurredAt,
    odometer: event.odometer,
    odometerUnit: event.odometerUnit,
    source: 'USER' as const,
    createdBy,
  };

  if (existing) {
    await tx.update(schema.expenses).set(values).where(eq(schema.expenses.id, existing.id));
    return;
  }
  await tx.insert(schema.expenses).values(values);
}

/**
 * Removes the expense behind an event that is being deleted.
 *
 * The `event_id` foreign key is `set null` on delete, which would leave the row as an orphan
 * nobody can find and every total still counts. Every expense carrying an `event_id` today
 * was written alongside its event — by the timeline or by a maintenance completion — so
 * deleting the event deletes the money it recorded, which is what the person pressing
 * delete on a duplicate entry means.
 */
export async function removeMirroredExpense(tx: Executor, eventId: string): Promise<void> {
  await tx.delete(schema.expenses).where(eq(schema.expenses.eventId, eventId));
}
