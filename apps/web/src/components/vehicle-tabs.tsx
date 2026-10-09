'use client';

import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import Link, { useLinkStatus } from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import {
  activityQuery,
  costQuery,
  documentsQuery,
  eventsQuery,
  expenseLedgerQuery,
  garageMembersQuery,
  garagesQuery,
  maintenancePlansQuery,
  queryKeys,
  readingsQuery,
  valuationsQuery,
  vehicleQuery,
} from '@vehicle-os/api-client/react';
import type { Vehicle } from '@vehicle-os/contracts';
import { capabilitiesFor } from '@vehicle-os/domain';
import { api } from '@/lib/api';
import { Icon, type IconName } from '@/components/icons';
import { buttonClass } from '@/components/ui/button-class';
import { addLinkProps } from '@/lib/open-add';
import { Select } from '@/components/ui/select';
import {
  PlusCoin,
  STRIP_ACTION,
  STRIP_ROW,
  STRIP_SCROLLER,
  StripPill,
  stripClass,
  stripTabClass,
  useStrip,
} from '@/components/ui/section-strip';
import { isReportTab, REPORT_TABS } from '@/components/vehicle/report-data';
import { windowStart } from '@/components/vehicle/spending-panel';
import { useStableReducedMotion } from '@/lib/hooks/use-stable-reduced-motion';
import { cn } from '@/lib/utils';

/**
 * Five sections (PRD §26).
 *
 * Logs is the vehicle's record: what was done. Reminders is what it is waiting on — repeating
 * services and one-off jobs, what needs you first; it was a rail under the hero on every tab, and as
 * a tab of its own each reminder gets its full row. Statistics is what that
 * record adds up to — a six-tab report (overview, refueling, expenses, income, services, routes)
 * with health and value on its overview. Documents are files rather
 * than activity, so they keep a place of their own. Drivers is who drives it — the garage's
 * assignments, seen from this vehicle.
 *
 * Health, spending and value used to sit at the top of Activity as three figures that each opened
 * a report in place. Comparing two meant opening one and losing the other, and the charts were
 * behind a press nothing advertised; as their own section they are all open at once.
 *
 * Schedules, Details and Photos were tabs of their own; their routes redirect so existing links
 * still land. Spending and Value now redirect here.
 *
 * `prefetch` warms the queries the tab's page reads on its first render, with the same
 * arguments, so the cache entries are the ones the page looks up. A page that changes what it
 * loads first has to change its line here too — otherwise the warm-up fetches data nobody reads.
 */
const TABS: readonly {
  segment: string;
  label: string;
  icon: IconName;
  prefetch: (client: QueryClient, vehicleId: string) => void;
}[] = [
  {
    segment: '',
    label: 'Logs',
    icon: 'timeline',
    prefetch: (client, id) => {
      void client.prefetchQuery(activityQuery(api, id));
      void client.prefetchQuery(maintenancePlansQuery(api, id));
    },
  },
  {
    segment: 'reminders',
    label: 'Reminders',
    icon: 'calendar',
    // The planned items ride on the activity entry, which Logs reads too.
    prefetch: (client, id) => {
      void client.prefetchQuery(activityQuery(api, id));
    },
  },
  {
    segment: 'statistics',
    label: 'Stats',
    icon: 'chart',
    // The report opens on Overview, last 12 months: its ledger and readings for that window.
    prefetch: (client, id) => {
      void client.prefetchQuery(costQuery(api, id, { from: windowStart(12) }));
      void client.prefetchQuery(expenseLedgerQuery(api, id, windowStart(12)));
      void client.prefetchQuery(readingsQuery(api, id, windowStart(12)));
      void client.prefetchQuery(valuationsQuery(api, id));
    },
  },
  {
    segment: 'documents',
    label: 'Docs',
    icon: 'document',
    prefetch: (client, id) => {
      void client.prefetchQuery(documentsQuery(api, id));
      void client.prefetchQuery(eventsQuery(api, id));
    },
  },
  {
    segment: 'drivers',
    label: 'Drivers',
    icon: 'people',
    // Who drives it lives on the garage's members; the vehicle, already loaded, names the garage.
    prefetch: (client, id) => {
      const garageId = client.getQueryData<Vehicle>(queryKeys.vehicle(id))?.garageId;
      if (garageId) void client.prefetchQuery(garageMembersQuery(api, garageId));
    },
  },
];

/**
 * The strip of vehicle sections, built to feel instant.
 *
 * Switching tabs felt slow for three reasons, and each has its own answer here:
 *
 * - The highlight waited for the route. The pill only moved once the new page had arrived, so
 *   a click looked ignored for as long as the navigation took. It now moves on the click, and
 *   a sweep appears on the tab only if the page is genuinely slow to follow.
 * - The page's data started loading when the page mounted. It now starts when the pointer
 *   reaches the tab, or it takes focus, or a finger touches it — a hover is a few hundred
 *   milliseconds of warning, which is usually the whole request.
 * - The arrow keys navigated. As a `tablist`, every arrow press loaded a page; three presses
 *   to reach Value were three navigations. These are links to pages, so they are a `nav` of
 *   links with `aria-current`, reached with Tab like any other link.
 *
 * It also sticks under the header, so a long history does not have to be scrolled back up
 * to change section.
 */
