/**
 * Reading a vehicle out of a sentence, for the add-vehicle form.
 *
 * One model turn with one tool it must call, rather than the ask loop: there is nothing to
 * look up, the answer *is* the call, and a person waiting on a form should wait one round
 * trip. What comes back is checked against the create contract's bounds and the type's own
 * spec fields here, so the form is only ever filled with values the API would accept.
 */

import type {
  AiAttachment,
  LookUpVehicle,
  VehicleDraft,
  VehicleLookup,
} from '@vehicle-os/contracts';
import {
  CAPABILITY_SPEC_FIELDS,
  DISTANCE_UNITS,
  VEHICLE_CAPABILITIES,
  VEHICLE_TYPES,
  specFieldsFor,
  validateSpecs,
  type SpecField,
  type VehicleType,
} from '@vehicle-os/domain';
import {
  AiUnavailableError,
  type AiProviderPort,
  type AiToolSpec,
  type AiTurn,
} from '../../infrastructure/ai-port';

/** Every spec field of every capability, once — the type is not known until the model says. */
const SPEC_FIELDS = [
  ...new Map(
    VEHICLE_CAPABILITIES.flatMap((capability) => CAPABILITY_SPEC_FIELDS[capability]).map(
      (field) => [field.key, field] as const,
    ),
  ).values(),
];

const specSchema = (field: SpecField) =>
  field.kind === 'select'
    ? { type: 'string', enum: [...(field.options ?? [])] }
    : field.kind === 'text'
      ? { type: 'string', description: field.label }
      : {
          type: field.kind,
          description: [field.label, field.unit && `in ${field.unit}`].filter(Boolean).join(', '),
        };

export const FILL_VEHICLE: AiToolSpec = {
  name: 'fill_vehicle',
  description: 'Fill the add-vehicle form with what was described. Leave out what was not.',
  parameters: {
    type: 'object',
    properties: {
      vehicle_type: { type: 'string', enum: [...VEHICLE_TYPES] },
      make: { type: 'string', description: 'Manufacturer, as it brands itself: "Mercedes-Benz".' },
      model: { type: 'string', description: 'Model alone, no make or trim: "911", "Civic".' },
      variant: { type: 'string', description: 'Trim or variant: "Carrera S", "VXL", "Touring".' },
      year: { type: 'integer', description: 'Model year.' },
      nickname: { type: 'string', description: 'Only a name the person gives it.' },
      color: { type: 'string' },
      vin: { type: 'string', description: 'Only when written out in full.' },
      registration: {
        type: 'string',
        description: 'The number plate exactly as written, spaces kept.',
      },
      purchase_date: { type: 'string', description: 'YYYY-MM-DD; a month alone is its 1st.' },
      purchase_price: { type: 'number', description: 'Major units: "98k" is 98000.' },
      purchase_currency: { type: 'string', description: 'ISO 4217: USD, EUR, PKR, GBP.' },
      odometer: { type: 'integer', description: '"42k km" is 42000.' },
      odometer_unit: { type: 'string', enum: [...DISTANCE_UNITS] },
      engine_hours: { type: 'integer' },
      specs: {
        type: 'object',
        properties: Object.fromEntries(SPEC_FIELDS.map((field) => [field.key, specSchema(field)])),
      },
    },
  },
};

const system = (today: string) =>
  [
    'You fill the add-vehicle form of a garage app from what the person typed, and from any',
    'photos or papers attached (a registration card, a sale receipt, a photo of the car).',
    'Call fill_vehicle once.',
    '- Fill what is said or plainly implied: "2019 911 Carrera S" is a Porsche, a CAR;',
    '  "42k km" is odometer 42000 in KM; "$98k" is 98000 USD.',
    '- Never invent identifiers or money: a VIN, plate or price only when written or shown.',
    '- Specs: what is said, plus the maker’s standard figures for that exact model, year and',
    '  variant when you are certain of them (engine size, power, cylinders, fuel, gearbox,',
    '  drivetrain, tank). Leave out anything that varies by market or option.',
    `- Today is ${today}, for "last March" or "two years ago".`,
    '- Leave a field out rather than guess.',
  ].join('\n');

export async function draftVehicle(
  provider: AiProviderPort,
  input: { text: string; attachments?: readonly AiAttachment[]; today: string },
): Promise<VehicleDraft> {
  const turn = await provider.generate({
    system: system(input.today),
    messages: [{ role: 'user', text: input.text, attachments: input.attachments }],
    tools: [FILL_VEHICLE],
    force: FILL_VEHICLE.name,
  });
  const call = turn.calls.find((candidate) => candidate.name === FILL_VEHICLE.name);
  return readDraft(call?.args ?? {});
}

const text = (value: unknown, max: number) =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined;

const whole = (value: unknown, min: number, max: number) => {
  if (value === undefined || value === null || value === '') return undefined;
  const number = typeof value === 'number' ? value : Number(String(value).replace(/,/g, ''));
  return Number.isFinite(number) && number >= min && number <= max ? Math.round(number) : undefined;
};

