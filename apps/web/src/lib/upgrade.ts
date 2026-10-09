'use client';

import { useQuery } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import { garagesQuery, planQuery, pricesQuery } from '@vehicle-os/api-client/react';
import type { PlanWall } from '@vehicle-os/api-client';
import {
  hasEntitlement,
  PLAN_NAMES,
  tierForCount,
  tierForEntitlement,
  type Entitlement,
  type PlanLimits,
} from '@vehicle-os/domain';
import { api } from '@/lib/api';

/**
 * The one upgrade wall, open or not (GAPS §10).
 *
 * A module store rather than context: the query client's error handler raises it, and that
 * handler lives outside the React tree — the same reason the toaster is built this way.
 */
let current: PlanWall | null = null;
const listeners = new Set<() => void>();

function set(next: PlanWall | null) {
  current = next;
  listeners.forEach((listener) => listener());
}

export const openUpgrade = (wall: PlanWall) => set(wall);
export const closeUpgrade = () => set(null);

export function useUpgradeWall(): PlanWall | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
    () => null,
  );
}

const LIMIT_NOUN: Record<keyof PlanLimits, string> = {
  vehicles: 'vehicles',
  garages: 'garages',
  members: 'people per garage',
};

/**
 * The plan, and the two questions every gated control asks of it *before* the server has to
 * refuse: is this feature included, and is there room for one more.
 *
 * Asking first is the difference between a wall and a trap. A form filled in and submitted
 * into a 409 is a person's time thrown away; a button that says "3 of 3" and opens the upgrade
 * instead is a choice offered at the moment it matters. The server still refuses regardless —
 * this is a courtesy, and a stale plan here costs one refusal, not a leak.
 *
 * While the plan loads, everything reads as allowed: blocking a free action on a slow request
 * is worse than letting the server answer it.
 */
export function usePlan() {
  const plan = useQuery(planQuery(api));
  const data = plan.data;
  // Loaded ahead of any wall, so one never opens on a blank price. Cached for an hour.
  useQuery({ ...pricesQuery(api), enabled: Boolean(data) && data?.plan !== 'BUSINESS' });

  const allows = (entitlement: Entitlement) => !data || hasEntitlement(data.plan, entitlement);

  /** A wall for a feature, or null when the plan includes it. */
  const featureWall = (entitlement: Entitlement, label: string): PlanWall | null =>
    allows(entitlement)
      ? null
      : {
          reason: 'feature',
          entitlement,
          requiredPlan: tierForEntitlement(entitlement) as 'PLUS' | 'BUSINESS',
          message: `${label} is part of the ${PLAN_NAMES[tierForEntitlement(entitlement)]} plan.`,
        };

  /**
   * A wall for one more of something, or null when there is room. Only vehicles and garages
   * are counted on the account; people are per garage, and the server alone knows that count.
   */
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
      message: `Your ${PLAN_NAMES[data.plan]} plan holds ${allowed} ${LIMIT_NOUN[limit]}.`,
    };
  };

  return { plan, data, allows, featureWall, limitWall };
}

/**
 * Whether the caller's *own* plan is the one that decides here.
 *
 * A garage's entitlements are its owner's (see `plan-access.ts`), so a free member of someone
 * else's business fleet is not limited by their own plan inside it. Walling them on their own
 * count would block them from a fleet that has plenty of room — the one direction a courtesy
 * check must never be wrong in.
 *
 * With a garage: only if they own it. Without one — a button whose garage is chosen later —
 * only if every garage they can reach is theirs. Anything uncertain, including not having
 * loaded yet, answers false, and the server's refusal opens the same wall if one is due.
 */
export function useOwnPlanGoverns(garageId?: string): boolean {
  const garages = useQuery(garagesQuery(api));
  const list = garages.data;
  if (!list || list.length === 0) return false;
  if (garageId) return list.find((garage) => garage.id === garageId)?.role === 'OWNER';
  return list.every((garage) => garage.role === 'OWNER');
}
