/**
 * Mobile authentication.
 *
 * The API is Better Auth with the `bearer` plugin, so signing in is an ordinary POST whose
 * response carries a `set-auth-token` header. There is no Better Auth *client* here on
 * purpose: the two calls this app makes are a sign-in and a sign-out, and pulling a second
 * HTTP stack and its own storage adapter into the bundle to make them is a poor trade.
 */

import { useCallback, useEffect, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import { API_URL, clearSessionToken, storeSessionToken } from './api';
import { unregisterForPush } from './push';

const TOKEN_KEY = 'vehicleos.session-token';

export interface Credentials {
  readonly email: string;
  readonly password: string;
}

async function post(path: string, body: unknown): Promise<Response> {
  return fetch(`${API_URL}/api/auth${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    /*
     * React Native has one process-wide cookie jar and attaches it to every request. This
     * app is bearer-only — the token lives in the keystore — so those cookies are not just
     * unused, they are actively harmful: Better Auth runs its CSRF origin check whenever a
     * request carries a cookie, and a native `fetch` sends no `Origin`, so sign-in comes
     * back 403 "Missing or null Origin". Omitting them skips the check the honest way.
     */
    credentials: 'omit',
    body: JSON.stringify(body),
  });
}

function errorFrom(payload: unknown, fallback: string): string {
  const message = (payload as { message?: string })?.message;
  return typeof message === 'string' && message ? message : fallback;
}

export async function signIn({ email, password }: Credentials): Promise<void> {
  const response = await post('/sign-in/email', { email, password });
  if (!response.ok) {
    throw new Error(
      errorFrom(await response.json().catch(() => null), 'That email and password did not match.'),
    );
  }

  /*
   * The token comes back in a header, not the body. A phone has no cookie jar that survives
   * a restart, so it goes straight into the platform keystore — Keychain on iOS,
   * EncryptedSharedPreferences on Android.
   */
  const token = response.headers.get('set-auth-token');
  if (!token) throw new Error('The server did not return a session token.');
  await storeSessionToken(token);
}

export async function signUp(input: Credentials & { name: string }): Promise<void> {
  const response = await post('/sign-up/email', input);
  if (!response.ok) {
    throw new Error(
      errorFrom(await response.json().catch(() => null), 'Could not create that account.'),
    );
  }
  const token = response.headers.get('set-auth-token');
  if (token) await storeSessionToken(token);
}

export async function signOut(): Promise<void> {
  // While the session still authenticates the request that removes it.
  await unregisterForPush();
  const token = await SecureStore.getItemAsync(TOKEN_KEY);
  /*
   * The local token is cleared whatever the server says. If the request fails the session
   * stays alive server-side until it expires, but leaving the credential on the device
   * because the network was down is the worse of the two outcomes.
   */
  try {
    if (token) {
      await fetch(`${API_URL}/api/auth/sign-out`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        credentials: 'omit',
      });
    }
  } finally {
    await clearSessionToken();
  }
}

export interface SessionState {
  readonly token: string | null;
  readonly loading: boolean;
  readonly refresh: () => Promise<void>;
}

/**
 * Whether this device holds a token.
 *
 * Deliberately not "is the session valid" — that would be a network call on every launch,
 * and the app would sit on a splash screen in a tunnel. An expired token surfaces as the
 * first 401, which the root layout turns into a sign-in screen.
 */
export function useSession(): SessionState {
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setToken(await SecureStore.getItemAsync(TOKEN_KEY));
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { token, loading, refresh };
}
