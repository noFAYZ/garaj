'use client';

import { useEffect, useState } from 'react';

/**
 * False during the server render and the client's first pass, true from the commit after.
 *
 * React requires the first client render to produce the same tree the server sent. Anything
 * the server cannot know — a media query, `localStorage`, a session resolved from a cookie —
 * is therefore not safe to render on directly: the client resolves it immediately, renders
 * something different, and React reports a mismatch it will not patch up.
 *
 * Gating on this defers the difference by exactly one commit, which is the shortest correct
 * answer. It is not a way to silence the warning — the value still has to be one the user
 * does not miss for a frame.
 */
export function useHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return hydrated;
}
