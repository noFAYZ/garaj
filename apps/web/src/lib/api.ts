import { createApiClient } from '@vehicle-os/api-client';

/**
 * The API base URL.
 *
 * `NEXT_PUBLIC_` because the browser makes the calls directly — Next.js is a client of the
 * Fastify API, not a proxy in front of it (Architecture.md §62). Domain rules stay on one
 * side of the wire.
 */
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

/**
 * One client for the whole app. It holds no per-user state — the session travels in a
 * cookie the browser attaches — so a module-level instance is safe and avoids threading a
 * provider through every component that needs to fetch.
 */
export const api = createApiClient({ baseUrl: API_URL });
