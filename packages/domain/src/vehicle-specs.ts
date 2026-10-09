/**
 * Type-specific vehicle specifications (Architecture.md §18, §19; PRD §9).
 *
 * Fields are declared per *capability*, not per vehicle type. A motorcycle and a bicycle
 * both have a chain, so `chain` is described once and both types inherit it — whereas a
 * per-type list would repeat every shared field ten times and drift the moment one copy is
 * edited.
 *
 * A vehicle's valid spec keys are the union of the fields of the capabilities its type
 * declares. That single rule gives the API its validation and the client its form layout,
 * so the two cannot disagree about what a boat is allowed to have.
 */

import { FUEL_TYPES, type VehicleType } from './enums';
import { VEHICLE_TYPE_CAPABILITIES, type VehicleCapability } from './vehicle-capabilities';

export type SpecFieldKind = 'text' | 'number' | 'integer' | 'select';

export interface SpecField {
  readonly key: string;
  readonly label: string;
  readonly kind: SpecFieldKind;
  /** Rendered as a suffix in the UI; the stored value is always the bare number. */
  readonly unit?: string;
  readonly options?: readonly string[];
  readonly max?: number;
}

export const CAPABILITY_SPEC_FIELDS: Readonly<Record<VehicleCapability, readonly SpecField[]>> =
  Object.freeze({
    odometer: [],
    engineHours: [],
    engine: [
      { key: 'engineCode', label: 'Engine code', kind: 'text' },
      { key: 'displacementCc', label: 'Displacement', kind: 'integer', unit: 'cc', max: 100_000 },
      { key: 'powerHp', label: 'Power', kind: 'integer', unit: 'hp', max: 5_000 },
      { key: 'cylinders', label: 'Cylinders', kind: 'integer', max: 24 },
      { key: 'oilType', label: 'Oil type', kind: 'text' },
      { key: 'oilCapacityL', label: 'Oil capacity', kind: 'number', unit: 'L', max: 200 },
    ],
    fuelSystem: [
      { key: 'fuelType', label: 'Fuel type', kind: 'select', options: FUEL_TYPES },
      { key: 'tankCapacityL', label: 'Tank capacity', kind: 'number', unit: 'L', max: 2_000 },
    ],
    electricSystem: [
      {
        key: 'batteryCapacityKwh',
        label: 'Battery capacity',
        kind: 'number',
        unit: 'kWh',
        max: 500,
      },
      { key: 'rangeKm', label: 'Range', kind: 'integer', unit: 'km', max: 2_000 },
      { key: 'chargePortType', label: 'Charge port', kind: 'text' },
    ],
    battery: [
      { key: 'batteryType', label: 'Battery type', kind: 'text' },
      { key: 'batteryVoltage', label: 'Voltage', kind: 'number', unit: 'V', max: 1_000 },
    ],
    transmission: [
      {
        key: 'transmissionType',
        label: 'Transmission',
        kind: 'select',
        options: ['MANUAL', 'AUTOMATIC', 'DCT', 'CVT', 'SEMI_AUTOMATIC', 'SINGLE_SPEED'],
      },
      { key: 'gears', label: 'Gears', kind: 'integer', max: 30 },
      {
        key: 'drivetrain',
        label: 'Drivetrain',
        kind: 'select',
        options: ['FWD', 'RWD', 'AWD', '4WD', 'CHAIN', 'BELT', 'SHAFT'],
      },
    ],
    registration: [{ key: 'registrationCountry', label: 'Country of registration', kind: 'text' }],
    insurance: [{ key: 'insurancePolicyNumber', label: 'Policy number', kind: 'text' }],
    tires: [
      { key: 'frontTireSize', label: 'Front tire size', kind: 'text' },
      { key: 'rearTireSize', label: 'Rear tire size', kind: 'text' },
      { key: 'tirePressureFront', label: 'Front pressure', kind: 'number', unit: 'bar', max: 20 },
      { key: 'tirePressureRear', label: 'Rear pressure', kind: 'number', unit: 'bar', max: 20 },
    ],
    chain: [
      { key: 'chainSize', label: 'Chain size', kind: 'text' },
      { key: 'frontSprocket', label: 'Front sprocket', kind: 'integer', max: 100 },
      { key: 'rearSprocket', label: 'Rear sprocket', kind: 'integer', max: 100 },
      { key: 'groupset', label: 'Groupset', kind: 'text' },
    ],
    hull: [
      { key: 'hullType', label: 'Hull type', kind: 'text' },
      { key: 'hullMaterial', label: 'Hull material', kind: 'text' },
      { key: 'lengthM', label: 'Length', kind: 'number', unit: 'm', max: 200 },
      { key: 'beamM', label: 'Beam', kind: 'number', unit: 'm', max: 60 },
      { key: 'draftM', label: 'Draft', kind: 'number', unit: 'm', max: 30 },
    ],
    mooring: [
      { key: 'marina', label: 'Marina', kind: 'text' },
      { key: 'berth', label: 'Berth', kind: 'text' },
    ],
    trailer: [
      { key: 'trailerMake', label: 'Trailer make', kind: 'text' },
      {
        key: 'trailerCapacityKg',
        label: 'Trailer capacity',
        kind: 'integer',
        unit: 'kg',
        max: 50_000,
      },
    ],
    telemetry: [],
  });

