/**
 * Light, dark, or whatever the phone is set to — the person's choice, kept on this phone.
 *
 * Applied twice over: `Appearance.setColorScheme` turns the native parts (alerts, the keyboard,
 * date pickers, the status bar) to match, and `useScheme` is what every colour in the app reads, so
 * a choice redraws the app at once without waiting on the native change event to come back.
 *
 * Read from storage once, at launch, while the splash is still up (`_layout` waits on
 * `appearanceReady`), so the first frame is already in the chosen scheme.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';
import { Appearance, useColorScheme } from 'react-native';

export type AppearanceChoice = 'system' | 'light' | 'dark';

const KEY = 'vehicleos.appearance';
let choice: AppearanceChoice = 'system';
const listeners = new Set<() => void>();

function apply(next: AppearanceChoice) {
  choice = next;
  // `unspecified` hands the decision back to the phone.
  Appearance.setColorScheme(next === 'system' ? 'unspecified' : next);
  listeners.forEach((listener) => listener());
}

export const appearanceReady: Promise<void> = AsyncStorage.getItem(KEY)
  .then((stored) => {
    if (stored === 'light' || stored === 'dark') apply(stored);
  })
  // Unreadable storage costs the preference, never the launch.
  .catch(() => undefined);

export function setAppearance(next: AppearanceChoice): void {
  apply(next);
  void AsyncStorage.setItem(KEY, next).catch(() => undefined);
}

export function useAppearance(): AppearanceChoice {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => choice,
  );
}

/** The scheme the app draws in: the choice, or the phone's (dark when it says nothing). */
export function useScheme(): 'light' | 'dark' {
  const chosen = useAppearance();
  const system = useColorScheme();
  if (chosen !== 'system') return chosen;
  return system === 'light' ? 'light' : 'dark';
}
