import { resolve } from 'node:path';

// The monorepo's one `.env`, as in apps/web: Next only reads env files from its own directory.
try {
  process.loadEnvFile(resolve(import.meta.dirname, '../../.env'));
} catch {
  // No root .env — a CI build with real environment variables.
}

const root = resolve(import.meta.dirname, '../..');

/*
 * The marketing site, apart from the product so it can ship, cache and be indexed on its own.
 *
 * `@/` resolves to apps/web/src (tsconfig paths): the page is built from the product's own
 * components — Readings, ThemePicker, Icon, the button styles — and its stylesheet, not copies.
 * Next compiles files outside an app's directory only when told to, hence `externalDir` and a
 * Turbopack root at the repository.
 *
 * ponytail: apps/admin and this app both reach into apps/web. The next component either of them
 * needs is the moment to move the shared ones into `packages/ui`.
 */
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: { externalDir: true },
  turbopack: { root },
  outputFileTracingRoot: root,
  transpilePackages: ['@vehicle-os/domain', '@vehicle-os/ui'],
  env: {
    // Where "Start free" and "Sign in" go: the product, on its own origin.
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
    // Its own public address: canonical URL, sitemap, and the base for the link-preview image.
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3003',
    // The developer docs (apps/docs), for the MCP card and the footer — the same variable as web's.
    NEXT_PUBLIC_DOCS_URL: process.env.NEXT_PUBLIC_DOCS_URL ?? 'http://localhost:3004',
  },
};

export default nextConfig;
