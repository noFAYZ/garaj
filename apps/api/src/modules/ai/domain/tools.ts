/**
 * The tool catalogue (Architecture.md §41).
 *
 * The model never touches the database. It is given this fixed list of read-only questions
 * it may ask, and nothing else — so the worst a prompt injection can achieve is a tool call
 * this application was already willing to answer for this caller.
 *
 * Pure data: the schemas travel to the provider, the implementations live in the tool
 * runner, and the two are matched by name in one place.
 */

import { EVENT_TYPES, TRIP_PURPOSES, VEHICLE_TYPES } from '@vehicle-os/domain';
import type { AiAbility, AiAction } from '@vehicle-os/contracts';

export const AI_TOOLS = [
  {
    name: 'list_vehicles',
    description:
      "Every vehicle in the user's garages, with its id, name, type, year, odometer and " +
      'status. Call this first when the question names a vehicle in words rather than by id.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_vehicle_profile',
    description:
      'The full record for one vehicle: make, model, variant, year, colour, identifiers, ' +
      'purchase date and price, current odometer.',
    parameters: {
      type: 'object',
      properties: { vehicle_id: { type: 'string', description: 'From list_vehicles.' } },
      required: ['vehicle_id'],
    },
  },
  {
    name: 'get_vehicle_costs',
    description:
      'What one vehicle has cost: total spent, a breakdown by category, ownership cost, ' +
      'cost per year, cost per unit of distance, and fuel consumption. All lifetime figures.',
    parameters: {
      type: 'object',
      properties: { vehicle_id: { type: 'string', description: 'From list_vehicles.' } },
      required: ['vehicle_id'],
    },
  },
  {
    name: 'get_vehicle_timeline',
    description:
      'Recent events for one vehicle, newest first — services, repairs, fuel, inspections, ' +
      'with their dates, odometer readings and costs.',
    parameters: {
      type: 'object',
      properties: {
        vehicle_id: { type: 'string', description: 'From list_vehicles.' },
        limit: { type: 'integer', description: 'How many events, 1 to 50. Defaults to 20.' },
      },
      required: ['vehicle_id'],
    },
  },
  {
    name: 'get_attention_required',
    description:
      'Everything overdue or nearly due across every garage: maintenance schedules, ' +
      'expiring documents and overdue tasks. Use for "what needs doing" questions.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'list_garages',
    description:
      "The user's garages: id, name, currency, vehicle count and their role. Call it before " +
      'proposing a vehicle (which garage) or a change to a garage.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
] as const;

export type AiToolName = (typeof AI_TOOLS)[number]['name'];

export const AI_TOOL_NAMES: readonly string[] = AI_TOOLS.map((tool) => tool.name);

/*
 * The proposal catalogue.
 *
 * Each `propose_*` tool ends the turn with a change for the person to approve. Calling one
 * writes nothing: the server checks its ids against the caller's garages and hands its
 * arguments back as `AiAnswer.proposal`. Only the abilities the person allowed are offered,
 * so a switched-off kind of change is not even nameable by the model.
 */
const summary = {
  type: 'string',
  description:
    'One short sentence for the person: what approving does, e.g. "Add the 2023 Suzuki Cultus to Home."',
};
const vehicle = { type: 'string', description: 'vehicle_id from list_vehicles.' };
const garage = { type: 'string', description: 'garage_id from list_garages.' };
const entry = { type: 'string', description: 'entry_id from get_vehicle_timeline.' };
const day = { type: 'string', description: 'YYYY-MM-DD.' };
const amount = { type: 'number', description: 'In major units as said, e.g. 13000 or 62.4.' };
const currency = { type: 'string', description: 'ISO 4217 code, e.g. USD, PKR, EUR.' };
const unit = { type: 'string', enum: ['KM', 'MI'] };
const vehicleFields = {
  vehicle_type: { type: 'string', enum: [...VEHICLE_TYPES] },
  make: { type: 'string' },
  model: { type: 'string' },
  variant: { type: 'string', description: 'Trim or market variant, e.g. "VXL" or "Pakistan".' },
  year: { type: 'integer' },
  nickname: { type: 'string' },
  color: { type: 'string' },
  registration: { type: 'string', description: 'Number plate.' },
  purchase_price: amount,
  purchase_currency: currency,
  purchase_date: day,
  odometer: { type: 'integer' },
  odometer_unit: unit,
};
const entryFields = {
  kind: { type: 'string', enum: [...EVENT_TYPES] },
  title: { type: 'string', description: 'Short, e.g. "Oil change". Leave out for a trip.' },
  date: day,
  amount,
  currency,
  odometer: { type: 'integer', description: 'The reading at the time, if said.' },
  place: { type: 'string', description: 'Where: the station, garage or shop.' },
  notes: { type: 'string' },
  quantity: { type: 'number', description: 'Fuel or charge bought, e.g. 40.' },
  quantity_unit: { type: 'string', enum: ['L', 'GAL', 'KWH'] },
  trip_from: { type: 'string', description: 'For a trip: where it started.' },
  trip_to: { type: 'string', description: 'For a trip: where it ended.' },
  trip_purpose: { type: 'string', enum: [...TRIP_PURPOSES] },
  trip_distance: { type: 'integer', description: 'For a trip, in the vehicle’s unit.' },
};

export const PROPOSE_TOOLS = [
  {
    ability: 'vehicles',
    action: 'add_vehicle',
    name: 'propose_add_vehicle',
    description:
      'Propose adding a vehicle the person bought or owns but has not recorded — even when ' +
      'they already own another of the same make. Leave garage_id out if they have several ' +
      'garages and did not say which.',
    parameters: {
      type: 'object',
      properties: { summary, garage_id: garage, ...vehicleFields },
      required: ['summary', 'vehicle_type'],
    },
  },
  {
    ability: 'vehicles',
    action: 'edit_vehicle',
    name: 'propose_edit_vehicle',
    description: 'Propose changing a recorded vehicle. Give only the fields that change.',
    parameters: {
      type: 'object',
      properties: { summary, vehicle_id: vehicle, ...vehicleFields },
      required: ['summary', 'vehicle_id'],
    },
  },
  {
    ability: 'delete',
    action: 'archive_vehicle',
    name: 'propose_archive_vehicle',
    description: 'Propose removing a vehicle (sold, scrapped, recorded by mistake).',
    parameters: {
      type: 'object',
      properties: { summary, vehicle_id: vehicle },
      required: ['summary', 'vehicle_id'],
    },
  },
  {
    ability: 'garages',
    action: 'add_garage',
    name: 'propose_add_garage',
    description: 'Propose a new garage: a group of vehicles, e.g. "Home" or "Work fleet".',
    parameters: {
      type: 'object',
      properties: { summary, name: { type: 'string' }, description: { type: 'string' }, currency },
      required: ['summary', 'name'],
    },
  },
  {
    ability: 'garages',
    action: 'edit_garage',
    name: 'propose_edit_garage',
    description: 'Propose renaming a garage or changing its currency or description.',
    parameters: {
      type: 'object',
      properties: {
        summary,
        garage_id: garage,
        name: { type: 'string' },
        description: { type: 'string' },
        currency,
      },
      required: ['summary', 'garage_id'],
    },
  },
  {
    ability: 'delete',
    action: 'delete_garage',
    name: 'propose_delete_garage',
    description: 'Propose deleting a garage, for every member.',
    parameters: {
      type: 'object',
      properties: { summary, garage_id: garage },
      required: ['summary', 'garage_id'],
    },
  },
  {
    ability: 'log',
    action: 'log_entry',
    name: 'propose_log_entry',
    description:
      'Propose recording something done to or with a vehicle: a fill-up, a service, a repair, ' +
      'a trip, an expense. Fill every field the line or the attachments give. Leave vehicle_id ' +
      'out when they have several vehicles and did not say which: the form asks them.',
    parameters: {
      type: 'object',
      properties: { summary, vehicle_id: vehicle, ...entryFields },
      required: ['summary', 'kind'],
    },
  },
  {
    ability: 'log',
    action: 'edit_entry',
    name: 'propose_edit_entry',
    description: 'Propose correcting a recorded entry. Give only the fields that change.',
    parameters: {
      type: 'object',
      properties: { summary, vehicle_id: vehicle, entry_id: entry, ...entryFields },
      required: ['summary', 'vehicle_id', 'entry_id'],
    },
  },
  {
    ability: 'delete',
    action: 'delete_entry',
    name: 'propose_delete_entry',
    description: 'Propose deleting a recorded entry.',
    parameters: {
      type: 'object',
      properties: { summary, vehicle_id: vehicle, entry_id: entry },
      required: ['summary', 'vehicle_id', 'entry_id'],
    },
  },
  {
    ability: 'plan',
    action: 'plan',
    name: 'propose_plan',
    description:
      'Propose something to do later: a one-off reminder with a due date, or a job that ' +
      'repeats every so many months or so much distance. Leave vehicle_id out when they ' +
      'have several vehicles and did not say which: the form asks them.',
    parameters: {
      type: 'object',
      properties: {
        summary,
        vehicle_id: vehicle,
        title: { type: 'string' },
        due_date: day,
        every_months: { type: 'integer' },
        every_distance: { type: 'integer' },
      },
      required: ['summary', 'title'],
    },
  },
] as const satisfies readonly {
  ability: AiAbility;
  action: AiAction;
  name: string;
  description: string;
  parameters: { type: 'object'; properties: Record<string, unknown>; required: readonly string[] };
}[];

/**
 * A question back, with its answers to tap: offered with every line, so "which one?" is never
 * asked in prose the person has to retype an answer to. Like a proposal, it ends the turn.
 */
export const CHOOSE_TOOL = {
  name: 'ask_to_choose',
  description:
    'When you need the person to pick — which garage, which entry, which of several matches — ' +
    'ask with the real options from the read tools instead of asking in prose. Not for which ' +
    'vehicle a new entry or plan is for: leave vehicle_id out of the proposal instead.',
  parameters: {
    type: 'object',
    properties: {
      question: { type: 'string', description: 'Short, e.g. "Which garage?"' },
      options: {
        type: 'array',
        description: 'Two to eight.',
        items: {
          type: 'object',
          properties: {
            label: {
              type: 'string',
              description:
                'As the person would say it: a vehicle or garage name exactly as the tools give ' +
                'it, or an entry title with its date.',
            },
            detail: { type: 'string', description: 'One short line under it: a date, an amount.' },
          },
          required: ['label'],
        },
      },
    },
    required: ['question', 'options'],
  },
} as const;

/**
 * The system prompt.
 *
 * Two rules do the real work: answer only from tool results, and say so when the tools do
 * not cover the question. A model that fills a gap with a plausible service interval is
 * worse than one that admits the interval was never recorded — the second is checkable.
 */
export const AI_SYSTEM_PROMPT = [
  'You answer questions about the vehicles in this user’s garage.',
  '',
  'Rules:',
  '- Every fact in your answer must come from a tool result in this conversation. Never',
  '  invent a figure, a date, a service interval or a price, and never fill a gap from',
  '  general knowledge about the make or model.',
  '- If the tools do not hold what was asked, say plainly what is missing and what the user',
  '  would have to record for the question to be answerable.',
  '- Amounts and distances arrive written out ("$1,269.50", "42,150 km"). Quote them exactly',
  '  as given, symbol and unit included. Never convert between currencies or units.',
  '- Lead with the answer in one or two plain sentences. When the answer is a breakdown or a',
  '  set of items (costs by category, what is due), follow it with one line per item in the',
  '  form "- Label: value", at most six. No other markdown: no bold, headings or tables.',
  '- Call a vehicle by its display name exactly as the tools give it. Write dates as YYYY-MM-DD.',
  '- Quote the numbers you were given rather than recomputing them.',
  '',
  'Changes:',
  '- When the person tells you something to record or change — a vehicle they bought, a',
  '  fill-up, a trip, a garage to add, an entry to fix or delete — do not reply in prose. Look',
  '  up the ids you need with the read tools, then call exactly one propose_* tool. The person',
  '  sees it as a form and approves it; calling it saves nothing.',
  '- Never invent an id. Vehicles come from list_vehicles, garages from list_garages, entries',
  '  from get_vehicle_timeline. A vehicle the person says they bought or got is a new one.',
  '- Fill what the line and any attached files say — amounts, dates, litres, odometer, places,',
  '  trip start and end — and leave the rest out. Today is given with the message.',
  '- If the change they ask for has no propose_* tool, say in one sentence that it is switched',
  '  off in GarajAI settings.',
  '- Never guess between things the person owns. If more than one garage, vehicle or entry',
  '  could be meant and the line does not say which, do not pick one: for a new entry or plan,',
  '  propose it without vehicle_id and the form asks; for anything else, call ask_to_choose',
  '  with the real candidates from the read tools.',
  '- Never end with a question in prose; a question back is always ask_to_choose.',
].join('\n');
