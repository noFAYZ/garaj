/**
 * Generates `src/components/emoji.tsx` from Twemoji.
 *
 * Activity entries are a list of very different things — a fill-up, a repair, an insurance
 * payment, a note — and a line-art set draws most of them with the same spanner. Twemoji's
 * artwork is recognisable at 20px and different from entry to entry, which is the whole job.
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

/** Pinned: emoji artwork changes between releases, and a silent redraw is not a thing to inherit. */
const VERSION = '15.1.0';
const base = `https://cdn.jsdelivr.net/gh/jdecked/twemoji@${VERSION}/assets/svg`;

/**
 * The vocabulary, as `localName: emoji`.
 *
 * Every one of these is mapped from a real value — an event type, or a word in a schedule's title.
 * Nothing here is decoration for its own sake.
 */
const EMOJI = {
  // Event types
  maintenance: '🔧',
  repair: '🛠️',
  fuel: '⛽',
  charge: '🔌',
  purchase: '🧾',
  inspection: '🔍',
  modification: '⚙️',
  cleaning: '🧼',
  registration: '📋',
  insurance: '🛡️',
  trip: '🗺️',
  accident: '💥',
  note: '📝',
  expense: '💸',
  // Parts and jobs, matched from a schedule's title
  oil: '🛢️',
  tyre: '🛞',
  brake: '🛑',
  chain: '⛓️',
  battery: '🔋',
  filter: '🌬️',
  coolant: '❄️',
  spark: '⚡',
  calendar: '🗓️',
  // The home screen's add menu: four unlike things to add, one glyph each.
  garage: '🏠',
  vehicle: '🚗',
  logbook: '📒',
  sparkles: '✨',
};

/**
 * Twemoji's filenames are the code points in hex, joined by `-`.
 *
 * The variation selector (`fe0f`) that makes an emoji render in colour is usually left out of the
 * filename but kept for a few, so the name with it is tried first and the name without it second.
 */
function candidates(emoji) {
  const points = [...emoji].map((char) => char.codePointAt(0).toString(16));
  const withSelector = points.join('-');
  const withoutSelector = points.filter((point) => point !== 'fe0f').join('-');
  return withSelector === withoutSelector ? [withSelector] : [withSelector, withoutSelector];
}

async function fetchSvg(emoji) {
  for (const name of candidates(emoji)) {
    const response = await fetch(`${base}/${name}.svg`);
    if (response.ok) return { name, svg: await response.text() };
  }
  throw new Error(`No Twemoji SVG for ${emoji} (tried ${candidates(emoji).join(', ')})`);
}

const entries = [];
const mobileEntries = [];
for (const [key, emoji] of Object.entries(EMOJI)) {
  const { name, svg } = await fetchSvg(emoji);
  const viewBox = /viewBox="([^"]+)"/.exec(svg)?.[1];
  const body = /<svg[^>]*>([\s\S]*)<\/svg>/.exec(svg)?.[1];
  if (!viewBox || !body) throw new Error(`Unexpected SVG shape for ${emoji} (${name}.svg)`);
  const art = `{ viewBox: '${viewBox}', body: "${body.replaceAll('"', "'").trim()}" }`;
  entries.push(`  ${key}: ${art},`);
  mobileEntries.push(`  '${emoji}': ${art},`);
}

const output = `/**
 * Emoji set — GENERATED, do not edit.
 *
 * Twemoji ${VERSION} (https://github.com/jdecked/twemoji), graphics CC-BY 4.0 — attribution is in
 * \`ATTRIBUTION.md\`. Run \`pnpm --filter @vehicle-os/web emoji\` after changing the list in
 * \`scripts/generate-emoji.mjs\`.
 *
 * Flat colour artwork, inlined. Unlike \`Icon\`, these do not take \`currentColor\`: the whole point
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
 * Twemoji ${VERSION} (https://github.com/jdecked/twemoji), graphics CC-BY 4.0 — attribution is in
 * \`apps/web/ATTRIBUTION.md\`. The same artwork the web draws, keyed by the character, so an entry
 * on the phone wears the glyph it wears on the web rather than the phone's own emoji font.
 */

export const EMOJI_ART: Readonly<Record<string, { viewBox: string; body: string }>> = {
${mobileEntries.join('\n')}
};
`;

mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, output, 'utf8');
writeFileSync(mobileTarget, mobileOutput, 'utf8');
console.log(`Wrote ${entries.length} emoji to ${target} and ${mobileTarget}`);
