/**
 * TanStack Query keys and helpers (Architecture.md §64).
 *
 * Query *keys* live here rather than in each app so that a mutation in one place invalidates
 * the right caches everywhere. A key typed as a loose array is how a list silently fails to
 * refresh after a create — the shape drifts and the invalidation misses.
 */

import type {
  ApiKey,
  ConditionAssessment,
  ConditionSummary,
  CostSummary,
  CostTrends,
  PlanPrices,
  PlanState,
  FuelPrices,
  MonthlySpend,
  Dashboard,
  DueItem,
  Expense,
  Income,
  MileageReport,
  ExpiringDocument,
  Garage,
  GarageMember,
  MaintenancePlan,
  MaintenanceRecord,
  VehicleDocument,
  Notification,
  SearchResponse,
  Task,
  TaskBuckets,
  Vehicle,
  ShareLink,
  ValuationSummary,
  VehicleActivity,
  VehicleEvent,
  VehicleHealth,
  VehiclePassport,
  VehiclePhoto,
} from '@vehicle-os/contracts';
import type { ApiClient, Page } from './client';

/**
 * The shape each builder returns, spread into `useQuery` at the call site.
 *
 * Declared here rather than derived from `UseQueryOptions`: that type reaches into
 * `@tanstack/query-core`'s internal build output, which TypeScript refuses to name across a
 * package boundary. The call site still type-checks against the real thing, because that is
 * where `useQuery` actually receives it.
 */
export interface QueryConfig<T> {
  queryKey: readonly unknown[];
  queryFn: () => Promise<T>;
  enabled?: boolean;
  staleTime?: number;
  gcTime?: number;
  retry?: number | boolean;
  refetchOnWindowFocus?: boolean;
}

