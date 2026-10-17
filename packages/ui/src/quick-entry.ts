/**
 * Reading an entry from one line, the way a person would say it.
 *
 * "Filled up 40 L, €62.40 at Shell, 52,900 km yesterday" is a fill-up of forty litres, its cost,
 * where, the odometer and the day — five fields nobody has to find. "Rotate tyres every 10,000 km"
 * is a schedule; "Renew insurance on 11 Nov" a one-off with a date. What is recognised is cut out
 * of the title and returned with where it sat in the line, so the input can show what it read.
 *
 * Pure and forgiving: whatever is not recognised stays in the title, and nothing here decides for
 * the person — the form shows every value it took, and any field set by hand wins.
 */

/**
 * The kinds a line can name: the domain's event types this reader knows words for. Typed here
 * rather than imported, as the rest of this package is, and a subset, so it fits an `EventType`.
 */
export type SaidKind =
  | 'FUEL'
  | 'CHARGE'
  | 'MAINTENANCE'
  | 'REPAIR'
  | 'CLEANING'
  | 'INSPECTION'
  | 'INSURANCE'
  | 'REGISTRATION'
  | 'EXPENSE'
  | 'TRIP'
  | 'MODIFICATION'
  | 'ACCIDENT'
  | 'PURCHASE'
  | 'SALE'
  | 'NOTE';

export type TokenKind = 'kind' | 'money' | 'odometer' | 'quantity' | 'date' | 'place' | 'interval';

export interface Token {
  kind: TokenKind;
  start: number;
  end: number;
}

export interface ParsedDone {
  /** What is left once every figure, date and place is taken out; '' when nothing is. */
  title: string;
  kind: SaidKind | null;
  /** In the currency's major unit, as typed: "62.40". */
  amount: string | null;
  /**
   * The currency the amount was written in — "EUR" for "€62", "GBP" for "£40" — or `$` for a
   * dollar sign, which the caller resolves (a Canadian's "$" is not a US dollar). Null when bare.
   */
  currency: string | null;
  odometer: number | null;
  /** `YYYY-MM-DD`, in the person's own zone. */
  day: string | null;
  place: string | null;
  /** A measured quantity — "40 L", "32 kWh" — kept in the note, as the phone's quick entry does. */
  quantity: string | null;
  tokens: Token[];
}

export interface ParsedPlanned {
  title: string;
  everyMonths: number | null;
  everyDistance: number | null;
  /** `YYYY-MM-DD`, today or later. */
  due: string | null;
  tokens: Token[];
}

const NUMBER = String.raw`\d{1,3}(?:,\d{3})+|\d+`;
const num = (text: string) => Number(text.replace(/,/g, ''));

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH = String.raw`(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?`;
const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const WEEKDAY_FULL = String.raw`(sunday|monday|tuesday|wednesday|thursday|friday|saturday)`;
const WEEKDAY_SHORT = String.raw`(sun|mon|tues?|wed|thu(?:rs?)?|fri|sat)`;

const dayString = (date: Date) => date.toLocaleDateString('en-CA');
const startOf = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const plus = (today: Date, days: number, months = 0) =>
  new Date(today.getFullYear(), today.getMonth() + months, today.getDate() + days);

/**
 * The words that say what kind of entry it is, by kind. Whole words only, the first one in the
 * line wins, and they stay in the title — "Oil and filter change" is still called that.
 */
const KIND_WORDS: readonly [SaidKind, readonly string[]][] = [
  [
    'FUEL',
    [
      'fuel',
      'fuelled',
      'fueled',
      'refuel',
      'refuelled',
      'fill',
      'filled',
      'fill-up',
      'fillup',
      'petrol',
      'diesel',
      'gas',
      'tank',
    ],
  ],
  ['CHARGE', ['charge', 'charged', 'charging', 'supercharger', 'supercharged']],
  ['MAINTENANCE', ['service', 'serviced', 'servicing', 'oil', 'maintenance', 'tune-up', 'coolant']],
  ['REPAIR', ['repair', 'repaired', 'fix', 'fixed', 'replaced', 'replace', 'puncture', 'broken']],
  [
    'CLEANING',
    ['wash', 'washed', 'valet', 'valeted', 'clean', 'cleaned', 'detail', 'detailed', 'detailing'],
  ],
  ['INSPECTION', ['inspection', 'inspected', 'mot', 'nct', 'smog']],
  ['INSURANCE', ['insurance', 'insured']],
  ['REGISTRATION', ['registration', 'rego', 'tax', 'licence', 'license']],
  ['EXPENSE', ['parking', 'toll', 'tolls', 'fine', 'ticket', 'expense']],
  ['TRIP', ['trip', 'drove', 'commute', 'journey']],
  ['MODIFICATION', ['upgrade', 'upgraded', 'fitted', 'installed', 'modified']],
  ['ACCIDENT', ['accident', 'crash', 'crashed', 'collision']],
  ['PURCHASE', ['bought', 'purchased']],
  ['SALE', ['sold']],
  ['NOTE', ['note']],
];

