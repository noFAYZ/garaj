/**
 * Push registration (Architecture.md §36).
 *
 * Asked for when it means something — the moment a reminder is made, or from This phone in
 * settings — never at launch or straight after sign-in: a permission prompt before the app has
 * done anything for someone is a question they answer no to, and on iOS that no is permanent
 * until they dig through Settings. Every launch registers again quietly where the answer was
 * already yes, so a new push token always reaches the server.
 *
 * Failure is silent by design. No permission, a simulator, a missing project id — every one
 * leaves in-app notifications and email working, and none is worth an error on screen.
 */

import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { api } from './api';
import { reportError } from './crash';

let registered: string | null = null;

// Shown while the app is open too: the reminder is the point, and the bell alone is easy to miss.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

/**
 * Registers this phone for reminders. `ask` shows the system prompt when the question has not
 * been answered yet; without it, only a phone that already said yes is registered.
 */
export async function registerForPush({ ask = false }: { ask?: boolean } = {}): Promise<void> {
  if (!Device.isDevice) return;

  /*
   * Android 13 shows its permission prompt only once a channel exists, so the channel comes
   * first — created after the request, the first ask on a new phone silently did nothing.
   */
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('reminders', {
      name: 'Reminders',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  const current = await Notifications.getPermissionsAsync();
  let granted = current.granted;
  if (!granted && ask && current.canAskAgain) {
    granted = (await Notifications.requestPermissionsAsync()).granted;
  }
  if (!granted) return;

  const projectId: unknown =
    Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (typeof projectId !== 'string') {
    /*
     * A build made before `eas init` has no project to issue push tokens for, and every reminder
     * would silently never arrive. Said once per launch to crash reporting, where it is a build
     * fault someone can act on, not a person's.
     */
    reportError(new Error('No EAS projectId in the app config: push is off for this build.'));
    return;
  }
  const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });

  if (token === registered) return;
  await api.notifications.registerDevice({
    token,
    platform: Platform.OS === 'ios' ? 'ios' : 'android',
  });
  registered = token;
}

/** The moment a reminder is made: ask, once, and register if the answer is yes. */
export const askForPush = () => registerForPush({ ask: true }).catch(() => undefined);

/**
 * Before the session goes: a phone that has signed out must stop receiving that account's
 * reminders, and the server only drops a token for the account that owns it.
 */
export async function unregisterForPush(): Promise<void> {
  if (!registered) return;
  const token = registered;
  registered = null;
  await api.notifications.unregisterDevice(token).catch(() => undefined);
}
