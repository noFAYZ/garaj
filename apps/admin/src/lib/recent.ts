import { useSyncExternalStore } from 'react';

/*
 * The last few records this browser opened, for the sidebar: a convenience for whoever is at
 * this screen, so it lives in `localStorage` and nowhere else. Storage that is blocked or full
 * only means the list is empty — every read and write is guarded.
 */

export interface Recent {
  kind: 'user' | 'garage' | 'vehicle';
  id: string;
  label: string;
  sub?: string;
  image?: string | null;
}

const KEY = 'garaj.admin.recent';
const LIMIT = 5;
const listeners = new Set<() => void>();
let cache: Recent[] | null = null;

function read(): Recent[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(parsed) ? (parsed as Recent[]).slice(0, LIMIT) : [];
  } catch {
    return [];
  }
}

const snapshot = () => (cache ??= read());

function subscribe(listener: () => void) {
  listeners.add(listener);
  // Another tab opened something: the list follows it.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== KEY) return;
    cache = read();
    listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

export function remember(item: Recent): void {
  const current = snapshot();
  const first = current[0];
  // Already at the top as it is: nothing to write, nothing to re-render.
  if (first && first.kind === item.kind && first.id === item.id && first.label === item.label)
    return;
  cache = [item, ...current.filter((row) => !(row.kind === item.kind && row.id === item.id))].slice(
    0,
    LIMIT,
  );
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    // A full or blocked storage keeps the list for this tab only.
  }
  listeners.forEach((listener) => listener());
}

export function forget(kind: Recent['kind'], id: string): void {
  cache = snapshot().filter((row) => !(row.kind === kind && row.id === id));
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    // As above.
  }
  listeners.forEach((listener) => listener());
}

export const useRecent = () => useSyncExternalStore(subscribe, snapshot, () => []);
