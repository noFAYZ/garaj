import { DARK_TOKENS, LIGHT_TOKENS, oklchToHex } from '@vehicle-os/ui';

/*
 * No `'use client'` in this module, on purpose. The root layout is a server component: it
 * inlines `THEME_SCRIPT` as text and puts `THEME_COLORS` in the viewport metadata. Imported from
 * a client module, both would arrive as client references rather than as a string and an object.
 */

export const THEME_KEY = 'vehicleos.theme';
/** `'1'` while the glass material is on; absent otherwise. */
export const GLASS_KEY = 'vehicleos.glass';

/**
 * The page colour per theme, as hex for the `theme-color` meta — the browser's own chrome, such
 * as a phone's address bar. From the shared tokens, so it cannot drift from the page it frames.
 */
export const THEME_COLORS = {
  dark: oklchToHex(DARK_TOKENS.background),
  light: oklchToHex(LIGHT_TOKENS.background),
} as const;

/**
 * Applies the theme before the first paint.
 *
 * React cannot: the server has no `localStorage` and no idea what the OS prefers, so the page
 * would paint in the default theme and then swap — a full-page flash on every load for everyone
 * on the other one. A synchronous script in `<head>` sets the attribute before anything paints.
 *
 * No stored choice means "system": the OS preference decides. Storage is read in its own `try`
 * so that when it is blocked, the OS preference still applies instead of the dark default.
 * Glass is its own key, read in the same `try`, and adds `data-glass` over whichever theme is on.
 */
export const THEME_SCRIPT = `(function(){var p=null,g=null;try{p=localStorage.getItem('${THEME_KEY}');g=localStorage.getItem('${GLASS_KEY}')}catch(e){}var t=p==='light'||p==='dark'?p:window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';var d=document.documentElement;d.dataset.theme=t;d.style.colorScheme=t;if(g==='1')d.setAttribute('data-glass','')})();`;
