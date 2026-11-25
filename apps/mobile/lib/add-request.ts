import { useEffect, useRef } from 'react';
import type { EventType } from '@vehicle-os/domain';
import type { ActivityMode, QuickAction } from '@/components/add-activity';

/**
 * Opening the + drawer on its add form from anywhere — a reminder's Log, Home's Up next, an empty
 * list's "add". The drawer is the one place an entry is added; there is no add screen beside it.
 */
export interface AddRequest {
  /** The vehicle it is for; absent, the form asks. */
  readonly vehicleId?: string;
  readonly mode?: ActivityMode;
  readonly kind?: EventType;
  /** A reminder's Log: the form completes this schedule. */
  readonly planId?: string;
  /** Home's quick actions: the drawer opens on this quick entry instead of the form. */
  readonly quick?: QuickAction;
}

/*
 * The drawers mounted right now, oldest first. A vehicle's dock mounts over the tab bar's, so the
 * last one is the one in front — the one a press on this screen means.
 */
const takers: ((request: AddRequest) => void)[] = [];

export function openAdd(request: AddRequest = {}): void {
  takers[takers.length - 1]?.(request);
}

/** Takes add requests while mounted. */
export function useAddRequests(take: (request: AddRequest) => void): void {
  const latest = useRef(take);
  latest.current = take;
  useEffect(() => {
    const taker = (request: AddRequest) => latest.current(request);
    takers.push(taker);
    return () => {
      takers.splice(takers.indexOf(taker), 1);
    };
  }, []);
}
