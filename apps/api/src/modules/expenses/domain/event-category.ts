/**
 * Which expense category a timeline event's cost belongs to.
 *
 * A cost typed into the timeline is money spent on the vehicle, and it has to reach the
 * ownership total — money that appears on one screen and not the other is the exact
 * fragmentation the product exists to remove (PRD §4). The mapping lives here, as data,
 * because it is a product decision rather than a data structure: `CHARGE` is `CHARGING`
 * spend, an `ACCIDENT` with a bill on it is a `REPAIR`.
 */

import type { EventType, ExpenseCategory } from '@vehicle-os/domain';

const BY_EVENT_TYPE: Partial<Record<EventType, ExpenseCategory>> = {
  PURCHASE: 'PURCHASE',
  MAINTENANCE: 'MAINTENANCE',
  REPAIR: 'REPAIR',
  MODIFICATION: 'MODIFICATION',
  ACCIDENT: 'REPAIR',
  FUEL: 'FUEL',
  CHARGE: 'CHARGING',
  CLEANING: 'CLEANING',
  REGISTRATION: 'REGISTRATION',
  INSURANCE: 'INSURANCE',
  INSPECTION: 'MAINTENANCE',
  PART_INSTALLED: 'PART',
};

/**
 * `OTHER` for anything unmapped rather than dropping the amount.
 *
 * A cost on a `NOTE` is unusual but it is still money the owner spent; filing it under
 * "other" keeps the total honest, where skipping it would make the summary quietly disagree
 * with the timeline it was built from.
 */
export function categoryForEventType(eventType: EventType): ExpenseCategory {
  return BY_EVENT_TYPE[eventType] ?? 'OTHER';
}

/**
 * The other direction: what kind of activity item an expense becomes.
 *
 * Every expense is an item in the vehicle's activity — money spent on it is something that
 * happened to it — so an expense entered on the spending page is written as an event carrying
 * its cost. Categories with no event type of their own (tax, storage, an accessory, transport)
 * become a plain `EXPENSE` item. Exhaustive on purpose: a new category that is not mapped here
 * is a compile error, not an expense that silently never appears in activity.
 */
const BY_CATEGORY: Record<ExpenseCategory, EventType> = {
  PURCHASE: 'PURCHASE',
  MAINTENANCE: 'MAINTENANCE',
  REPAIR: 'REPAIR',
  FUEL: 'FUEL',
  CHARGING: 'CHARGE',
  INSURANCE: 'INSURANCE',
  REGISTRATION: 'REGISTRATION',
  TAX: 'EXPENSE',
  MODIFICATION: 'MODIFICATION',
  PART: 'PART_INSTALLED',
  ACCESSORY: 'EXPENSE',
  STORAGE: 'EXPENSE',
  CLEANING: 'CLEANING',
  TRANSPORT: 'EXPENSE',
  OTHER: 'EXPENSE',
};

export function eventTypeForCategory(category: ExpenseCategory): EventType {
  return BY_CATEGORY[category];
}

/**
 * The category an expense keeps when its event is edited.
 *
 * Recomputing it from the event type would be lossy: a `TAX` expense is an `EXPENSE` event,
 * and `EXPENSE` maps back to `OTHER`, so the first correction to the item's title would quietly
 * refile the tax as "other". The category follows the event only when the event's type has
 * changed to one the category no longer describes — an inspection filed as maintenance stays
 * maintenance, a note retyped as fuel becomes fuel.
 */
export function categoryAfterEdit(current: ExpenseCategory, eventType: EventType): ExpenseCategory {
  const stillDescribes =
    eventTypeForCategory(current) === eventType || categoryForEventType(eventType) === current;
  return stillDescribes ? current : categoryForEventType(eventType);
}
