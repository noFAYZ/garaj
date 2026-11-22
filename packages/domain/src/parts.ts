/**
 * Parts and fluids (PRD §17): what went into a vehicle, where, and when.
 *
 * A *position* is a place on the vehicle that takes a product — the engine's oil, the front
 * tyres, the battery. Positions are declared per capability, as spec fields are, so a bicycle
 * gets a chain and pads but no oil, a boat gets anodes, and adding a vehicle type adds nothing
 * here. Keys are stored as text rather than a database enum: a new position is one entry in this
 * list, not a migration.
 *
 * What is fitted *now* is never stored. It is the newest replacement at each position, read off
 * the history — so a back-dated entry, an edited date or a deleted entry is reflected the moment
 * it happens, with no "removed" flag to keep in step.
 */

import type { VehicleType } from './enums';
import { VEHICLE_TYPE_CAPABILITIES, type VehicleCapability } from './vehicle-capabilities';

/** What a part's quantity is counted in. Fluids in volume, everything else in pieces. */
export const PART_UNITS = ['PIECE', 'LITER', 'QUART', 'US_GALLON', 'IMP_GALLON'] as const;
export type PartUnit = (typeof PART_UNITS)[number];

/**
 * A replacement resets a position's age; a top-up adds to what is there without resetting it, so
 * half a litre of oil between changes does not make a 9,000 km old fill look new.
 */
export const PART_ACTIONS = ['REPLACED', 'TOPPED_UP'] as const;
export type PartAction = (typeof PART_ACTIONS)[number];

export const PART_GROUPS = [
  'ENGINE',
  'DRIVETRAIN',
  'BRAKES',
  'TYRES',
  'ELECTRICAL',
  'BODY',
  'HULL',
  'OTHER',
] as const;
export type PartGroup = (typeof PART_GROUPS)[number];

export interface PartPositionSpec {
  readonly label: string;
  readonly group: PartGroup;
  /** The capability that brings it; `null` for one every vehicle may have. */
  readonly capability: VehicleCapability | null;
  /** Narrower than a capability: a cabin filter is a car's, not a motorcycle's. */
  readonly types?: readonly VehicleType[];
  /**
   * Positions that take the same kind of product share a category — front and rear tyres — so a
   * product used on one is offered on the other.
   */
  readonly category: string;
  /** Measured by volume: its quantity defaults to litres (quarts on a vehicle read in miles). */
  readonly liquid?: boolean;
  /** The vehicle spec that says what it takes, offered as the grade when nothing was fitted yet. */
  readonly specKey?: string;
  /** An example grade or size, for the empty field. */
  readonly specHint?: string;
  /** Burns fuel: not on a vehicle whose fuel is electricity. */
  readonly combustion?: boolean;
  /** `false`: a history only, never one "current" part — Other holds unrelated things. */
  readonly tracked?: boolean;
}