const KIND_OF = new Map(
  KIND_WORDS.flatMap(([kind, words]) => words.map((w) => [w, kind] as const)),
);
const KIND_RE = new RegExp(
  String.raw`(?<![\w-])(${[...KIND_OF.keys()].map((w) => w.replace('-', '\\-')).join('|')})(?![\w-])`,
  'gi',
);

interface Rule<T> {
  kind: TokenKind;
  re: RegExp;
  read: (match: RegExpExecArray) => T | null;
}

/**
 * Every rule over the line, in order: a match is taken only where nothing taken earlier sits, so
 * a rule's place in the list is its priority — "€1,240" is money before it can be a reading.
 */
function scan<T>(line: string, rules: readonly Rule<T>[]) {
  const taken: (Token & { value: T })[] = [];
  for (const rule of rules) {
    rule.re.lastIndex = 0;
    for (let match = rule.re.exec(line); match; match = rule.re.exec(line)) {
      const start = match.index;
      const end = start + match[0].length;
      if (taken.some((token) => start < token.end && end > token.start)) continue;
      const value = rule.read(match);
      if (value !== null) taken.push({ kind: rule.kind, start, end, value });
    }
  }
  return taken.sort((a, b) => a.start - b.start);
}

/**
 * "at Shell", "@ Kwik Fit": the words after it, up to a comma or the next thing recognised. After
 * "at" only a name counts — a capital — so "a rattle at idle" and "charged at home" stay words.
 */
function findPlace(line: string, taken: readonly Token[]): (Token & { value: string }) | null {
  const re = /(?:^|\s)(at|@)\s*/gi;
  for (let match = re.exec(line); match; match = re.exec(line)) {
    const start = match.index + match[0].indexOf(match[1]!);
    const from = match.index + match[0].length;
    if (taken.some((token) => start >= token.start && start < token.end)) continue;
    const stop = Math.min(
      ...[line.slice(from).search(/[,;]/), line.length - from]
        .filter((at) => at >= 0)
        .map((at) => from + at),
      ...taken.filter((token) => token.start >= from).map((token) => token.start),
    );
    const words = line.slice(from, stop).replace(/\s+(for|on|in|by|and)\s*$/i, '');
    const value = words.trim();
    if (!(match[1] === '@' ? /^[a-z]/i : /^[A-Z]/).test(value)) continue;
    return { kind: 'place', start, end: from + words.trimEnd().length, value };
  }
  return null;
}

/**
 * The line less what was recognised. A word that only joined a figure to the rest — "for €40",
 * "on Monday" — goes with it; commas left with nothing between them close up.
 */
function remainder(line: string, removed: readonly Token[]): string {
  let text = line;
  for (const token of [...removed].sort((a, b) => b.start - a.start)) {
    const before = text.slice(0, token.start).replace(/\b(for|on|by|from|or|and)\s*$/i, '');
    text = `${before} ${text.slice(token.end)}`;
  }
  const title = text
    .split(/[,;]/)
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(', ')
    .replace(/\s+(for|on|at|by|from|or|and|-|–|·)$/i, '')
    .replace(/^(for|on|at|by|or|and|-|–|·)\s+/i, '')
    .trim();
  return title ? title.charAt(0).toUpperCase() + title.slice(1) : '';
}

