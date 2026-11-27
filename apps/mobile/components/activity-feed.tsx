import { Ionicons } from '@expo/vector-icons';
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { memo, useEffect, useMemo, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import type {
  MaintenancePlan,
  PlannedItem,
  Task,
  Vehicle,
  VehicleEvent,
} from '@vehicle-os/contracts';
import { positionsForJob } from '@vehicle-os/domain';
import {
  activityQuery,
  documentsQuery,
  photosQuery,
  queryKeys,
} from '@vehicle-os/api-client/react';
import { daysUntil, dueGauge, groupByMonth, odometerDeltas, spanOfDays } from '@vehicle-os/ui';
import {
  lastFitted,
  PartChips,
  positionLabel,
  useParts,
  type PartLike,
} from '@/components/parts-kit';
import { photoKey } from '@/components/remote-image';
import {
  FactChips,
  fillQuantity,
  type Filed,
  KindIcon,
  LedgerCard,
  LedgerMonth,
  LedgerPlaceholder,
  LedgerRow,
} from '@/components/timeline';
import { openAdd } from '@/lib/add-request';
import { api } from '@/lib/api';
import { jobEmoji } from '@/lib/emoji';
import { ledgerDate, unitPrice } from '@/lib/ledger';
import { pad, DATE_LOCALE, formatDistance, formatMoney, humanise } from '@/lib/format';
import { Glyph, StatusDot, ToneChip, type Tone } from '@/lib/instrument';
import { ease, haptic, Pop, PressableScale, Pulse, Rise, useReduceMotion } from '@/lib/motion';
import {
  discard,
  enqueue,
  flush,
  usePendingWrites,
  type PendingWrite,
  type SentWrite,
} from '@/lib/offline';
import { figure, rimmed, spacing, typeScale, useTheme, leaf } from '@/lib/theme';
import { Button, Skeleton } from '@/lib/ui';

const DATE = new Intl.DateTimeFormat(DATE_LOCALE, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

/** A done entry that lives on this phone until the queue has sent it. */
type LocalEvent = VehicleEvent & {
  readonly local: { readonly writeId: string; readonly error?: string };
};

const money = (amount: unknown, currency: unknown) =>
  typeof amount === 'number' && typeof currency === 'string'
    ? { amountMinor: amount, currency }
    : null;

/**
 * Queued writes, drawn as the entries they will become, so a fill-up shows in the logbook the
 * moment it is saved rather than when the network allows. A write the server has just accepted
 * stays until this feed's own data is newer than the send — then the server's copy replaces it.
 */
function localEvents(
  writes: readonly (PendingWrite | SentWrite)[],
  vehicleId: string,
  schedules: readonly MaintenancePlan[],
  dataUpdatedAt: number,
): LocalEvent[] {
  return writes.flatMap((write): LocalEvent[] => {
    if ('sentAt' in write && write.sentAt <= dataUpdatedAt) return [];
    if (
      (write.kind !== 'event' &&
        write.kind !== 'maintenance' &&
        write.kind !== 'maintenance-log') ||
      write.vehicleId !== vehicleId
    ) {
      return [];
    }
    // What the entry will be, read off the body each kind actually sends.
    const shown =
      write.kind === 'event'
        ? {
            eventType: write.body.eventType,
            title: write.body.title,
            occurredAt: write.body.occurredAt,
            cost: money(write.body.costAmountMinor, write.body.costCurrency),
            description: write.body.description ?? null,
          }
        : {
            eventType: 'MAINTENANCE' as const,
            title:
              write.kind === 'maintenance-log'
                ? write.body.title
                : (write.body.workPerformed ??
                  schedules.find((plan) => plan.id === write.planId)?.title ??
                  'Service'),
            occurredAt: write.body.performedAt,
            cost: money(write.body.laborCostAmountMinor, write.body.costCurrency),
            description: null,
          };
    return [
      {
        id: `local-${write.id}`,
        ...shown,
        odometer: write.body.odometer ?? null,
        odometerUnit: write.body.odometerUnit ?? null,
        provider: null,
        local: { writeId: write.id, error: write.error },
      } as unknown as LocalEvent,
    ];
  });
}

const isLocal = (event: VehicleEvent): event is LocalEvent => 'local' in event;

/**
 * How many of the not-yet-urgent jobs are listed before the rest fold away. Three is a glance;
 * the record below them is what the screen is for.
 */
const LATER_SHOWN = 3;

/** Late, or due within the week — the web's line, so both apps split the list in the same place. */
function needsYou(item: PlannedItem): boolean {
  if (item.kind === 'SCHEDULE') {
    return item.schedule.status === 'OVERDUE' || item.schedule.status === 'DUE_SOON';
  }
  return item.task.dueDate !== null && daysUntil(item.task.dueDate) <= 7;
}

/**
 * A vehicle's logbook: the record only, newest first and straight in — no heading over it, the dock
 * already says where you are — month by month, each month on a card of its own under its heading
 * (user asked: as Home's recent activity), each day on the road, down to where it starts. Every
 * entry opens. What is coming up is Reminders' alone, so the two never repeat.
 */
export function ActivityFeed({
  vehicle,
  bottom = 0,
}: {
  vehicle: Vehicle;
  /** Room under the last entry, for what floats over the page's foot. */
  bottom?: number;
}) {
  const theme = useTheme();
  const [showOlder, setShowOlder] = useState(false);

  // No filter chips (user asked): the whole record, always.
  const activity = useQuery(activityQuery(api, vehicle.id));

  /*
   * Older pages after the first. The first page's cursor is in the key: once an entry is added the
   * first page shifts by one, and pages fetched from the old cursor would skip the entry that
   * crossed the boundary.
   */
  const firstCursor = activity.data?.done.pagination.nextCursor ?? null;
  const older = useInfiniteQuery({
    queryKey: [...queryKeys.activity(vehicle.id), 'older', firstCursor],
    queryFn: ({ pageParam }) => api.activity(vehicle.id, { cursor: pageParam }),
    initialPageParam: firstCursor ?? '',
    getNextPageParam: (page) => page.done.pagination.nextCursor ?? undefined,
    enabled: showOlder && firstCursor !== null,
    // While a shifted first page refetches the older ones, the ones on screen stay on screen.
    placeholderData: keepPreviousData,
  });
  /*
   * How many older pages the person has asked for. A new entry moves the first page's cursor and
   * so the key above, and the history they had scrolled back through would otherwise collapse to
   * one page; this asks for the same number again from the new cursor.
   */
  const [olderPages, setOlderPages] = useState(1);
  const loadedPages = older.isPlaceholderData ? 0 : (older.data?.pages.length ?? 0);
  useEffect(() => {
    if (!showOlder || older.isFetching || !older.hasNextPage) return;
    if (loadedPages > 0 && loadedPages < olderPages) void older.fetchNextPage();
  }, [showOlder, older, loadedPages, olderPages]);

  /*
   * What is filed against each entry, for its thumbnail: the vehicle page already reads both, so
   * this is the cache, not two more requests. A photo is the preferred picture, then a paper's.
   */
  const photos = useQuery(photosQuery(api, vehicle.id));
  const papers = useQuery(documentsQuery(api, vehicle.id));
  const filed = useMemo(() => {
    const byEvent = new Map<string, Filed>();
    const add = (eventId: string | null, uri: string | null, cacheKey: string) => {
      if (!eventId) return;
      const seen = byEvent.get(eventId);
      byEvent.set(
        eventId,
        seen
          ? { ...(seen.uri || !uri ? seen : { uri, cacheKey }), count: seen.count + 1 }
          : { uri, cacheKey, count: 1 },
      );
    };
    for (const photo of photos.data ?? []) {
      add(photo.eventId, photo.thumbnailUrl, photoKey(photo, 'thumb'));
    }
    for (const paper of papers.data?.data ?? []) {
      add(paper.eventId, paper.thumbnailUrl, `document:${paper.id}`);
    }
    return byEvent;
  }, [photos.data, papers.data]);

  // What went in with each entry, for its chips: the parts read the Upkeep tab shares.
  const { history: partLines } = useParts(vehicle);
  const partsByEvent = useMemo(() => {
    const byEvent = new Map<string, PartLike[]>();
    for (const part of partLines) {
      if (part.eventId) byEvent.set(part.eventId, [...(byEvent.get(part.eventId) ?? []), part]);
    }
    return byEvent;
  }, [partLines]);

  const planned = activity.data?.planned;
  const writes = usePendingWrites();
  const updatedAt = activity.dataUpdatedAt;
  const local = useMemo(() => {
    const schedules = (planned ?? []).flatMap((item) =>
      item.kind === 'SCHEDULE' ? [item.schedule] : [],
    );
    return localEvents(writes, vehicle.id, schedules, updatedAt);
  }, [writes, vehicle.id, planned, updatedAt]);
  // What this vehicle still has waiting on the network, failed entries aside.
  const waiting = writes.filter(
    (write) =>
      !write.error &&
      !('sentAt' in write) &&
      'vehicleId' in write &&
      write.vehicleId === vehicle.id,
  ).length;
  /*
   * Newest first by when each entry happened, the server's order — with this phone's unsent
   * entries slotted in by the same rule rather than stacked on top.
   */
  /*
   * The record, derived once per change of what goes into it — not on every render. A pending
   * write ticking or the sync strip would otherwise re-sort, re-group and
   * re-measure the whole loaded history each time. The rows themselves are memoised below, so an
   * entry that did not change is not drawn again either.
   */
  const firstPage = activity.data?.done.data;
  const olderData = showOlder ? older.data : undefined;
  const { done, groups, deltas } = useMemo(() => {
    const seen = new Set<string>();
    const rows = [
      ...local,
      ...(firstPage ?? []),
      ...(olderData?.pages.flatMap((page) => page.done.data) ?? []),
    ]
      // A boundary the first page moved across can repeat an entry between two pages.
      .filter((event) => (seen.has(event.id) ? false : (seen.add(event.id), true)))
      .map((event) => ({ event, at: Date.parse(event.occurredAt) }))
      .sort((a, b) => b.at - a.at)
      .map(({ event }) => event);
    return { done: rows, groups: groupByMonth(rows), deltas: odometerDeltas(rows) };
  }, [local, firstPage, olderData]);
  const hasMore = showOlder
    ? firstCursor !== null && (older.isPending || older.hasNextPage)
    : (activity.data?.done.pagination.hasMore ?? false);

  // Rows numbered down the page, for the entrance stagger across months.
  let row = 0;

  const logFirst = () => openAdd({ vehicleId: vehicle.id });

  return (
    <View style={{ flexGrow: 1, gap: spacing.md, paddingBottom: spacing.sm + bottom }}>
      {waiting > 0 ? <SyncStrip count={waiting} /> : null}

      {activity.isPending ? (
        <LedgerCard>
          <LedgerPlaceholder />
        </LedgerCard>
      ) : activity.isError && !activity.data ? (
        <LedgerCard>
          <View style={styles.empty}>
            <Glyph size={28}>📡</Glyph>
            <Text style={[typeScale.headline, { color: theme.foreground }]}>
              The record did not load
            </Text>
            <Text
              style={[typeScale.caption, { color: theme.mutedForeground, textAlign: 'center' }]}
            >
              {(activity.error as Error).message}
            </Text>
            <Button label="Try again" onPress={() => void activity.refetch()} />
          </View>
        </LedgerCard>
      ) : done.length === 0 ? (
        <LedgerCard>
          <View style={styles.empty}>
            <Glyph size={30}>📝</Glyph>
            <Text style={[typeScale.headline, { color: theme.foreground }]}>
              Nothing recorded yet
            </Text>
            <Text style={[typeScale.label, styles.emptyText, { color: theme.mutedForeground }]}>
              Every service, fill-up, repair, payment and note you add becomes part of this
              vehicle's activity.
            </Text>
            <Button label="Log the first entry" icon="add" variant="primary" onPress={logFirst} />
          </View>
        </LedgerCard>
      ) : (
        <View style={{ gap: spacing.md, opacity: activity.isPlaceholderData ? 0.6 : 1 }}>
          {/* Each month on a card of its own under its heading, as Home's recent activity sits. */}
          {groups.map((group) => (
            <View key={group.key} style={styles.month}>
              <LedgerMonth group={group} />
              <LedgerCard>
                {group.items.map((event, place) => (
                  <DoneRow
                    key={event.id}
                    event={event}
                    previousAt={place > 0 ? group.items[place - 1]!.occurredAt : undefined}
                    nextAt={group.items[place + 1]?.occurredAt}
                    delta={deltas.get(event.id) ?? null}
                    filed={filed.get(event.id) ?? null}
                    parts={partsByEvent.get(event.id) ?? null}
                    index={row++}
                  />
                ))}
              </LedgerCard>
            </View>
          ))}

          {/* Under the last month: the way into older pages, or where the record starts. */}
          <View style={styles.end}>
            {hasMore ? (
              <Button
                label="Load older entries"
                size="sm"
                icon="chevron-down"
                loading={older.isFetching}
                onPress={() => {
                  if (!showOlder) return setShowOlder(true);
                  setOlderPages(loadedPages + 1);
                  void older.fetchNextPage();
                }}
              />
            ) : (
              <Text style={[figure, styles.endText, { color: theme.mutedForeground }]}>
                START OF THE RECORD · {DATE.format(new Date(done.at(-1)!.occurredAt)).toUpperCase()}
              </Text>
            )}
          </View>
          {older.isError ? (
            <Text
              accessibilityRole="alert"
              style={[typeScale.caption, { color: theme.destructive, textAlign: 'center' }]}
            >
              {(older.error as Error).message}
            </Text>
          ) : null}
        </View>
      )}
    </View>
  );
}

const plannedKey = (item: PlannedItem) =>
  item.kind === 'SCHEDULE' ? `s-${item.schedule.id}` : `t-${item.task.id}`;

const SCHEDULE_TONE: Record<MaintenancePlan['status'], Tone> = {
  OVERDUE: 'destructive',
  DUE_SOON: 'warning',
  OK: 'neutral',
  UNSCHEDULED: 'neutral',
};

interface GaugeReading {
  /** The measure that arrives first — the one the headline and the cells follow. */
  byDistance: boolean;
  /** Share of that interval used, 0 upward — past 1 is overdue. */
  progress: number;
  /** Cells: the interval's months for time, tenths for distance. */
  cells: number;
  /** Last done and next due, in every measure the schedule has. */
  from: string;
  to: string;
}

/**
 * A schedule's due, in words, a tone and a gauge — the web's `readDue`, so "Overdue by 580 km"
 * is worded one way on both platforms and the gauge has the same cells.
 */
export function readDue(
  plan: MaintenancePlan,
  unit: Vehicle['odometerUnit'],
): { headline: string; tone: Tone; gauge: GaugeReading | null } {
  const tone = SCHEDULE_TONE[plan.status];
  const lead = dueGauge(plan);
  if (!lead) return { headline: 'No baseline recorded yet', tone, gauge: null };
  const amount = lead.byDistance
    ? formatDistance(Math.abs(lead.remaining), unit)
    : spanOfDays(Math.abs(lead.remaining));
  const headline =
    lead.remaining < 0
      ? `Overdue by ${amount}`
      : lead.remaining === 0
        ? lead.byDistance
          ? 'Due now'
          : 'Due today'
        : `Due in ${amount}`;
  const hasTime = plan.lastPerformedAt && plan.nextDueDate;
  const hasDistance = plan.lastPerformedOdometer !== null && plan.nextDueOdometer !== null;
  const ends = (date: string | null, odometer: number | null) =>
    [
      hasTime && date ? DATE.format(new Date(date)) : null,
      hasDistance && odometer !== null ? formatDistance(odometer, unit) : null,
    ]
      .filter(Boolean)
      .join(' · ');
  return {
    headline,
    tone,
    gauge: {
      byDistance: lead.byDistance,
      progress: lead.progress,
      // A month a cell reads as a calendar; past two years that is noise, so it tops out.
      cells: lead.byDistance ? 10 : Math.min(24, Math.max(4, plan.intervalMonths ?? 12)),
      from: ends(plan.lastPerformedAt, plan.lastPerformedOdometer),
      to: ends(plan.nextDueDate, plan.nextDueOdometer),
    },
  };
}

/**
 * The interval as one segmented gauge — the web's: a cell per month (or tenth of the distance),
 * filled up to today one cell after another, with last done and next due underneath. Past due,
 * every cell is full and the figure says by how much.
 */
function SegmentGauge({ gauge, color }: { gauge: GaugeReading; color: string }) {
  const theme = useTheme();
  const reduce = useReduceMotion();
  const percent = Math.round(gauge.progress * 100);
  const used = gauge.progress * gauge.cells;
  const [fill] = useState(() => new Animated.Value(reduce ? 1 : 0));
  useEffect(() => {
    if (reduce) return;
    const animation = Animated.timing(fill, {
      toValue: 1,
      duration: 700,
      delay: 150,
      easing: ease.out,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [fill, reduce]);

  return (
    <View
      accessible
      accessibilityLabel={`${percent}% of the interval used, last done ${gauge.from}, due ${gauge.to}`}
      style={{ marginTop: spacing.sm }}
    >
      <View style={styles.gaugeRow}>
        <Ionicons
          name={gauge.byDistance ? 'speedometer-outline' : 'calendar-outline'}
          size={11}
          color={theme.mutedForeground}
        />
        <View style={styles.cells}>
          {Array.from({ length: gauge.cells }, (_, index) => {
            const share = Math.min(1, Math.max(0, used - index));
            // Each cell lights in turn: its share of the sweep is its place along the bar.
            const start = index / gauge.cells;
            return (
              <View key={index} style={[styles.cell, { backgroundColor: theme.muted }]}>
                {share > 0 ? (
                  <Animated.View
                    style={{
                      height: '100%',
                      width: `${share * 100}%`,
                      backgroundColor: color,
                      transformOrigin: 'left',
                      transform: [
                        {
                          scaleX: fill.interpolate({
                            inputRange: [
                              0,
                              Math.max(0.001, start),
                              Math.min(1, start + 1 / gauge.cells),
                              1,
                            ],
                            outputRange: [0, 0, 1, 1],
                          }),
                        },
                      ],
                    }}
                  />
                ) : null}
              </View>
            );
          })}
        </View>
        <Text style={[figure, styles.gaugePercent, { color }]}>
          {percent > 100 ? `+${percent - 100}%` : `${percent}%`}
        </Text>
      </View>
      <View style={styles.gaugeEnds}>
        <Text numberOfLines={1} style={[figure, styles.gaugeEnd, { color: theme.mutedForeground }]}>
          {gauge.from}
        </Text>
        <Text numberOfLines={1} style={[figure, styles.gaugeEnd, { color: theme.mutedForeground }]}>
          {gauge.to}
        </Text>
      </View>
    </View>
  );
}

function PlannedRow({
  item,
  vehicle,
  index,
}: {
  item: PlannedItem;
  vehicle: Vehicle;
  index: number;
}) {
  return (
    <Rise index={index}>
      {item.kind === 'SCHEDULE' ? (
        <ScheduleRow plan={item.schedule} vehicle={vehicle} />
      ) : (
        <TaskRow task={item.task} vehicleId={vehicle.id} />
      )}
    </Rise>
  );
}

/**
 * A repeating service, as the web's reminder row drawn compact: the job's glyph on a tile tinted by
 * how near it is; what it is with its interval beside it, and when in words; the way to log it —
 * copper once it is overdue, the one state where logging it is the thing to do next — and the
 * interval as a slim segmented gauge.
 */
function ScheduleRow({ plan, vehicle }: { plan: MaintenancePlan; vehicle: Vehicle }) {
  const theme = useTheme();
  const { headline, tone, gauge } = readDue(plan, vehicle.odometerUnit);
  // What the job put in last time — what to buy before doing it again.
  const { current, positions } = useParts(vehicle);
  const last = lastFitted(
    current,
    positionsForJob(plan.title).filter((position) => positions.includes(position)),
  );
  const overdue = plan.status === 'OVERDUE';
  const color =
    tone === 'destructive'
      ? theme.destructive
      : tone === 'warning'
        ? theme.warning
        : theme.foreground;

  const every = [
    plan.intervalDistance ? formatDistance(plan.intervalDistance, plan.intervalDistanceUnit) : null,
    plan.intervalMonths ? `${plan.intervalMonths} mo` : null,
  ]
    .filter(Boolean)
    .join(' or ');
  // The interval and a schedule never yet done, said beside the title rather than as pills under it.
  const aside = [every ? `every ${every}` : null, plan.lastPerformedAt ? null : 'never done']
    .filter(Boolean)
    .join(' · ');

  return (
    <View style={[styles.reminder, { backgroundColor: theme.card }, rimmed(theme)]}>
      <View style={styles.reminderTop}>
        <KindIcon
          emoji={jobEmoji(plan.title)}
          size={34}
          tint={
            tone === 'destructive'
              ? theme.destructiveSoft
              : tone === 'warning'
                ? theme.warningSoft
                : undefined
          }
        />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={[styles.reminderTitle, { color: theme.foreground }]}>
            {plan.title}
            {aside ? (
              <Text style={[styles.reminderAside, { color: theme.mutedForeground }]}>
                {' '}
                · {aside}
              </Text>
            ) : null}
          </Text>
          <Text numberOfLines={1} style={[styles.reminderHeadline, { color }]}>
            {headline}
          </Text>
          {last ? (
            <Text
              numberOfLines={1}
              style={[styles.reminderAside, { color: theme.mutedForeground }]}
            >
              Last: {last}
            </Text>
          ) : null}
        </View>
        <Button
          label="Log"
          a11yLabel={`Log ${plan.title}`}
          icon="checkmark"
          size="xs"
          variant={overdue ? 'primary' : 'secondary'}
          // The reminder itself, so the form opens on completing it rather than on a list.
          onPress={() => openAdd({ vehicleId: vehicle.id, kind: 'MAINTENANCE', planId: plan.id })}
        />
      </View>

      {gauge ? <SegmentGauge gauge={gauge} color={color} /> : null}
    </View>
  );
}

function taskDue(task: Task): { headline: string; tone: Tone } | null {
  if (!task.dueDate) return null;
  const days = daysUntil(task.dueDate);
  if (days < 0)
    return { headline: `${-days} ${days === -1 ? 'day' : 'days'} late`, tone: 'destructive' };
  if (days === 0) return { headline: 'Due today', tone: 'warning' };
  if (days <= 7)
    return { headline: `Due in ${days} ${days === 1 ? 'day' : 'days'}`, tone: 'warning' };
  return {
    headline: `Due ${new Date(`${task.dueDate}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
    tone: 'neutral',
  };
}

/** The most pressing planned job, as its row words it. */
export interface NextUp {
  title: string;
  headline: string;
  tone: Tone;
  emoji: string;
}

/**
 * What a vehicle needs next, for its hero: anything late before anything soon, and otherwise the
 * first job the server lists — which is the nearest due.
 */
export function nextUp(
  planned: readonly PlannedItem[],
  unit: Vehicle['odometerUnit'],
): NextUp | null {
  const rank = (tone: Tone) => (tone === 'destructive' ? 0 : tone === 'warning' ? 1 : 2);
  const read = planned.map((item): NextUp => {
    if (item.kind === 'SCHEDULE') {
      const { headline, tone } = readDue(item.schedule, unit);
      return { title: item.schedule.title, headline, tone, emoji: jobEmoji(item.schedule.title) };
    }
    const due = taskDue(item.task);
    return {
      title: item.task.title,
      headline: due?.headline ?? 'No due date',
      tone: due?.tone ?? 'neutral',
      emoji: '🗓️',
    };
  });
  // A stable sort: within a tone, the server's order — nearest due first — stands.
  return read.sort((a, b) => rank(a.tone) - rank(b.tone))[0] ?? null;
}

/** A one-off job, with the only control a row needs: done. Queued, so it works without signal. */
function TaskRow({ task, vehicleId }: { task: Task; vehicleId: string }) {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const due = taskDue(task);
  const [ticked, setTicked] = useState(false);

  const complete = useMutation({
    mutationFn: async () => {
      await enqueue({ kind: 'task-status', taskId: task.id, status: 'COMPLETED' });
      await flush();
    },
    onMutate: () => {
      setTicked(true);
      haptic.success();
    },
    onError: () => setTicked(false),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.activity(vehicleId) });
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });

  return (
    <View
      style={[
        styles.task,
        { backgroundColor: theme.card, opacity: ticked ? 0.6 : 1 },
        rimmed(theme),
      ]}
    >
      <PressableScale
        onPress={() => !ticked && complete.mutate()}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: ticked, busy: complete.isPending }}
        accessibilityLabel={`Complete ${task.title}`}
        scaleTo={0.8}
        style={styles.checkSlot}
      >
        <View
          style={[
            styles.check,
            ticked
              ? { backgroundColor: theme.primary, borderColor: theme.primary }
              : { backgroundColor: 'transparent', borderColor: theme.borderStrong },
          ]}
        >
          {ticked ? (
            <Pop>
              <Ionicons name="checkmark" size={13} color={theme.primaryForeground} />
            </Pop>
          ) : null}
        </View>
      </PressableScale>
      <View style={{ flex: 1, gap: 2 }}>
        <Text
          numberOfLines={2}
          style={[
            styles.reminderTitle,
            { color: theme.foreground, textDecorationLine: ticked ? 'line-through' : 'none' },
          ]}
        >
          {task.title}
        </Text>
        <View style={styles.taskMeta}>
          {due ? <StatusDot tone={due.tone} label={due.headline} /> : null}
          <Text style={[styles.reminderAside, { color: theme.mutedForeground }]}>
            {humanise(task.priority)} priority
          </Text>
        </View>
      </View>
    </View>
  );
}

/**
 * One done entry on the road, with what only a vehicle's own record knows: where the odometer
 * stood and how far it had gone since the reading before — the range of a tank, the gap between
 * services — the fill's quantity, who did it, and the note. A title that only repeats the kind
 * ("Fuel", filed under Fuel) gives the kind's place in the line to the rest. The whole row opens
 * it; an entry still on this phone says so and, if the server refused it, offers to let it go.
 */
/*
 * Memoised: every prop is a value or an entry object that React Query keeps the same identity for
 * while it is unchanged, so a refetch, a sync or a new entry redraws only the rows that moved.
 */
const DoneRow = memo(function DoneRow({
  event,
  previousAt,
  nextAt,
  delta,
  filed,
  parts,
  index,
}: {
  event: VehicleEvent;
  /** The entries above and below it in its month: one badge and one stretch of road per day. */
  previousAt: string | undefined;
  nextAt: string | undefined;
  delta: number | null;
  filed: Filed | null;
  /** The parts and fluids that went in with it. */
  parts: readonly PartLike[] | null;
  index: number;
}) {
  const theme = useTheme();
  const router = useRouter();
  const local = isLocal(event) ? event.local : null;
  const { quantity, rest: note } = fillQuantity(event.eventType, event.description);
  const kind = humanise(event.eventType);
  const titled =
    event.title.trim() !== '' && event.title.trim().toLowerCase() !== kind.toLowerCase();
  const unit = event.odometerUnit;
  const when = ledgerDate(event.occurredAt);
  // A fill's litres as a chip under it, what one cost said quietly inside it (user asked).
  const fill = event.eventType === 'FUEL' || event.eventType === 'CHARGE';
  const price = fill ? unitPrice(event.cost, quantity) : null;
  const facts = quantity
    ? [
        {
          icon:
            event.eventType === 'CHARGE' ? ('flash-outline' as const) : ('water-outline' as const),
          text: quantity,
          aside: price ? `${formatMoney(price.price)}/${price.per}` : undefined,
        },
      ]
    : [];

  return (
    <LedgerRow
      eventType={event.eventType}
      title={titled ? event.title : kind}
      occurredAt={event.occurredAt}
      previousAt={previousAt}
      nextAt={nextAt}
      meta={[event.provider]}
      cost={event.cost}
      // Nothing paid: a trip says how far it went, a reading where the odometer stands.
      aside={
        event.cost
          ? null
          : event.trip
            ? formatDistance(event.trip.distance, unit)
            : event.odometer !== null
              ? formatDistance(event.odometer, unit)
              : null
      }
      // Under the figure, how far since the reading before; a fill's litres are its chips.
      trail={fill ? [] : [quantity]}
      change={
        delta === null
          ? null
          : {
              text: `${delta > 0 ? '+' : '−'}${formatDistance(Math.abs(delta), unit)}`,
              up: delta > 0,
            }
      }
      note={note}
      filed={filed}
      state={local ? (local.error ? 'failed' : 'waiting') : undefined}
      // Not one still queued: it has no id on the server yet.
      onPress={
        local
          ? undefined
          : () =>
              router.push({
                pathname: '/event/[id]',
                params: { id: event.id, vehicleId: event.vehicleId },
              })
      }
      accessibilityLabel={[
        when,
        `${kind}: ${titled ? event.title : kind}`,
        event.cost ? formatMoney(event.cost) : null,
        event.odometer !== null ? `at ${formatDistance(event.odometer, unit)}` : null,
        note || null,
        filed ? `${filed.count} ${filed.count === 1 ? 'attachment' : 'attachments'}` : null,
        price ? `${formatMoney(price.price)} per ${price.per}` : null,
        parts ? `parts: ${parts.map((part) => positionLabel(part.position)).join(', ')}` : null,
      ]
        .filter(Boolean)
        .join(', ')}
      accessibilityHint={local ? undefined : 'Opens the entry'}
      index={index}
    >
      {facts.length > 0 ? <FactChips eventType={event.eventType} facts={facts} /> : null}
      {parts ? <PartChips lines={parts} /> : null}
      {local ? (
        local.error ? (
          <View style={styles.failed}>
            <ToneChip tone="destructive" label="Not saved" />
            <Text
              numberOfLines={2}
              style={[typeScale.caption, { flex: 1, color: theme.destructive }]}
            >
              {local.error}
            </Text>
            <PressableScale
              onPress={() => void discard(local.writeId)}
              accessibilityRole="button"
              accessibilityLabel={`Discard ${event.title}`}
              style={[styles.discard, { backgroundColor: theme.destructiveSoft }]}
            >
              <Text style={[typeScale.caption, { color: theme.destructive, fontWeight: '700' }]}>
                Discard
              </Text>
            </PressableScale>
          </View>
        ) : (
          <View style={[styles.syncChip, { backgroundColor: theme.warningSoft }]}>
            <Pulse color={theme.warning} size={6} />
            <Text style={[typeScale.caption, { color: theme.foreground, fontWeight: '600' }]}>
              Waiting to sync
            </Text>
          </View>
        )
      ) : null}
    </LedgerRow>
  );
});

/**
 * What is still on this phone, said plainly, with a way to send it now. It goes by itself when
 * there is signal; the button is for the person standing where the signal just came back.
 */
function SyncStrip({ count }: { count: number }) {
  const theme = useTheme();
  const [sending, setSending] = useState(false);
  return (
    <View style={[styles.syncStrip, { backgroundColor: theme.warningSoft }]}>
      <Pulse color={theme.warning} size={7} />
      <Text style={[typeScale.caption, { flex: 1, color: theme.foreground }]}>
        {count} {count === 1 ? 'change is' : 'changes are'} saved on this phone and will sync when
        there is signal.
      </Text>
      <Button
        label={sending ? 'Syncing' : 'Sync now'}
        size="sm"
        loading={sending}
        onPress={() => {
          setSending(true);
          void flush().finally(() => setSending(false));
        }}
      />
    </View>
  );
}

function RowPlaceholders({ count }: { count: number }) {
  const theme = useTheme();
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel="Loading reminders"
      style={{ gap: spacing.sm }}
    >
      {Array.from({ length: count }, (_, index) => (
        <View key={index} style={[styles.reminder, { backgroundColor: theme.card }, rimmed(theme)]}>
          <View style={styles.reminderTop}>
            <Skeleton width={34} height={34} radius={12} />
            <View style={{ flex: 1, gap: 6 }}>
              <Skeleton width="55%" height={12} />
              <Skeleton width="40%" height={15} />
            </View>
            <Skeleton width={56} height={30} radius={10} />
          </View>
          <Skeleton height={6} radius={2} style={{ marginTop: spacing.sm }} />
        </View>
      ))}
    </View>
  );
}