export const queryKeys = {
  me: () => ['me'] as const,
  apiKeys: () => ['me', 'api-keys'] as const,
  plan: () => ['me', 'plan'] as const,
  prices: () => ['billing', 'prices'] as const,
  garages: () => ['garages'] as const,
  garage: (garageId: string) => ['garages', garageId] as const,
  garageMembers: (garageId: string) => ['garages', garageId, 'members'] as const,

  // Prefixed with 'vehicles' so invalidating that prefix refreshes every filtered list at
  // once — after a create, the caller should not have to know which filters are mounted.
  vehicles: (filters?: Record<string, unknown>) => ['vehicles', filters ?? {}] as const,
  vehicle: (vehicleId: string) => ['vehicles', vehicleId] as const,
  vehicleTypes: () => ['vehicle-types'] as const,

  events: (vehicleId: string, filters?: Record<string, unknown>) =>
    ['vehicles', vehicleId, 'events', filters ?? {}] as const,
  event: (vehicleId: string, eventId: string) =>
    ['vehicles', vehicleId, 'events', eventId] as const,
  // Under the vehicle prefix: every write that touches a vehicle — an event, an expense, a
  // completed service — already invalidates `['vehicles', id]`, and so reaches this feed.
  // Tasks live under their own root, so task writes invalidate this key explicitly.
  activity: (vehicleId: string, filters?: Record<string, unknown>) =>
    ['vehicles', vehicleId, 'activity', filters ?? {}] as const,
  photos: (vehicleId: string) => ['vehicles', vehicleId, 'photos'] as const,

  // Under the 'vehicles' prefix for the same reason: completing a service moves the plan,
  // the timeline and the odometer, and one invalidation should reach all three.
  maintenancePlans: (vehicleId: string, filters?: Record<string, unknown>) =>
    ['vehicles', vehicleId, 'maintenance', filters ?? {}] as const,
  maintenanceRecords: (vehicleId: string) =>
    ['vehicles', vehicleId, 'maintenance', 'records'] as const,
  /** Not per-vehicle: it spans every garage, so it hangs off its own root. */
  due: () => ['due'] as const,

  expenses: (vehicleId: string, filters?: Record<string, unknown>) =>
    ['vehicles', vehicleId, 'expenses', filters ?? {}] as const,
  cost: (vehicleId: string, filters?: Record<string, unknown>) =>
    ['vehicles', vehicleId, 'cost', filters ?? {}] as const,

  // Under the `cost` prefix, so recording an expense invalidates the chart along with the
  // totals — two views of the same money must not disagree after a write.
  fuelPrices: (vehicleId: string) => ['vehicles', vehicleId, 'cost', 'fuel-prices'] as const,
  trends: (vehicleId: string) => ['vehicles', vehicleId, 'cost', 'trends'] as const,
  monthlySpend: (vehicleId: string, months: number) =>
    ['vehicles', vehicleId, 'cost', 'monthly', months] as const,
  /*
   * The report's inputs: every row in a window, not a page of it. Each under the prefix its
   * writes already invalidate — an expense under `cost`, a reading under `events` — so a new
   * entry moves the report as it moves the totals.
   */
  ledger: (vehicleId: string, from?: string) =>
    ['vehicles', vehicleId, 'cost', 'ledger', from ?? 'all'] as const,
  readings: (vehicleId: string, from?: string) =>
    ['vehicles', vehicleId, 'events', 'readings', from ?? 'all'] as const,
  income: (vehicleId: string, from?: string) =>
    ['vehicles', vehicleId, 'income', from ?? 'all'] as const,
  mileageReport: (vehicleId: string, range: { from: string; to: string }) =>
    ['vehicles', vehicleId, 'mileage-report', range] as const,

  documents: (vehicleId: string, filters?: Record<string, unknown>) =>
    ['vehicles', vehicleId, 'documents', filters ?? {}] as const,
  /** Spans every garage, like `due`, so it hangs off its own root. */
  expiringDocuments: () => ['documents', 'expiring'] as const,

  tasks: (filters?: Record<string, unknown>) => ['tasks', filters ?? {}] as const,
  taskBuckets: () => ['tasks', 'buckets'] as const,

  dashboard: () => ['dashboard'] as const,
  search: (query: string, filters?: Record<string, unknown>) =>
    ['search', query, filters ?? {}] as const,
  health: (vehicleId: string) => ['vehicles', vehicleId, 'health'] as const,
  condition: (vehicleId: string) => ['vehicles', vehicleId, 'condition'] as const,
  conditionSummary: (vehicleId: string) => ['vehicles', vehicleId, 'condition', 'summary'] as const,
  valuations: (vehicleId: string) => ['vehicles', vehicleId, 'valuations'] as const,
  shares: (vehicleId: string) => ['vehicles', vehicleId, 'shares'] as const,
  /** Keyed by token, not by vehicle: the public reader has no idea which vehicle it is. */
  passport: (token: string) => ['passport', token] as const,

  notifications: (filters?: Record<string, unknown>) => ['notifications', filters ?? {}] as const,
  unreadCount: () => ['notifications', 'unread-count'] as const,
  notificationPreferences: () => ['notifications', 'preferences'] as const,
} as const;

type Options<T> = Omit<QueryConfig<T>, 'queryKey' | 'queryFn'>;

export function garagesQuery(
  client: ApiClient,
  options?: Options<Garage[]>,
): QueryConfig<Garage[]> {
  return { queryKey: queryKeys.garages(), queryFn: () => client.garages.list(), ...options };
}

export function garageMembersQuery(
  client: ApiClient,
  garageId: string,
  options?: Options<GarageMember[]>,
): QueryConfig<GarageMember[]> {
  return {
    queryKey: queryKeys.garageMembers(garageId),
    queryFn: () => client.garages.members(garageId),
    ...options,
  };
}

export function vehiclesQuery(
  client: ApiClient,
  filters: { garageId?: string; status?: string } = {},
  options?: Options<Page<Vehicle>>,
): QueryConfig<Page<Vehicle>> {
  return {
    queryKey: queryKeys.vehicles(filters),
    queryFn: () => client.vehicles.list(filters),
    ...options,
  };
}

export function vehicleQuery(
  client: ApiClient,
  vehicleId: string,
  options?: Options<Vehicle>,
): QueryConfig<Vehicle> {
  return {
    queryKey: queryKeys.vehicle(vehicleId),
    queryFn: () => client.vehicles.get(vehicleId),
    ...options,
  };
}

