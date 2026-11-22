/**
 * Reading a photo into a quick entry: a fuel receipt, a workshop's invoice, a dashboard.
 *
 * `draftVehicle`'s twin. One model turn with one tool it must call — the answer is the call — and
 * what comes back is held to the event contract's bounds here, so the form is only ever filled
 * with values the API would accept. Nothing is written: the person checks the draft and saves.
 */

import type { AiAttachment, EntryDraft, EntryDraftKind } from '@vehicle-os/contracts';
import { PARTS_PER_ENTRY } from '@vehicle-os/contracts';
import { PART_POSITION_KEYS, PART_POSITIONS, type PartPosition } from '@vehicle-os/domain';
import type { AiProviderPort, AiToolSpec } from '../../infrastructure/ai-port';

export const FILL_ENTRY: AiToolSpec = {
  name: 'fill_entry',
  description: 'Fill the quick entry with what the photo shows. Leave out what it does not.',
  parameters: {
    type: 'object',
    properties: {
      total: {
        type: 'number',
        description: 'The total paid, in major units as printed: "1,234.50" is 1234.5.',
      },
      currency: { type: 'string', description: 'ISO 4217 code of the total: USD, EUR, PKR, GBP.' },
      litres: {
        type: 'number',
        description: 'Fuel bought, in litres. Gallons converted: 1 US gallon is 3.785 L.',
      },
      vendor: {
        type: 'string',
        description: 'The station or workshop, as printed, branch kept: "Shell Gulberg".',
      },
      date: { type: 'string', description: 'YYYY-MM-DD of the purchase or the work.' },
      odometer: {
        type: 'integer',
        description: 'The odometer reading, whole units: the total distance, not a trip meter.',
      },
      work: {
        type: 'string',
        description: 'What was done or bought, in a few words: "Oil and filter change".',
      },
      parts: {
        type: 'array',
        description:
          'Each part or fluid that went into the vehicle, one per item printed. Never labour, ' +
          'fees, tax, or a consumable that was not fitted (wipes, gloves).',
        items: {
          type: 'object',
          properties: {
            position: {
              type: 'string',
              enum: [...PART_POSITION_KEYS],
              // The model reads names, not keys: each key is said with what it holds.
              description:
                'Where it went: ' +
                PART_POSITION_KEYS.map((key) => `${key} = ${PART_POSITIONS[key].label}`).join(
                  ', ',
                ) +
                '. A pair of tyres or pads whose end is not printed: the front.',
            },
            brand: { type: 'string', description: 'The maker: "Castrol", "Bosch", "Michelin".' },
            product: {
              type: 'string',
              description: 'The product line, without brand or grade: "Edge", "Pilot Sport 4".',
            },
            grade: {
              type: 'string',
              description:
                'Grade, size or standard as printed: "5W-30", "225/45 R17 94W", "DOT 4".',
            },
            part_number: { type: 'string', description: 'The maker’s part number, as printed.' },
            quantity: {
              type: 'number',
              description: 'How many or how much: 4.2 for litres of oil, 2 for a pair of tyres.',
            },
            unit: {
              type: 'string',
              enum: ['L', 'QT', 'PIECE'],
              description: 'L for litres, QT for quarts, PIECE for a count.',
            },
          },
          required: ['position'],
        },
      },
    },
  },
};

/** What each kind of entry reads off its photo, said to the model in its own terms. */
const BRIEF: Record<EntryDraftKind, string> = {
  fuel:
    'The photo is a fuel or charging receipt. Read the total paid, the litres of fuel (none for ' +
    'an electric charge), the station and the date.',
  service:
    'The photo is a workshop invoice or receipt for work on a vehicle, or the label or packaging ' +
    'of a part or fluid that went into one (an oil bottle, a tyre sidewall, a battery). Read the ' +
    'total paid, the workshop, the date, the odometer if the invoice records it, what was done, ' +
    'and each part or fluid fitted.',
  odometer:
    'The photo is a vehicle dashboard or an odometer. Read the odometer: the total distance on ' +
    'the instrument cluster, never the trip meter, the range or the outside temperature.',
};

/** The fields each kind of entry has; anything else the model reads is not the form's. */
const FIELDS: Record<EntryDraftKind, readonly (keyof EntryDraft)[]> = {
  fuel: ['amount', 'currency', 'litres', 'provider', 'date', 'odometer'],
  service: ['amount', 'currency', 'provider', 'date', 'odometer', 'note', 'parts'],
  odometer: ['odometer', 'date'],
};

