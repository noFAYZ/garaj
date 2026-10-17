/**
 * Generates `src/components/emoji.tsx` (and the phone's `lib/emoji-art.ts`) from Microsoft's
 * Fluent Emoji, the "Color" style, fetched through the Iconify API.
 *
 * Activity entries are a list of very different things — a fill-up, a repair, an insurance
 * payment, a note — and a line-art set draws most of them with the same spanner. Fluent's
 * artwork is recognisable at 20px and different from entry to entry, which is the whole job, and
 * its soft gradients and inner shading look finished rather than flat.
 *
 * Inlined rather than fetched: the same reasoning as the icon set. A CDN image per row is a
 * request per row and a flash of nothing while it loads, and the runtime library parses text to
 * find emoji, which is a lot of machinery for a fixed list of twenty.
 *
 *   pnpm --filter @vehicle-os/web emoji
 *
 * Adding one means adding a name below and re-running it. Needs network access; it writes nothing
 * unless every emoji downloads.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const target = resolve(here, '../src/components/emoji.tsx');
/** The phone app draws the same artwork, keyed by the character its entries already carry. */
const mobileTarget = resolve(here, '../../mobile/lib/emoji-art.ts');

// ponytail: the Iconify API is not versioned (the pinned npm set is a 100 MB JSON). The output is
// committed, so a redraw upstream only lands when this is re-run, and shows in the diff.
const API = 'https://api.iconify.design/fluent-emoji.json';

/**
 * The vocabulary, as `localName: [emoji, Fluent name]` — Fluent's name is the emoji's CLDR name,
 * lower-case and hyphenated.
 *
 * Every one of these is mapped from a real value — an event type, or a word in a schedule's title.
 * Nothing here is decoration for its own sake.
 */
const EMOJI = {
  // Event types
  maintenance: ['🧰', 'toolbox'],
  repair: ['🛠️', 'hammer-and-wrench'],
  fuel: ['⛽', 'fuel-pump'],
  charge: ['🔌', 'electric-plug'],
  purchase: ['🧾', 'receipt'],
  inspection: ['🔍', 'magnifying-glass-tilted-left'],
  modification: ['⚙️', 'gear'],
  cleaning: ['🧼', 'soap'],
  registration: ['📋', 'clipboard'],
  insurance: ['🛡️', 'shield'],
  trip: ['🗺️', 'world-map'],
  accident: ['💥', 'collision'],
  note: ['📝', 'memo'],
  expense: ['💸', 'money-with-wings'],
  // Parts and jobs, matched from a schedule's title
  oil: ['🛢️', 'oil-drum'],
  tyre: ['🛞', 'wheel'],
  brake: ['🛑', 'stop-sign'],
  chain: ['⛓️', 'chains'],
  battery: ['🔋', 'battery'],
  filter: ['🌬️', 'wind-face'],
  coolant: ['❄️', 'snowflake'],
  spark: ['⚡', 'high-voltage'],
  calendar: ['🗓️', 'spiral-calendar'],
  // The home screen's add menu: four unlike things to add, one glyph each.
  garage: ['🏠', 'house'],
  vehicle: ['🚗', 'automobile'],
  logbook: ['📒', 'ledger'],
  sparkles: ['✨', 'sparkles'],
  // The phone's vehicle form keeps the spanner for its catch-all type.
  wrench: ['🔧', 'wrench'],
};

const response = await fetch(`${API}?icons=${Object.values(EMOJI).map(([, name]) => name).join(',')}`);
if (!response.ok) throw new Error(`Iconify answered ${response.status}`);
const set = await response.json();
if (set.not_found?.length) throw new Error(`No Fluent emoji named ${set.not_found.join(', ')}`);

/**
 * Every icon's ids get its own prefix: the web inlines many of these into one document, where two
 * icons' gradients sharing an id would paint each other.
 */
