/**
 * The tools Garaj offers an AI client over MCP.
 *
 * Every tool is a REST route the API already serves, called in-process with the caller's own
 * credentials (see `mcp.routes.ts`). So a tool cannot do anything its user could not do in the
 * app: the same validation, the same garage permissions, the same plan limits, the same audit
 * trail. The inputs of the write tools are the routes' own contract schemas, so what a model is
 * told it may send is exactly what the server accepts.
 *
 * Reading is broad; writing is limited to adding and correcting records. Nothing here deletes,
 * shares or transfers — an assistant that misunderstood should cost a correction, never a record.
 */

import { Type, type TObject, type TSchema } from '@sinclair/typebox';
import {
  CompleteMaintenance,
  CreateEvent,
  CreateExpense,
  CreateGarage,
  CreateIncome,
  CreateMaintenancePlan,
  CreateTask,
  CreateVehicle,
  ListDocumentsQuery,
  UpdateEvent,
  UpdateExpense,
  UpdateMaintenancePlan,
  UpdateTask,
  UpdateVehicle,
} from '@vehicle-os/contracts';

export interface ToolCall {
  method: 'GET' | 'POST' | 'PATCH';
  url: string;
  body?: Record<string, unknown>;
}

export interface Tool {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  readOnly: boolean;
  /** Where the call goes: a route under `/api/v1`, with its query and body. */
  route: (args: Record<string, unknown>) => ToolCall;
}

const Id = (what: string) => Type.String({ format: 'uuid', description: `The ${what}'s id.` });

/** A plain JSON Schema object, with TypeBox's symbol keys left behind. */
const json = (schema: TSchema): Record<string, unknown> =>
  JSON.parse(JSON.stringify(schema)) as Record<string, unknown>;

/**
 * A route's path ids and its body, as one flat argument object — the shape a model fills in
 * most reliably. `id` is dropped from bodies: it is the offline client's own key, not the model's.
 */
function withPath(path: Record<string, TSchema>, body?: TObject): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  for (const [key, schema] of Object.entries(path)) properties[key] = json(schema);
  for (const [key, schema] of Object.entries(body?.properties ?? {})) {
    if (key !== 'id') properties[key] = json(schema);
  }
  return {
    type: 'object',
    properties,
    required: [...Object.keys(path), ...(body?.required ?? []).filter((key) => key !== 'id')],
    additionalProperties: false,
  };
}

