import { resolve } from 'node:path';

// The monorepo's one `.env`, as in apps/web: Next only reads env files from its own directory.
try {
  process.loadEnvFile(resolve(import.meta.dirname, '../../.env'));
} catch {
  // No root .env — a CI build with real environment variables.
}

const root = resolve(import.meta.dirname, '../..');

/*
 * The developer docs, on their own origin like the landing site.
 *
 * `@/` resolves to apps/web/src (tsconfig paths), so the docs wear the product's own stylesheet,
 * logo and components rather than copies of them. The API reference is read from the running
 * API's OpenAPI document — generated from the same schemas the server validates against — so a
 * route cannot change without its documentation changing with it.
 */
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: { externalDir: true },
  turbopack: { root },
  outputFileTracingRoot: root,
  transpilePackages: ['@vehicle-os/domain', '@vehicle-os/ui'],
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001',
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
    NEXT_PUBLIC_DOCS_URL: process.env.NEXT_PUBLIC_DOCS_URL ?? 'http://localhost:3004',
  },
};

export default nextConfig;
