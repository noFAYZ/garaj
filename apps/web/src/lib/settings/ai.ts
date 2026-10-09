/**
 * GarajAI's settings, per device: the model it asks, and what it may do.
 *
 * The permissions are consent, not security — every write still goes through the same
 * authorised API the person could call by hand, and each one waits for their approve. They say
 * which kinds of work GarajAI should offer at all.
 */

'use client';

import type { AiAbility } from '@vehicle-os/contracts';
import { useSyncExternalStore } from 'react';

/** The assistant's name, wherever it is shown or announced. */
export const AI_NAME = 'GarajAI';

export interface AiSettings {
  /** `null` is the server's default. */
  model: string | null;
  canAsk: boolean;
  canLog: boolean;
  canPlan: boolean;
  /** Add and change vehicles and garages. */
  canManage: boolean;
  /** Remove vehicles, garages and entries (each still takes two presses). */
  canDelete: boolean;
  /** On a vehicle's page, questions and entries are about that vehicle. */
  followPage: boolean;
  /** Ctrl/⌘ J opens and closes it. */
  shortcut: boolean;
}

export const AI_DEFAULTS: AiSettings = {
  model: null,
  canAsk: true,
  canLog: true,
  canPlan: true,
  canManage: true,
  canDelete: true,
  followPage: true,
  shortcut: true,
};

const KEY = 'vehicleos.ai';
const CHANGE_EVENT = 'vehicleos-ai-change';
// The settings for this session when storage refuses them (a private window, blocked data).
let memory: AiSettings | null = null;
// `useSyncExternalStore` needs the same object back while nothing changed.
let cached: { raw: string | null; value: AiSettings } | null = null;

function subscribe(callback: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, callback);
  window.addEventListener('storage', callback);
  return () => {
    window.removeEventListener(CHANGE_EVENT, callback);
    window.removeEventListener('storage', callback);
  };
}

function read(): AiSettings {
  let raw: string | null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return memory ?? AI_DEFAULTS;
  }
  if (cached?.raw === raw) return cached.value;
  let value = AI_DEFAULTS;
  try {
    value = {
      ...AI_DEFAULTS,
      ...(raw ? (JSON.parse(raw) as Partial<AiSettings>) : {}),
    };
  } catch {
    // A value from an older shape or a hand edit: the defaults, rather than a broken console.
  }
  cached = { raw, value };
  return value;
}

export function setAiSettings(patch: Partial<AiSettings>): void {
  const next = { ...read(), ...patch };
  memory = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Ignored: `memory` carries it for this session.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function useAiSettings(): AiSettings {
  return useSyncExternalStore(subscribe, read, () => AI_DEFAULTS);
}

/** The changes the server may offer the model, from what the person allowed. */
export function abilitiesOf(settings: AiSettings): AiAbility[] {
  return [
    ...(settings.canLog ? (['log'] as const) : []),
    ...(settings.canPlan ? (['plan'] as const) : []),
    ...(settings.canManage ? (['vehicles', 'garages'] as const) : []),
    ...(settings.canDelete ? (['delete'] as const) : []),
  ];
}
