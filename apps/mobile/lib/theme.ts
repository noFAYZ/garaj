import { composite, DARK_TOKENS, LIGHT_TOKENS, oklchToHex, toNativeTokens } from '@vehicle-os/ui';
import { useColorScheme, type TextStyle } from 'react-native';

/**
 * The phone's half of "Precision / Editorial", the web's design system.
 *
 * Every colour comes from `@vehicle-os/ui`, the same tokens `globals.css` declares (a test fails if
 * the two differ) — copper as identity, warm carbon and mineral as material, statuses spaced by hue.
 * React Native cannot use Tailwind, so the values are shared and the mechanism is not
 * (Architecture.md §65). What is added here is only what the web draws with CSS a phone lacks: the
 * resting card the web gets from `bg-card/50`, the lit rim of a dark floating surface, a scrim.
 */
const SHARED_DARK = toNativeTokens(DARK_TOKENS);
const SHARED_LIGHT = toNativeTokens(LIGHT_TOKENS);

/** The web's resting card is the card at half strength over the page; it lifts to full on hover. */
const resting = (tokens: typeof DARK_TOKENS | typeof LIGHT_TOKENS) =>
  composite(tokens.card.replace(')', ' / 0.5)'), tokens.background);

const DARK = {
  ...SHARED_DARK,
  /** A card at rest on the page — `bg-card/50`. */
  card: resting(DARK_TOKENS),
  /** The full card: something lifted, pressed, or floating over the page. */
  cardRaised: SHARED_DARK.card,
  /** Hairline edges, `ring-1 ring-border` at the web's 76%. */
  hairline: 'rgba(255,255,255,0.07)',
  /** The light catching the top edge of a dark floating surface. */
  rim: 'rgba(255,255,255,0.14)',
  scrim: 'rgba(0,0,0,0.52)',
  shadow: '#000000',
  dark: true,
};

export type Theme = { [K in keyof typeof DARK]: K extends 'dark' ? boolean : string };

const LIGHT: Theme = {
  ...SHARED_LIGHT,
  card: resting(LIGHT_TOKENS),
  cardRaised: SHARED_LIGHT.card,
  hairline: 'rgba(40,30,20,0.08)',
  rim: 'rgba(255,255,255,0.9)',
  scrim: 'rgba(28,22,16,0.38)',
  // The web's light shadow: warm ink at low strength, never black.
  shadow: oklchToHex('oklch(0.2 0.015 65)'),
  dark: false,
};

export function useTheme(): Theme {
  return useColorScheme() === 'light' ? LIGHT : DARK;
}

/** A 4pt grid — the web's Tailwind spacing, in points. */
export const spacing = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

/** The web's radii: instrument-like rather than toy-like. `xxl` is `rounded-2xl`, a card. */
export const radius = { sm: 7, md: 10, lg: 13, xl: 16, xxl: 20, xxxl: 24, pill: 999 } as const;

/**
 * The type scale: a screen picks a role, not a number. Albert Sans, as the web sets it, at the web's
 * sizes; figures in mono (`figure`).
 */
export const typeScale = {
  /** The one huge heading on a screen. */
  hero: { fontSize: 40, lineHeight: 44, fontWeight: '700', letterSpacing: -1.6 },
  /** The greeting, the sign-in headline — the web's `text-2xl font-bold tracking-tight`. */
  display: { fontSize: 28, lineHeight: 33, fontWeight: '700', letterSpacing: -0.7 },
  /** Section titles — the web's `text-lg font-semibold tracking-tight`. */
  title: { fontSize: 18, lineHeight: 24, fontWeight: '600', letterSpacing: -0.35 },
  /** A card's name. */
  headline: { fontSize: 15, lineHeight: 20, fontWeight: '600', letterSpacing: -0.15 },
  /** Running text, the web's `text-md`. */
  body: { fontSize: 15, lineHeight: 22, fontWeight: '400' },
  /** Buttons, chips, field labels — `text-sm font-semibold`. */
  label: { fontSize: 14, lineHeight: 19, fontWeight: '600' },
  /** Meta lines under a row, hints — `text-xs`. */
  caption: { fontSize: 12, lineHeight: 17, fontWeight: '400' },
  /** The web's `text-label`: small, uppercase, tracked out. */
  overline: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '600',
    letterSpacing: 1.15,
    textTransform: 'uppercase',
  },
} as const satisfies Record<string, TextStyle>;

/**
 * Figures — odometers, money, counts — in mono with tabular digits, as the web sets every number:
 * a reading that changes in place does not jitter, and a column of them lines up. `GeistMono` is a
 * role, resolved to the right weight's file by the patch in `fonts.tsx`.
 */
export const figure: TextStyle = {
  fontFamily: 'GeistMono',
  fontVariant: ['tabular-nums'],
  letterSpacing: -0.3,
};

/**
 * The web's `shadow-float`, as one shadow: something floating over the page. `low` is the soft
 * ambient one a resting card would carry, for the few places that lift without floating.
 */
export const lift = (theme: Theme, strength: 'low' | 'float' = 'float') => ({
  shadowColor: theme.shadow,
  shadowOpacity: theme.dark ? 0.5 : strength === 'float' ? 0.16 : 0.06,
  shadowRadius: strength === 'float' ? 22 : 10,
  shadowOffset: { width: 0, height: strength === 'float' ? 12 : 4 },
  elevation: strength === 'float' ? 12 : 2,
});

/**
 * A floating surface's edge: in the dark a lit line along the top and a faint ring all round —
 * the web's dialog rim — and in daylight a hairline, the shadow doing the lifting.
 */
export const rimmed = (theme: Theme) => ({
  borderWidth: 1,
  borderColor: theme.hairline,
  borderTopColor: theme.dark ? theme.rim : theme.hairline,
});