export const PART_POSITIONS = {
  ENGINE_OIL: {
    label: 'Engine oil',
    group: 'ENGINE',
    capability: 'engine',
    category: 'ENGINE_OIL',
    liquid: true,
    specKey: 'oilType',
    specHint: '5W-30',
    combustion: true,
  },
  OIL_FILTER: {
    label: 'Oil filter',
    group: 'ENGINE',
    capability: 'engine',
    category: 'OIL_FILTER',
    combustion: true,
  },
  AIR_FILTER: {
    label: 'Air filter',
    group: 'ENGINE',
    capability: 'engine',
    category: 'AIR_FILTER',
    combustion: true,
  },
  FUEL_FILTER: {
    label: 'Fuel filter',
    group: 'ENGINE',
    capability: 'fuelSystem',
    category: 'FUEL_FILTER',
    combustion: true,
  },
  SPARK_PLUGS: {
    label: 'Spark plugs',
    group: 'ENGINE',
    capability: 'engine',
    category: 'SPARK_PLUGS',
    combustion: true,
  },
  TIMING_BELT: {
    label: 'Timing belt',
    group: 'ENGINE',
    capability: 'engine',
    category: 'TIMING_BELT',
    combustion: true,
  },
  COOLANT: {
    label: 'Coolant',
    group: 'ENGINE',
    capability: 'engine',
    category: 'COOLANT',
    liquid: true,
    specHint: 'G12 Evo',
  },
  GEARBOX_OIL: {
    label: 'Gearbox oil',
    group: 'DRIVETRAIN',
    capability: 'transmission',
    category: 'GEARBOX_OIL',
    liquid: true,
    specHint: '75W-90',
  },
  CHAIN: {
    label: 'Chain',
    group: 'DRIVETRAIN',
    capability: 'chain',
    category: 'CHAIN',
    specKey: 'chainSize',
    specHint: '520',
  },
  SPROCKETS: {
    label: 'Sprockets',
    group: 'DRIVETRAIN',
    capability: 'chain',
    category: 'SPROCKETS',
  },
  BRAKE_PADS_FRONT: {
    label: 'Front brake pads',
    group: 'BRAKES',
    capability: 'tires',
    category: 'BRAKE_PADS',
  },
  BRAKE_PADS_REAR: {
    label: 'Rear brake pads',
    group: 'BRAKES',
    capability: 'tires',
    category: 'BRAKE_PADS',
  },
  BRAKE_DISCS_FRONT: {
    label: 'Front brake discs',
    group: 'BRAKES',
    capability: 'tires',
    category: 'BRAKE_DISCS',
  },
  BRAKE_DISCS_REAR: {
    label: 'Rear brake discs',
    group: 'BRAKES',
    capability: 'tires',
    category: 'BRAKE_DISCS',
  },
  BRAKE_FLUID: {
    label: 'Brake fluid',
    group: 'BRAKES',
    capability: 'tires',
    category: 'BRAKE_FLUID',
    liquid: true,
    specHint: 'DOT 4',
  },
  TYRES_FRONT: {
    label: 'Front tyres',
    group: 'TYRES',
    capability: 'tires',
    category: 'TYRES',
    specKey: 'frontTireSize',
    specHint: '225/45 R17',
  },
  TYRES_REAR: {
    label: 'Rear tyres',
    group: 'TYRES',
    capability: 'tires',
    category: 'TYRES',
    specKey: 'rearTireSize',
    specHint: '225/45 R17',
  },
  BATTERY: {
    label: 'Battery',
    group: 'ELECTRICAL',
    capability: 'battery',
    category: 'BATTERY',
    specKey: 'batteryType',
    specHint: 'AGM 70 Ah',
  },
  WIPER_BLADES: {
    label: 'Wiper blades',
    group: 'BODY',
    capability: null,
    types: ['CAR', 'VAN', 'RV'],
    category: 'WIPER_BLADES',
  },
  CABIN_FILTER: {
    label: 'Cabin filter',
    group: 'BODY',
    capability: null,
    types: ['CAR', 'VAN', 'RV'],
    category: 'CABIN_FILTER',
  },
  ANODES: { label: 'Anodes', group: 'HULL', capability: 'hull', category: 'ANODES' },
  IMPELLER: { label: 'Impeller', group: 'HULL', capability: 'hull', category: 'IMPELLER' },
  OTHER: {
    label: 'Other part',
    group: 'OTHER',
    capability: null,
    category: 'OTHER',
    tracked: false,
  },
} as const satisfies Record<string, PartPositionSpec>;

export type PartPosition = keyof typeof PART_POSITIONS;
export const PART_POSITION_KEYS = Object.keys(PART_POSITIONS) as PartPosition[];

export const partPosition = (key: string): PartPositionSpec | undefined =>
  (PART_POSITIONS as Record<string, PartPositionSpec>)[key];

/**
 * The positions a vehicle of this type has, in display order. With its specs, a vehicle that
 * runs on electricity loses the oil, filters and plugs it does not have — offered, never
 * enforced: the API only checks the type, so a mis-set fuel type cannot lock a record out.
 */
export function partPositionsFor(
  type: VehicleType,
  specs?: Readonly<Record<string, unknown>>,
): PartPosition[] {
  const capabilities = new Set<VehicleCapability>(VEHICLE_TYPE_CAPABILITIES[type]);
  const fuel = specs?.fuelType;
  const electric = typeof fuel === 'string' && fuel.startsWith('ELECTRIC');
  return PART_POSITION_KEYS.filter((key) => {
    const position: PartPositionSpec = PART_POSITIONS[key];
    if (position.types && !position.types.includes(type)) return false;
    if (position.capability && !capabilities.has(position.capability)) return false;
    return !(electric && position.combustion);
  });
}

