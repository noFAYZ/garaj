import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { useSyncExternalStore } from 'react';
import { createApiClient } from '@vehicle-os/api-client';

const TOKEN_KEY = 'vehicleos.session-token';

/**
 * The API host.
 *
 * `localhost` on a phone means the phone, not the development machine, so the LAN address
 * Expo already knows about is used instead — the single most common reason a fresh mobile
 * setup cannot reach a working API.
 */
function resolveBaseUrl(): string {
  /*
   * Read off `expoConfig.extra` rather than `process.env` so no Node type definitions are
   * needed in a React Native app. Set `extra.apiUrl` in `app.json` to point at a deployed
   * API instead of the machine running Metro.
   *
   * The `typeof` check is not defensive padding. Expo serialises a JSON `null` in `extra`
   * as `{}` in the manifest it serves, and `{}` is truthy — so `"apiUrl": null` in
   * `app.json` was being returned as the base URL, and every screen died at import with
   * "options.baseUrl.replace is not a function". Anything that is not a real string is
   * ignored here.
   */
  const configured: unknown = Constants.expoConfig?.extra?.apiUrl;
  if (typeof configured === 'string' && configured.length > 0) return configured;

  // `localhost` on a device means the device, not the development machine, so the LAN
  // address Expo already knows about is used instead — the single most common reason a
  // fresh mobile setup cannot reach a working API.
  const host = Constants.expoConfig?.hostUri?.split(':')[0];
  return host ? `http://${host}:3001` : 'http://localhost:3001';
}

export const API_URL = resolveBaseUrl();

/*
 * The session: one store for the whole app.
 *
 * Mobile has no cookie jar it can rely on across app restarts, so the session travels as a
 * bearer token held in the platform keystore — Keychain on iOS, EncryptedSharedPreferences on
 * Android; `AsyncStorage` would put it in plain text on disk. The keystore is read once, at
 * launch; after that the token lives here, so a request does not decrypt it again, and every
 * screen that asks whether someone is signed in hears the same answer the moment it changes.
 * (Each screen holding its own copy is how signing in once sent the app straight back to the
 * sign-in screen: the gate's copy still said nobody was there.)
 */
export interface Session {
  readonly token: string | null;
  /** True until the keystore has been read on launch. */
  readonly loading: boolean;
  /** Why the last session ended, when it was the server's doing rather than the person's. */
  readonly ended: 'expired' | null;
}

let session: Session = { token: null, loading: true, ended: null };
const listeners = new Set<() => void>();

function publish(next: Session) {
  session = next;
  listeners.forEach((listener) => listener());
}

let loaded: Promise<void> | null = null;
/** Reads the keystore once; every later call is the same promise. */
export function loadSession(): Promise<void> {
  loaded ??= SecureStore.getItemAsync(TOKEN_KEY)
    .then((token) => publish({ token, loading: false, ended: null }))
    // An unreadable keystore (a restored backup on another phone) is a signed-out phone.
    .catch(() => publish({ token: null, loading: false, ended: null }));
  return loaded;
}

export function useSession(): Session {
  void loadSession();
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => session,
  );
}

/** The token now, for code outside React. */
export const sessionToken = () => session.token;

export async function setSessionToken(token: string | null): Promise<void> {
  if (token) await SecureStore.setItemAsync(TOKEN_KEY, token);
  else await SecureStore.deleteItemAsync(TOKEN_KEY);
  publish({ token, loading: false, ended: null });
}

/**
 * The server no longer knows this token — it expired, or was revoked from another device. The
 * gate sends the person to sign in, told why; nothing queued is lost, it goes out once they are
 * back.
 */
function expire(token: string) {
  // Only the session that was refused: a late 401 from before a fresh sign-in is not news.
  if (session.token !== token) return;
  void SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => undefined);
  publish({ token: null, loading: false, ended: 'expired' });
}

/** Exported for requests the typed client cannot make, such as a download written to disk. */
export async function authHeader(): Promise<Record<string, string>> {
  await loadSession();
  return session.token ? { authorization: `Bearer ${session.token}` } : {};
}

/** `fetch`, listening for the one answer that means the session is over. */
const sessionFetch: typeof fetch = async (input, init) => {
  const response = await fetch(input, init);
  if (response.status === 401) {
    const sent = (init?.headers as Record<string, string> | undefined)?.authorization;
    if (sent?.startsWith('Bearer ')) expire(sent.slice('Bearer '.length));
  }
  return response;
};

export const api = createApiClient({
  baseUrl: API_URL,
  getAuthHeader: authHeader,
  fetch: sessionFetch,
});
