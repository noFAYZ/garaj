/**
 * Generates `src/components/icons.tsx` from the Solar icon set.
 *
 * `@iconify-json/solar` is 10.5 MB across 7,759 icons — importing it at runtime, even
 * through a tree-shakeable wrapper, risks dragging the whole collection into the bundle
 * because the icon name is usually a runtime value. Inlining the handful actually used is a
 * few kilobytes and needs no client library at all.
 *
 * The package stays a devDependency; this script runs when the icon list changes:
 *
 *   pnpm --filter @vehicle-os/web icons
 *
 * Adding an icon means adding a name below and re-running it. Browse names at
 * https://icon-sets.iconify.design/solar/
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source = resolve(here, '../node_modules/@iconify-json/solar/icons.json');
const target = resolve(here, '../src/components/icons.tsx');
/** The phone app draws the same icons from the same data, so the two never drift apart. */
const mobileTarget = resolve(here, '../../mobile/lib/icon-art.ts');

/**
 * The app's icon vocabulary, as `localName: solar-icon-name`.
 *
 * `bold-duotone` throughout: its two-tone fill reads like a backlit instrument face against
 * the dark ground, and mixing Solar's styles in one interface is the fastest way to make a
 * set of icons look like a set of accidents.
 */
const ICONS = {
  // Navigation and chrome
  garage: 'garage-bold-duotone',
  // Home on the phone's dock: tiles of mixed sizes, the dashboard it opens on.
  dashboard: 'widget-5-bold-duotone',
  vehicles: 'bus-bold-duotone',
  settings: 'settings-bold-duotone',
  bell: 'bell-bold-duotone',
  logout: 'logout-3-bold-duotone',
  sun: 'sun-2-bold-duotone',
  moon: 'moon-bold-duotone',
  search: 'magnifer-bold-duotone',
  filter: 'filter-bold-duotone',

  // Vehicle types
  car: 'bus-bold-duotone',
  motorcycle: 'scooter-bold-duotone',
  bicycle: 'bicycling-bold-duotone',
  // Solar has no boat or ship glyph; water is the closest honest stand-in.
  boat: 'water-bold-duotone',

  // The domain
  maintenance: 'toolbox-bold-duotone',
  wheel: 'wheel-bold-duotone',
  fuel: 'gas-station-bold-duotone',
  battery: 'battery-charge-bold-duotone',
  odometer: 'speedometer-max-bold-duotone',
  speedometer: 'speedometer-middle-bold-duotone',
  timeline: 'history-2-bold-duotone',
  // A vehicle's four places, on the phone's dock and the web's strip — the one exception to
  // bold-duotone here: outlined where you are not, solid where you are, the tab bar's own
  // convention. At 22px a grey duotone reads as a smudge; an outline reads as a drawing. Stats is
  // a pie with its slice lifted out — read as analytics at a glance, where bars read as a level.
  logbook: 'clipboard-list-linear',
  logbookActive: 'clipboard-list-bold',
  reminder: 'bell-linear',
  reminderActive: 'bell-bold',
  analytics: 'pie-chart-2-linear',
  analyticsActive: 'pie-chart-2-bold',
  papers: 'folder-with-files-linear',
  papersActive: 'folder-with-files-bold',
  task: 'checklist-minimalistic-bold-duotone',
  document: 'document-text-bold-duotone',
  // The papers a vehicle is expected to have (Documents' key grid).
  registration: 'card-2-bold-duotone',
  insurance: 'shield-check-bold-duotone',
  inspection: 'magnifer-bold-duotone',
  warranty: 'medal-ribbon-bold-duotone',
  manual: 'book-bold-duotone',
  upload: 'upload-bold-duotone',
  gallery: 'gallery-bold-duotone',
  camera: 'camera-bold-duotone',
  money: 'wallet-money-bold-duotone',
  chart: 'chart-2-bold-duotone',
  // The report's tabs.
  pie: 'pie-chart-2-bold-duotone',
  receipt: 'bill-list-bold-duotone',
  income: 'hand-money-bold-duotone',
  route: 'routing-2-bold-duotone',

  // Status
  overdue: 'danger-triangle-bold-duotone',
  dueSoon: 'clock-circle-bold-duotone',
  ok: 'check-circle-bold-duotone',
  calendar: 'calendar-mark-bold-duotone',
  stopwatch: 'stopwatch-bold-duotone',
  info: 'info-circle-bold-duotone',

  // Actions
  add: 'add-circle-bold-duotone',
  edit: 'pen-2-bold-duotone',
  trash: 'trash-bin-trash-bold-duotone',
  archive: 'archive-bold-duotone',
  share: 'share-bold-duotone',
  star: 'star-bold-duotone',
  check: 'check-circle-bold-duotone',
  close: 'close-circle-bold-duotone',
  chevronDown: 'alt-arrow-down-bold-duotone',
  chevronRight: 'alt-arrow-right-bold-duotone',
  refresh: 'refresh-bold-duotone',
  people: 'users-group-rounded-bold-duotone',
};