/*
 * A reminder's parts, from its title. Checks, rotations and adjustments touch a part without
 * replacing it, so they name none — completing "Tyre rotation" must not offer four new tyres.
 */
const NOT_A_REPLACEMENT =
  /\b(rotat\w*|check\w*|inspect\w*|pressures?|balanc\w*|align\w*|clean\w*|lube|lubricat\w*|adjust\w*|tension\w*)\b/;
/** Oil that is not the engine's, removed before the engine-oil rule reads the title. */
const OTHER_OIL = /\b(gear ?box|gear|transmission|diff(erential)?|fork|chain)\s+(oil|fluid)\b/g;

const JOBS: readonly (readonly [RegExp, readonly PartPosition[]])[] = [
  [/\b(gear ?box|transmission|diff(erential)?|atf)\b/, ['GEARBOX_OIL']],
  [/\boil\b(?! filter)|\bservice\b/, ['ENGINE_OIL', 'OIL_FILTER']],
  [/\boil filter\b/, ['OIL_FILTER']],
  [/\bair filter\b/, ['AIR_FILTER']],
  [/\b(cabin|pollen) filter\b/, ['CABIN_FILTER']],
  [/\bfuel filter\b/, ['FUEL_FILTER']],
  [/\b(spark )?plugs?\b/, ['SPARK_PLUGS']],
  [/\b(timing|cam) ?belt\b/, ['TIMING_BELT']],
  [/\b(coolant|antifreeze)\b/, ['COOLANT']],
  [/\bbrake fluid\b/, ['BRAKE_FLUID']],
  [/\bpads?\b/, ['BRAKE_PADS_FRONT', 'BRAKE_PADS_REAR']],
  [/\b(discs?|rotors?)\b/, ['BRAKE_DISCS_FRONT', 'BRAKE_DISCS_REAR']],
  [/\b(tyres?|tires?)\b/, ['TYRES_FRONT', 'TYRES_REAR']],
  [/\bbattery\b/, ['BATTERY']],
  [/\bwipers?\b/, ['WIPER_BLADES']],
  [/\bchain\b/, ['CHAIN']],
  [/\bsprockets?\b/, ['SPROCKETS']],
  [/\banodes?\b/, ['ANODES']],
  [/\bimpeller\b/, ['IMPELLER']],
];

/**
 * The positions a job replaces, from its name: "Oil change" → engine oil and oil filter; "Front
 * pads" → the front pads only. Callers narrow it to the vehicle's own positions.
 */
export function positionsForJob(title: string): PartPosition[] {
  const text = title.toLowerCase();
  if (NOT_A_REPLACEMENT.test(text)) return [];
  const engine = text.replace(OTHER_OIL, ' ');
  const found = new Set<PartPosition>();
  for (const [pattern, positions] of JOBS) {
    const subject = positions.includes('ENGINE_OIL') ? engine : text;
    if (pattern.test(subject)) positions.forEach((position) => found.add(position));
  }
  // "Front pads": one end only, when the title names one end and not the other.
  const front = /\bfront\b/.test(text);
  const rear = /\b(rear|back)\b/.test(text);
  return [...found].filter((position) =>
    front && !rear
      ? !position.endsWith('_REAR')
      : rear && !front
        ? !position.endsWith('_FRONT')
        : true,
  );
}

export interface PartProductFields {
  readonly brand: string | null;
  readonly name: string | null;
  readonly spec: string | null;
  readonly partNumber?: string | null;
}

/** "Castrol Edge 5W-30" — null when nothing names the product. */
export function partName(part: PartProductFields): string | null {
  const words = [part.brand, part.name, part.spec].filter((word) => word && word.trim());
  return words.length > 0 ? words.join(' ') : part.partNumber || null;
}

/** One product however it was typed: "castrol|edge|5w-30|", for spotting the same one twice. */
export function partProductKey(part: PartProductFields): string {
  return [part.brand, part.name, part.spec, part.partNumber ?? null]
    .map((word) => (word ?? '').trim().toLowerCase().replace(/\s+/g, ' '))
    .join('|');
}

/**
 * What is fitted now at each tracked position: the first replacement for it in a history listed
 * newest first (the API's order). Top-ups and untracked positions never become "current".
 */