const system = (input: { kind: EntryDraftKind; currency?: string; unit?: string; today: string }) =>
  [
    'You read a photo into a quick entry of a garage app. Call fill_entry once.',
    BRIEF[input.kind],
    '- Copy figures exactly as printed; never add up lines yourself or invent a value.',
    // The vehicle's currency settles only a bare symbol it shares; it never overrides the print.
    '- The currency is the one the receipt shows, by code, symbol or place: "Rs" in Lahore is ' +
      'PKR, "€" is EUR.' +
      (input.currency
        ? ` Only a bare symbol that ${input.currency} also uses (as "$" for USD) is ` +
          `${input.currency}; with no currency shown at all, leave it out.`
        : ' With no currency shown, leave it out.'),
    input.unit ? `- Its odometer reads in ${input.unit}.` : '',
    `- Today is ${input.today}; the date is on or before it. Read 03/04 the way that holds.`,
    '- Leave a field out rather than guess. A photo that is not what was asked for fills nothing.',
  ]
    .filter(Boolean)
    .join('\n');

export async function draftEntry(
  provider: AiProviderPort,
  input: {
    kind: EntryDraftKind;
    currency?: string;
    unit?: string;
    attachments: readonly AiAttachment[];
    today: string;
  },
): Promise<EntryDraft> {
  const turn = await provider.generate({
    system: system(input),
    messages: [{ role: 'user', text: 'Read this into the entry.', attachments: input.attachments }],
    tools: [FILL_ENTRY],
    force: FILL_ENTRY.name,
  });
  const call = turn.calls.find((candidate) => candidate.name === FILL_ENTRY.name);
  return readEntryDraft(call?.args ?? {}, input.kind, input.today);
}

const text = (value: unknown, max: number) =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined;

const number = (value: unknown) => {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = typeof value === 'number' ? value : Number(String(value).replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : undefined;
};

/** A positive figure inside `max`, to `places` decimals; anything else is not one. */
const amount = (value: unknown, max: number, places: number) => {
  const parsed = number(value);
  if (parsed === undefined || parsed <= 0 || parsed > max) return undefined;
  const scale = 10 ** places;
  return Math.round(parsed * scale) / scale;
};

const isDay = (value: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  new Date(`${value}T00:00:00Z`).toISOString().startsWith(value);

const UNIT = { L: 'LITER', QT: 'QUART', PIECE: 'PIECE' } as const;

/**
 * The parts the model read, held to the line contract: a position it made up drops the item, as
 * does one that names nothing — an item with no maker, product, grade or number is not a part
 * anyone can buy again.
 */
function readParts(value: unknown): EntryDraft['parts'] {
  if (!Array.isArray(value)) return undefined;
  const parts = value.slice(0, PARTS_PER_ENTRY).flatMap((item: unknown) => {
    if (!item || typeof item !== 'object') return [];
    const read = item as Record<string, unknown>;
    const position = String(read.position ?? '');
    if (!(PART_POSITION_KEYS as readonly string[]).includes(position)) return [];
    const unit = UNIT[String(read.unit ?? '').toUpperCase() as keyof typeof UNIT];
    const line = {
      position: position as PartPosition,
      brand: text(read.brand, 80),
      name: text(read.product, 120),
      spec: text(read.grade, 80),
      partNumber: text(read.part_number, 80),
      quantity: amount(read.quantity, 10_000, 3),
    };
    if (!line.brand && !line.name && !line.spec && !line.partNumber) return [];
    return [
      Object.fromEntries(
        Object.entries({ ...line, unit: line.quantity === undefined ? undefined : unit }).filter(
          ([, field]) => field !== undefined,
        ),
      ) as NonNullable<EntryDraft['parts']>[number],
    ];
  });
  return parts.length > 0 ? parts : undefined;
}

/**
 * The model's arguments, held to the event contract: a value out of bounds, of the wrong kind or
 * not the asking form's is dropped, not clamped — a field left empty is honest, a corrected guess
 * is not. A day after `today` is a misread, so it goes too.
 */
export function readEntryDraft(
  args: Record<string, unknown>,
  kind: EntryDraftKind,
  today: string,
): EntryDraft {
  const currency = String(args.currency ?? '')
    .trim()
    .toUpperCase();
  const day = text(args.date, 10);
  const odometer = number(args.odometer);
  const read: EntryDraft = {
    amount: amount(args.total, 10_000_000, 2),
    currency: /^[A-Z]{3}$/.test(currency) ? currency : undefined,
    litres: amount(args.litres, 5_000, 2),
    provider: text(args.vendor, 200),
    date: day && isDay(day) && day <= today ? day : undefined,
    odometer:
      odometer !== undefined && odometer >= 0 && odometer <= 100_000_000
        ? Math.round(odometer)
        : undefined,
    note: text(args.work, 200),
    parts: readParts(args.parts),
  };
  // Absent rather than `undefined`, so the response says only what was read.
  return Object.fromEntries(
    FIELDS[kind].flatMap((field) => (read[field] === undefined ? [] : [[field, read[field]]])),
  ) as EntryDraft;
}