/** One entry, for the screen that shows everything recorded about it. */
export function eventQuery(
  client: ApiClient,
  vehicleId: string,
  eventId: string,
  options?: Options<VehicleEvent>,
): QueryConfig<VehicleEvent> {
  return {
    queryKey: queryKeys.event(vehicleId, eventId),
    queryFn: () => client.events.get(vehicleId, eventId),
    ...options,
  };
}

export function eventsQuery(
  client: ApiClient,
  vehicleId: string,
  filters: { eventType?: string[] } = {},
  options?: Options<Page<VehicleEvent>>,
): QueryConfig<Page<VehicleEvent>> {
  return {
    queryKey: queryKeys.events(vehicleId, filters),
    queryFn: () => client.events.list(vehicleId, filters),
    ...options,
  };
}

export function photosQuery(
  client: ApiClient,
  vehicleId: string,
  options?: Options<VehiclePhoto[]>,
): QueryConfig<VehiclePhoto[]> {
  return {
    queryKey: queryKeys.photos(vehicleId),
    queryFn: () => client.photos.list(vehicleId),
    ...options,
  };
}

export function activityQuery(
  client: ApiClient,
  vehicleId: string,
  filters: { eventType?: string[] } = {},
  options?: Options<VehicleActivity>,
): QueryConfig<VehicleActivity> {
  return {
    queryKey: queryKeys.activity(vehicleId, filters),
    queryFn: () => client.activity(vehicleId, filters),
    ...options,
  };
}

export function maintenancePlansQuery(
  client: ApiClient,
  vehicleId: string,
  filters: { status?: MaintenancePlan['status']; includeInactive?: boolean } = {},
  options?: Options<MaintenancePlan[]>,
): QueryConfig<MaintenancePlan[]> {
  return {
    queryKey: queryKeys.maintenancePlans(vehicleId, filters),
    queryFn: () => client.maintenance.plans(vehicleId, filters),
    ...options,
  };
}

export function maintenanceRecordsQuery(
  client: ApiClient,
  vehicleId: string,
  options?: Options<MaintenanceRecord[]>,
): QueryConfig<MaintenanceRecord[]> {
  return {
    queryKey: queryKeys.maintenanceRecords(vehicleId),
    queryFn: () => client.maintenance.records(vehicleId),
    ...options,
  };
}

export function dueQuery(client: ApiClient, options?: Options<DueItem[]>): QueryConfig<DueItem[]> {
  return { queryKey: queryKeys.due(), queryFn: () => client.maintenance.due(), ...options };
}

export function tasksQuery(
  client: ApiClient,
  filters: { garageId?: string; vehicleId?: string; openOnly?: boolean } = {},
  options?: Options<Task[]>,
): QueryConfig<Task[]> {
  return {
    queryKey: queryKeys.tasks(filters),
    queryFn: () => client.tasks.list(filters),
    ...options,
  };
}

export function taskBucketsQuery(
  client: ApiClient,
  options?: Options<TaskBuckets>,
): QueryConfig<TaskBuckets> {
  return { queryKey: queryKeys.taskBuckets(), queryFn: () => client.tasks.buckets(), ...options };
}

export function apiKeysQuery(
  client: ApiClient,
  options?: Options<ApiKey[]>,
): QueryConfig<ApiKey[]> {
  return {
    queryKey: queryKeys.apiKeys(),
    queryFn: () => client.apiKeys.list(),
    ...options,
  };
}

export function notificationsQuery(
  client: ApiClient,
  filters: { unreadOnly?: boolean; limit?: number } = {},
  options?: Options<Notification[]>,
): QueryConfig<Notification[]> {
  return {
    queryKey: queryKeys.notifications(filters),
    queryFn: () => client.notifications.list(filters),
    ...options,
  };
}

export function unreadCountQuery(
  client: ApiClient,
  options?: Options<{ unread: number }>,
): QueryConfig<{ unread: number }> {
  return {
    queryKey: queryKeys.unreadCount(),
    queryFn: () => client.notifications.unreadCount(),
    ...options,
  };
}

export function expensesQuery(
  client: ApiClient,
  vehicleId: string,
  filters: { category?: string; from?: string; to?: string } = {},
  options?: Options<Page<Expense>>,
): QueryConfig<Page<Expense>> {
  return {
    queryKey: queryKeys.expenses(vehicleId, filters),
    queryFn: () => client.expenses.list(vehicleId, filters),
    ...options,
  };
}

