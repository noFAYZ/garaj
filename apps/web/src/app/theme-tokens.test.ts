import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { contrastRatio, DARK_TOKENS, LIGHT_TOKENS, oklchToHex } from '@vehicle-os/ui';

/*
 * The web reads its colours from `globals.css`; the mobile app reads the same design from
 * `@vehicle-os/ui`. The stylesheet claimed to mirror the package for months while its background,
 * cards and focus ring had all moved — nothing compares a CSS file with a TypeScript object, so
 * the two platforms quietly became two designs. This does.
 */
const css = readFileSync(new URL('./globals.css', import.meta.url), 'utf8');

/** Every `--<prefix>*` declared in the block that starts at `opener`, comments removed. */
function declaredColors(opener: string, prefix = 'color-'): Map<string, string> {
  const start = css.indexOf(opener);
  expect(start, `block "${opener}" in globals.css`).toBeGreaterThanOrEqual(0);
  const body = css.slice(start, css.indexOf('\n}', start)).replace(/\/\*[\s\S]*?\*\//g, '');
  return new Map(
    [...body.matchAll(new RegExp(`--${prefix}([\\w-]+):\\s*([^;]+);`, 'g'))].map((match) => [
      match[1]!,
      match[2]!.trim(),
    ]),
  );
}

const kebab = (name: string) => name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

describe.each([
  ['dark', '@theme {', DARK_TOKENS],
  ['light', "html[data-theme='light'] {", LIGHT_TOKENS],
] as const)('the %s theme in globals.css', (_, opener, tokens) => {
  it('matches @vehicle-os/ui token for token', () => {
    const declared = declaredColors(opener);
    for (const [name, value] of Object.entries(tokens)) {
      expect(declared.get(kebab(name)), `--color-${kebab(name)}`).toBe(value);
    }
  });
});

/*
 * Glass reads text off a composite — a translucent surface over the page, or over another surface
 * — so a token pair proves nothing on its own. Each surface is laid over what it sits on and the
 * text checked on what reaches the screen.
 */
type Rgb = readonly number[];

const rgb = (value: string): Rgb =>
  [1, 3, 5].map((index) => Number.parseInt(oklchToHex(value).slice(index, index + 2), 16));
const alphaOf = (value: string) => Number(/\/\s*([\d.]+)\s*\)$/.exec(value)?.[1] ?? 1);
const hex = (color: Rgb) =>
  `#${color.map((channel) => Math.round(channel).toString(16).padStart(2, '0')).join('')}`;

/** `top` over an opaque `bottom`, blended as the browser does: per channel, in encoded sRGB. */
const over = (top: string, bottom: Rgb, alpha = alphaOf(top)): Rgb =>
  rgb(top).map((channel, index) => alpha * channel + (1 - alpha) * bottom[index]!);

describe.each(['dark', 'light'] as const)('the %s glass theme', (theme) => {
  it('keeps text readable on every surface', () => {
    const opener = `html[data-glass][data-theme='${theme}'] {`;
    const tokens = new Map<string, string>([
      ...Object.entries(theme === 'dark' ? DARK_TOKENS : LIGHT_TOKENS).map(
        ([name, value]) => [kebab(name), value] as const,
      ),
      ...declaredColors(opener),
    ]);
    const token = (name: string) => tokens.get(name)!;
    // The cockpit's display, opaque: the vehicle's figures and statuses are read on it.
    const screen = declaredColors(opener, 'glass-').get('screen')!;
    expect(screen, '--glass-screen').toBeDefined();

    const page = rgb(token('background'));
    const card50 = over(token('card'), page, alphaOf(token('card')) / 2);
    const popover = over(token('popover'), page);
    const surfaces = {
      page,
      'card/50': card50,
      card: over(token('card'), page),
      popover,
      muted: over(token('muted'), card50),
      border: over(token('border'), card50),
      'primary-soft': over(token('primary-soft'), card50),
      'muted on popover': over(token('muted'), popover),
      screen: rgb(screen),
    };
    const status = ['page', 'card/50', 'card', 'popover', 'muted', 'screen'] as const;
    const checks: [string, readonly (keyof typeof surfaces)[], number][] = [
      ['foreground', Object.keys(surfaces) as (keyof typeof surfaces)[], 4.5],
      ['muted-foreground', [...status, 'border'], 4.5],
      ['destructive', status, 4.5],
      ['success', status, 4.5],
      ['warning', status, 4.5],
      // WCAG 1.4.11: a focus indicator needs 3:1 against what it sits on.
      ['ring', ['page', 'card/50', 'card', 'popover'], 3],
    ];
    const failures: string[] = [];
    for (const [text, on, floor] of checks) {
      for (const surface of on) {
        const ratio = contrastRatio(token(text), hex(surfaces[surface]));
        if (ratio < floor) failures.push(`${text} on ${surface}: ${ratio.toFixed(2)}`);
      }
    }
    expect(failures).toEqual([]);
  });
});
