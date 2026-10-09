import { Type, type Static } from '@sinclair/typebox';
import { EventTypeSchema, IsoDateTime, MoneyOutput, Nullable, Uuid } from './common';
import { DueItem } from './maintenance';
import { ExpiringDocument } from './documents';

export const ActivityItem = Type.Object({
  id: Uuid,
  eventType: EventTypeSchema,
  title: Type.String(),
  occurredAt: IsoDateTime,
  vehicleId: Uuid,
  vehicleName: Type.String(),
  cost: Nullable(MoneyOutput),
});
export type ActivityItem = Static<typeof ActivityItem>;

/**
 * The home dashboard (PRD §25), assembled server-side.
 *
 * One response rather than five: every figure here is derived from the same handful of bulk
 * queries, and against a hosted database five round trips from the browser cost five times
 * what one does. It also keeps the briefing and the totals computed in the one place that
 * has all the inputs (§27).
 */
export const Dashboard = Type.Object({
  summary: Type.Object({
    vehicles: Type.Integer(),
    garages: Type.Integer(),
    /** Purchase prices summed where they share a currency; null when they do not. */
    totalValue: Nullable(MoneyOutput),
    /** Purchase prices plus all recorded running spend, same currency rule. */
    ownershipCost: Nullable(MoneyOutput),
    /** Mean health across vehicles that could be assessed at all. */
    averageHealth: Nullable(Type.Integer()),
    worstVehicle: Nullable(
      Type.Object({ vehicleId: Uuid, vehicleName: Type.String(), health: Type.Integer() }),
    ),
  }),

  attention: Type.Object({
    maintenance: Type.Array(DueItem),
    documents: Type.Array(ExpiringDocument),
    overdueTasks: Type.Integer(),
    tasksDueToday: Type.Integer(),
    /**
     * Recall campaigns that *may* apply, from the caller's unread recall notifications. A
     * make/model/year match, never a VIN one — clients word it as "may be affected". Marking
     * the notification read is how it leaves this list.
     */
    recalls: Type.Array(
      Type.Object({
        notificationId: Uuid,
        vehicleId: Uuid,
        vehicleName: Type.String(),
        campaign: Type.String(),
        component: Type.String(),
      }),
    ),
    /** Everything above, as one number for the headline stat. */
    total: Type.Integer(),
  }),

  recentActivity: Type.Array(ActivityItem),

  /**
   * The briefing (PRD §25), already written as sentences.
   *
   * Composed here because it is a summary of the whole garage, and a client stitching it
   * together would produce a different one per platform out of the same facts.
   */
  briefing: Type.Array(Type.String()),
});
export type Dashboard = Static<typeof Dashboard>;