export function costQuery(
  client: ApiClient,
  vehicleId: string,
  filters: { from?: string; to?: string } = {},
  options?: Options<CostSummary>,
): QueryConfig<CostSummary> {
  return {
    queryKey: queryKeys.cost(vehicleId, filters),
    queryFn: () => client.expenses.cost(vehicleId, filters),
    ...options,
  };
}

export function monthlySpendQuery(
  client: ApiClient,
  vehicleId: string,
  months = 12,
  options?: Options<MonthlySpend>,
): QueryConfig<MonthlySpend> {
  return {
    queryKey: queryKeys.monthlySpend(vehicleId, months),
    queryFn: () => client.expenses.monthly(vehicleId, { months }),
    ...options,
  };
}

/** The caller's plan. Short-lived: it changes the moment a webhook lands after checkout. */
export function planQuery(client: ApiClient, options?: Options<PlanState>): QueryConfig<PlanState> {
  return {
    queryKey: queryKeys.plan(),
    queryFn: () => client.users.plan(),
    staleTime: 15_000,
    ...options,
  };
}

/** What the paid tiers cost. Long-lived: prices change on a business timescale. */
export function pricesQuery(
  client: ApiClient,
  options?: Options<PlanPrices>,
): QueryConfig<PlanPrices> {
  return {
    queryKey: queryKeys.prices(),
    queryFn: () => client.billing.prices(),
    staleTime: 60 * 60 * 1000,
    ...options,
  };
}

export function costTrendsQuery(
  client: ApiClient,
  vehicleId: string,
  options?: Options<CostTrends>,
): QueryConfig<CostTrends> {
  return {
    queryKey: queryKeys.trends(vehicleId),
    queryFn: () => client.expenses.trends(vehicleId),
    ...options,
  };
}

export function fuelPricesQuery(
  client: ApiClient,
  vehicleId: string,
  options?: Options<FuelPrices[]>,
): QueryConfig<FuelPrices[]> {
  return {
    queryKey: queryKeys.fuelPrices(vehicleId),
    queryFn: () => client.expenses.fuelPrices(vehicleId),
    ...options,
  };
}

export function documentsQuery(
  client: ApiClient,
  vehicleId: string,
  filters: { documentType?: string; expiringOnly?: boolean } = {},
  options?: Options<Page<VehicleDocument>>,
): QueryConfig<Page<VehicleDocument>> {
  return {
    queryKey: queryKeys.documents(vehicleId, filters),
    queryFn: () => client.documents.list(vehicleId, filters),
    ...options,
  };
}

export function expiringDocumentsQuery(
  client: ApiClient,
  options?: Options<ExpiringDocument[]>,
): QueryConfig<ExpiringDocument[]> {
  return {
    queryKey: queryKeys.expiringDocuments(),
    queryFn: () => client.documents.expiring(),
    ...options,
  };
}

export function dashboardQuery(
  client: ApiClient,
  options?: Options<Dashboard>,
): QueryConfig<Dashboard> {
  return { queryKey: queryKeys.dashboard(), queryFn: () => client.dashboard(), ...options };
}

export function searchQuery(
  client: ApiClient,
  q: string,
  filters: { type?: string; limit?: number } = {},
  options?: Options<SearchResponse>,
): QueryConfig<SearchResponse> {
  return {
    queryKey: queryKeys.search(q, filters),
    queryFn: () => client.search({ q, ...filters }),
    // Below two characters the API refuses the query; asking anyway is a guaranteed 400.
    enabled: q.trim().length >= 2,
    ...options,
  };
}

export function healthQuery(
  client: ApiClient,
  vehicleId: string,
  options?: Options<VehicleHealth>,
): QueryConfig<VehicleHealth> {
  return {
    queryKey: queryKeys.health(vehicleId),
    queryFn: () => client.health(vehicleId),
    ...options,
  };
}

