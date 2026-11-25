/**
 * The home dashboard (PRD §25).
 *
 * Assembled server-side from a handful of bulk queries run in parallel, rather than left to
 * the client to stitch out of five separate endpoints. Two reasons, and both matter:
 *
 *  - Every figure here — the totals, the health average, the briefing — is a calculation over
 *    the whole garage, and §27 puts those on the server so every client quotes the same
 *    number.
 *  - Five requests from a browser to an API in front of a database in another region cost
 *    five times what one does.
 */

import { and, desc, eq, gte, inArray, isNull, lt, notInArray, sql } from 'drizzle-orm';
import { schema, type Database } from '@vehicle-os/database';
import type { ActivityItem, Dashboard, DueItem, ExpiringDocument } from '@vehicle-os/contracts';
import { displayName } from '../../../vehicles/domain/entities/vehicle';
import { computeNextDue } from '../../../maintenance/domain/next-due';
import { listDuePlansForGarages } from '../../../maintenance/infrastructure/repositories/maintenance-repository';
import { serializePlan } from '../../../maintenance/http/serializers/maintenance-serializer';
import { EXPIRY_HORIZON_DAYS, daysUntil } from '../../../documents/domain/expiry';
import { listExpiringDocuments } from '../../../documents/infrastructure/repositories/document-repository';
import { serializeDocument } from '../../../documents/http/serializers/document-serializer';
import { computeHealth } from '../../../health/domain/health';
import { freshStandings, latestByCategory } from '../../../condition/domain/condition';
import { formatMoney } from '../../domain/briefing';
import { primaryCurrency, type CategorySum } from '../../../expenses/domain/cost';

const STATUS_ORDER = { OVERDUE: 0, DUE_SOON: 1, OK: 2, UNSCHEDULED: 3 } as const;