export function VehicleTabs({ vehicleId }: { vehicleId: string }) {
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const reduce = useStableReducedMotion();
  const base = `/vehicles/${vehicleId}`;

  /*
   * The tab that was clicked, until the route catches up with it. Reset during render when the
   * path changes rather than in an effect, so there is no frame where the pill jumps back to
   * the old tab before settling on the new one.
   */
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const [seenPath, setSeenPath] = useState(pathname);
  if (pathname !== seenPath) {
    setSeenPath(pathname);
    setPendingHref(null);
  }
  const activeHref = pendingHref ?? pathname;
  const reportOpen = activeHref === `${base}/statistics`;
  const onActivity = activeHref === base;
  const onReminders = activeHref === `${base}/reminders`;
  const onDocuments = activeHref === `${base}/documents`;
  const onDrivers = activeHref === `${base}/drivers`;

  // Only someone who may change the garage's people gets the strip's Assign — both from cache.
  const vehicle = useQuery(vehicleQuery(api, vehicleId));
  const garages = useQuery(garagesQuery(api));
  const role = garages.data?.find((garage) => garage.id === vehicle.data?.garageId)?.role;
  const canAssign = role ? capabilitiesFor(role).includes('garage.manage_members') : false;

  /*
   * What is late or coming due, as a count on Reminders — the one thing worth seeing before
   * choosing where to go, on the tab that answers it.
   */
  const plans = useQuery(maintenancePlansQuery(api, vehicleId));
  const overdue = plans.data?.filter((plan) => plan.status === 'OVERDUE').length ?? 0;
  const dueSoon = plans.data?.filter((plan) => plan.status === 'DUE_SOON').length ?? 0;

  // Sticking, and the return to the top after a switch from deep in a page, as every strip does.
  const { sentinelRef, stuck, markSwitch } = useStrip(pathname);
  const scrollerRef = useRef<HTMLDivElement>(null);

  // On a phone the strip scrolls sideways; the chosen tab is brought to the middle of it.
  useEffect(() => {
    const scroller = scrollerRef.current;
    const tab = scroller?.querySelector<HTMLElement>('[data-active]');
    if (!scroller || !tab || scroller.scrollWidth <= scroller.clientWidth) return;
    scroller.scrollTo({
      left: tab.offsetLeft - (scroller.clientWidth - tab.offsetWidth) / 2,
      behavior: reduce ? 'instant' : 'smooth',
    });
  }, [activeHref, reduce]);

  return (
    <>
      {/* Its negative margin cancels the column's gap, so the marker takes no space. */}
      <div ref={sentinelRef} aria-hidden="true" className="-mb-6 h-0" />

      <div className={STRIP_ROW}>
        <div ref={scrollerRef} className={STRIP_SCROLLER}>
          <nav aria-label="Vehicle sections" className={stripClass(stuck)}>
            {TABS.map((tab) => {
              const href = tab.segment ? `${base}/${tab.segment}` : base;
              const active = activeHref === href;
              /*
               * On a phone the control at the end of the strip needs the room. Beside the report
               * picker every section keeps only its icon (the picker says where you are); beside
               * Add, only the other sections do.
               */
              const iconOnly =
                reportOpen || ((onActivity || onReminders || onDocuments || onDrivers) && !active);
              const count = tab.segment === 'reminders' ? overdue || dueSoon : 0;
              const warm = () => tab.prefetch(queryClient, vehicleId);

              return (
                <Link
                  key={href}
                  href={href}
                  scroll={false}
                  // The page actually shown, not the one on its way: a screen reader should
                  // not announce a page as current before it is.
                  aria-current={pathname === href ? 'page' : undefined}
                  data-active={active || undefined}
                  onPointerEnter={warm}
                  onPointerDown={warm}
                  onFocus={warm}
                  onClick={(event) => {
                    // A new tab or window leaves this one where it is.
                    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                    markSwitch();
                    setPendingHref(href);
                  }}
                  className={stripTabClass(active)}
                >
                  {active ? <StripPill layoutId="vehicle-tab-active" /> : null}

                  <Icon name={tab.icon} size={16} />
                  <span className={cn(iconOnly && 'max-sm:sr-only')}>{tab.label}</span>

                  {count > 0 ? (
                    <span
                      className={cn(
                        'grid h-5 min-w-5 place-items-center rounded-full px-1.5 text-xs font-bold tabular-nums',
                        overdue > 0
                          ? 'bg-destructive text-destructive-foreground'
                          : 'bg-warning-soft text-warning',
                      )}
                    >
                      {count}
                      <span className="sr-only">{overdue > 0 ? ' overdue' : ' due soon'}</span>
                    </span>
                  ) : null}

                  <PendingSweep />
                </Link>
              );
            })}
          </nav>
        </div>
        {reportOpen ? (
          <ReportPicker base={base} stuck={stuck} />
        ) : onActivity ? (
          <AddButton vehicleId={vehicleId} />
        ) : onReminders ? (
          <AddReminderButton vehicleId={vehicleId} />
        ) : onDocuments ? (
          <AddDocumentButton vehicleId={vehicleId} />
        ) : onDrivers && canAssign ? (
          <AssignDriversButton vehicleId={vehicleId} />
        ) : null}
      </div>
    </>
  );
}