export function currentParts<T extends { readonly position: string; readonly action: PartAction }>(
  history: readonly T[],
): Map<string, T> {
  const current = new Map<string, T>();
  for (const part of history) {
    if (part.action !== 'REPLACED' || current.has(part.position)) continue;
    if (partPosition(part.position)?.tracked === false) continue;
    current.set(part.position, part);
  }
  return current;
}

/** What a job last put in, for its reminder: "Castrol Edge 5W-30" — the first named one fitted. */
export function lastFitted(
  current: ReadonlyMap<string, PartProductFields>,
  positions: readonly PartPosition[],
): string | null {
  for (const position of positions) {
    const part = current.get(position);
    const name = part ? partName(part) : null;
    if (name) return name;
  }
  return null;
}

/* ---------------------------------------------------------------------------------------------- */
/* Lines being written: the add forms', on the web and the phone alike                             */

/** A line in a form: every field as typed, so a half-written one is still a line. */
export interface PartDraft {
  /** The line's id too, so a replayed write lands on the same line. */
  readonly id: string;
  readonly position: PartPosition;
  readonly action: PartAction;
  readonly brand: string;
  readonly name: string;
  readonly spec: string;
  readonly partNumber: string;
  readonly quantity: string;
  readonly unit: PartUnit | null;
  /** `YYYY-MM-DD`, or empty for none. */
  readonly warrantyUntil: string;
  /** Filled from what is fitted there now and not changed since: "Same as last time". */
  readonly same: boolean;
  /** Read off a photo and not changed since. */
  readonly read?: boolean;
}

/** A line as recorded, structurally — the API's `VehiclePart` is one. */
export interface RecordedPart extends PartProductFields {
  readonly position: string;
  readonly action: PartAction;
  readonly quantity: number | null;
  readonly unit: PartUnit | null;
  readonly warrantyUntil?: string | null;
}

/** A fluid on a vehicle read in miles is bought in quarts. */
export const fluidUnit = (odometerUnit: string): PartUnit =>
  odometerUnit === 'MI' ? 'QUART' : 'LITER';

/**
 * A line for a position: the product fitted there now, when it has a name — the routine service
 * is then one tap — or else the grade the vehicle's spec says it takes. A new item's warranty is
 * its own, so it never carries over.
 */
export function draftFor(
  id: string,
  position: PartPosition,
  vehicle: { readonly specs: Readonly<Record<string, unknown>>; readonly odometerUnit: string },
  last?: RecordedPart,
): PartDraft {
  const spec: PartPositionSpec = PART_POSITIONS[position];
  const unit = spec.liquid ? fluidUnit(vehicle.odometerUnit) : null;
  const base = { id, position, action: 'REPLACED' as const, warrantyUntil: '', partNumber: '' };
  if (last && partName(last)) {
    return {
      ...base,
      brand: last.brand ?? '',
      name: last.name ?? '',
      spec: last.spec ?? '',
      partNumber: last.partNumber ?? '',
      quantity: last.quantity === null ? '' : String(last.quantity),
      unit: last.unit ?? unit,
      same: true,
    };
  }
  const specified = spec.specKey ? vehicle.specs[spec.specKey] : undefined;
  return {
    ...base,
    brand: '',
    name: '',
    spec: typeof specified === 'string' ? specified : '',
    quantity: '',
    unit,
    same: false,
  };
}

/** A part as a photo read it — the API's `EntryDraft.parts` item. */
export interface ReadPart {
  readonly position: PartPosition;
  readonly brand?: string;
  readonly name?: string;
  readonly spec?: string;
  readonly partNumber?: string;
  readonly quantity?: number;
  readonly unit?: PartUnit;
}

/** A part a photo read, as a line to check: what the invoice or the label printed. */
export function draftFromRead(id: string, read: ReadPart, odometerUnit: string): PartDraft {
  return {
    id,
    position: read.position,
    action: 'REPLACED',
    brand: read.brand ?? '',
    name: read.name ?? '',
    spec: read.spec ?? '',
    partNumber: read.partNumber ?? '',
    quantity: read.quantity === undefined ? '' : String(read.quantity),
    unit:
      read.unit ??
      ((PART_POSITIONS[read.position] as PartPositionSpec).liquid ? fluidUnit(odometerUnit) : null),
    warrantyUntil: '',
    same: false,
    read: true,
  };
}

