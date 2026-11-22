/**
 * Turning the lines a client sent into rows (PRD §17) — shared by every write that carries parts:
 * a logbook entry, a completed service, and lines recorded on their own.
 *
 * Pure: it reads nothing and writes nothing, so it runs before a transaction opens, and a bad
 * line refuses the whole entry with a field error rather than saving the entry without it.
 */

import type { PartLine, RecordParts } from '@vehicle-os/contracts';
import type { schema } from '@vehicle-os/database';
import {
  assertCurrency,
  MoneyError,
  partPosition,
  partPositionsFor,
  type DistanceUnit,
  type VehicleType,
} from '@vehicle-os/domain';

export type PartInsert = typeof schema.vehicleParts.$inferInsert;
/** A line as written, less the entry it belongs to — known only inside the transaction. */
export type PartDraft = Omit<PartInsert, 'eventId'>;

type LineInput = PartLine &
  Partial<Pick<RecordParts['parts'][number], 'fittedAt' | 'odometer' | 'odometerUnit'>>;

/** Same bound as an entry's date: a part cannot have been fitted next year. */
const MAX_FUTURE_MS = 24 * 60 * 60 * 1000;

const words = (value: string | null | undefined) => value?.trim() || null;

export interface LineContext {
  readonly vehicleId: string;
  readonly vehicleType: VehicleType;
  /** What a reading with no unit is read in: the vehicle's own. */
  readonly odometerUnit: DistanceUnit;
  readonly createdBy: string;
  /** On an entry: the lines take its date and reading, and may not bring their own. */
  readonly onEntry: boolean;
  readonly now?: Date;
}

/**
 * The rows for these lines, or errors in `fields` under `parts.<n>.<field>`. Callers check
 * `fields` once, together with their own, and throw one validation error for the request.
 */
export function resolvePartLines(
  lines: readonly LineInput[] | undefined,
  context: LineContext,
  fields: Record<string, string>,
): PartDraft[] {
  if (!lines?.length) return [];
  const fits = new Set<string>(partPositionsFor(context.vehicleType));
  const now = context.now ?? new Date();

  return lines.map((line, index) => {
    const at = (field: string) => `parts.${index}.${field}`;
    // Unknown only for a stored line whose position has since left the domain: refused, not a crash.
    const position = partPosition(line.position);
    const action = line.action ?? 'REPLACED';

    if (!fits.has(line.position)) {
      fields[at('position')] =
        `${position?.label ?? line.position} does not apply to this vehicle.`;
    }
    if (action === 'TOPPED_UP' && !position?.liquid) {
      fields[at('action')] = 'Only a fluid is topped up.';
    }

    // Amount and currency travel together, as on the entry (§79).
    if (line.costAmountMinor !== undefined && !line.costCurrency) {
      fields[at('costCurrency')] = 'A cost needs a currency.';
    } else if (line.costCurrency) {
      try {
        assertCurrency(line.costCurrency);
      } catch (error) {
        if (!(error instanceof MoneyError)) throw error;
        fields[at('costCurrency')] = error.message;
      }
    }

    let fittedAt: Date | null = null;
    if (context.onEntry && (line.fittedAt !== undefined || line.odometer !== undefined)) {
      fields[at('fittedAt')] = 'A line on an entry takes the entry’s date and reading.';
    } else if (line.fittedAt !== undefined) {
      fittedAt = new Date(line.fittedAt);
      if (fittedAt.getTime() > now.getTime() + MAX_FUTURE_MS) {
        fields[at('fittedAt')] = 'A part cannot have been fitted in the future.';
      }
    }

    const quantity = line.quantity ?? null;
    return {
      ...(line.id ? { id: line.id } : {}),
      vehicleId: context.vehicleId,
      position: line.position,
      action,
      brand: words(line.brand),
      name: words(line.name),
      spec: words(line.spec),
      partNumber: words(line.partNumber),
      // `numeric` travels as a string, exactly: 4.2 stays 4.2, not 4.2000000000000002.
      quantity: quantity === null ? null : String(quantity),
      unit: quantity === null ? null : (line.unit ?? (position?.liquid ? 'LITER' : 'PIECE')),
      costAmountMinor: line.costCurrency ? (line.costAmountMinor ?? null) : null,
      costCurrency: line.costAmountMinor !== undefined ? (line.costCurrency ?? null) : null,
      fittedAt,
      odometer: line.odometer ?? null,
      odometerUnit:
        line.odometer !== undefined ? (line.odometerUnit ?? context.odometerUnit) : null,
      warrantyUntil: line.warrantyUntil ?? null,
      notes: words(line.notes),
      createdBy: context.createdBy,
    };
  });
}
