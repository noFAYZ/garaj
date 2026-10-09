/**
 * Executing the model's tool calls (Architecture.md §41, §42).
 *
 * This is the security boundary of the whole AI feature. The model's arguments are
 * untrusted input — a question can be crafted to name somebody else's vehicle id, and a
 * document or a service note the model has read can try to instruct it to fetch one. So
 * every vehicle id it supplies is resolved to its garage here and checked against the
 * caller's memberships, exactly as an HTTP route would.
 *
 * Tools are read-only by construction. There is no write tool, so no prompt can make the
 * model change a record.
 */

import type { Database } from '@vehicle-os/database';
import {
  distance,
  format as formatMoney,
  formatDistance,
  money,
  type DistanceUnit,
} from '@vehicle-os/domain';
import { computeCost } from '../../../expenses/domain/cost';
import { computeFuelConsumption } from '../../../expenses/domain/fuel';
import {
  fuelFills,
  odometerSpan,
  sumByCategory,
} from '../../../expenses/infrastructure/repositories/expense-repository';
import {
  findEventById,
  listEvents,
} from '../../../events/infrastructure/repositories/event-repository';
import { listForUser } from '../../../garages/infrastructure/repositories/garage-repository';
import { buildDashboard } from '../../../dashboard/application/services/dashboard';
import {
  findGarageIdForVehicle,
  findVehicleById,
  listVehicles,
} from '../../../vehicles/infrastructure/repositories/vehicle-repository';
import { displayName } from '../../../vehicles/domain/entities/vehicle';
import { garageDefaultCurrency } from '../../../expenses/infrastructure/repositories/expense-repository';
import type { AiChoice, AiProposal } from '@vehicle-os/contracts';
import { PROPOSE_TOOLS } from '../../domain/tools';
import type { AiToolCall } from '../../infrastructure/ai-port';

export interface ToolContext {
  readonly db: Database;
  /** The caller, for what is theirs by membership rather than by garage (their garages' roles). */
  readonly userId: string;
  /** The garages the caller belongs to. An empty list can reach nothing. */
  readonly garageIds: readonly string[];
  /** Today in the caller's timezone, for the calendar questions. */
  readonly today: string;
}

/** Refusals are returned to the model as data, not thrown: it should say so, not crash. */
export interface ToolOutcome {
  readonly result: unknown;
  /** Recorded as provenance when the call succeeded against a specific vehicle. */
  readonly vehicleId: string | null;
}

export async function runTool(context: ToolContext, call: AiToolCall): Promise<ToolOutcome> {
  switch (call.name) {
    case 'list_vehicles':
      return { result: await toolListVehicles(context), vehicleId: null };
    case 'get_vehicle_profile':
      return withVehicle(context, call, toolVehicleProfile);
    case 'get_vehicle_costs':
      return withVehicle(context, call, toolVehicleCosts);
    case 'get_vehicle_timeline':
      return withVehicle(context, call, (ctx, id) => toolTimeline(ctx, id, call.args.limit));
    case 'get_attention_required':
      return { result: await toolAttention(context), vehicleId: null };
    case 'list_garages':
      return { result: await toolListGarages(context), vehicleId: null };
    default:
      // A name outside the catalogue means the provider invented one. Reported rather than
      // thrown so the model can correct itself on the next turn.
      return { result: { error: `Unknown tool: ${call.name}` }, vehicleId: null };
  }
}

/**
 * The check every vehicle-scoped tool goes through.
 *
 * "Not found" and "not yours" are deliberately the same answer, for the same reason the
 * rest of the API gives one: distinguishing them tells a caller whether an id they guessed
 * exists.
 */
async function withVehicle(
  context: ToolContext,
  call: AiToolCall,
  run: (context: ToolContext, vehicleId: string) => Promise<unknown>,
): Promise<ToolOutcome> {
  const vehicleId = typeof call.args.vehicle_id === 'string' ? call.args.vehicle_id : null;
  if (!vehicleId) {
    return { result: { error: 'vehicle_id is required and must be a string.' }, vehicleId: null };
  }

  const garageId = await findGarageIdForVehicle(context.db, vehicleId);
  if (!garageId || !context.garageIds.includes(garageId)) {
    return {
      result: { error: 'No such vehicle in this user’s garages.' },
      vehicleId: null,
    };
  }

  return { result: await run(context, vehicleId), vehicleId };
}

async function toolListVehicles(context: ToolContext) {
  const vehicles = await listVehicles(context.db, {
    garageIds: context.garageIds,
    // Enough for any garage this product is designed around, and a hard ceiling on how
    // much of the context window one tool result can take.
    limit: 100,
  });

  return vehicles.map((vehicle) => ({
    vehicle_id: vehicle.id,
    garage_id: vehicle.garageId,
    name: displayName(vehicle),
    type: vehicle.vehicleType,
    make: vehicle.make,
    model: vehicle.model,
    year: vehicle.year,
    status: vehicle.status,
    odometer: reading(vehicle.currentOdometer, vehicle.odometerUnit),
  }));
}