const collection = JSON.parse(readFileSync(source, 'utf8'));

const missing = Object.entries(ICONS).filter(([, name]) => !collection.icons[name]);
if (missing.length > 0) {
  console.error('Icons not found in the Solar set:');
  for (const [key, name] of missing) console.error(`  ${key} -> ${name}`);
  process.exit(1);
}

const entries = Object.entries(ICONS)
  .map(([key, name]) => {
    const icon = collection.icons[name];
    // Most Solar icons use the collection default 24x24, but a few carry their own box.
    // Reading it per icon avoids a silently cropped or floating glyph.
    const width = icon.width ?? collection.width ?? 24;
    const height = icon.height ?? collection.height ?? 24;
    const left = icon.left ?? 0;
    const top = icon.top ?? 0;
    const body = icon.body.replaceAll('"', "'");
    return `  ${key}: { viewBox: '${left} ${top} ${width} ${height}', body: "${body}" },`;
  })
  .join('\n');

const output = `/**
 * Icon set — GENERATED, do not edit.
 *
 * Run \`pnpm --filter @vehicle-os/web icons\` after changing the list in
 * \`scripts/generate-icons.mjs\`.
 *
 * Solar bold-duotone, inlined, and the vehicle's four places also outlined. Every path is \`currentColor\`, so an icon takes the
 * colour of whatever it sits in and needs no per-variant styling.
 */

export interface IconProps {
  name: IconName;
  /** Rendered size in pixels. */
  size?: number;
  className?: string;
  /**
   * Announce the icon when it carries meaning of its own. Omit it for decoration beside a
   * label — a screen reader reading "wrench Maintenance" is worse than reading "Maintenance".
   */
  title?: string;
}

const ICONS = {
${entries}
} as const;

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 20, className, title }: IconProps) {
  const icon = ICONS[name];

  return (
    <svg
      viewBox={icon.viewBox}
      width={size}
      height={size}
      className={className}
      // Decorative unless given a title: without this every icon beside a label is read
      // aloud twice.
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      // Stops the glyph being squashed when it lands in a flex row next to long text.
      style={{ flexShrink: 0 }}
      dangerouslySetInnerHTML={{ __html: icon.body }}
    />
  );
}

export const ICON_NAMES = Object.keys(ICONS) as IconName[];
`;

const mobileOutput = `/**
 * Icon artwork — GENERATED by \`apps/web/scripts/generate-icons.mjs\`, do not edit.
 *
 * Solar bold-duotone, the web's own set (the vehicle's four places also outlined): every path is \`currentColor\`, so an icon takes
 * the colour it is drawn in, and the half-strength layer gives each its two tones.
 */

export const ICON_ART = {
${entries}
} as const;

export type IconName = keyof typeof ICON_ART;
`;

mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, output, 'utf8');
writeFileSync(mobileTarget, mobileOutput, 'utf8');
console.log(`Wrote ${Object.keys(ICONS).length} icons to ${target} and ${mobileTarget}`);