const scopeIds = (body, key) =>
  body.replace(/\b(id="|url\(#|href="#)([\w-]+)/g, (_, lead, id) => `${lead}${key}-${id}`);

/**
 * The phone gets no SVG filters at all. react-native-svg 15 cannot draw Fluent's inner shadows (no
 * `feComposite`: the shadow spills outside its shape as a halo), its Android renderer crashes the
 * app on Fluent's `feBlend`, which has no `mode`, and it runs filters per pixel on the CPU, in a long
 * list. So inner-shadowed shapes are kept plain and the soft glows, which are only blurred
 * highlights, are dropped. At 20pt the difference from the web's art is hard to see.
 */
function withoutFilters(body) {
  const glows = new Set();
  return body
    .replace(/<filter id="([^"]+)"[\s\S]*?<\/filter>/g, (filter, id) => {
      if (!filter.includes('feComposite')) glows.add(id);
      return '';
    })
    .replace(/<g filter="url\(#([^)]+)\)">[\s\S]*?<\/g>/g, (group, id) => (glows.has(id) ? '' : group))
    .replace(/ filter="url\(#[^)]+\)"/g, '');
}

const entries = [];
const mobileEntries = [];
for (const [key, [emoji, name]] of Object.entries(EMOJI)) {
  const icon = set.icons[name];
  const viewBox = `${icon.left ?? 0} ${icon.top ?? 0} ${icon.width ?? set.width} ${icon.height ?? set.height}`;
  const body = scopeIds(icon.body, key);
  const art = (svg) => `{ viewBox: '${viewBox}', body: "${svg.replaceAll('"', "'").trim()}" }`;
  entries.push(`  ${key}: ${art(body)},`);
  mobileEntries.push(`  '${emoji}': ${art(withoutFilters(body))},`);
}

const output = `/**
 * Emoji set — GENERATED, do not edit.
 *
 * Fluent Emoji, Color (https://github.com/microsoft/fluentui-emoji), MIT — attribution is in
 * \`ATTRIBUTION.md\`. Run \`pnpm --filter @vehicle-os/web emoji\` after changing the list in
 * \`scripts/generate-emoji.mjs\`.
 *
 * Colour artwork, inlined. Unlike \`Icon\`, these do not take \`currentColor\`: the whole point
 * is that a fuel pump and a receipt look different from one another.
 */

export interface EmojiProps {
  name: EmojiName;
  /** Rendered size in pixels. */
  size?: number;
  className?: string;
  /**
   * Announce it when it carries meaning of its own. Beside a label that already says "Fuel", leave
   * it out — a screen reader reading "fuel pump Fuel" is worse than reading "Fuel".
   */
  title?: string;
}

const EMOJI = {
${entries.join('\n')}
} as const;

export type EmojiName = keyof typeof EMOJI;

export function Emoji({ name, size = 20, className, title }: EmojiProps) {
  const emoji = EMOJI[name];

  return (
    <svg
      viewBox={emoji.viewBox}
      width={size}
      height={size}
      className={className}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      style={{ flexShrink: 0 }}
      dangerouslySetInnerHTML={{ __html: emoji.body }}
    />
  );
}

export const EMOJI_NAMES = Object.keys(EMOJI) as EmojiName[];
`;

const mobileOutput = `/**
 * Emoji artwork — GENERATED by \`apps/web/scripts/generate-emoji.mjs\`, do not edit.
 *
 * Fluent Emoji, Color (https://github.com/microsoft/fluentui-emoji), MIT — attribution is in
 * \`apps/web/ATTRIBUTION.md\`. The same artwork the web draws, keyed by the character, so an entry
 * on the phone wears the glyph it wears on the web rather than the phone's own emoji font. The
 * SVG filters (inner shadows, soft glows) are left out: react-native-svg cannot draw them safely
 * (see the generator).
 */

export const EMOJI_ART: Readonly<Record<string, { viewBox: string; body: string }>> = {
${mobileEntries.join('\n')}
};
`;

mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, output, 'utf8');
writeFileSync(mobileTarget, mobileOutput, 'utf8');
console.log(`Wrote ${entries.length} emoji to ${target} and ${mobileTarget}`);
