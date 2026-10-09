/**
 * The toast store: plain data and one timer, outside React. `raise` is called from the query
 * client's mutation cache, which is created outside the React tree and has no provider to read.
 */

export interface Toast {
  id: number;
  tone: 'success' | 'error';
  text: string;
  /** How many times this same message was raised while it was up. */
  count: number;
  /** When it leaves, in epoch ms. Pushed back by however long the stack was held open. */
  due: number;
}

export const EMPTY: Toast[] = [];
let toasts: Toast[] = EMPTY;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | undefined;
let heldSince: number | null = null;

/** Three at once. Past that the stack is taller than the thing it is reporting on. */
const MAX = 3;
const SUCCESS_MS = 2600;
/** Longer: a failure is worth reading, and it is the only copy of the reason on screen. */
const ERROR_MS = 6000;

function emit() {
  for (const listener of listeners) listener();
}

/** One timeout, for whichever toast is due first. Nothing expires while the stack is held. */
function schedule() {
  clearTimeout(timer);
  if (heldSince !== null || toasts.length === 0) return;
  const next = Math.min(...toasts.map((toast) => toast.due));
  timer = setTimeout(() => {
    const now = Date.now();
    toasts = toasts.filter((toast) => toast.due > now);
    emit();
    schedule();
  }, next - Date.now());
}

/**
 * The same message raised again while it is up (three saves in a row) counts on the one toast
 * and restarts its clock, instead of stacking three identical "Saved"s.
 */
export function raise(tone: Toast['tone'], text: string) {
  const due = Date.now() + (tone === 'error' ? ERROR_MS : SUCCESS_MS);
  const same = toasts.find((toast) => toast.tone === tone && toast.text === text);
  toasts = same
    ? toasts.map((toast) => (toast === same ? { ...toast, count: toast.count + 1, due } : toast))
    : [...toasts, { id: Date.now() + Math.random(), tone, text, count: 1, due }].slice(-MAX);
  emit();
  schedule();
}

export function dismiss(id: number) {
  toasts = toasts.filter((toast) => toast.id !== id);
  emit();
  schedule();
}

/** Pointing at the stack or tabbing into it stops the clock; letting go gives the time back. */
export function hold(on: boolean) {
  if (on === (heldSince !== null)) return;
  if (on) {
    heldSince = Date.now();
    clearTimeout(timer);
    return;
  }
  const held = Date.now() - heldSince!;
  heldSince = null;
  toasts = toasts.map((toast) => ({ ...toast, due: toast.due + held }));
  emit();
  schedule();
}

export const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const snapshot = () => toasts;