/** A recorded line, to correct: it keeps its id, which is the line being rewritten. */
export function draftFromPart(part: RecordedPart & { readonly id: string }): PartDraft {
  return {
    id: part.id,
    position: part.position as PartPosition,
    action: part.action,
    brand: part.brand ?? '',
    name: part.name ?? '',
    spec: part.spec ?? '',
    partNumber: part.partNumber ?? '',
    quantity: part.quantity === null ? '' : String(part.quantity),
    unit: part.unit,
    warrantyUntil: part.warrantyUntil ?? '',
    same: false,
  };
}

/** The line as the API takes it (`PartLine`): empty words left out, a quantity only when given. */
export function toPartLine(draft: PartDraft) {
  const words = (value: string) => value.trim() || undefined;
  const quantity = Number(draft.quantity);
  return {
    id: draft.id,
    position: draft.position,
    action: draft.action,
    brand: words(draft.brand),
    name: words(draft.name),
    spec: words(draft.spec),
    partNumber: words(draft.partNumber),
    ...(quantity > 0 ? { quantity, ...(draft.unit ? { unit: draft.unit } : {}) } : {}),
    ...(draft.warrantyUntil ? { warrantyUntil: draft.warrantyUntil } : {}),
  };
}

/** The draft as a recorded line reads, for its summary while it is being written. */
export function draftAsPart(draft: PartDraft): RecordedPart {
  const quantity = Number(draft.quantity);
  return {
    position: draft.position,
    action: draft.action,
    brand: draft.brand.trim() || null,
    name: draft.name.trim() || null,
    spec: draft.spec.trim() || null,
    partNumber: draft.partNumber.trim() || null,
    quantity: quantity > 0 ? quantity : null,
    unit: draft.unit,
  };
}

/** The garage's products for this position's kind — front and rear tyres share — each once. */
export function productsFor<T extends PartProductFields & { readonly position: string }>(
  products: readonly T[],
  position: PartPosition,
): T[] {
  const category = PART_POSITIONS[position].category;
  const seen = new Set<string>();
  return products.filter((product) => {
    if (partPosition(product.position)?.category !== category) return false;
    const key = partProductKey(product);
    return seen.has(key) ? false : (seen.add(key), true);
  });
}

const UNIT_WORD: Record<PartUnit, string> = {
  PIECE: '×',
  LITER: 'L',
  QUART: 'qt',
  US_GALLON: 'gal',
  IMP_GALLON: 'gal',
};

/** The unit as a quantity field's suffix: "L", "qt", "×". */
export const partUnitWord = (unit: PartUnit | null): string => (unit ? UNIT_WORD[unit] : '×');

/** "4.2 L", "×4"; nothing without a quantity. */
export function partAmount(
  quantity: number | null,
  unit: PartUnit | null,
  locale?: string,
): string | null {
  if (quantity === null) return null;
  const figure = new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }).format(quantity);
  return !unit || unit === 'PIECE' ? `×${figure}` : `${figure} ${UNIT_WORD[unit]}`;
}

/** "Castrol Edge 5W-30 · P3300 · 4.2 L"; a line that named nothing says so. */
export function partSummary(part: RecordedPart, locale?: string): string {
  const name = partName(part);
  return [
    name ?? 'Product not recorded',
    // The part number is what a counter looks up, when the name has not already said it.
    part.partNumber && part.partNumber !== name ? part.partNumber : null,
    partAmount(part.quantity, part.unit, locale),
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * The lines a form opens with, before anything is touched: what the photo read — that is what
 * went in — then the parts the job being completed names, each the product fitted last time, for
 * the positions the photo did not. Only positions this vehicle has.
 */
export function seedPartLines(
  makeId: () => string,
  vehicle: { readonly specs: Readonly<Record<string, unknown>>; readonly odometerUnit: string },
  current: ReadonlyMap<string, RecordedPart>,
  positions: readonly PartPosition[],
  job: string | null,
  read?: readonly ReadPart[],
): PartDraft[] {
  const fromPhoto = (read ?? [])
    .filter((part) => positions.includes(part.position))
    .map((part) => draftFromRead(makeId(), part, vehicle.odometerUnit));
  const named = new Set<string>(fromPhoto.map((draft) => draft.position));
  const fromJob = job
    ? positionsForJob(job)
        .filter((position) => positions.includes(position) && !named.has(position))
        .map((position) => draftFor(makeId(), position, vehicle, current.get(position)))
    : [];
  return [...fromPhoto, ...fromJob];
}