export function conditionQuery(
  client: ApiClient,
  vehicleId: string,
  options?: Options<Page<ConditionAssessment>>,
): QueryConfig<Page<ConditionAssessment>> {
  return {
    queryKey: queryKeys.condition(vehicleId),
    queryFn: () => client.condition.list(vehicleId),
    ...options,
  };
}

export function conditionSummaryQuery(
  client: ApiClient,
  vehicleId: string,
  options?: Options<ConditionSummary>,
): QueryConfig<ConditionSummary> {
  return {
    queryKey: queryKeys.conditionSummary(vehicleId),
    queryFn: () => client.condition.summary(vehicleId),
    ...options,
  };
}

export function valuationsQuery(
  client: ApiClient,
  vehicleId: string,
  options?: Options<ValuationSummary>,
): QueryConfig<ValuationSummary> {
  return {
    queryKey: queryKeys.valuations(vehicleId),
    queryFn: () => client.valuations.summary(vehicleId),
    ...options,
  };
}

export function sharesQuery(
  client: ApiClient,
  vehicleId: string,
  options?: Options<ShareLink[]>,
): QueryConfig<ShareLink[]> {
  return {
    queryKey: queryKeys.shares(vehicleId),
    queryFn: () => client.shares.list(vehicleId),
    ...options,
  };
}

export function passportQuery(
  client: ApiClient,
  token: string,
  options?: Options<VehiclePassport>,
): QueryConfig<VehiclePassport> {
  return {
    queryKey: queryKeys.passport(token),
    queryFn: () => client.passport(token),
    // A revoked link answers 404; retrying it just delays telling the reader.
    retry: false,
    ...options,
  };
}

/**
 * Every page of a list, for a report that has to see all of it.
 *
 * ponytail: capped at 20 pages (2,000 rows) per window — years of daily entries. Past that the
 * report needs a server-side aggregate, not more round trips.
 */
async function allPages<T>(fetch: (cursor?: string) => Promise<Page<T>>, cap = 20): Promise<T[]> {
  const rows: T[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < cap; page += 1) {
    const result = await fetch(cursor);
    rows.push(...result.data);
    if (!result.pagination.hasMore || !result.pagination.nextCursor) break;
    cursor = result.pagination.nextCursor;
  }
  return rows;
}

/** Every expense since `from` (all of them without it), newest first. */
export function expenseLedgerQuery(
  client: ApiClient,
  vehicleId: string,
  from?: string,
  options?: Options<Expense[]>,
): QueryConfig<Expense[]> {
  return {
    queryKey: queryKeys.ledger(vehicleId, from),
    queryFn: () =>
      allPages((cursor) => client.expenses.list(vehicleId, { from, limit: 100, cursor })),
    ...options,
  };
}

/** Every odometer reading since `from`, off the timeline — what the distance in a window is measured from. */
export function readingsQuery(
  client: ApiClient,
  vehicleId: string,
  from?: string,
  options?: Options<{ occurredAt: string; odometer: number | null }[]>,
): QueryConfig<{ occurredAt: string; odometer: number | null }[]> {
  return {
    queryKey: queryKeys.readings(vehicleId, from),
    queryFn: async () =>
      (await allPages((cursor) => client.events.list(vehicleId, { from, limit: 100, cursor })))
        .filter((event) => event.odometer !== null)
        .map((event) => ({ occurredAt: event.occurredAt, odometer: event.odometer })),
    ...options,
  };
}

/** Every income entry since `from`. A free garage answers 402 — read it with `planWall`. */
export function incomeLedgerQuery(
  client: ApiClient,
  vehicleId: string,
  from?: string,
  options?: Options<Income[]>,
): QueryConfig<Income[]> {
  return {
    queryKey: queryKeys.income(vehicleId, from),
    queryFn: () =>
      allPages((cursor) => client.income.list(vehicleId, { from, limit: 100, cursor })),
    ...options,
  };
}

/** Trips in a period by purpose, with deductions at each trip's own rate. */
export function mileageReportQuery(
  client: ApiClient,
  vehicleId: string,
  range: { from: string; to: string },
  options?: Options<MileageReport>,
): QueryConfig<MileageReport> {
  return {
    queryKey: queryKeys.mileageReport(vehicleId, range),
    queryFn: () => client.events.mileageReport(vehicleId, range),
    ...options,
  };
}
