/**
 * Theme preference (zunoUI settings model).
 *
 * State that outlives a render lives outside React: a plain module owns it and components
 * subscribe with `useSyncExternalStore`. A context provider would re-render the whole subtree on
 * every change and force every consumer to sit beneath it — for a value read in a dozen places
 * and changed twice a year.
 *
 * The preference is one of three: `system`, `light` or `dark`. The *theme* is what that resolves
 * to right now, and for `system` it changes on its own when the device does — which is why the
 * store also listens to the OS, not only to the setting.
 *
 * Glass is a second, separate choice: a material laid over whichever theme is on, as macOS keeps
 * Appearance and the Liquid Glass style apart. So glass comes light, dark, or following the device,
 * without the theme list growing a glass twin of every entry.
 */

'use client';

import { useSyncExternalStore } from 'react';
import { GLASS_KEY, THEME_COLORS, THEME_KEY } from './theme-script';

export type ThemePreference = 'system' | 'light' | 'dark';
export type Theme = 'light' | 'dark';

const CHANGE_EVENT = 'vehicleos-theme-change';
const LIGHT_QUERY = '(prefers-color-scheme: light)';

/** Where the choice lives when storage throws (private mode, blocked site data): this tab only. */
let unsaved: ThemePreference = 'system';
let unsavedGlass = false;

function subscribe(callback: () => void): () => void {
  const media = window.matchMedia(LIGHT_QUERY);
  window.addEventListener(CHANGE_EVENT, callback);
  // Without this a change in one tab never reaches the others, and the two disagree until a
  // reload.
  window.addEventListener('storage', callback);
  // The device switching at sunset, for anyone on `system`.
  media.addEventListener('change', callback);
  return () => {
    window.removeEventListener(CHANGE_EVENT, callback);
    window.removeEventListener('storage', callback);
    media.removeEventListener('change', callback);
  };
}

function readPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    return stored === 'light' || stored === 'dark' ? stored : 'system';
  } catch {
    return unsaved;
  }
}

function readGlass(): boolean {
  try {
    return localStorage.getItem(GLASS_KEY) === '1';
  } catch {
    return unsavedGlass;
  }
}

function resolve(preference: ThemePreference): Theme {
  if (preference !== 'system') return preference;
  return window.matchMedia(LIGHT_QUERY).matches ? 'light' : 'dark';
}

const readTheme = (): Theme => resolve(readPreference());

/** What the person chose. The server has no storage, so it renders `system`. */
export function useThemePreference(): ThemePreference {
  return useSyncExternalStore(subscribe, readPreference, () => 'system');
}

/** The theme on screen. The server render assumes dark, as the root layout's markup does. */
export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, readTheme, () => 'dark');
}

/** Whether the glass material is on. Off on the server, as the root layout's markup is. */
export function useGlass(): boolean {
  return useSyncExternalStore(subscribe, readGlass, () => false);
}

/**
 * Choose a theme. `origin` is where the reveal starts, in viewport pixels — the centre of the
 * control that was pressed.
 *
 * `system` is stored as no value at all rather than as the word: a person who has never chosen
 * and a person who chose to follow their device are the same person.
 */
export function setThemePreference(
  preference: ThemePreference,
  origin?: { x: number; y: number },
): void {
  try {
    if (preference === 'system') localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, preference);
  } catch {
    unsaved = preference;
  }
  applyTheme(resolve(preference), readGlass(), origin);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** Turn the glass material on or off, over whichever theme is on. Off is stored as no value. */
export function setGlass(on: boolean, origin?: { x: number; y: number }): void {
  try {
    if (on) localStorage.setItem(GLASS_KEY, '1');
    else localStorage.removeItem(GLASS_KEY);
  } catch {
    unsavedGlass = on;
  }
  applyTheme(readTheme(), on, origin);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/**
 * Brings the document in line with the stored preference. For changes that did not come through
 * `setThemePreference` in this tab: the OS switching, or a choice made in another tab — which
 * used to update that tab's switch and leave its page in the old colours.
 */
export function syncTheme(): void {
  applyTheme(readTheme(), readGlass());
}

/** The attributes every token keys off, native form controls, and the browser's own chrome. */
function paint(theme: Theme, glass: boolean): void {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.toggleAttribute('data-glass', glass);
  root.style.colorScheme = theme;
  // Both media variants are rewritten: an explicit choice has to win over the OS in either.
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    meta.content = THEME_COLORS[theme];
  }
}

function applyTheme(theme: Theme, glass: boolean, origin?: { x: number; y: number }): void {
  const root = document.documentElement;
  if (root.dataset.theme === theme && root.hasAttribute('data-glass') === glass) return;

  // Transitions off until the new colours have painted; see `globals.css`.
  root.setAttribute('data-theme-switching', '');
  const settle = () => root.removeAttribute('data-theme-switching');

  const reduce =
    root.hasAttribute('data-reduce-motion') ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (reduce || !('startViewTransition' in document)) {
    paint(theme, glass);
    // Two frames: the first paints the new theme with transitions still off.
    requestAnimationFrame(() => requestAnimationFrame(settle));
    return;
  }

  const transition = document.startViewTransition(() => paint(theme, glass));
  transition.ready.then(
    () => {
      const x = origin?.x ?? window.innerWidth / 2;
      const y = origin?.y ?? 0;
      // Far enough to cover the corner furthest from where it starts.
      const radius = Math.hypot(
        Math.max(x, window.innerWidth - x),
        Math.max(y, window.innerHeight - y),
      );
      root.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        {
          duration: 420,
          easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
          pseudoElement: '::view-transition-new(root)',
        },
      );
    },
    // Skipped — another transition started, or the tab was hidden. The theme still changed.
    () => undefined,
  );
  transition.finished.then(settle, settle);
}
