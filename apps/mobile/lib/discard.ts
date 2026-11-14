/**
 * Asking before throwing away what was typed.
 *
 * A form a back swipe can close — every add screen, the edit screen, the + sheet — lost
 * everything in it to one stray thumb at the screen's edge. Now, while a form holds input, every
 * way out asks first: the back button, the iOS edge swipe (the native stack disables the gesture
 * while a removal is prevented) and Android's Back. A form with nothing in it, or one that has just
 * saved, leaves at once.
 */

import { usePreventRemove, useNavigation } from '@react-navigation/native';
import { useCallback, useEffect, useRef } from 'react';
import { Alert } from 'react-native';

export function confirmDiscard(discard: () => void): void {
  Alert.alert('Discard changes?', 'What you have entered here has not been saved.', [
    { text: 'Keep editing', style: 'cancel' },
    { text: 'Discard', style: 'destructive', onPress: discard },
  ]);
}

/**
 * Holds the screen while `dirty`. Returns `release`, to call just before a save navigates away:
 * the navigation that follows a save happens before the form's state says it is saved, and would
 * otherwise be asked about.
 */
export function useDiscardGuard(dirty: boolean): () => void {
  const navigation = useNavigation();
  const released = useRef(false);
  usePreventRemove(dirty, ({ data }) => {
    const leave = () => navigation.dispatch(data.action);
    // After the navigator has finished refusing this action, not from inside its handling of it.
    if (released.current) queueMicrotask(leave);
    else confirmDiscard(leave);
  });
  return useCallback(() => {
    released.current = true;
  }, []);
}

/**
 * For a form drawn inside a host that decides how it closes (a screen, the + sheet): tells the
 * host whether the form holds input, and that it no longer does once it is gone.
 */
export function useReportDirty(dirty: boolean, report: ((dirty: boolean) => void) | undefined) {
  useEffect(() => {
    report?.(dirty);
    return () => report?.(false);
  }, [dirty, report]);
}
