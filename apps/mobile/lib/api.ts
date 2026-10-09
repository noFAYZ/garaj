import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
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

/**
 * Mobile has no cookie jar it can rely on across app restarts, so the session travels as a
 * bearer token held in the platform keystore — Keychain on iOS, EncryptedSharedPreferences
 * on Android. `AsyncStorage` would put it in plain text on disk.
 */
export const API_URL = resolveBaseUrl();

/** Exported for requests the typed client cannot make, such as a download written to disk. */
export async function authHeader(): Promise<Record<string, string>> {
  const token = await SecureStore.getItemAsync(TOKEN_KEY);
  return token ? { authorization: `Bearer ${token}` } : {};
}

export const api = createApiClient({ baseUrl: API_URL, getAuthHeader: authHeader });

export async function storeSessionToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

export async function clearSessionToken(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}
