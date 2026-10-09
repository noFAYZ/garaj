import { billingReturned } from '@/lib/billing-return';

/**
 * Links from outside the app, before the router sees them.
 *
 * Stripe's return (`…/billing-return?checkout=done`) is news, not a place. Warm, the upgrade
 * screen that opened the browser is still open and hears the outcome; routing would stack a
 * second screen over it, so the link itself goes nowhere. Cold — the app was closed while
 * paying — it opens the plan, which asks for the plan again as it mounts.
 */
export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }) {
  if (!path.includes('billing-return')) return path;
  if (initial) return '/settings/plan';
  billingReturned(path);
  return null;
}
