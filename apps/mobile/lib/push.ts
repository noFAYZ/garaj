/**
 * Push registration (Architecture.md §36).
 *
 * Asked for once the person is signed in, not at launch: a permission prompt on a sign-in
 * screen is a question about an app they have not used yet, and the answer is usually no —
 * which on iOS is permanent until they dig through Settings.
 *
 * Failure is silent by design. No permission, a simulator, a missing project id — every one
 * leaves in-app notifications and email working, and none is worth an error on screen.
 */

import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { api } from './api';

let registered: string | null = null;

// Shown while the app is open too: the reminder is the point, and the bell alone is easy to miss.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export async function registerForPush(): Promise<void> {
  if (!Device.isDevice) return;

  const current = await Notifications.getPermissionsAsync();
  const status = current.granted
    ? current.status
    : (await Notifications.requestPermissionsAsync()).status;
  if (status !== 'granted') return;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('reminders', {
      name: 'Reminders',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? undefined;
  const { data: token } = await Notifications.getExpoPushTokenAsync(
    projectId ? { projectId } : undefined,
  );

  if (token === registered) return;
  await api.notifications.registerDevice({
    token,
    platform: Platform.OS === 'ios' ? 'ios' : 'android',
  });
  registered = token;
}

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