function addDays(date: string, days: number): string {
  const shifted = new Date(`${date}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

/**
 * Sums money only where the currency agrees.
 *
 * Mixed currencies cannot be added without an exchange rate, and one invented here would
 * make the headline figure a guess. Null is the honest answer (§27).
 */
function sumSameCurrency(
  amounts: readonly { amountMinor: number; currency: string }[],
): { amountMinor: number; currency: string } | null {
  if (amounts.length === 0) return null;
  const currency = amounts[0]!.currency;
  if (amounts.some((amount) => amount.currency !== currency)) return null;
  return {
    amountMinor: amounts.reduce((total, amount) => total + amount.amountMinor, 0),
    currency,
  };
}

/**
 * The garages' newest entries, for the logbook on the home screen.
 *
 * Each vehicle's own newest rows, read off `(vehicle_id, occurred_at desc)`, then the newest of
 * those. Sorting the joined table instead let Postgres walk the whole events index from today
 * backwards until it met eight rows of these garages — every other account's history included.
 */
async function recentEvents(db: Database, garageIds: string[]) {
  const RECENT = 8;
  type Row = {
    id: string;
    event_type: (typeof schema.vehicleEvents.$inferSelect)['eventType'];
    title: string;
    occurred_at: Date | string;
    cost_amount_minor: string | number | null;
    cost_currency: string | null;
    vehicle_id: string;
    nickname: string | null;
    make: string | null;
    model: string | null;
    year: number | null;
    vehicle_type: (typeof schema.vehicles.$inferSelect)['vehicleType'];
  };
  const result = await db.execute<Row>(sql`
    select e.id, e.event_type, e.title, e.occurred_at, e.cost_amount_minor, e.cost_currency,
           v.id as vehicle_id, v.nickname, v.make, v.model, v.year, v.vehicle_type
    from ${schema.vehicles} v
    cross join lateral (
      select id, event_type, title, occurred_at, cost_amount_minor, cost_currency
      from ${schema.vehicleEvents}
      where vehicle_id = v.id
      order by occurred_at desc
      limit ${RECENT}
    ) e
    where v.garage_id in ${garageIds} and v.deleted_at is null
    order by e.occurred_at desc
    limit ${RECENT}
  `);
  // postgres.js answers with the rows themselves; PGlite (the test suite) with `{ rows }`.
  const rows: Row[] = Array.isArray(result) ? result : (result as unknown as { rows: Row[] }).rows;
  return rows.map((row) => ({
    id: row.id,
    eventType: row.event_type,
    title: row.title,
    occurredAt: new Date(row.occurred_at),
    costAmountMinor: row.cost_amount_minor === null ? null : Number(row.cost_amount_minor),
    costCurrency: row.cost_currency,
    vehicleId: row.vehicle_id,
    nickname: row.nickname,
    make: row.make,
    model: row.model,
    year: row.year,
    vehicleType: row.vehicle_type,
  }));
}

export async function buildDashboard(
  db: Database,
  garageIds: readonly string[],
  today: string,
  now: Date = new Date(),
  /** Whose unread recall notices to include. Omitted by callers with no one person in view. */
  userId?: string,
): Promise<Dashboard> {
  if (garageIds.length === 0) {
    return {
      summary: {
        vehicles: 0,
        garages: 0,
        totalValue: null,
        ownershipCost: null,
        averageHealth: null,
        worstVehicle: null,
        spentThisMonth: null,
        spentLastMonth: null,
      },
      attention: {
        maintenance: [],
        documents: [],
        overdueTasks: 0,
        tasksDueToday: 0,
        recalls: [],
        total: 0,
      },
      vehicleSpend: {},
      recentActivity: [],
      briefing: ['Create a garage to start keeping a vehicle’s history.'],
    };
  }

  const ids = [...garageIds];
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const lastMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const inGarages = and(inArray(schema.vehicles.garageId, ids), isNull(schema.vehicles.deletedAt));

  /*
   * Independent reads, issued together — sequentially this would be ten times the latency for
   * the same answer. Each returns what the page needs and no more: money as sums per vehicle,
   * condition and valuations as the newest per vehicle. Reading the rows themselves made the
   * home screen cost more with every fill-up ever recorded.
   */
  const [
    vehicles,
    duePlans,
    expiringDocs,
    openTasks,
    expenses,
    events,
    conditionRows,
    valuationRows,
    recallRows,
    garageRows,
  ] = await Promise.all([
    db.select().from(schema.vehicles).where(inGarages),
    listDuePlansForGarages(db, ids),
    listExpiringDocuments(db, ids, addDays(today, EXPIRY_HORIZON_DAYS)),
    db
      .select({
        vehicleId: schema.tasks.vehicleId,
        title: schema.tasks.title,
        dueDate: schema.tasks.dueDate,
        priority: schema.tasks.priority,
      })
      .from(schema.tasks)
      .where(
        and(
          inArray(schema.tasks.garageId, ids),
          isNull(schema.tasks.deletedAt),
          notInArray(schema.tasks.status, ['COMPLETED', 'CANCELLED']),
        ),
      ),
    // Lifetime and this month's spend, summed per vehicle, currency and category.
    db
      .select({
        vehicleId: schema.expenses.vehicleId,
        currency: schema.expenses.currency,
        category: schema.expenses.category,
        amountMinor: sql<number>`sum(${schema.expenses.amountMinor})`.mapWith(Number),
        count: sql<number>`count(*)`.mapWith(Number),
        // Null when nothing was spent this month in that currency — not the same as zero.
        monthMinor: sql<number | null>`sum(${schema.expenses.amountMinor}) filter (where ${gte(
          schema.expenses.occurredAt,
          monthStart,
        )})`.mapWith((value: unknown) => (value === null ? null : Number(value))),
        // Last calendar month's, for the home screen's month-on-month: the same null rule.
        lastMonthMinor: sql<number | null>`sum(${schema.expenses.amountMinor}) filter (where ${and(
          gte(schema.expenses.occurredAt, lastMonthStart),
          lt(schema.expenses.occurredAt, monthStart),
        )})`.mapWith((value: unknown) => (value === null ? null : Number(value))),
      })
      .from(schema.expenses)
      .innerJoin(schema.vehicles, eq(schema.vehicles.id, schema.expenses.vehicleId))
      .where(inGarages)
      .groupBy(schema.expenses.vehicleId, schema.expenses.currency, schema.expenses.category),
    recentEvents(db, ids),
    // The newest score per vehicle and category: all `latestByCategory` keeps of the history.
    db
      .selectDistinctOn([schema.conditionAssessments.vehicleId, schema.conditionItems.category], {
        vehicleId: schema.conditionAssessments.vehicleId,
        category: schema.conditionItems.category,
        score: schema.conditionItems.score,
        assessedAt: schema.conditionAssessments.assessedAt,
      })
      .from(schema.conditionItems)
      .innerJoin(
        schema.conditionAssessments,
        eq(schema.conditionAssessments.id, schema.conditionItems.assessmentId),
      )
      .innerJoin(schema.vehicles, eq(schema.vehicles.id, schema.conditionAssessments.vehicleId))
      .where(inGarages)
      .orderBy(
        schema.conditionAssessments.vehicleId,
        schema.conditionItems.category,
        desc(schema.conditionAssessments.assessedAt),
      ),
    // The newest valuation per vehicle.
    db
      .selectDistinctOn([schema.valuations.vehicleId], {
        vehicleId: schema.valuations.vehicleId,
        amountMinor: schema.valuations.estimatedValueAmountMinor,
        currency: schema.valuations.estimatedValueCurrency,
        valuationDate: schema.valuations.valuationDate,
      })
      .from(schema.valuations)
      .innerJoin(schema.vehicles, eq(schema.vehicles.id, schema.valuations.vehicleId))
      .where(inGarages)
      .orderBy(schema.valuations.vehicleId, desc(schema.valuations.valuationDate)),
    userId
      ? db
          .select({
            notificationId: schema.notifications.id,
            vehicleId: schema.notifications.vehicleId,
            payload: schema.notifications.payload,
          })
          .from(schema.notifications)
          .where(
            and(
              eq(schema.notifications.userId, userId),
              eq(schema.notifications.notificationType, 'RECALL'),
              isNull(schema.notifications.readAt),
            ),
          )
          .orderBy(desc(schema.notifications.createdAt))
      : Promise.resolve([]),
    db
      .select({ id: schema.garages.id, defaultCurrency: schema.garages.defaultCurrency })
      .from(schema.garages)
      .where(inArray(schema.garages.id, ids)),
  ]);

  const nameOf = (vehicle: {
    nickname: string | null;
    make: string | null;
    model: string | null;
    year: number | null;
    vehicleType: (typeof schema.vehicles.$inferSelect)['vehicleType'];
  }) => displayName(vehicle);

  // --- attention ---------------------------------------------------------------------

  const maintenance: DueItem[] = duePlans
    .map((row) => ({
      plan: serializePlan(row.plan, {
        currentOdometer: row.currentOdometer,
        odometerUnit: row.odometerUnit,
        currentEngineHours: row.currentEngineHours,
      }),
      vehicleId: row.vehicleId,
      vehicleName: nameOf(row),
      vehicleType: row.vehicleType,
      odometerUnit: row.odometerUnit,
    }))
    .filter((item) => item.plan.status === 'OVERDUE' || item.plan.status === 'DUE_SOON')
    .sort((a, b) => STATUS_ORDER[a.plan.status] - STATUS_ORDER[b.plan.status]);

  const documents: ExpiringDocument[] = expiringDocs.map((row) => ({
    document: serializeDocument(row.document),
    vehicleId: row.vehicleId,
    vehicleName: nameOf(row),
    daysRemaining: daysUntil(row.document.expiresOn!, today),
  }));

  const overdueTasks = openTasks.filter(
    (task) => task.dueDate !== null && task.dueDate < today,
  ).length;
  const tasksDueToday = openTasks.filter((task) => task.dueDate === today).length;

  // --- health ------------------------------------------------------------------------

  /*
   * Computed per vehicle from the bulk reads already in hand. Calling the health endpoint
   * once per vehicle would be one request and three queries each — for a garage of six
   * vehicles, nineteen round trips to say the same thing.
   */
  const plansByVehicle = new Map<string, { title: string; status: DueItem['plan']['status'] }[]>();
  for (const row of duePlans) {
    const list = plansByVehicle.get(row.vehicleId) ?? [];
    list.push({
      title: row.plan.title,
      status: computeNextDue(
        row.plan,
        {
          currentOdometer: row.currentOdometer,
          odometerUnit: row.odometerUnit,
          currentEngineHours: row.currentEngineHours,
        },
        now,
      ).status,
    });
    plansByVehicle.set(row.vehicleId, list);
  }

  const tasksByVehicle = new Map<string, typeof openTasks>();
  for (const task of openTasks) {
    if (!task.vehicleId) continue;
    const list = tasksByVehicle.get(task.vehicleId) ?? [];
    list.push(task);
    tasksByVehicle.set(task.vehicleId, list);
  }

  const conditionByVehicle = new Map<string, typeof conditionRows>();
  for (const row of conditionRows) {
    const list = conditionByVehicle.get(row.vehicleId) ?? [];
    list.push(row);
    conditionByVehicle.set(row.vehicleId, list);
  }

  const docsByVehicle = new Map<string, { title: string; expiresOn: string }[]>();
  for (const row of expiringDocs) {
    const list = docsByVehicle.get(row.vehicleId) ?? [];
    list.push({ title: row.document.title, expiresOn: row.document.expiresOn! });
    docsByVehicle.set(row.vehicleId, list);
  }

  const scored = vehicles
    .map((vehicle) => ({
      vehicleId: vehicle.id,
      vehicleName: nameOf(vehicle),
      health: computeHealth({
        plans: plansByVehicle.get(vehicle.id) ?? [],
        tasks: tasksByVehicle.get(vehicle.id) ?? [],
        documents: docsByVehicle.get(vehicle.id) ?? [],
        condition: freshStandings(
          latestByCategory(conditionByVehicle.get(vehicle.id) ?? [], now),
        ).map((standing) => ({
          category: standing.category,
          score: standing.score!,
          ageDays: standing.ageDays,
        })),
        today,
      }).overall,
    }))
    .filter(
      (row): row is { vehicleId: string; vehicleName: string; health: number } =>
        // A vehicle with nothing recorded has no score, and averaging it in as 100 would let
        // an empty garage report perfect health.
        row.health !== null,
    );

  const averageHealth =
    scored.length === 0
      ? null
      : Math.round(scored.reduce((total, row) => total + row.health, 0) / scored.length);
  const worstVehicle =
    scored.length === 0
      ? null
      : [...scored].sort(
          (a, b) => a.health - b.health || a.vehicleName.localeCompare(b.vehicleName),
        )[0]!;

  // --- money -------------------------------------------------------------------------

  const purchasePrices = vehicles
    .filter((vehicle) => vehicle.purchasePriceAmountMinor !== null && vehicle.purchasePriceCurrency)
    .map((vehicle) => ({
      amountMinor: vehicle.purchasePriceAmountMinor!,
      currency: vehicle.purchasePriceCurrency!,
    }));
  /*
   * "Total estimated value" is what the vehicles are worth now, not what they cost — the
   * most recent valuation per vehicle (one row each), falling back to the purchase price for a
   * vehicle nobody has valued.
   */
  const latestValuation = new Map(
    valuationRows.map((row) => [
      row.vehicleId,
      { amountMinor: row.amountMinor, currency: row.currency },
    ]),
  );

  const currentValues = vehicles
    .map(
      (vehicle) =>
        latestValuation.get(vehicle.id) ??
        (vehicle.purchasePriceAmountMinor !== null && vehicle.purchasePriceCurrency
          ? {
              amountMinor: vehicle.purchasePriceAmountMinor,
              currency: vehicle.purchasePriceCurrency,
            }
          : null),
    )
    .filter((value): value is { amountMinor: number; currency: string } => value !== null);

  const totalValue = sumSameCurrency(currentValues);

  // Running spend excludes PURCHASE for the same reason the per-vehicle summary does: the
  // purchase price is already counted from the vehicle, and a user who filed it in both
  // places would otherwise be charged for the car twice.
  const running = expenses.filter((expense) => expense.category !== 'PURCHASE');
  const ownershipCost = sumSameCurrency([...purchasePrices, ...running]);

  /*
   * What each vehicle has cost to run, lifetime, for the cards on the phone's home screen —
   * from the rows already loaded here, so a garage of a hundred vehicles is one request, not a
   * hundred. The currency is the one its cost summary picks (`primaryCurrency`); spend in any
   * other currency is left out, as that summary's strict figure leaves it out.
   */
  const currencyOf = new Map(garageRows.map((garage) => [garage.id, garage.defaultCurrency]));
  const sumsOf = new Map<string, CategorySum[]>();
  for (const sum of expenses) {
    const sums = sumsOf.get(sum.vehicleId) ?? [];
    sums.push(sum);
    sumsOf.set(sum.vehicleId, sums);
  }
  const vehicleSpend: Record<string, { amountMinor: number; currency: string }> = {};
  for (const vehicle of vehicles) {
    const sums = sumsOf.get(vehicle.id) ?? [];
    const currency = primaryCurrency(
      { lifetimeSums: sums, purchasePriceCurrency: vehicle.purchasePriceCurrency },
      currencyOf.get(vehicle.garageId) ?? 'USD',
    );
    vehicleSpend[vehicle.id] = {
      amountMinor: sums
        .filter((sum) => sum.currency === currency && sum.category !== 'PURCHASE')
        .reduce((total, sum) => total + sum.amountMinor, 0),
      currency,
    };
  }

  const spentThisMonth = sumSameCurrency(
    running.flatMap((sum) =>
      sum.monthMinor === null ? [] : [{ amountMinor: sum.monthMinor, currency: sum.currency }],
    ),
  );
  const spentLastMonth = sumSameCurrency(
    running.flatMap((sum) =>
      sum.lastMonthMinor === null
        ? []
        : [{ amountMinor: sum.lastMonthMinor, currency: sum.currency }],
    ),
  );

  // --- activity and briefing ----------------------------------------------------------

  const recentActivity: ActivityItem[] = events.map((event) => ({
    id: event.id,
    eventType: event.eventType,
    title: event.title,
    occurredAt: event.occurredAt.toISOString(),
    vehicleId: event.vehicleId,
    vehicleName: nameOf(event),
    cost:
      event.costAmountMinor !== null && event.costCurrency
        ? { amountMinor: event.costAmountMinor, currency: event.costCurrency }
        : null,
  }));

  const vehicleById = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle]));
  const recalls = recallRows.flatMap((row) => {
    // A notice for a vehicle since archived, or moved out of these garages, is not this
    // dashboard's to show.
    const vehicle = row.vehicleId ? vehicleById.get(row.vehicleId) : undefined;
    if (!vehicle) return [];
    return [
      {
        notificationId: row.notificationId,
        vehicleId: vehicle.id,
        vehicleName: nameOf(vehicle),
        campaign: String(row.payload.campaign ?? ''),
        component: String(row.payload.component ?? ''),
      },
    ];
  });

  const attentionTotal = maintenance.length + documents.length + overdueTasks + recalls.length;

  return {
    summary: {
      vehicles: vehicles.length,
      garages: garageIds.length,
      totalValue,
      ownershipCost,
      averageHealth,
      worstVehicle,
      spentThisMonth,
      spentLastMonth,
    },
    vehicleSpend,
    attention: {
      maintenance: maintenance.slice(0, 6),
      documents: documents.slice(0, 6),
      overdueTasks,
      tasksDueToday,
      recalls: recalls.slice(0, 6),
      total: attentionTotal,
    },
    recentActivity,
    briefing: briefingFor({
      vehicles: vehicles.length,
      attentionTotal,
      maintenanceCount: maintenance.length,
      documentCount: documents.length,
      overdueTasks,
      recallCount: recalls.length,
      spentThisMonth,
      averageHealth,
    }),
  };
}

/**
 * The briefing (PRD §25), in the order a person would ask.
 *
 * Sentences, not a data structure: the product's example is prose, and a client assembling
 * it from fields would word it differently on every platform.
 */
export function briefingFor(input: {
  vehicles: number;
  attentionTotal: number;
  maintenanceCount: number;
  documentCount: number;
  overdueTasks: number;
  recallCount?: number;
  spentThisMonth: { amountMinor: number; currency: string } | null;
  averageHealth: number | null;
}): string[] {
  const lines: string[] = [];

  if (input.vehicles === 0) {
    return ['Your garage is empty. Add a vehicle to start keeping its history.'];
  }

  if (input.attentionTotal === 0) {
    lines.push(
      input.averageHealth === null
        ? 'Nothing needs attention. There is not much recorded yet to judge by.'
        : 'Your garage is healthy. Nothing needs attention.',
    );
  } else if (input.averageHealth !== null) {
    lines.push(`Your garage scores ${input.averageHealth} out of 100.`);
  }

  if (input.maintenanceCount > 0) {
    lines.push(
      `${input.maintenanceCount} maintenance ${input.maintenanceCount === 1 ? 'item needs' : 'items need'} attention.`,
    );
  }
  if (input.documentCount > 0) {
    lines.push(
      `${input.documentCount} ${input.documentCount === 1 ? 'document expires' : 'documents expire'} soon.`,
    );
  }
  if (input.overdueTasks > 0) {
    lines.push(
      `${input.overdueTasks} ${input.overdueTasks === 1 ? 'task is' : 'tasks are'} overdue.`,
    );
  }
  if (input.recallCount) {
    lines.push(
      `${input.recallCount} safety ${input.recallCount === 1 ? 'recall may apply' : 'recalls may apply'} — worth checking against your VIN.`,
    );
  }
  if (input.spentThisMonth && input.spentThisMonth.amountMinor > 0) {
    lines.push(`You spent ${formatMoney(input.spentThisMonth)} this month.`);
  }

  return lines;
}
