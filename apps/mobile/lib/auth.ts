/**
 * Mobile authentication.
 *
 * The API is Better Auth with the `bearer` plugin, so signing in is an ordinary POST whose
 * response carries a `set-auth-token` header. There is no Better Auth *client* here on
 * purpose: the two calls this app makes are a sign-in and a sign-out, and pulling a second
 * HTTP stack and its own storage adapter into the bundle to make them is a poor trade.
 *
 * The session itself — the token, and who else is listening for it — lives in `./api`.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { api, API_URL, sessionToken, setSessionToken } from './api';
import { clearQueue } from './offline';
import { unregisterForPush } from './push';
import { forgetStoreAccount } from './store';

export { useSession, type Session } from './api';

/** Whose writes the offline queue holds: the last account signed in on this phone. */
const ACCOUNT_KEY = 'vehicleos.account';

export interface Credentials {
  readonly email: string;
  readonly password: string;
}

/** Auth calls get the same patience as the API client, so a dead network is an answer too. */
async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    return await fetch(`${API_URL}/api/auth${path}`, {
      method: 'POST',
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...headers,
      },
      /*
       * React Native has one process-wide cookie jar and attaches it to every request. This
       * app is bearer-only — the token lives in the keystore — so those cookies are not just
       * unused, they are actively harmful: Better Auth runs its CSRF origin check whenever a
       * request carries a cookie, and a native `fetch` sends no `Origin`, so sign-in comes
       * back 403 "Missing or null Origin". Omitting them skips the check the honest way.
       */
      credentials: 'omit',
      body: body === undefined ? undefined : JSON.stringify(body),
      // Typed for RN's `fetch`; Expo's globals also declare Node's AbortSignal (see api-client).
      signal: controller.signal as RequestInit['signal'],
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error('The server took too long to answer. Check your connection.');
    }
    throw new Error('Could not reach Garaj. Check your connection and try again.', {
      cause: error,
    });
  } finally {
    clearTimeout(timer);
  }
}

function errorFrom(payload: unknown, fallback: string): string {
  const message = (payload as { message?: string })?.message;
  return typeof message === 'string' && message ? message : fallback;
}

/**
 * Keeps the session a response handed over. The token comes back in a header, not the body,
 * and goes straight into the keystore.
 *
 * A different account than the last one on this phone starts with an empty queue. Writes left
 * by a session that expired wait for their owner to sign back in; sent under someone else's
 * session they would be refused and lost, or worse, recorded as that person's.
 */
async function adopt(response: Response, fallback: string): Promise<void> {
  const payload = (await response.json().catch(() => null)) as {
    user?: { id?: string };
  } | null;
  if (!response.ok) throw new Error(errorFrom(payload, fallback));

  const token = response.headers.get('set-auth-token');
  if (!token) throw new Error('The server did not return a session token.');

  const account = payload?.user?.id ?? null;
  const previous = await AsyncStorage.getItem(ACCOUNT_KEY).catch(() => null);
  if (account && previous && previous !== account) await clearQueue();
  if (account) await AsyncStorage.setItem(ACCOUNT_KEY, account).catch(() => undefined);

  await setSessionToken(token);
}

export async function signIn({ email, password }: Credentials): Promise<void> {
  await adopt(
    await post('/sign-in/email', { email, password }),
    'That email and password did not match.',
  );
}

export async function signUp(input: Credentials & { name: string }): Promise<void> {
  await adopt(await post('/sign-up/email', input), 'Could not create that account.');
}

/**
 * Asks for a reset link. The email opens the web app's reset page — the phone has no page to set a
 * password on — and the answer is the same whether or not the address has an account, so this can
 * never tell anyone who uses Garaj.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  const response = await post('/request-password-reset', { email });
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    throw new Error(errorFrom(payload, 'Could not send the link. Try again.'));
  }
}

/** Sends the confirmation link again, to the signed-in account's own address. */
export async function sendConfirmationEmail(email: string): Promise<void> {
  const token = sessionToken();
  const response = await post(
    '/send-verification-email',
    { email },
    token ? { authorization: `Bearer ${token}` } : {},
  );
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    throw new Error(errorFrom(payload, 'Could not send the link. Try again.'));
  }
}

/**
 * Ends the session on this phone, whatever the network says.
 *
 * The server is told when it can be — this phone's push token first, while the session still
 * authenticates the request that removes it — but neither call can stop the local token going.
 * A session left alive server-side expires on its own; a credential left on a phone because the
 * network was down is the worse of the two outcomes.
 */
export async function signOut(): Promise<void> {
  const token = sessionToken();
  await unregisterForPush().catch(() => undefined);
  if (token) {
    await post('/sign-out', undefined, { authorization: `Bearer ${token}` }).catch(() => undefined);
  }
  await setSessionToken(null);
  await AsyncStorage.removeItem(ACCOUNT_KEY).catch(() => undefined);
  // The store too: the next account on this phone must not inherit this one's purchases.
  await forgetStoreAccount();
}

/**
 * Deletes the account on the server — its live subscription cancelled, the garages it owns and
 * everything in them — then forgets it here. The server's answer comes first: nothing local is
 * dropped for an account that still exists.
 */
export async function deleteAccount(): Promise<void> {
  await api.users.deleteMe();
  await setSessionToken(null);
  await AsyncStorage.removeItem(ACCOUNT_KEY).catch(() => undefined);
  await forgetStoreAccount();
}
