'use client';

import { createAuthClient } from 'better-auth/react';
import { API_URL } from './api';

/**
 * Better Auth's browser client, pointed at the Fastify API rather than a Next.js route.
 *
 * The API owns authentication (Architecture.md §7), so there is no `/api/auth` handler in
 * this app to duplicate and drift from it.
 */
export const authClient = createAuthClient({
  baseURL: `${API_URL}/api/auth`,
});

export const { signIn, signUp, signOut } = authClient;

/**
 * What the app actually reads from a session.
 *
 * Declared rather than inferred: the library's own hook type cannot be named without
 * reaching into its `dist` directory, which TypeScript rejects as non-portable. Writing the
 * shape here also states the app's dependency on the provider explicitly — swapping it
 * means satisfying this interface, not chasing inference through node_modules.
 */
export interface SessionUser {
  id: string;
  email: string;
  name: string;
  image?: string | null;
}

export interface SessionState {
  data: { user: SessionUser } | null;
  isPending: boolean;
  error: { message?: string } | null;
}

export function useSession(): SessionState {
  return authClient.useSession() as unknown as SessionState;
}
