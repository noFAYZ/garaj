/**
 * Feature flags (Architecture.md §94).
 *
 * The server decides. A flag exposed to a client is a hint for hiding UI; the route that
 * backs a gated feature checks `isEnabled` itself, so flipping a flag in devtools buys
 * nothing.
 */

import type { Env } from './env';

export const FEATURE_FLAGS = [
  'ai',
  'ocr',
  'passport',
  'advancedAnalytics',
  'obd',
  'billing',
  'experimentalUi',
] as const;

export type FeatureFlag = (typeof FEATURE_FLAGS)[number];

/** What a flag would be with no admin override: on only when its dependency is configured. */
export function defaultFlags(env: Env): Readonly<Record<FeatureFlag, boolean>> {
  const hasAi = Boolean(env.AI_API_KEY);
  return Object.freeze({
    ai: hasAi,
    ocr: hasAi,
    // On: the passport is built, prints to PDF, and discloses only the sections each link was
    // made with (PRD §1531). The routes check this flag themselves.
    passport: true,
    advancedAnalytics: false,
    obd: false,
    billing: Boolean(env.STRIPE_SECRET_KEY),
    experimentalUi: env.NODE_ENV !== 'production',
  });
}

/**
 * Whether a flag *can* be on. An override cannot switch on AI without a key — it would only
 * trade "AI unavailable" for an auth error from a vendor the user never heard of.
 */
export function flagAvailable(env: Env, flag: FeatureFlag): boolean {
  if (flag === 'ai' || flag === 'ocr') return Boolean(env.AI_API_KEY);
  if (flag === 'billing') return Boolean(env.STRIPE_SECRET_KEY);
  return true;
}

export type FlagOverrides = Partial<Record<FeatureFlag, boolean>>;

/*
 * Set from the admin console (stored in `app_settings`, loaded at boot and on every change).
 *
 * ponytail: per-process. One API instance sees a change at once; a second one only on its next
 * restart. Upgrade path: publish the change over Redis, or re-read the row on an interval.
 */
let overrides: FlagOverrides = {};

export function setFlagOverrides(next: FlagOverrides): void {
  overrides = { ...next };
}

export function flagOverrides(): FlagOverrides {
  return overrides;
}

/**
 * Flags default off and turn on when their dependency is actually configured — so a
 * deployment without AI_API_KEY reports "AI unavailable" instead of failing at the
 * first request with an auth error from a vendor the user never heard of. An admin override
 * wins over the default, but never over a missing dependency.
 */
export function resolveFlags(env: Env): Readonly<Record<FeatureFlag, boolean>> {
  const defaults = defaultFlags(env);
  const result = {} as Record<FeatureFlag, boolean>;
  for (const flag of FEATURE_FLAGS) {
    result[flag] = (overrides[flag] ?? defaults[flag]) && flagAvailable(env, flag);
  }
  return Object.freeze(result);
}

export function isEnabled(env: Env, flag: FeatureFlag): boolean {
  return resolveFlags(env)[flag];
}
