/**
 * Reading the home screen's add line: is it a question for Ask, or something to put on a
 * vehicle's record — and which vehicle does it name? Pure, so it is tested on its own.
 */

import type { Vehicle } from '@vehicle-os/contracts';
import { parsePlanned } from './quick-entry';

/** What a line reads as: a question for Ask, or something to put on a vehicle's record. */
export type Intent =
  | { kind: 'empty' }
  | { kind: 'ask'; question: string; vehicle: Vehicle | null }
  | { kind: 'log'; line: string; vehicle: Vehicle | null; planned: boolean };

const QUESTION =
  /^(what|what's|whats|how|when|where|which|who|why|is|are|was|were|do|does|did|can|could|should|will|would|has|have|show|tell|list|compare|explain)\b/i;
const REMIND = /^(remind\s+me\s+(to\s+)?|remind\s+|plan\s+(to\s+)?|schedule\s+|to-?do:?\s+)/i;
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The vehicle a line names — by nickname, make and model, model or make, the longest that matches
 * — and the line without it. Two vehicles matching equally ("the Porsche", with two) name neither:
 * the menu asks rather than guessing.
 */
export function findVehicle(line: string, vehicles: readonly Vehicle[]) {
  let best: { vehicle: Vehicle; start: number; end: number } | null = null;
  let tied = false;
  for (const vehicle of vehicles) {
    const names = [
      vehicle.displayName,
      vehicle.nickname,
      [vehicle.make, vehicle.model].filter(Boolean).join(' '),
      vehicle.model,
      vehicle.make,
    ];
    let own: { start: number; end: number } | null = null;
    for (const name of names) {
      if (!name || name.trim().length < 2) continue;
      const match = new RegExp(`(?<![\\w-])${escape(name.trim())}(?![\\w-])`, 'i').exec(line);
      if (match && (!own || match[0].length > own.end - own.start)) {
        own = { start: match.index, end: match.index + match[0].length };
      }
    }
    if (!own) continue;
    const length = own.end - own.start;
    const bestLength = best ? best.end - best.start : 0;
    if (length > bestLength) {
      best = { vehicle, ...own };
      tied = false;
    } else if (best && length === bestLength) {
      tied = true;
    }
  }
  if (!best || tied) return { vehicle: null, rest: line };
  // The words that only joined the name to the line go with it: "…on the Porsche", "for my MX-5".
  const before = line.slice(0, best.start).replace(/(\b(the|my|our|for|on|in|to|of)\s*)+$/i, '');
  const rest = `${before} ${line.slice(best.end)}`
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;])/g, '$1')
    .replace(/^[\s,;]+|[\s,;]+$/g, '');
  return { vehicle: best.vehicle, rest };
}

export function readIntent(text: string, vehicles: readonly Vehicle[]): Intent {
  const line = text.trim();
  if (!line) return { kind: 'empty' };
  const { vehicle, rest } = findVehicle(line, vehicles);
  if (line.endsWith('?') || QUESTION.test(line)) return { kind: 'ask', question: line, vehicle };
  const said = rest.replace(REMIND, '').trim();
  const repeat = parsePlanned(said);
  return {
    kind: 'log',
    line: said,
    vehicle: vehicle ?? (vehicles.length === 1 ? vehicles[0]! : null),
    planned: REMIND.test(rest) || repeat.everyMonths !== null || repeat.everyDistance !== null,
  };
}
