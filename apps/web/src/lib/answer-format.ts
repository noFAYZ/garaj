/**
 * GarajAI's answer, read into what the console draws.
 *
 * The model writes plain text: a sentence or two, then optionally "- Label: value" lines for a
 * breakdown. This splits that into prose and lists, and marks what Garaj has its own way of
 * showing — the person's vehicles, money and distances (set as figures), and dates (in the
 * app's date format). Anything it does not recognise stays as the words the model wrote.
 */

export type Token =
  | { kind: 'text'; text: string }
  | { kind: 'figure'; text: string }
  | { kind: 'date'; text: string; iso?: string }
  | { kind: 'vehicle'; text: string; vehicleId: string };

export type Block =
  { kind: 'prose'; text: string } | { kind: 'list'; items: { label?: string; value: string }[] };

export interface NamedVehicle {
  id: string;
  /** Every name the answer might use for it: display name, nickname, make + model. */
  names: string[];
}

const NUMBER = String.raw`\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?`;
const CURRENCY = 'USD|EUR|GBP|PKR|INR|AED|SAR|QAR|CAD|AUD|NZD|JPY|CHF|SGD|ZAR|SEK|NOK|DKK';
// Longer units first: `km/L` must win over `km`, `L/100 km` over `L`.
const UNIT = String.raw`km\/L|L\/100\s?km|kilomet(?:er|re)s|miles|km|mi|litres|liters|gallons|gal|mpg|kWh|L|%`;
const MONTH = String.raw`(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?`;

const FIGURE = [
  String.raw`(?:[$€£¥₹]|Rs\.?\s?|(?:${CURRENCY})\s?)-?(?:${NUMBER})`,
  String.raw`(?:${NUMBER})\s?(?:${CURRENCY})\b`,
  String.raw`(?:${NUMBER})\s?(?:${UNIT})(?![a-z])`,
  String.raw`\b\d+\s(?:days?|weeks?|months?|years?)\b`,
].join('|');

const DATE = [
  String.raw`\b\d{4}-\d{2}-\d{2}\b`,
  String.raw`\b\d{1,2}\s${MONTH}\s\d{4}\b`,
  String.raw`\b${MONTH}\s\d{1,2}(?:st|nd|rd|th)?,?\s\d{4}\b`,
].join('|');

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function tokenize(text: string, vehicles: readonly NamedVehicle[] = []): Token[] {
  const byName = new Map<string, string>();
  for (const vehicle of vehicles) {
    for (const name of vehicle.names) {
      if (name.trim().length >= 3) byName.set(name.trim().toLowerCase(), vehicle.id);
    }
  }
  // Longest first, so "2019 Mazda MX-5" is one chip rather than a year and a "Mazda MX-5".
  const names = [...byName.keys()].sort((a, b) => b.length - a.length).map(escape);
  const vehicle = names.length > 0 ? `(?<vehicle>(?<![\\w])(?:${names.join('|')})(?![\\w]))|` : '';
  const pattern = new RegExp(`${vehicle}(?<date>${DATE})|(?<figure>${FIGURE})`, 'gi');

  const tokens: Token[] = [];
  let at = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index;
    if (start > at) tokens.push({ kind: 'text', text: text.slice(at, start) });
    const [found] = match;
    const groups = match.groups ?? {};
    if (groups.vehicle) {
      tokens.push({ kind: 'vehicle', text: found, vehicleId: byName.get(found.toLowerCase())! });
    } else if (groups.date) {
      tokens.push({
        kind: 'date',
        text: found,
        iso: /^\d{4}-\d{2}-\d{2}$/.test(found) ? found : undefined,
      });
    } else {
      tokens.push({ kind: 'figure', text: found });
    }
    at = start + found.length;
  }
  if (at < text.length) tokens.push({ kind: 'text', text: text.slice(at) });
  return tokens;
}

/** Prose and "- Label: value" lists. Stray markdown emphasis and headings are dropped, not shown. */
export function toBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  let joinable = false;
  for (const raw of text.split('\n')) {
    const line = raw
      .replace(/\*\*|__/g, '')
      .replace(/^\s*#+\s*/, '')
      .trim();
    const item = /^(?:[-*•]|\d+[.)])\s+(.+)$/.exec(line);
    const last = blocks.at(-1);
    if (item) {
      const body = item[1]!;
      const pair = /^([^:]{1,48}):\s+(.+)$/.exec(body);
      const entry = pair ? { label: tidy(pair[1]!), value: pair[2]! } : { value: body };
      if (last?.kind === 'list') last.items.push(entry);
      else blocks.push({ kind: 'list', items: [entry] });
      joinable = false;
    } else if (line) {
      if (joinable && last?.kind === 'prose') last.text += ` ${line}`;
      else blocks.push({ kind: 'prose', text: line });
      joinable = true;
    } else {
      joinable = false;
    }
  }
  return blocks;
}

/** A label as the app would set it: "INSURANCE" or "insurance" both become "Insurance". */
function tidy(label: string): string {
  const shouted = /^[A-Z0-9_ ]+$/.test(label) && /[A-Z]{2}/.test(label);
  const words = shouted ? label.toLowerCase().replace(/_/g, ' ') : label;
  return words.charAt(0).toUpperCase() + words.slice(1);
}
