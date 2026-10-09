/*
 * Tailwind v4 is CSS-first: there is no `tailwind.config.js`, and the theme lives in the
 * `@theme` block in globals.css. Next has no Vite, so the PostCSS plugin is the entry point
 * rather than `@tailwindcss/vite`.
 */
export default {
  plugins: { '@tailwindcss/postcss': {} },
};
