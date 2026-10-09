/**
 * Vehicle capabilities (Architecture.md §19).
 *
 * A bicycle has no engine, a trailer has no odometer, a boat measures life in engine hours
 * rather than distance. Rather than a schema full of columns that are null for most rows,
 * each type declares what it supports, and the UI and validation read from here.
 *
 * This is deliberately data, not classes: adding a type is one entry, and no `switch`
 * anywhere else has to learn about it.
 */

import type { VehicleType } from './enums';

export const VEHICLE_CAPABILITIES = [
  'odometer',
  'engineHours',
  'engine',
  'fuelSystem',
  'electricSystem',
  'battery',
  'transmission',
  'registration',
  'insurance',
  'tires',
  'chain',
  'hull',
  'mooring',
  'trailer',
  'telemetry',
] as const;

export type VehicleCapability = (typeof VEHICLE_CAPABILITIES)[number];

const CAR: readonly VehicleCapability[] = [
  'odometer',
  'engine',
  'fuelSystem',
  'battery',
  'transmission',
  'registration',
  'insurance',
  'tires',
  'telemetry',
];

export const VEHICLE_TYPE_CAPABILITIES: Readonly<
  Record<VehicleType, readonly VehicleCapability[]>
> = Object.freeze({
  CAR,
  VAN: CAR,
  RV: [...CAR, 'trailer'],
  MOTORCYCLE: [
    'odometer',
    'engine',
    'fuelSystem',
    'battery',
    'transmission',
    'registration',
    'insurance',
    'tires',
    'chain',
    'telemetry',
  ],
  SCOOTER: ['odometer', 'engine', 'fuelSystem', 'battery', 'registration', 'insurance', 'tires'],
  ATV: ['odometer', 'engineHours', 'engine', 'fuelSystem', 'battery', 'tires'],
  // No registration, no insurance, no engine — and a chain that is a real maintenance item.
  BICYCLE: ['odometer', 'tires', 'chain'],
  BOAT: [
    'engineHours',
    'engine',
    'fuelSystem',
    'battery',
    'registration',
    'insurance',
    'hull',
    'mooring',
    'trailer',
  ],
  TRAILER: ['registration', 'insurance', 'tires'],
  OTHER: ['odometer'],
});

export function supports(type: VehicleType, capability: VehicleCapability): boolean {
  return VEHICLE_TYPE_CAPABILITIES[type].includes(capability);
}

/**
 * Which reading drives maintenance intervals for this type. A boat serviced every 100
 * hours and a car serviced every 10,000 km are the same rule with a different meter.
 */
export function primaryUsageMeter(type: VehicleType): 'odometer' | 'engineHours' | null {
  if (supports(type, 'odometer')) return 'odometer';
  if (supports(type, 'engineHours')) return 'engineHours';
  return null;
}
