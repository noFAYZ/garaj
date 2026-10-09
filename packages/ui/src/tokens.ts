/**
 * Design tokens, as data (Architecture.md §65).
 *
 * The one source for both platforms. The web declares these same values in `globals.css`, and
 * `apps/web/src/app/theme-tokens.test.ts` fails if a single one differs; React Native cannot use
 * Tailwind at all, so it builds a StyleSheet theme from this object. §65 is explicit that the two
 * platforms should not be forced into one UI architecture — they share values, not mechanism.
 *
 * How the palette ("Precision / Editorial") is built:
 *
 * - **Copper is identity.** One restrained copper-orange is the brand: the primary key, the active
 *   place, the month's leaf on the record. It is never a status — red, amber, green and blue keep
 *   that job — so a copper thing on screen means "this is Garaj's", never "this is wrong".
 * - **Warm carbon and mineral.** The dark theme is carbon at hue 62, the light one a warm mineral
 *   paper at 78: chroma under 0.015, enough to feel like material, not enough to read as a tint.
 * - **Elevation by lightness.** Page, card, popover, then the fills that sit on them, each a
 *   deliberate step up. `contrast.test.ts` checks the order, and every text colour against every
 *   surface it is read on.
 * - **Soft tints are washes.** Each `*Soft` is its colour at a tenth or so of its strength, laid
 *   over whatever is behind it — the active pill over a card, the focus halo round a field. The
 *   alpha survives the trip to React Native (`oklchToHex` emits `#rrggbbaa`), and the contrast
 *   test reads text on each wash as it lands on a card and on the page.
 * - **Statuses spaced by hue.** Red 25, amber 83–88, green 155, blue 245 — far enough apart to
 *   tell at a glance, and far enough from copper at 48 that nothing brand reads as a warning.
 */

export const DARK_TOKENS = {
  background: 'oklch(0.13 0.007 62)',
  foreground: 'oklch(0.955 0.012 78)',
  card: 'oklch(0.235 0.009 62)',
  popover: 'oklch(0.255 0.01 62)',
  muted: 'oklch(0.285 0.01 62)',
  mutedForeground: 'oklch(0.74 0.014 70)',
  border: 'oklch(0.33 0.011 65)',
  borderStrong: 'oklch(0.41 0.013 62)',
  input: 'oklch(0.285 0.01 62)',
  primary: 'oklch(0.69 0.145 48)',
  primaryHover: 'oklch(0.74 0.15 49)',
  primaryForeground: 'oklch(0.14 0.012 45)',
  /**
   * The primary key's two machined edges: a lit line along the top and a darker lip along the
   * bottom. Solidity from light falling on an edge, not from a gradient across the face.
   */
  primarySheen: 'oklch(0.82 0.105 63)',
  primaryEdge: 'oklch(0.52 0.11 43)',
  /** The active place's pill, a selection, the halo round a focused field. */
  primarySoft: 'oklch(0.69 0.145 48 / 0.12)',
  destructive: 'oklch(0.69 0.19 25)',
  destructiveHover: 'oklch(0.64 0.2 25)',
  /** Dark, not white: white on this red measured 2.9:1. */
  destructiveForeground: 'oklch(0.16 0.02 25)',
  destructiveSoft: 'oklch(0.69 0.19 25 / 0.12)',
  success: 'oklch(0.74 0.13 155)',
  successSoft: 'oklch(0.74 0.13 155 / 0.12)',
  warning: 'oklch(0.82 0.14 88)',
  warningSoft: 'oklch(0.82 0.14 88 / 0.13)',
  /**
   * On track: scheduled, and nothing to do yet. Blue, not green — green is "done" and "good",
   * and a service four months out is neither; it is simply in hand.
   */
  info: 'oklch(0.76 0.12 245)',
  infoSoft: 'oklch(0.76 0.12 245 / 0.12)',
  ring: 'oklch(0.72 0.13 48)',
  /*
   * Chart series: the one place hue carries identity rather than status, and intentionally muted
   * so copper stays the brightest thing on a report. Each report group owns one hue on every
   * screen — refuelling orange, services blue, other expenses rose, income green, trips violet —
   * so a colour means the same money on the overview and on its own tab. Neutral is "other".
   */
  chartRefuel: '#d9793c',
  chartService: '#6f9ed8',
  chartExpense: '#c87996',
  chartIncome: '#5eaf8b',
  chartTrip: '#9285c9',
  chartNeutral: '#77716a',
} as const;

/*
 * Warm mineral canvas, white instrumentation, copper as the signal. Each status is darker than its
 * dark-theme twin by more than a flip of lightness: it is used as text, and a light-theme amber
 * that still looks like amber sits near 3:1 on white.
 */
export const LIGHT_TOKENS = {
  background: 'oklch(0.955 0.008 78)',
  foreground: 'oklch(0.19 0.012 58)',
  card: 'oklch(0.995 0.003 85)',
  popover: 'oklch(0.995 0.003 85)',
  muted: 'oklch(0.925 0.008 78)',
  mutedForeground: 'oklch(0.47 0.015 65)',
  border: 'oklch(0.87 0.012 76)',
  borderStrong: 'oklch(0.76 0.015 70)',
  input: 'oklch(0.93 0.008 78)',
  primary: 'oklch(0.57 0.145 47)',
  primaryHover: 'oklch(0.52 0.15 47)',
  primaryForeground: 'oklch(0.99 0.003 85)',
  primarySheen: 'oklch(0.67 0.13 54)',
  primaryEdge: 'oklch(0.45 0.12 44)',
  primarySoft: 'oklch(0.57 0.145 47 / 0.1)',
  destructive: 'oklch(0.52 0.19 25)',
  destructiveHover: 'oklch(0.47 0.2 25)',
  destructiveForeground: 'oklch(0.99 0 0)',
  destructiveSoft: 'oklch(0.52 0.19 25 / 0.1)',
  success: 'oklch(0.48 0.12 155)',
  successSoft: 'oklch(0.48 0.12 155 / 0.1)',
  warning: 'oklch(0.5 0.12 83)',
  warningSoft: 'oklch(0.5 0.12 83 / 0.11)',
  info: 'oklch(0.49 0.12 245)',
  infoSoft: 'oklch(0.49 0.12 245 / 0.1)',
  ring: 'oklch(0.57 0.145 47)',
  chartRefuel: '#d9793c',
  chartService: '#6f9ed8',
  chartExpense: '#c87996',
  chartIncome: '#5eaf8b',
  chartTrip: '#9285c9',
  chartNeutral: '#77716a',
} as const satisfies Record<keyof typeof DARK_TOKENS, string>;

export type ThemeTokens = typeof DARK_TOKENS;
