/**
 * In-app reduce-motion preference.
 *
 * Separate from the OS setting on purpose: `useReducedMotion` from `motion` only sees the
 * media query, so an app-level toggle governs nothing until the root bridges it through
 * `<MotionConfig reducedMotion>`. Without that bridge the toggle silently affects only
 * hand-written CSS animation while every vendored component keeps moving.
 */

'use client';

import { useSyncExternalStore } from 'react';

const KEY = 'vehicleos.reduce-motion';
const CHANGE_EVENT = 'vehicleos-reduce-motion-change';

function subscribe(callback: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, callback);
  window.addEventListener('storage', callback);
  return () => {
    window.removeEventListener(CHANGE_EVENT, callback);
    window.removeEventListener('storage', callback);
  };
}

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === 'true';
  } catch {
    return false;
  }
}

export function setReduceMotion(value: boolean): void {
  try {
    localStorage.setItem(KEY, String(value));
  } catch {
    // Ignored: the dispatch below still updates this session.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function useReduceMotion(): boolean {
  return useSyncExternalStore(subscribe, read, () => false);
}
