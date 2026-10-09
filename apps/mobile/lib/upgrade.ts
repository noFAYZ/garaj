import { useQuery } from '@tanstack/react-query';
import { createURL } from 'expo-linking';
import { router } from 'expo-router';
import type { PlanWall } from '@vehicle-os/api-client';
import { garagesQuery, planQuery, pricesQuery } from '@vehicle-os/api-client/react';
import type { PlanPrice } from '@vehicle-os/contracts';
import {
  formatPlanPrice,
  hasEntitlement,
  PLAN_NAMES,
  tierForCount,
  tierForEntitlement,
  type Entitlement,
} from '@vehicle-os/domain';
import { api } from '@/lib/api';

/**
 * Where checkout and the billing portal send the person back to. Not a screen: `+native-intent`
 * turns it into an event for the upgrade screen still open underneath (or the plan, cold).
 * `vehicleos://billing-return` in a build, `exp://<host>/--/billing-return` in Expo Go — never
 * the web app, which a phone may not reach.
 */
export const BILLING_RETURN = createURL('/billing-return');

let lastShown = 0;

/**
 * The upgrade wall: the upgrade screen, opened with the reason it was hit (GAPS §10).
 *
 * It used to be an alert whose "See plans" sent the person to settings — two hops, and the
 * second one landed on a page about their account rather than about the thing they had just
 * tried to do. The screen leads with that thing instead, and closing it returns them to it.
 *
 * Collapsed to one per few seconds: three vehicles queued offline and refused together on
 * reconnect are one wall, not three stacked screens.
 */
export function showUpgrade(wall: PlanWall): void {
  const now = Date.now();
  if (now - lastShown < 3_000) return;
  lastShown = now;

  router.push({
    pathname: '/upgrade',
    params: {
      reason: wall.reason,
      ...(wall.limit ? { limit: wall.limit } : {}),
      ...(wall.entitlement ? { entitlement: wall.entitlement } : {}),
      ...(wall.requiredPlan ? { plan: wall.requiredPlan } : {}),
    },
  });
}

/**
 * The plan, and a wall for a limit before a form is filled in. Same rules as the web's
 * `usePlan`: while it loads, everything reads as allowed — the server still refuses regardless.
 */
export function usePlan() {
  const plan = useQuery(planQuery(api));
  const data = plan.data;
  // Loaded ahead of any wall, so the upgrade screen never opens on a blank price.
  useQuery({ ...pricesQuery(api), enabled: Boolean(data) && data?.plan !== 'BUSINESS' });

  const allows = (entitlement: Entitlement) => !data || hasEntitlement(data.plan, entitlement);

  const featureWall = (entitlement: Entitlement, label: string): PlanWall | null =>
    allows(entitlement)
      ? null
      : {
          reason: 'feature',
          entitlement,
          requiredPlan: tierForEntitlement(entitlement) as 'PLUS' | 'BUSINESS',
          message: `${label} is part of the ${PLAN_NAMES[tierForEntitlement(entitlement)]} plan.`,
        };

  const limitWall = (limit: 'vehicles' | 'garages'): PlanWall | null => {
    if (!data) return null;
    const used = data.usage[limit];
    const allowed = data.limits[limit];
    if (used < allowed) return null;
    const upgrade = tierForCount(limit, used + 1);
    return {
      reason: 'limit',
      limit,
      requiredPlan: upgrade === 'PLUS' || upgrade === 'BUSINESS' ? upgrade : null,
      message: `Your ${PLAN_NAMES[data.plan]} plan holds ${allowed} ${limit}.`,
    };
  };

  return { plan, data, allows, featureWall, limitWall };
}

/**
 * Whether the caller's own plan decides here — see the web's `useOwnPlanGoverns`. A member of
 * someone else's fleet is governed by the owner's plan, and walling them on their own count
 * would block them from a garage with room to spare.
 */
export function useOwnPlanGoverns(garageId?: string): boolean {
  const garages = useQuery(garagesQuery(api));
  const list = garages.data;
  if (!list || list.length === 0) return false;
  if (garageId) return list.find((garage) => garage.id === garageId)?.role === 'OWNER';
  return list.every((garage) => garage.role === 'OWNER');
}

/** Each paid feature's glyph. Its name and one-line description are `ENTITLEMENT_COPY`. */
export const FEATURE_ICON: Record<
  Entitlement,
  'document-text' | 'cash' | 'speedometer' | 'people'
> = {
  'passport.share': 'document-text',
  'income.track': 'cash',
  'mileage.report': 'speedometer',
  'driver.assign': 'people',
};

/** "$2.99 / mo" — the one way a price is written on the phone. */
export function priceLabel(price: PlanPrice): string {
  const { amount, per } = formatPlanPrice(price);
  return `${amount} / ${per}`;
}