/** Every spec field a vehicle of this type may carry, in a stable order for form rendering. */
export function specFieldsFor(type: VehicleType): readonly SpecField[] {
  return VEHICLE_TYPE_CAPABILITIES[type].flatMap(
    (capability) => CAPABILITY_SPEC_FIELDS[capability],
  );
}

export function specFieldMap(type: VehicleType): ReadonlyMap<string, SpecField> {
  return new Map(specFieldsFor(type).map((field) => [field.key, field]));
}

export interface SpecValidationResult {
  readonly specs: Record<string, unknown>;
  readonly errors: Record<string, string>;
}

/**
 * Validates a spec object against what the vehicle's type actually supports.
 *
 * Unknown keys are rejected rather than dropped. Silently discarding a field the user filled
 * in is worse than telling them it does not apply, and in practice it means a client sent
 * the wrong type's form — a bug worth surfacing. An explicit `null` clears a field, which is
 * how a form removes a value it previously set.
 */
export function validateSpecs(
  type: VehicleType,
  input: Record<string, unknown>,
): SpecValidationResult {
  const allowed = specFieldMap(type);
  const specs: Record<string, unknown> = {};
  const errors: Record<string, string> = {};

  for (const [key, value] of Object.entries(input)) {
    const field = allowed.get(key);
    if (!field) {
      errors[key] = `"${key}" does not apply to a vehicle of type ${type}`;
      continue;
    }
    if (value === null || value === '') continue;

    switch (field.kind) {
      case 'text': {
        if (typeof value !== 'string') errors[key] = `${field.label} must be text`;
        else if (value.length > 200) errors[key] = `${field.label} must be 200 characters or fewer`;
        else specs[key] = value;
        break;
      }
      case 'integer':
      case 'number': {
        const numeric = typeof value === 'number' ? value : Number(value);
        if (!Number.isFinite(numeric)) errors[key] = `${field.label} must be a number`;
        else if (field.kind === 'integer' && !Number.isInteger(numeric))
          errors[key] = `${field.label} must be a whole number`;
        else if (numeric < 0) errors[key] = `${field.label} cannot be negative`;
        else if (field.max !== undefined && numeric > field.max)
          errors[key] = `${field.label} must be ${field.max} or less`;
        else specs[key] = numeric;
        break;
      }
      case 'select': {
        if (typeof value !== 'string' || !field.options?.includes(value))
          errors[key] = `${field.label} must be one of: ${field.options?.join(', ')}`;
        else specs[key] = value;
        break;
      }
    }
  }

  return { specs, errors };
}
