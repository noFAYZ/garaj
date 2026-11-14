/**
 * Over-the-air fixes (EAS Update).
 *
 * The native side already checks once per cold start (`checkAutomatically: ON_LOAD`, the default)
 * and, with no wait configured, downloads in the background and applies on the *next* cold start.
 * A phone that keeps the app alive for days would therefore run last week's JavaScript for days.
 * So the app also asks when it comes back to the foreground, at most hourly, and only downloads:
 * the fix applies on the next launch. It never reloads under someone — a half-typed entry is worth
 * more than a fix arriving a few minutes sooner.
 *
 * Off in development and in any build without an updates URL (`eas update:configure` adds it),
 * where `Updates.isEnabled` is false.
 *
 * Runtime is `appVersion` (app.json): bump `version` with every native change, or an update built
 * for the new native code would be offered to the old binary.
 */

import type * as UpdatesModuleType from 'expo-updates';
import { AppState } from 'react-native';

type UpdatesModule = typeof UpdatesModuleType;

const CHECK_EVERY_MS = 60 * 60 * 1000;
// The launch check has just run natively; the first foreground check waits its turn.
let lastCheck = Date.now();
let busy = false;
let downloaded = false;

async function check(Updates: UpdatesModule): Promise<void> {
  if (busy || downloaded || Date.now() - lastCheck < CHECK_EVERY_MS) return;
  busy = true;
  lastCheck = Date.now();
  try {
    const { isAvailable } = await Updates.checkForUpdateAsync();
    if (isAvailable) downloaded = (await Updates.fetchUpdateAsync()).isNew;
  } catch {
    // Offline or the update server is down: the next foreground tries again.
  } finally {
    busy = false;
  }
}

export function watchForUpdates(): void {
  if (__DEV__) return;
  /*
   * Loaded only past that check: the module reaches for its native half on import, and a
   * development build made before it was added has none — it would not start at all.
   */
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Updates = require('expo-updates') as UpdatesModule;
  if (!Updates.isEnabled) return;
  AppState.addEventListener('change', (state) => {
    if (state === 'active') void check(Updates);
  });
}