async function toolVehicleProfile(context: ToolContext, vehicleId: string) {
  const vehicle = await findVehicleById(context.db, vehicleId);
  if (!vehicle) return { error: 'No such vehicle.' };

  return {
    vehicle_id: vehicle.id,
    name: displayName(vehicle),
    type: vehicle.vehicleType,
    status: vehicle.status,
    make: vehicle.make,
    model: vehicle.model,
    variant: vehicle.variant,
    year: vehicle.year,
    color: vehicle.color,
    odometer: reading(vehicle.currentOdometer, vehicle.odometerUnit),
    purchase_date: vehicle.purchaseDate,
    purchase_price: cash(vehicle.purchasePriceAmountMinor, vehicle.purchasePriceCurrency),
  };
}

async function toolVehicleCosts(context: ToolContext, vehicleId: string) {
  const vehicle = await findVehicleById(context.db, vehicleId);
  if (!vehicle) return { error: 'No such vehicle.' };

  const [lifetimeSums, span, fills, fallback] = await Promise.all([
    sumByCategory(context.db, vehicleId),
    odometerSpan(context.db, vehicleId),
    fuelFills(context.db, vehicleId),
    garageDefaultCurrency(context.db, vehicle.garageId),
  ]);

  // No window: "what has this cost me" is a lifetime question, and a model given a 90-day
  // figure labelled "total" would quote it as one.
  const totals = computeCost(
    {
      windowSums: lifetimeSums,
      lifetimeSums,
      purchasePriceAmountMinor: vehicle.purchasePriceAmountMinor,
      purchasePriceCurrency: vehicle.purchasePriceCurrency,
      purchaseDate: vehicle.purchaseDate,
      odometerLow: span.low,
      odometerHigh: span.high,
      now: new Date(),
    },
    fallback,
  );

  const fuel = computeFuelConsumption(fills, vehicle.odometerUnit);

  const unit = vehicle.odometerUnit;
  const perDistance = cash(totals.costPerDistanceMinor, totals.currency);
  return {
    total_spent: cash(totals.totalSpentMinor, totals.currency),
    by_category: totals.byCategory.map((row) => ({
      category: row.category.charAt(0) + row.category.slice(1).toLowerCase(),
      amount: cash(row.amountMinor, totals.currency),
      entries: row.count,
    })),
    ownership_cost: cash(totals.ownershipCostMinor, totals.currency),
    cost_per_year: cash(totals.costPerYearMinor, totals.currency),
    cost_per_distance: perDistance && `${perDistance} per ${unit === 'KM' ? 'km' : 'mi'}`,
    distance_covered: reading(totals.distanceCovered, unit),
    // Spent in a currency other than the summary's; never added to it, never converted.
    other_currencies: totals.otherCurrencies.map((row) => ({
      amount: cash(row.amountMinor, row.currency),
      entries: row.count,
    })),
    fuel_consumption:
      fuel === null
        ? null
        : {
            liters_per_100km: Math.round(fuel.litersPer100Km * 100) / 100,
            miles_per_us_gallon: Math.round(fuel.milesPerUsGallon * 10) / 10,
            measured_over: reading(Math.round(fuel.distanceCovered), unit),
            fill_ups: fuel.segments,
          },
  };
}

async function toolTimeline(context: ToolContext, vehicleId: string, rawLimit: unknown) {
  const limit = clamp(rawLimit, 20, 1, 50);
  const [vehicle, events] = await Promise.all([
    findVehicleById(context.db, vehicleId),
    listEvents(context.db, { vehicleId, limit }),
  ]);
  if (!vehicle) return { error: 'No such vehicle.' };

  return events.slice(0, limit).map((event) => ({
    entry_id: event.id,
    date: event.occurredAt.toISOString().slice(0, 10),
    type: event.eventType,
    title: event.title,
    odometer: reading(event.odometer, vehicle.odometerUnit),
    cost: cash(event.costAmountMinor, event.costCurrency),
  }));
}

async function toolAttention(context: ToolContext) {
  // The dashboard already answers exactly this, in the caller's timezone, with the due
  // status decided by the domain rather than re-derived here.
  const dashboard = await buildDashboard(context.db, context.garageIds, context.today);

  return {
    overdue_or_due_soon_maintenance: dashboard.attention.maintenance.map((item) => ({
      vehicle: item.vehicleName,
      title: item.plan.title,
      status: item.plan.status,
      days_remaining: item.plan.daysRemaining,
      distance_remaining: reading(item.plan.distanceRemaining, item.odometerUnit),
    })),
    expiring_documents: dashboard.attention.documents.map((item) => ({
      vehicle: item.vehicleName,
      title: item.document.title,
      days_remaining: item.daysRemaining,
    })),
    overdue_tasks: dashboard.attention.overdueTasks,
    tasks_due_today: dashboard.attention.tasksDueToday,
  };
}

async function toolListGarages(context: ToolContext) {
  const garages = await listForUser(context.db, context.userId);
  return garages.map((garage) => ({
    garage_id: garage.id,
    name: garage.name,
    currency: garage.defaultCurrency,
    vehicles: garage.vehicleCount,
    role: garage.role,
  }));
}

