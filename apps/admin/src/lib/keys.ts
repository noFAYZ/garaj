/** Whether a key press belongs to a field being typed in, rather than to the console. */
export const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

export const isMac = () => /Mac|iPhone|iPad/.test(navigator.userAgent);

/** `G` then a letter: where each one goes. The palette and the shortcuts sheet both read this. */
export const GO_TO: Record<string, { section: string; label: string }> = {
  o: { section: 'overview', label: 'Overview' },
  a: { section: 'analytics', label: 'Analytics' },
  s: { section: 'system', label: 'System' },
  l: { section: 'logs', label: 'Logs' },
  u: { section: 'users', label: 'Users' },
  g: { section: 'garages', label: 'Garages' },
  v: { section: 'vehicles', label: 'Vehicles' },
  f: { section: 'settings', label: 'Settings' },
};
