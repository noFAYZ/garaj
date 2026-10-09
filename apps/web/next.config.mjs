import { resolve } from 'node:path';

/*
 * The monorepo keeps one `.env` at its root — that is what `@vehicle-os/config`'s
 * `loadEnvFile` walks up to, and what the API and the worker read. Next does not: it loads
 * env from its own directory, so a variable added to the root file is simply never seen and
 * the feature it gates looks broken for no visible reason.
 *
 * `process.loadEnvFile` is Node's own, so this needs no dotenv import. Values already in the
 * environment win, and `apps/web/.env.local` still overrides for anything web-specific.
 */
try {
  process.loadEnvFile(resolve(import.meta.dirname, '../../.env'));
} catch {
  // No root .env — a CI build with real environment variables, which is fine.
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // `<ViewTransition>`: route cross-fades and the vehicle card growing into its hero.
    // Swaps in Next's bundled experimental React for the App Router.
    viewTransition: true,
  },
  // Inlined explicitly: `NEXT_PUBLIC_*` is picked up from Next's own env files, and this one
  // comes from the root file loaded above.
  env: {
    NEXT_PUBLIC_LOGO_DEV_TOKEN: process.env.NEXT_PUBLIC_LOGO_DEV_TOKEN,
  },
  // Workspace packages ship TypeScript source rather than a build; Next has to compile them
  // itself or the import fails at runtime with a syntax error in node_modules.
  transpilePackages: [
    '@vehicle-os/api-client',
    '@vehicle-os/contracts',
    '@vehicle-os/domain',
    '@vehicle-os/ui',
  ],
  // No `images.remotePatterns`: photos are signed URLs drawn with a plain <img> (see
  // vehicle-card.tsx), and `next/image` only ever sees static imports. A `**` pattern here
  // made /_next/image a public resize proxy for any host on the internet, on this server's CPU.
};

export default nextConfig;