/**
 * A `propose_*` call, checked before it becomes a proposal.
 *
 * The same boundary as every read tool: each id in it must be the caller's, and "not yours"
 * reads as "no such". Unknown keys are dropped and an enum the model mangled is left out for
 * the form to default, rather than refused — the person sees and corrects every field anyway.
 * What fails comes back as an error for the model to correct on its next turn.
 */
/**
 * The model may not choose between the person's own things for them.
 *
 * A proposal aimed at one of several garages or vehicles that the line never names (and no
 * vehicle page is in view) is a guess, however confident. A new entry or plan loses the
 * vehicle, so its form asks; anything else becomes a question with the real candidates. Checked
 * here rather than trusted to the prompt, because a small model "helpfully" picks the first.
 */
export async function guardGuess(
  context: ToolContext,
  line: string,
  focusVehicleId: string | undefined,
  proposal: AiProposal,
): Promise<{ proposal: AiProposal } | { choices: AiChoice }> {
  const said = line.toLowerCase();
  const named = (names: readonly (string | null)[]) =>
    names.some((name) => name && name.trim().length >= 2 && said.includes(name.toLowerCase()));
  const fields = { ...proposal.fields };
  const formAsks = proposal.action === 'log_entry' || proposal.action === 'plan';

  if (typeof fields.garage_id === 'string') {
    const garages = await listForUser(context.db, context.userId);
    if (garages.length > 1 && !named(garages.map((garage) => garage.name))) {
      if (proposal.action !== 'add_vehicle') {
        return {
          choices: {
            question: 'Which garage?',
            options: garages.map((garage) => ({
              label: garage.name,
              detail: `${garage.vehicleCount} ${garage.vehicleCount === 1 ? 'vehicle' : 'vehicles'}`,
            })),
          },
        };
      }
      delete fields.garage_id;
    }
  }

  if (typeof fields.vehicle_id === 'string' && !focusVehicleId) {
    const vehicles = await listVehicles(context.db, { garageIds: context.garageIds, limit: 100 });
    // A make names a vehicle only when it is the one of that make: "the Mazda", not "the Suzuki" of two.
    const makes = vehicles.map((vehicle) => vehicle.make?.toLowerCase());
    const isNamed = vehicles.some((vehicle) =>
      named([
        displayName(vehicle),
        vehicle.nickname,
        vehicle.model,
        [vehicle.make, vehicle.model].filter(Boolean).join(' '),
        makes.filter((make) => make === vehicle.make?.toLowerCase()).length === 1
          ? vehicle.make
          : null,
      ]),
    );
    if (vehicles.length > 1 && !isNamed) {
      if (!formAsks) {
        return {
          choices: {
            question: 'Which vehicle?',
            options: vehicles.map((vehicle) => ({ label: displayName(vehicle) })),
          },
        };
      }
      delete fields.vehicle_id;
    }
  }

  return { proposal: { ...proposal, fields } };
}

export async function checkProposal(
  context: ToolContext,
  call: AiToolCall,
): Promise<{ proposal: AiProposal } | { error: string }> {
  const tool = PROPOSE_TOOLS.find((candidate) => candidate.name === call.name);
  if (!tool) return { error: `Unknown tool: ${call.name}` };

  const properties = tool.parameters.properties as Record<
    string,
    { type: string; enum?: readonly string[] }
  >;
  const fields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(call.args)) {
    if (key === 'summary' || !(key in properties) || value === null || value === '') continue;
    const allowed = properties[key]?.enum;
    if (allowed && !allowed.includes(String(value))) continue;
    fields[key] = value;
  }
  const missing = tool.parameters.required.filter(
    (key) => key !== 'summary' && fields[key] === undefined,
  );
  if (missing.length > 0) return { error: `Missing: ${missing.join(', ')}.` };

  if (typeof fields.vehicle_id === 'string') {
    const garageId = await findGarageIdForVehicle(context.db, fields.vehicle_id);
    if (!garageId || !context.garageIds.includes(garageId)) {
      return { error: 'No such vehicle in this user’s garages.' };
    }
    if (typeof fields.entry_id === 'string') {
      const event = await findEventById(context.db, fields.vehicle_id, fields.entry_id);
      if (!event) return { error: 'No such entry on that vehicle.' };
    }
  }
  if (typeof fields.garage_id === 'string' && !context.garageIds.includes(fields.garage_id)) {
    return { error: 'No such garage for this user.' };
  }

  const summary = typeof call.args.summary === 'string' ? call.args.summary.trim() : '';
  return { proposal: { action: tool.action, summary, fields } };
}

/*
 * Figures go to the model already written out — "$1,269.50", "42,150 km" — to be quoted, not
 * worked out. Given minor units beside a currency code, and a reading beside a separate unit,
 * a small model quoted 126950 USD for $1,269.50 and called kilometres miles.
 */
function cash(minor: number | null | undefined, currency: string | null | undefined) {
  return minor == null || !currency ? null : formatMoney(money(minor, currency));
}

function reading(value: number | null | undefined, unit: DistanceUnit) {
  return value == null ? null : formatDistance(distance(value, unit));
}

function clamp(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}