/** A month and day, this year — or the year before or after, whichever keeps it on the right side of today. */
function calendarDay(
  today: Date,
  month: string,
  day: string,
  year: string | undefined,
  side: 'past' | 'future',
): string | null {
  const m = MONTHS.indexOf(month.slice(0, 3).toLowerCase());
  const d = Number(day);
  if (m < 0 || d < 1 || d > 31) return null;
  let date = new Date(year ? Number(year) : today.getFullYear(), m, d);
  if (!year && side === 'past' && date > today) date = new Date(date.getFullYear() - 1, m, d);
  if (!year && side === 'future' && date < today) date = new Date(date.getFullYear() + 1, m, d);
  return dayString(date);
}

function weekday(today: Date, name: string, side: 'past' | 'future', strict: boolean): string {
  const target = WEEKDAYS.indexOf(name.slice(0, 3).toLowerCase());
  const now = today.getDay();
  if (side === 'past') {
    const back = (now - target + 7) % 7 || (strict ? 7 : 0);
    return dayString(plus(today, -back));
  }
  const ahead = (target - now + 7) % 7 || 7;
  return dayString(plus(today, ahead));
}

const AMOUNT = (whole: string, cents?: string) =>
  `${num(whole)}${cents ? `.${cents.padEnd(2, '0')}` : ''}`;

/** The currency a symbol or word names; `$` stays `$`, since which dollar is the caller's to say. */
function currencyOf(mark: string | undefined): string | null {
  const m = mark?.toLowerCase();
  if (!m) return null;
  if (m === '€' || m.startsWith('eur')) return 'EUR';
  if (m === '£' || m === 'gbp' || m.startsWith('pound')) return 'GBP';
  if (m === '¥') return 'JPY';
  if (m === 'usd') return 'USD';
  if (m === '$' || m.startsWith('dollar') || m === 'bucks') return '$';
  return null;
}