const isDay = (value: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  new Date(`${value}T00:00:00Z`).toISOString().startsWith(value);

/**
 * The model's arguments, held to the create contract: a value out of bounds or of the wrong
 * kind is dropped, not clamped — a form with a gap is honest, one with a corrected guess is not.
 */
export function readDraft(args: Record<string, unknown>): VehicleDraft {
  const type = String(args.vehicle_type ?? '').toUpperCase();
  const vehicleType = (VEHICLE_TYPES as readonly string[]).includes(type)
    ? (type as VehicleType)
    : undefined;
  const unit = String(args.odometer_unit ?? '').toUpperCase();
  const currency = String(args.purchase_currency ?? '')
    .trim()
    .toUpperCase();
  const day = text(args.purchase_date, 10);
  const price = Number(args.purchase_price);
  const specs =
    vehicleType && args.specs && typeof args.specs === 'object'
      ? validateSpecs(vehicleType, args.specs as Record<string, unknown>).specs
      : {};

  const draft: VehicleDraft = {
    vehicleType,
    make: text(args.make, 120),
    model: text(args.model, 120),
    variant: text(args.variant, 120),
    year: whole(args.year, 1885, 2100),
    nickname: text(args.nickname, 120),
    color: text(args.color, 60),
    identificationNumber: text(args.vin, 64)?.toUpperCase().replace(/\s/g, ''),
    registrationIdentifier: text(args.registration, 32)?.toUpperCase(),
    purchaseDate: day && isDay(day) ? day : undefined,
    purchasePrice: Number.isFinite(price) && price > 0 ? price : undefined,
    purchaseCurrency: /^[A-Z]{3}$/.test(currency) ? currency : undefined,
    currentOdometer: whole(args.odometer, 0, 100_000_000),
    odometerUnit: (DISTANCE_UNITS as readonly string[]).includes(unit)
      ? (unit as VehicleDraft['odometerUnit'])
      : undefined,
    currentEngineHours: whole(args.engine_hours, 0, 1_000_000),
    specs: specs as VehicleDraft['specs'],
  };
  // Absent rather than `undefined`, so the response says only what was read.
  return Object.fromEntries(
    Object.entries(draft).filter(([, value]) => value !== undefined),
  ) as VehicleDraft;
}

/*
 * When a searched turn was last refused. Search then sits out a while rather than costing two
 * failed round trips on every lookup.
 * ponytail: per process; a shared flag in Redis if the API runs several instances.
 */
const SEARCH_RETRY_MS = 10 * 60_000;
let searchDownUntil = 0;

/**
 * The factory specs of a vehicle already identified — the figures nobody types: oil capacity,
 * tyre sizes, tank, gearbox.
 *
 * With web search: two turns. The first searches and writes what it found as notes, with the
 * pages it used; the second copies the notes into the type's own spec fields, converting units —
 * apart because a searched turn answers in prose and the fields must come from a forced call.
 * Without search (no grounding quota on the key): one forced turn from the model's knowledge of
 * the published figures, since prose notes first only doubled the wait.
 */
export async function lookUpVehicle(
  provider: AiProviderPort,
  vehicle: LookUpVehicle,
): Promise<VehicleLookup> {
  const fields = specFieldsFor(vehicle.vehicleType);
  if (fields.length === 0) return { specs: {}, sources: [] };

  const name = [vehicle.year, vehicle.make, vehicle.model, vehicle.variant]
    .filter(Boolean)
    .join(' ');
  const wanted = fields
    .map((field) =>
      [
        field.label,
        field.unit && `(${field.unit})`,
        field.options && `[one of ${field.options.join(', ')}]`,
      ]
        .filter(Boolean)
        .join(' '),
    )
    .join('; ');

  let notes: AiTurn | undefined;
  if (Date.now() >= searchDownUntil) {
    try {
      notes = await provider.generate({
        system:
          'You look up vehicle specifications on the web. Report the manufacturer figures for ' +
          'the exact vehicle, model year and variant asked about, one per line as ' +
          '"Label: value unit". Where a figure differs by market or option, give the most ' +
          'common one. Write "unknown" rather than guess.',
        messages: [
          { role: 'user', text: `Vehicle: ${name} (${vehicle.vehicleType}).\nFind: ${wanted}.` },
        ],
        tools: [],
        search: true,
      });
    } catch (error) {
      // Search refused (no quota on the key, a model without it): known figures still help.
      if (!(error instanceof AiUnavailableError)) throw error;
      searchDownUntil = Date.now() + SEARCH_RETRY_MS;
    }
  }
  const sources = [
    ...new Map((notes?.sources ?? []).map((source) => [source.title, source])).values(),
  ]
    .slice(0, 4)
    .map(({ title, url }) => ({ title, url }));

  const turn = await provider.generate({
    system:
      (notes
        ? 'Copy the vehicle specifications in the notes into fill_specs. '
        : 'Fill fill_specs with the manufacturer’s published figures for this exact vehicle, ' +
          'model year and variant — every field the owner’s manual and spec sheet give: engine ' +
          'code, oil grade and capacity, tank, gears, battery, tyre sizes and pressures, as ' +
          'well as power and displacement. Where one differs by market or option, give the ' +
          'most common. ') +
      'Convert to the units asked for (hp, cc, L, bar, kWh, km, m, kg; psi to bar). Options ' +
      'must be one of the listed values. Leave out what you do not know.',
    messages: [
      {
        role: 'user',
        text: notes
          ? `Vehicle: ${name}\n\nNotes:\n${notes.text ?? 'none'}`
          : `Vehicle: ${name} (${vehicle.vehicleType}).`,
      },
    ],
    tools: [
      {
        name: 'fill_specs',
        description: 'The specifications of the vehicle.',
        parameters: {
          type: 'object',
          properties: Object.fromEntries(fields.map((field) => [field.key, specSchema(field)])),
        },
      },
    ],
    force: 'fill_specs',
  });
  const call = turn.calls.find((candidate) => candidate.name === 'fill_specs');
  return {
    specs: validateSpecs(vehicle.vehicleType, call?.args ?? {}).specs as VehicleLookup['specs'],
    sources,
  };
}
