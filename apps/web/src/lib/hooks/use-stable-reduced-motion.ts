'use client';

import { useReducedMotion } from 'motion/react';
import { useHydrated } from '@/lib/hooks/use-hydrated';

/**
 * `useReducedMotion`, but safe to render on the server.
 *
 * The raw hook reads `prefers-reduced-motion` — a media query the server does not have, so it
 * returns false there. On the client it can return true on the very first render, and every
 * `motion.*` element whose `variants` depend on it then writes different `style` attributes
 * than the server sent. React reports that as a hydration mismatch and, as it says, does not
 * patch it up.
 *
 * The same applies to the in-app toggle: `MotionConfig reducedMotion` is fed from
 * `localStorage`, which the server cannot read either.
 *
 * So the first client render deliberately agrees with the server — motion allowed — and the
 * real preference takes effect on the commit after hydration. Nothing is animating during
 * that first frame: these components animate on open, hover or value change, all of which
 * happen after mount.
 */
export function useStableReducedMotion(): boolean {
  const preference = useReducedMotion() ?? false;
  return useHydrated() ? preference : false;
}