export function parseDone(
  line: string,
  { today = new Date(), lastReading = null }: { today?: Date; lastReading?: number | null } = {},
): ParsedDone {
  const day0 = startOf(today);
  type Money = { amount: string; currency: string | null };
  type Value = string | number | Money | { quantity: string; implies: SaidKind };
  const rules: Rule<Value>[] = [
    {
      kind: 'money',
      re: new RegExp(String.raw`([€$£¥])\s?(${NUMBER})(?:\.(\d{1,2}))?`, 'g'),
      read: (m) => ({ amount: AMOUNT(m[2]!, m[3]), currency: currencyOf(m[1]) }),
    },
    {
      kind: 'money',
      re: new RegExp(
        String.raw`(${NUMBER})(?:\.(\d{1,2}))?\s?(€|£|\$|eur|euros?|usd|gbp|dollars?|pounds?|bucks)(?![a-z])`,
        'gi',
      ),
      read: (m) => ({ amount: AMOUNT(m[1]!, m[2]), currency: currencyOf(m[3]) }),
    },
    {
      kind: 'quantity',
      re: /(\d+(?:[.,]\d+)?)\s?(l|ltrs?|litres?|liters?|gal|gallons?|kwh)(?![a-z])/gi,
      read: (m) => {
        const unit = m[2]!.toLowerCase();
        const amount = m[1]!.replace(',', '.');
        if (unit === 'kwh') return { quantity: `${amount} kWh`, implies: 'CHARGE' };
        if (unit.startsWith('gal')) return { quantity: `${amount} gal`, implies: 'FUEL' };
        return { quantity: `${amount} L`, implies: 'FUEL' };
      },
    },
    {
      kind: 'odometer',
      re: new RegExp(String.raw`\+\s?(${NUMBER})\s?(?:km|kms|mi|miles?)?(?![a-z])`, 'gi'),
      read: (m) => (lastReading === null ? null : lastReading + num(m[1]!)),
    },
    {
      kind: 'odometer',
      re: new RegExp(String.raw`(?<![\d.,+])(${NUMBER})\s?(?:km|kms|mi|miles?)(?![a-z])`, 'gi'),
      read: (m) => num(m[1]!),
    },
    {
      kind: 'date',
      re: /\b(today|tonight|this (?:morning|afternoon|evening))\b/gi,
      read: () => dayString(day0),
    },
    { kind: 'date', re: /\byesterday\b/gi, read: () => dayString(plus(day0, -1)) },
    {
      kind: 'date',
      re: /\b(\d+)\s+(days?|weeks?)\s+ago\b/gi,
      read: (m) =>
        dayString(plus(day0, -Number(m[1]) * (m[2]!.toLowerCase().startsWith('week') ? 7 : 1))),
    },
    {
      kind: 'date',
      re: new RegExp(String.raw`\b(last\s+)?${WEEKDAY_FULL}\b`, 'gi'),
      read: (m) => weekday(day0, m[2]!, 'past', Boolean(m[1])),
    },
    {
      kind: 'date',
      re: new RegExp(String.raw`\b(last|on)\s+${WEEKDAY_SHORT}\b`, 'gi'),
      read: (m) => weekday(day0, m[2]!, 'past', m[1]!.toLowerCase() === 'last'),
    },
    {
      kind: 'date',
      re: new RegExp(
        String.raw`\b(\d{1,2})(?:st|nd|rd|th)?\s+${MONTH}(?:\s+(\d{4}))?(?![a-z])`,
        'gi',
      ),
      read: (m) => calendarDay(day0, m[2]!, m[1]!, m[3], 'past'),
    },
    {
      kind: 'date',
      re: new RegExp(String.raw`\b${MONTH}\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b`, 'gi'),
      read: (m) => calendarDay(day0, m[1]!, m[2]!, m[3], 'past'),
    },
    {
      kind: 'date',
      re: /\b(\d{4})-(\d{2})-(\d{2})\b/g,
      read: (m) => `${m[1]}-${m[2]}-${m[3]}`,
    },
    // A price with its cents and no symbol: "62.40".
    {
      kind: 'money',
      re: /(?<![\d,.])(\d+)\.(\d{2})(?![\d.])/g,
      read: (m) => ({ amount: AMOUNT(m[1]!, m[2]), currency: null }),
    },
    // A bare reading: four figures or more, or grouped — "52,900", "52900".
    {
      kind: 'odometer',
      re: /(?<![\d.,€$£¥+])(\d{1,3}(?:,\d{3})+|\d{4,7})(?![\d,]|\.\d|\s?%)/g,
      read: (m) => num(m[1]!),
    },
  ];

  const taken = scan(line, rules);
  const place = findPlace(line, taken);
  const kinds = scan(line, [
    { kind: 'kind' as const, re: KIND_RE, read: (m) => KIND_OF.get(m[1]!.toLowerCase()) ?? null },
  ]).filter(
    (token) =>
      ![...taken, ...(place ? [place] : [])].some(
        (t) => token.start < t.end && token.end > t.start,
      ),
  );

  const first = <K extends TokenKind>(kind: K) => taken.find((token) => token.kind === kind);
  const quantity = first('quantity')?.value as { quantity: string; implies: SaidKind } | undefined;

  return {
    title: remainder(line, [...taken, ...(place ? [place] : [])]),
    kind: (kinds[0]?.value as SaidKind | undefined) ?? quantity?.implies ?? null,
    amount: (first('money')?.value as Money | undefined)?.amount ?? null,
    currency: (first('money')?.value as Money | undefined)?.currency ?? null,
    odometer: (first('odometer')?.value as number | undefined) ?? null,
    day: (first('date')?.value as string | undefined) ?? null,
    place: place?.value ?? null,
    quantity: quantity?.quantity ?? null,
    tokens: [...taken, ...(place ? [place] : []), ...kinds]
      .map(({ kind, start, end }) => ({ kind, start, end }))
      .sort((a, b) => a.start - b.start),
  };
}