const query = (args: Record<string, unknown>, keys: readonly string[]): string => {
  const params = new URLSearchParams();
  for (const key of keys) {
    const value = args[key];
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : '';
};

const pick = (args: Record<string, unknown>, omit: readonly string[]) =>
  Object.fromEntries(Object.entries(args).filter(([key]) => !omit.includes(key)));

const path = (value: unknown) => encodeURIComponent(String(value ?? ''));

const MONEY =
  'Money is an integer in minor units (cents: 45.20 EUR is 4520) with an ISO 4217 currency code.';

export const TOOLS: readonly Tool[] = [
  {
    name: 'list_garages',
    title: 'List garages',
    description:
      'The garages the user belongs to, with their role in each. A garage groups vehicles and the people they are shared with.',
    inputSchema: json(Type.Object({})),
    readOnly: true,
    route: () => ({ method: 'GET', url: '/garages/' }),
  },
  {
    name: 'list_vehicles',
    title: 'List vehicles',
    description:
      'Vehicles across every garage the user belongs to — start here to find a vehicle id. Optionally narrowed to one garage.',
    inputSchema: json(
      Type.Object({
        garageId: Type.Optional(Id('garage')),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 50 })),
      }),
    ),
    readOnly: true,
    route: (args) => ({ method: 'GET', url: `/vehicles/${query(args, ['garageId', 'limit'])}` }),
  },
  {
    name: 'get_vehicle',
    title: 'Get a vehicle',
    description:
      'One vehicle: make, model, year, plate, VIN, current odometer and unit, purchase date and price.',
    inputSchema: json(Type.Object({ vehicleId: Id('vehicle') })),
    readOnly: true,
    route: (args) => ({ method: 'GET', url: `/vehicles/${path(args.vehicleId)}` }),
  },
  {
    name: 'get_activity',
    title: 'Get vehicle activity',
    description:
      "A vehicle's timeline: what is planned (repeating services and one-off tasks, with how soon each is due) and what was done (fuel, services, repairs, notes), newest first.",
    inputSchema: json(
      Type.Object({
        vehicleId: Id('vehicle'),
        eventType: Type.Optional(
          Type.String({
            description: 'Only done entries of this kind, e.g. FUEL, MAINTENANCE, REPAIR.',
          }),
        ),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50, default: 20 })),
      }),
    ),
    readOnly: true,
    route: (args) => ({
      method: 'GET',
      url: `/vehicles/${path(args.vehicleId)}/activity${query({ limit: 20, ...args }, ['eventType', 'limit'])}`,
    }),
  },
  {
    name: 'get_maintenance',
    title: 'Get maintenance schedule',
    description:
      "A vehicle's repeating maintenance plans with live status (OK, DUE_SOON, OVERDUE) and how far or how long until each is due.",
    inputSchema: json(Type.Object({ vehicleId: Id('vehicle') })),
    readOnly: true,
    route: (args) => ({ method: 'GET', url: `/vehicles/${path(args.vehicleId)}/maintenance` }),
  },
  {
    name: 'get_due_work',
    title: 'Get work that is due',
    description: 'Maintenance that is overdue or due soon across every vehicle the user can see.',
    inputSchema: json(Type.Object({})),
    readOnly: true,
    route: () => ({ method: 'GET', url: '/vehicles/due' }),
  },
  {
    name: 'get_costs',
    title: 'Get vehicle costs',
    description: `What a vehicle has cost: total, by category, cost per year and per distance, and fuel consumption. Optionally within a period. ${MONEY}`,
    inputSchema: json(
      Type.Object({
        vehicleId: Id('vehicle'),
        from: Type.Optional(
          Type.String({ format: 'date-time', description: 'Start of the period.' }),
        ),
        to: Type.Optional(Type.String({ format: 'date-time', description: 'End of the period.' })),
      }),
    ),
    readOnly: true,
    route: (args) => ({
      method: 'GET',
      url: `/vehicles/${path(args.vehicleId)}/cost${query(args, ['from', 'to'])}`,
    }),
  },
  {
    name: 'get_monthly_spend',
    title: 'Get monthly spend',
    description: `Spend per calendar month for a vehicle, quiet months as zero. ${MONEY}`,
    inputSchema: json(
      Type.Object({
        vehicleId: Id('vehicle'),
        months: Type.Optional(Type.Integer({ minimum: 2, maximum: 60, default: 12 })),
      }),
    ),
    readOnly: true,
    route: (args) => ({
      method: 'GET',
      url: `/vehicles/${path(args.vehicleId)}/cost/monthly${query(args, ['months'])}`,
    }),
  },
  {
    name: 'get_trends',
    title: 'Get consumption and ownership trends',
    description:
      'Fuel or energy consumption per fill over time, the cumulative cost of ownership by month, and distance driven per year.',
    inputSchema: json(Type.Object({ vehicleId: Id('vehicle') })),
    readOnly: true,
    route: (args) => ({ method: 'GET', url: `/vehicles/${path(args.vehicleId)}/cost/trends` }),
  },
  {
    name: 'get_fuel_prices',
    title: 'Get fuel prices',
    description:
      'What fuel has cost per unit at each fill, the weighted average, and the stations that were cheapest.',
    inputSchema: json(Type.Object({ vehicleId: Id('vehicle') })),
    readOnly: true,
    route: (args) => ({ method: 'GET', url: `/vehicles/${path(args.vehicleId)}/cost/fuel-prices` }),
  },
  {
    name: 'get_health',
    title: 'Get vehicle health',
    description:
      "A vehicle's health score out of 100, the score per area, and each factor that cost it points.",
    inputSchema: json(Type.Object({ vehicleId: Id('vehicle') })),
    readOnly: true,
    route: (args) => ({ method: 'GET', url: `/vehicles/${path(args.vehicleId)}/health` }),
  },
  {
    name: 'get_valuation',
    title: 'Get vehicle value',
    description: `What a vehicle is worth now against what was paid, and every valuation recorded. ${MONEY}`,
    inputSchema: json(Type.Object({ vehicleId: Id('vehicle') })),
    readOnly: true,
    route: (args) => ({ method: 'GET', url: `/vehicles/${path(args.vehicleId)}/valuations` }),
  },
  {
    name: 'list_tasks',
    title: 'List tasks',
    description:
      'One-off jobs across the user’s garages, optionally for one garage or vehicle. Open ones only by default.',
    inputSchema: json(
      Type.Object({
        garageId: Type.Optional(Id('garage')),
        vehicleId: Type.Optional(Id('vehicle')),
        openOnly: Type.Optional(Type.Boolean({ default: true })),
      }),
    ),
    readOnly: true,
    route: (args) => ({
      method: 'GET',
      url: `/tasks/${query({ openOnly: true, ...args }, ['garageId', 'vehicleId', 'openOnly'])}`,
    }),
  },
  {
    name: 'list_expiring_documents',
    title: 'List expiring documents',
    description: 'Insurance, registration and other documents that are expired or expire soon.',
    inputSchema: json(Type.Object({})),
    readOnly: true,
    route: () => ({ method: 'GET', url: '/documents/expiring' }),
  },
  {
    name: 'list_documents',
    title: 'List vehicle documents',
    description:
      "A vehicle's documents — insurance, registration, receipts — with their issue and expiry dates.",
    inputSchema: withPath({ vehicleId: Id('vehicle') }, ListDocumentsQuery),
    readOnly: true,
    route: (args) => ({
      method: 'GET',
      url: `/vehicles/${path(args.vehicleId)}/documents${query(args, Object.keys(ListDocumentsQuery.properties))}`,
    }),
  },
  {
    name: 'get_mileage_report',
    title: 'Get mileage report',
    description:
      'Trips logged in a period — distance per purpose (business, personal, commute) and the deductions they earn, for a tax return or an expense claim. Needs the Business plan.',
    inputSchema: json(
      Type.Object({
        vehicleId: Id('vehicle'),
        from: Type.String({ format: 'date-time', description: 'Start of the period.' }),
        to: Type.String({ format: 'date-time', description: 'End of the period.' }),
      }),
    ),
    readOnly: true,
    route: (args) => ({
      method: 'GET',
      url: `/vehicles/${path(args.vehicleId)}/mileage-report${query(args, ['from', 'to'])}`,
    }),
  },
  {
    name: 'get_income',
    title: 'Get vehicle income',
    description: `What a working vehicle earned against what it cost, per category and per driver. Optionally within a period. Needs the Business plan. ${MONEY}`,
    inputSchema: json(
      Type.Object({
        vehicleId: Id('vehicle'),
        from: Type.Optional(
          Type.String({ format: 'date-time', description: 'Start of the period.' }),
        ),
        to: Type.Optional(Type.String({ format: 'date-time', description: 'End of the period.' })),
      }),
    ),
    readOnly: true,
    route: (args) => ({
      method: 'GET',
      url: `/vehicles/${path(args.vehicleId)}/income/summary${query(args, ['from', 'to'])}`,
    }),
  },
  {
    name: 'create_garage',
    title: 'Create a garage',
    description:
      'Add a garage — a group of vehicles, e.g. "Family" or "Work fleet". Plan limits apply.',
    inputSchema: withPath({}, CreateGarage),
    readOnly: false,
    route: (args) => ({ method: 'POST', url: '/garages/', body: args }),
  },
  {
    name: 'create_vehicle',
    title: 'Add a vehicle',
    description: `Add a vehicle to a garage (find the garageId with list_garages). Plan limits apply. ${MONEY}`,
    inputSchema: withPath({}, CreateVehicle),
    readOnly: false,
    route: (args) => ({ method: 'POST', url: '/vehicles/', body: args }),
  },
  {
    name: 'update_vehicle',
    title: 'Update a vehicle',
    description: `Correct or update a vehicle's details — name, plate, odometer, purchase, specs. Only the fields sent change; null clears one. ${MONEY}`,
    inputSchema: withPath({ vehicleId: Id('vehicle') }, UpdateVehicle),
    readOnly: false,
    route: (args) => ({
      method: 'PATCH',
      url: `/vehicles/${path(args.vehicleId)}`,
      body: pick(args, ['vehicleId']),
    }),
  },
  {
    name: 'search',
    title: 'Search',
    description: 'Search vehicles, entries, expenses, documents and tasks the user can see.',
    inputSchema: json(
      Type.Object({
        q: Type.String({ minLength: 2, description: 'What to look for.' }),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 25, default: 10 })),
      }),
    ),
    readOnly: true,
    route: (args) => ({ method: 'GET', url: `/search/${query(args, ['q', 'limit'])}` }),
  },
  {
    name: 'log_event',
    title: 'Log an entry',
    description: `Record something that happened to a vehicle: a fill-up (FUEL), a service (MAINTENANCE), a repair, an odometer reading, a trip, a note. ${MONEY} occurredAt is ISO 8601; the odometer is in the vehicle's own unit.`,
    inputSchema: withPath({ vehicleId: Id('vehicle') }, CreateEvent),
    readOnly: false,
    route: (args) => ({
      method: 'POST',
      url: `/vehicles/${path(args.vehicleId)}/events`,
      body: pick(args, ['vehicleId']),
    }),
  },
  {
    name: 'update_event',
    title: 'Correct an entry',
    description: `Fix a logged entry — its date, odometer, cost, title. Only the fields sent change; null clears one. Find the eventId with get_activity. ${MONEY}`,
    inputSchema: withPath({ vehicleId: Id('vehicle'), eventId: Id('entry') }, UpdateEvent),
    readOnly: false,
    route: (args) => ({
      method: 'PATCH',
      url: `/vehicles/${path(args.vehicleId)}/events/${path(args.eventId)}`,
      body: pick(args, ['vehicleId', 'eventId']),
    }),
  },
  {
    name: 'log_expense',
    title: 'Log an expense',
    description: `Record money spent on a vehicle — fuel with its quantity, insurance, tax, parts — so it counts in its costs. ${MONEY}`,
    inputSchema: withPath({ vehicleId: Id('vehicle') }, CreateExpense),
    readOnly: false,
    route: (args) => ({
      method: 'POST',
      url: `/vehicles/${path(args.vehicleId)}/expenses`,
      body: pick(args, ['vehicleId']),
    }),
  },
  {
    name: 'update_expense',
    title: 'Correct an expense',
    description: `Fix a logged expense — amount, date, fuel quantity, odometer. Only the fields sent change; null clears one. ${MONEY}`,
    inputSchema: withPath({ vehicleId: Id('vehicle'), expenseId: Id('expense') }, UpdateExpense),
    readOnly: false,
    route: (args) => ({
      method: 'PATCH',
      url: `/vehicles/${path(args.vehicleId)}/expenses/${path(args.expenseId)}`,
      body: pick(args, ['vehicleId', 'expenseId']),
    }),
  },
  {
    name: 'log_income',
    title: 'Log income',
    description: `Record money a working vehicle earned — a fare, a delivery, a rental. Needs the Business plan. ${MONEY}`,
    inputSchema: withPath({ vehicleId: Id('vehicle') }, CreateIncome),
    readOnly: false,
    route: (args) => ({
      method: 'POST',
      url: `/vehicles/${path(args.vehicleId)}/income`,
      body: pick(args, ['vehicleId']),
    }),
  },
  {
    name: 'complete_maintenance',
    title: 'Complete scheduled maintenance',
    description: `Log a scheduled service as done: writes the service record and restarts the schedule's clock. Find the planId with get_maintenance. ${MONEY}`,
    inputSchema: withPath(
      { vehicleId: Id('vehicle'), planId: Id('maintenance plan') },
      CompleteMaintenance,
    ),
    readOnly: false,
    route: (args) => ({
      method: 'POST',
      url: `/vehicles/${path(args.vehicleId)}/maintenance/${path(args.planId)}/complete`,
      body: pick(args, ['vehicleId', 'planId']),
    }),
  },
  {
    name: 'schedule_maintenance',
    title: 'Schedule repeating maintenance',
    description:
      'Add a repeating service to a vehicle — "oil change every 5000 km or 6 months". Needs at least one interval; it comes due at whichever is reached first. Pass lastPerformedAt (and lastPerformedOdometer) when it was last done; left out, the clock starts today.',
    inputSchema: withPath({ vehicleId: Id('vehicle') }, CreateMaintenancePlan),
    readOnly: false,
    route: (args) => ({
      method: 'POST',
      url: `/vehicles/${path(args.vehicleId)}/maintenance`,
      body: pick(args, ['vehicleId']),
    }),
  },
  {
    name: 'update_maintenance',
    title: 'Update repeating maintenance',
    description:
      'Change a repeating service — its interval, title, or when it was last done. isActive false pauses it; that is how a plan is retired. Find the planId with get_maintenance.',
    inputSchema: withPath(
      { vehicleId: Id('vehicle'), planId: Id('maintenance plan') },
      UpdateMaintenancePlan,
    ),
    readOnly: false,
    route: (args) => ({
      method: 'PATCH',
      url: `/vehicles/${path(args.vehicleId)}/maintenance/${path(args.planId)}`,
      body: pick(args, ['vehicleId', 'planId']),
    }),
  },
  {
    name: 'create_task',
    title: 'Create a task',
    description:
      'Add a one-off job to a garage, optionally for one vehicle and with a due date — "book the MOT", "replace wiper blades".',
    inputSchema: withPath({}, CreateTask),
    readOnly: false,
    route: (args) => ({ method: 'POST', url: '/tasks/', body: args }),
  },
  {
    name: 'update_task',
    title: 'Update a task',
    description: 'Change a task — most often to mark it done with status COMPLETED.',
    inputSchema: withPath({ taskId: Id('task') }, UpdateTask),
    readOnly: false,
    route: (args) => ({
      method: 'PATCH',
      url: `/tasks/${path(args.taskId)}`,
      body: pick(args, ['taskId']),
    }),
  },
];

/** What a client is told on connecting: how the tools fit together. */
export const INSTRUCTIONS = `Garaj keeps the records of a person's vehicles: what was done, what it cost, what is due next.
Start with list_vehicles to find vehicle ids; most tools take a vehicleId.
${MONEY} Dates are ISO 8601. Distances are in each vehicle's own unit (odometerUnit KM or MI).
Before writing, confirm the vehicle and the details with the user. Nothing can be deleted through these tools; a mistake is fixed with the matching update_ tool.`;
