import { useMemo, useSyncExternalStore } from 'react';

/*
 * Routing is the hash: `#/section/id?filter=value`. A handful of screens, a detail sheet each, and
 * their filters — a router library would be most of the bundle. The id opens the sheet and the
 * query holds the list's search and filters, so a filtered list or a person is a link to paste.
 */

const subscribe = (callback: () => void) => {
  window.addEventListener('hashchange', callback);
  return () => window.removeEventListener('hashchange', callback);
};

/** Names a section used to have, and the old group name: old links and bookmarks still land. */
const ALIASES: Record<string, string> = {
  usage: 'analytics',
  audit: 'logs',
  management: 'users',
  features: 'settings',
};

export interface Route {
  section: string;
  id: string | undefined;
  params: URLSearchParams;
}

export function parseHash(hash: string): Route {
  const [path = '', query = ''] = hash.replace(/^#\/?/, '').split('?');
  const [section, id] = path.split('/');
  const name = section || 'overview';
  return {
    section: ALIASES[name] ?? name,
    id: id ? decodeURIComponent(id) : undefined,
    params: new URLSearchParams(query),
  };
}

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash);
  return useMemo(() => parseHash(hash), [hash]);
}

/** A link into the console. Empty params are dropped, so a cleared filter leaves no `?q=`. */
export function href(
  section: string,
  id?: string,
  params?: URLSearchParams | Record<string, string | null | undefined>,
): string {
  const entries = (
    params instanceof URLSearchParams ? [...params.entries()] : Object.entries(params ?? {})
  ).filter((entry): entry is [string, string] => Boolean(entry[1]));
  const query = new URLSearchParams(entries).toString();
  return `#/${section}${id ? `/${encodeURIComponent(id)}` : ''}${query ? `?${query}` : ''}`;
}

/**
 * Changes the current filters in place. `replaceState`, so typing a search does not leave a
 * history entry per letter; the event is raised by hand because only navigation raises it.
 */
export function setParams(patch: Record<string, string | null | undefined>): void {
  const { section, id, params } = parseHash(window.location.hash);
  for (const [key, value] of Object.entries(patch)) {
    if (value) params.set(key, value);
    else params.delete(key);
  }
  history.replaceState(null, '', href(section, id, params));
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

/** Back to the section's list: closing a sheet drops the id and keeps the filters. */
export function closeDetail(): void {
  const { section, params } = parseHash(window.location.hash);
  window.location.hash = href(section, undefined, params);
}