export function parsePlanned(
  line: string,
  { today = new Date() }: { today?: Date } = {},
): ParsedPlanned {
  const day0 = startOf(today);
  type Value = { months?: number; distance?: number; due?: string };
  const months = (count: number, unit: string): Value => ({
    months: unit.toLowerCase().startsWith('y') ? count * 12 : count,
  });
  const distance = (figure: string, thousands: string | undefined): Value => ({
    distance: num(figure) * (thousands ? 1000 : 1),
  });
  const rules: Rule<Value>[] = [
    {
      kind: 'interval',
      re: new RegExp(
        String.raw`\b(?:every|or)\s+(${NUMBER})\s*(k)?\s*(?:km|kms|mi|miles?)(?![a-z])`,
        'gi',
      ),
      read: (m) => distance(m[1]!, m[2]),
    },
    {
      kind: 'interval',
      re: /\b(?:every|or)\s+(\d+)\s*(months?|mos?|years?|yrs?)\b/gi,
      read: (m) => months(Number(m[1]), m[2]!),
    },
    {
      kind: 'interval',
      re: /\bevery\s+(\d+)k\b/gi,
      read: (m) => distance(m[1]!, 'k'),
    },
    {
      kind: 'interval',
      re: /\b(?:every|each)\s+(month|year)\b/gi,
      read: (m) => months(1, m[1]!),
    },
    {
      kind: 'interval',
      re: /\b(monthly|yearly|annually|annual)\b/gi,
      read: (m) => months(1, m[1]!.toLowerCase() === 'monthly' ? 'month' : 'year'),
    },
    { kind: 'date', re: /\btoday\b/gi, read: () => ({ due: dayString(day0) }) },
    { kind: 'date', re: /\btomorrow\b/gi, read: () => ({ due: dayString(plus(day0, 1)) }) },
    {
      kind: 'date',
      re: /\bnext\s+(week|month|year)\b/gi,
      read: (m) => {
        const unit = m[1]!.toLowerCase();
        return {
          due: dayString(
            unit === 'week' ? plus(day0, 7) : plus(day0, 0, unit === 'month' ? 1 : 12),
          ),
        };
      },
    },
    {
      kind: 'date',
      re: /\bin\s+(\d+|a|an|one|two|three|six)\s+(days?|weeks?|months?|years?)\b/gi,
      read: (m) => {
        const words: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, six: 6 };
        const count = words[m[1]!.toLowerCase()] ?? Number(m[1]);
        const unit = m[2]!.toLowerCase();
        if (unit.startsWith('day')) return { due: dayString(plus(day0, count)) };
        if (unit.startsWith('week')) return { due: dayString(plus(day0, count * 7)) };
        return { due: dayString(plus(day0, 0, unit.startsWith('month') ? count : count * 12)) };
      },
    },
    {
      kind: 'date',
      re: new RegExp(String.raw`\b(?:on\s+|next\s+|by\s+)?${WEEKDAY_FULL}\b`, 'gi'),
      read: (m) => ({ due: weekday(day0, m[1]!, 'future', true) }),
    },
    {
      kind: 'date',
      re: new RegExp(
        String.raw`\b(\d{1,2})(?:st|nd|rd|th)?\s+${MONTH}(?:\s+(\d{4}))?(?![a-z])`,
        'gi',
      ),
      read: (m) => {
        const due = calendarDay(day0, m[2]!, m[1]!, m[3], 'future');
        return due ? { due } : null;
      },
    },
    {
      kind: 'date',
      re: new RegExp(String.raw`\b${MONTH}\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b`, 'gi'),
      read: (m) => {
        const due = calendarDay(day0, m[1]!, m[2]!, m[3], 'future');
        return due ? { due } : null;
      },
    },
    { kind: 'date', re: /\b(\d{4})-(\d{2})-(\d{2})\b/g, read: (m) => ({ due: m[0] }) },
  ];

  const taken = scan(line, rules);
  const pick = <K extends keyof Value>(key: K) =>
    taken.find((token) => token.value[key] !== undefined)?.value[key] ?? null;

  return {
    title: remainder(line, taken),
    everyMonths: pick('months') as number | null,
    everyDistance: pick('distance') as number | null,
    due: pick('due') as string | null,
    tokens: taken.map(({ kind, start, end }) => ({ kind, start, end })),
  };
}

const QUANTITY = /^\s*(\d[\d.,]*\s?(?:l|kwh|gal))\b[\s,;·—-]*/i;

/**
 * A fill's quantity from the front of its note — where `parseDone` puts it — and what is left of
 * the note after it, so the logbook can show the quantity as a fact.
 */
export function fillQuantity(eventType: string, note: string | null) {
  const match = eventType === 'FUEL' || eventType === 'CHARGE' ? QUANTITY.exec(note ?? '') : null;
  return match
    ? { quantity: match[1]!.replace(/kwh$/i, 'kWh'), rest: note!.slice(match[0].length).trim() }
    : { quantity: null, rest: note?.trim() ?? '' };
}
