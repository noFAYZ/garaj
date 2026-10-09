/**
 * Stripe sending someone back to the app, as an event rather than a route.
 *
 * `app/+native-intent.tsx` hears the link before the router does and reports it here; the
 * upgrade screen that opened the browser listens. No imports, so the router can load it early.
 */
export type BillingOutcome = 'done' | 'cancelled' | 'back';

const listeners = new Set<(outcome: BillingOutcome) => void>();

export function billingReturned(url: string): void {
  const outcome: BillingOutcome = url.includes('checkout=done')
    ? 'done'
    : url.includes('checkout=cancelled')
      ? 'cancelled'
      : 'back';
  listeners.forEach((listener) => listener(outcome));
}

export function onBillingReturn(listener: (outcome: BillingOutcome) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
