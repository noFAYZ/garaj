import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/*
 * `@/` is the web app's source: the admin console is built from the same Garaj components
 * (Modal, SettingsModal, Readings, Field, …) rather than a copy that drifts. The only Next.js
 * pieces those reach for are `next/link` and `next/image`, shimmed with plain elements.
 *
 * ponytail: importing across apps. When a third client needs these, move them into
 * `packages/ui` and point both apps at it.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      { find: 'next/link', replacement: here('./src/shims/next-link.tsx') },
      { find: 'next/image', replacement: here('./src/shims/next-image.tsx') },
      { find: /^@\//, replacement: `${here('../web/src')}/` },
    ],
    // One React for both source trees, or hooks from a web component would see another copy.
    dedupe: ['react', 'react-dom', 'motion', '@tanstack/react-query'],
  },
  server: { port: 3002 },
});
