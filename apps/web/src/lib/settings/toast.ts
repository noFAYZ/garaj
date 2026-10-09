/**
 * Where toasts appear. A device preference, like theme and motion: it lives in `localStorage`
 * because a corner that suits a wide monitor may not suit a phone.
 */

'use client';

import { useSyncExternalStore } from 'react';

export const TOAST_POSITIONS = [
  'top-center',
  'top-right',
  'bottom-left',
  'bottom-center',
  'bottom-right',
] as const;
export type ToastPosition = (typeof TOAST_POSITIONS)[number];

/** Where they always were: over the foot of the screen, above the GarajAI pill. */
const DEFAULT: ToastPosition = 'bottom-center';
const KEY = 'vehicleos.toast-position';
const CHANGE_EVENT = 'vehicleos-toast-position-change';

function subscribe(callback: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, callback);
  window.addEventListener('storage', callback);
  return () => {
    window.removeEventListener(CHANGE_EVENT, callback);
    window.removeEventListener('storage', callback);
  };
}

function read(): ToastPosition {
  try {
    const stored = localStorage.getItem(KEY);
    return TOAST_POSITIONS.find((position) => position === stored) ?? DEFAULT;
  } catch {
    return DEFAULT;
  }
}

export function setToastPosition(value: ToastPosition): void {
  try {
    localStorage.setItem(KEY, value);
  } catch {
    // Ignored: the dispatch below still updates this session.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function useToastPosition(): ToastPosition {
  return useSyncExternalStore(subscribe, read, () => DEFAULT);
}