/**
 * What the vehicle is going to need, on its own — the web's Reminders: what needs you first, the
 * rest after it, each with its full row.
 */
export function VehiclePlanned({ vehicle }: { vehicle: Vehicle }) {
  const theme = useTheme();
  const [showAllLater, setShowAllLater] = useState(false);

  // The same query the feed and the dock read: one request, three readers.
  const activity = useQuery(activityQuery(api, vehicle.id));
  const planned = activity.data?.planned ?? [];
  const urgent = planned.filter(needsYou);
  const later = planned.filter((item) => !needsYou(item));

  const addPlanned = () => openAdd({ vehicleId: vehicle.id, mode: 'planned' });

  return (
    <View style={{ gap: spacing.sm }}>
      {activity.isPending ? (
        <RowPlaceholders count={2} />
      ) : planned.length === 0 ? (
        <View
          style={[
            styles.empty,
            styles.emptyCompact,
            { backgroundColor: theme.card },
            rimmed(theme),
          ]}
        >
          <Glyph size={26}>🗓️</Glyph>
          <Text style={[typeScale.headline, { color: theme.foreground }]}>Nothing coming up</Text>
          <Text style={[typeScale.label, styles.emptyText, { color: theme.mutedForeground }]}>
            A one-off job, or one that repeats — oil every year or 10,000 km.
          </Text>
          <Button label="Add a reminder" icon="add" variant="primary" onPress={addPlanned} />
        </View>
      ) : urgent.length > 0 && later.length > 0 ? (
        <>
          <Text style={[typeScale.overline, styles.group, { color: theme.mutedForeground }]}>
            Needs you
          </Text>
          {urgent.map((item, index) => (
            <PlannedRow key={plannedKey(item)} item={item} vehicle={vehicle} index={index} />
          ))}
          <Text style={[typeScale.overline, styles.group, { color: theme.mutedForeground }]}>
            Later
          </Text>
          {/*
           * Capped. "Needs you" is the part that is actually asking for something; a vehicle on a
           * full service schedule can carry a dozen jobs behind it.
           */}
          {(showAllLater ? later : later.slice(0, LATER_SHOWN)).map((item, index) => (
            <PlannedRow key={plannedKey(item)} item={item} vehicle={vehicle} index={index} />
          ))}
          {!showAllLater && later.length > LATER_SHOWN ? (
            <Button
              label={`${pad(later.length - LATER_SHOWN)} more later`}
              size="sm"
              icon="chevron-down"
              onPress={() => {
                haptic.selection();
                setShowAllLater(true);
              }}
            />
          ) : null}
        </>
      ) : (
        planned.map((item, index) => (
          <PlannedRow key={plannedKey(item)} item={item} vehicle={vehicle} index={index} />
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  month: { gap: spacing.sm },
  end: { alignItems: 'center', paddingTop: spacing.xs },
  endText: { fontSize: 11, letterSpacing: 0.8 },
  empty: {
    alignItems: 'center',
    gap: spacing.sm,
    ...leaf('md'),
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xxl,
  },
  emptyText: { fontWeight: '400', textAlign: 'center', marginBottom: spacing.sm },
  group: { marginTop: spacing.xs },

  emptyCompact: { paddingVertical: spacing.xl },

  reminder: { ...leaf('md'), padding: 10 },
  reminderTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  reminderTitle: { fontSize: 13, lineHeight: 17, fontWeight: '600' },
  reminderAside: { fontSize: 11, lineHeight: 15, fontWeight: '400' },
  reminderHeadline: { fontSize: 15, lineHeight: 19, fontWeight: '700', letterSpacing: -0.2 },
  // The icon and the percentage are fixed widths, so the ends sit under the cells.
  gaugeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  cells: { flex: 1, height: 6, flexDirection: 'row', gap: 2 },
  cell: { flex: 1, borderRadius: 2, overflow: 'hidden' },
  gaugePercent: { width: 36, textAlign: 'right', fontSize: 10.5, fontWeight: '600' },
  gaugeEnds: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginTop: 3,
    paddingLeft: 11 + spacing.sm,
    paddingRight: 36 + spacing.sm,
  },
  gaugeEnd: { flexShrink: 1, fontSize: 10, lineHeight: 13 },

  task: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    ...leaf('sm'),
    paddingVertical: 6,
    paddingHorizontal: 4,
    paddingRight: 10,
  },
  taskMeta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
  checkSlot: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  check: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  syncStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    ...leaf('md'),
    paddingVertical: spacing.sm,
    paddingLeft: spacing.md,
    paddingRight: spacing.sm,
  },
  syncChip: {
    marginTop: 4,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  failed: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 4 },
  discard: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
});