/**
 * Activity's one way in, at the end of the strip so it stays in reach as the record scrolls: a
 * split key. The face logs something done — the everyday case, also `N` — and the end adds a
 * reminder, the other answer to the dialog's first question, without asking it.
 *
 * Links, so the page opens its dialog from `?add=` as the dashboard's links do — changed in place
 * rather than navigated (`openHere`), or the route's cross-fade runs over the opening dialog.
 */
function AddButton({ vehicleId }: { vehicleId: string }) {
  const router = useRouter();
  const seam = 'hover:translate-y-0 active:scale-100';
  return (
    <div className="ml-auto flex shrink-0 gap-px print:hidden">
      <Link
        {...addLinkProps(router, `/vehicles/${vehicleId}?add=done`)}
        scroll={false}
        aria-keyshortcuts="N"
        className={buttonClass(
          'primary',
          'md',
          cn(seam, 'gap-2 rounded-r-md pl-2 pr-3.5 max-sm:pr-2'),
        )}
      >
        <PlusCoin />
        <span className="max-sm:sr-only">Add</span>
      </Link>
      <Link
        {...addLinkProps(router, `/vehicles/${vehicleId}?add=planned`)}
        scroll={false}
        aria-label="Add a reminder"
        title="Add a reminder"
        className={buttonClass('primary', 'md', cn(seam, 'rounded-l-md px-3'))}
      >
        <Icon name="calendar" size={16} />
      </Link>
    </div>
  );
}

/**
 * Reminders' way in, where Activity's is: one key that opens the add dialog straight on Reminder,
 * in place on this tab rather than sending you back to Logs.
 */
function AddReminderButton({ vehicleId }: { vehicleId: string }) {
  const router = useRouter();
  return (
    <Link
      {...addLinkProps(router, `/vehicles/${vehicleId}/reminders?add=planned`)}
      scroll={false}
      className={buttonClass('primary', 'md', STRIP_ACTION)}
    >
      <PlusCoin />
      <span className="max-sm:sr-only">Reminder</span>
    </Link>
  );
}

/** Documents' way in, where Activity's is: one key, opening the upload dialog in place. */
function AddDocumentButton({ vehicleId }: { vehicleId: string }) {
  const router = useRouter();
  return (
    <Link
      {...addLinkProps(router, `/vehicles/${vehicleId}/documents?add=document`)}
      scroll={false}
      className={buttonClass('primary', 'md', STRIP_ACTION)}
    >
      <PlusCoin />
      <span className="max-sm:sr-only">Add document</span>
    </Link>
  );
}

/** Drivers' way in, where the others' are: one key, opening who-drives-this in place. */
function AssignDriversButton({ vehicleId }: { vehicleId: string }) {
  const router = useRouter();
  return (
    <Link
      {...addLinkProps(router, `/vehicles/${vehicleId}/drivers?add=drivers`)}
      scroll={false}
      className={buttonClass('primary', 'md', STRIP_ACTION)}
    >
      <PlusCoin />
      <span className="max-sm:sr-only">Assign driver</span>
    </Link>
  );
}

/**
 * Which part of the report Statistics shows, beside the sections it belongs to — one dropdown
 * rather than a second strip of six tabs under the first. It writes `?tab=`, which the page
 * reads, so a report stays a link.
 */
function ReportPicker({ base, stuck }: { base: string; stuck: boolean }) {
  const search = useSearchParams();
  const router = useRouter();
  const tab = search.get('tab');
  return (
    <div
      className={cn(
        'ml-auto w-44 shrink-0 rounded-2xl p-1 transition-[background-color,box-shadow] duration-300 print:hidden max-sm:w-auto max-sm:min-w-0 max-sm:flex-1',
        stuck ? 'bg-popover shadow-float backdrop-blur-xl' : 'bg-card',
      )}
    >
      <Select
        ariaLabel="Report"
        value={isReportTab(tab) ? tab : 'overview'}
        onValueChange={(next) => {
          const params = new URLSearchParams(search);
          params.set('tab', next);
          router.replace(`${base}/statistics?${params.toString()}`, { scroll: false });
        }}
        options={REPORT_TABS.map((item) => ({
          value: item.value,
          label: item.label,
          icon: <Icon name={item.icon} size={16} />,
        }))}
      />
    </div>
  );
}

/**
 * A sweep along the bottom of a tab while its page is on the way.
 *
 * Shown after a delay, in CSS: a navigation that lands within ~120ms never draws it, because a
 * loader that flashes for one frame reads as a glitch rather than as progress.
 */
function PendingSweep() {
  const { pending } = useLinkStatus();
  return pending ? (
    <span
      aria-hidden="true"
      className="link-pending absolute inset-x-3 bottom-1 h-0.5 overflow-hidden rounded-full text-foreground/60"
    />
  ) : null;
}
