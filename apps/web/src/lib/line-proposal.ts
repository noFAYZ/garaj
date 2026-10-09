/**
 * A line read without the model, as the proposal the model would have made.
 *
 * For when GarajAI cannot be reached, or answering is switched off: the home screen's own
 * reading (`quick-entry`) still turns "Filled up 40 L, €62.40 at Shell" into an entry, and it
 * lands in the same approve card the model's proposals do. Pure, so it is tested on its own.
 */

import type { AiProposal } from '@vehicle-os/contracts';
import { parseDone, parsePlanned } from './quick-entry';

const UNITS: Record<string, string> = { l: 'L', gal: 'GAL', kwh: 'KWH' };

export function proposalFromLine(
  said: string,
  planned: boolean,
  vehicleId: string | null,
  options: { today?: Date; lastReading?: number | null } = {},
): AiProposal {
  if (planned) {
    const parsed = parsePlanned(said, options);
    return {
      action: 'plan',
      summary: '',
      fields: {
        vehicle_id: vehicleId,
        title: parsed.title,
        due_date: parsed.due,
        every_months: parsed.everyMonths,
        every_distance: parsed.everyDistance,
      },
    };
  }

  const parsed = parseDone(said, options);
  // "40 L" → 40 and L; a quantity in a unit the form does not know stays in the title's line.
  const [, amount, unit] = /^([\d.,]+)\s*([a-z]+)/i.exec(parsed.quantity ?? '') ?? [];
  return {
    action: 'log_entry',
    summary: '',
    fields: {
      vehicle_id: vehicleId,
      kind: parsed.kind ?? 'MAINTENANCE',
      title: parsed.title,
      date: parsed.day,
      amount: parsed.amount,
      currency: parsed.currency,
      odometer: parsed.odometer,
      place: parsed.place,
      ...(amount && unit && UNITS[unit.toLowerCase()]
        ? { quantity: amount, quantity_unit: UNITS[unit.toLowerCase()] }
        : {}),
    },
  };
}
