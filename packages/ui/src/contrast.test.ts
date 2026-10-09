import { describe, expect, it } from 'vitest';
import { composite, contrastRatio } from './color';
import { DARK_TOKENS, LIGHT_TOKENS, type ThemeTokens } from './tokens';

type Token = keyof ThemeTokens;

/*
 * Every text colour, and the surfaces it is actually read on. `border` is here because it is
 * the hover fill of fields and secondary buttons, so text sits on it whenever a pointer does.
 *
 * 4.5:1 is WCAG AA for body text. It is a floor, not a target: the light warning colour used to
 * sit at 3.1:1, which reads fine to a designer on a good screen and not at all to anyone else.
 */
const TEXT_ON: readonly (readonly [Token, readonly Token[]])[] = [
  ['foreground', ['background', 'card', 'popover', 'muted', 'border', 'primarySoft']],
  ['mutedForeground', ['background', 'card', 'popover', 'muted', 'border']],
  ['destructive', ['background', 'card', 'popover', 'muted', 'destructiveSoft']],
  ['success', ['background', 'card', 'popover', 'muted', 'successSoft']],
  ['warning', ['background', 'card', 'popover', 'muted', 'warningSoft']],
  ['info', ['background', 'card', 'popover', 'muted', 'infoSoft']],
  ['primaryForeground', ['primary', 'primaryHover']],
  ['destructiveForeground', ['destructive', 'destructiveHover']],
];

const THEMES: readonly (readonly [string, Record<Token, string>])[] = [
  ['dark', DARK_TOKENS],
  ['light', LIGHT_TOKENS],
];

describe.each(THEMES)('%s theme', (_, tokens) => {
  const pairs = TEXT_ON.flatMap(([text, surfaces]) =>
    surfaces.map((surface) => [text, surface] as const),
  );

  /*
   * A wash has no colour of its own until it lands on something, so it is read where it lands:
   * on a card and on the page. An opaque surface is itself either way.
   */
  it.each(pairs)('%s text on %s meets AA', (text, surface) => {
    for (const ground of [tokens.card, tokens.background]) {
      expect(
        contrastRatio(tokens[text], composite(tokens[surface], ground)),
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  // WCAG 1.4.11: a focus indicator needs 3:1 against what it sits on.
  it.each(['background', 'card', 'popover'] as const)(
    'the focus ring stands out on %s',
    (surface) => {
      expect(contrastRatio(tokens.ring, tokens[surface])).toBeGreaterThanOrEqual(3);
    },
  );
});

/** Lightness of an `oklch(L C H)` token. */
const lightness = (value: string) =>
  Number.parseFloat(/oklch\(\s*([\d.]+)/.exec(value)?.[1] ?? 'NaN');

/*
 * Surfaces are separated by lightness alone — there are no borders between regions — so their
 * order is load-bearing. A popover a shade darker than the card it opens over (as it once was)
 * reads as a hole in the card rather than something floating above it.
 */
describe('elevation', () => {
  it('steps up in the dark theme: page, card, popover, fills, hover', () => {
    const steps = (['background', 'card', 'popover', 'muted', 'border'] as const).map((token) =>
      lightness(DARK_TOKENS[token]),
    );
    expect(steps).toEqual([...steps].sort((a, b) => a - b));
    expect(new Set(steps).size).toBe(steps.length);
  });

  it('lifts cards off the page and sinks fills below it in the light theme', () => {
    expect(lightness(LIGHT_TOKENS.card)).toBeGreaterThan(lightness(LIGHT_TOKENS.background));
    expect(lightness(LIGHT_TOKENS.muted)).toBeLessThan(lightness(LIGHT_TOKENS.background));
    expect(lightness(LIGHT_TOKENS.border)).toBeLessThan(lightness(LIGHT_TOKENS.muted));
  });
});

describe('contrastRatio', () => {
  it('spans 1 to 21', () => {
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1);
    expect(contrastRatio('oklch(0 0 0)', 'oklch(1 0 0)')).toBeCloseTo(21);
  });

  it('is the same in either order', () => {
    expect(contrastRatio('#ffd60a', '#222222')).toBeCloseTo(contrastRatio('#222222', '#ffd60a'));
  });
});
