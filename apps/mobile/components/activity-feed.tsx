import { Ionicons } from '@expo/vector-icons';
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Animated, ScrollView, StyleSheet, Text, View } from 'react-native';
import type {
  MaintenancePlan,
  PlannedItem,
  Task,
  Vehicle,
  VehicleEvent,
} from '@vehicle-os/contracts';
import type { EventType } from '@vehicle-os/domain';
import { activityQuery, queryKeys } from '@vehicle-os/api-client/react';
import { daysUntil, dueGauge, groupByMonth, odometerDeltas, spanOfDays } from '@vehicle-os/ui';
import {
  EntryCard,
  EntryHead,
  Fact,
  Facts,
  fillQuantity,
  KindIcon,
  MonthHeading,
  NotePreview,
  RAIL,
  Road,
  startsDay,
  TimelineRow,
} from '@/components/timeline';
import { api } from '@/lib/api';
import { eventEmoji, jobEmoji } from '@/lib/emoji';
import { formatDistance, humanise } from '@/lib/format';
import {
  Chip,
  Glyph,
  Marker,
  SectionHeading,
  StatusDot,
  ToneChip,
  type Tone,
} from '@/lib/instrument';
import { ease, haptic, Pop, PressableScale, Pulse, Rise, useReduceMotion } from '@/lib/motion';
import {
  discard,
  enqueue,
  flush,
  usePendingWrites,
  type PendingWrite,
  type SentWrite,
} from '@/lib/offline';
import { figure, radius, rimmed, spacing, typeScale, useTheme } from '@/lib/theme';
import { Button, Skeleton } from '@/lib/ui';

const pad = (value: number) => String(value).padStart(2, '0');
const DATE = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

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
    const body = write.body;
    const isEvent = write.kind === 'event';
    const scheduleTitle =
      write.kind === 'maintenance'
        ? schedules.find((plan) => plan.id === write.planId)?.title
        : undefined;
    const title =
      (isEvent || write.kind === 'maintenance-log' ? body.title : body.workPerformed) ??
      scheduleTitle ??
      'Service';
    return [
      {
        id: `local-${write.id}`,
        eventType: (isEvent ? body.eventType : 'MAINTENANCE') as VehicleEvent['eventType'],
        title: String(title),
        occurredAt: String(isEvent ? body.occurredAt : body.performedAt),
        odometer: typeof body.odometer === 'number' ? body.odometer : null,
        odometerUnit: (body.odometerUnit as VehicleEvent['odometerUnit']) ?? null,
        cost: isEvent
          ? money(body.costAmountMinor, body.costCurrency)
          : money(body.laborCostAmountMinor, body.costCurrency),
        description: typeof body.description === 'string' ? body.description : null,
        provider: null,
        local: { writeId: write.id, error: write.error },
      } as unknown as LocalEvent,
    ];
  });
}

const isLocal = (event: VehicleEvent): event is LocalEvent => 'local' in event;

function isLate(item: PlannedItem): boolean {
  if (item.kind === 'SCHEDULE') return item.schedule.status === 'OVERDUE';
  return item.task.dueDate !== null && daysUntil(item.task.dueDate) < 0;
}

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
 * A vehicle's logbook, as the web's Logs draws it: the record only, newest first and straight in —
 * no heading over it, the dock already says where you are — month by month, each month a chapter
 * under its leaf, each day on the road, each entry a card, down to where it starts. Every entry
 * opens. What is coming up is Reminders' alone, so the two never repeat.
 */
export function ActivityFeed({ vehicle }: { vehicle: Vehicle }) {
  const theme = useTheme();
  const router = useRouter();
  const [filter, setFilter] = useState<EventType | null>(null);
  const [showOlder, setShowOlder] = useState(false);
  const filters = filter ? { eventType: [filter] } : {};

  const activity = useQuery({
    ...activityQuery(api, vehicle.id, filters),
    placeholderData: keepPreviousData,
  });
  // The unfiltered feed, for the chips' options; the same query as the feed when no filter is on.
  const everything = useQuery(activityQuery(api, vehicle.id));

  /*
   * Older pages after the first. The first page's cursor is in the key: once an entry is added the
   * first page shifts by one, and pages fetched from the old cursor would skip the entry that
   * crossed the boundary.
   */
  const firstCursor = activity.data?.done.pagination.nextCursor ?? null;
  const older = useInfiniteQuery({
    queryKey: [...queryKeys.activity(vehicle.id, filters), 'older', firstCursor],
    queryFn: ({ pageParam }) => api.activity(vehicle.id, { ...filters, cursor: pageParam }),
    initialPageParam: firstCursor ?? '',
    getNextPageParam: (page) => page.done.pagination.nextCursor ?? undefined,
    enabled: showOlder && firstCursor !== null,
  });

  const planned = activity.data?.planned ?? [];
  const writes = usePendingWrites();
  const schedulesForLocal = planned.flatMap((item) =>
    item.kind === 'SCHEDULE' ? [item.schedule] : [],
  );
  const local = localEvents(writes, vehicle.id, schedulesForLocal, activity.dataUpdatedAt).filter(
    (event) => !filter || event.eventType === filter,
  );
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
  const done = [
    ...local,
    ...(activity.data?.done.data ?? []),
    ...(showOlder ? (older.data?.pages.flatMap((page) => page.done.data) ?? []) : []),
  ].sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));
  const hasMore = showOlder
    ? firstCursor !== null && (older.isPending || older.hasNextPage)
    : (activity.data?.done.pagination.hasMore ?? false);

  const groups = groupByMonth(done);
  const deltas = odometerDeltas(done);

  const counts = new Map<EventType, number>();
  for (const event of everything.data?.done.data ?? []) {
    counts.set(event.eventType, (counts.get(event.eventType) ?? 0) + 1);
  }
  if (filter && !counts.has(filter)) counts.set(filter, 0);
  const kinds = [...counts].sort((a, b) => b[1] - a[1]);
  // Counts are only honest when the whole record is loaded.
  const countsComplete = everything.data?.done.pagination.hasMore === false;

  const choose = (next: EventType | null) => {
    setFilter(next);
    setShowOlder(false);
  };

  const logFirst = () => router.push({ pathname: '/add/done', params: { vehicleId: vehicle.id } });

  return (
    <View style={{ gap: spacing.md }}>
      {waiting > 0 ? <SyncStrip count={waiting} /> : null}

      {kinds.length >= 2 || filter ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ marginHorizontal: -spacing.lg }}
          contentContainerStyle={{ gap: 6, paddingHorizontal: spacing.lg }}
        >
          <Chip label="All" selected={filter === null} onPress={() => choose(null)} />
          {kinds.map(([kind, count]) => (
            <Chip
              key={kind}
              label={humanise(kind)}
              selected={filter === kind}
              onPress={() => choose(filter === kind ? null : kind)}
              leading={<Glyph size={16}>{eventEmoji(kind)}</Glyph>}
              count={countsComplete ? count : undefined}
            />
          ))}
        </ScrollView>
      ) : null}

      <View>
        {activity.isPending ? (
          <RailPlaceholders />
        ) : activity.isError && !activity.data ? (
          <View style={[styles.empty, { backgroundColor: theme.card }, rimmed(theme)]}>
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
        ) : (
          <View style={{ opacity: activity.isPlaceholderData ? 0.6 : 1 }}>
            {done.length === 0 ? (
              <View
                style={[
                  styles.empty,
                  { backgroundColor: theme.card, marginTop: spacing.sm },
                  rimmed(theme),
                ]}
              >
                <Glyph size={30}>📝</Glyph>
                <Text style={[typeScale.headline, { color: theme.foreground }]}>
                  {filter ? `No ${humanise(filter).toLowerCase()} yet` : 'Nothing recorded yet'}
                </Text>
                <Text style={[typeScale.label, styles.emptyText, { color: theme.mutedForeground }]}>
                  Every service, fill-up, repair, payment and note you add becomes part of this
                  vehicle's activity.
                </Text>
                <Button
                  label="Log the first entry"
                  icon="add"
                  variant="primary"
                  onPress={logFirst}
                />
              </View>
            ) : (
              groups.map((group) => (
                <View key={group.key} style={{ marginTop: spacing.xs }}>
                  <MonthHeading group={group} />
                  <View style={{ marginTop: spacing.xs }}>
                    {group.items.map((event, index) => (
                      <DoneRow
                        key={event.id}
                        event={event}
                        delta={deltas.get(event.id) ?? null}
                        firstOfDay={startsDay(group.items, index)}
                        last={index === group.items.length - 1}
                        index={index}
                      />
                    ))}
                  </View>
                </View>
              ))
            )}

            {done.length === 0 ? null : hasMore ? (
              <View style={styles.older}>
                <Button
                  label="Load older entries"
                  loading={older.isFetching}
                  onPress={() => (showOlder ? void older.fetchNextPage() : setShowOlder(true))}
                />
              </View>
            ) : (
              <View style={styles.older}>
                <Marker>
                  <Text style={[figure, styles.end, { color: theme.mutedForeground }]}>
                    START OF THE RECORD ·{' '}
                    {DATE.format(new Date(done.at(-1)!.occurredAt)).toUpperCase()}
                  </Text>
                </Marker>
              </View>
            )}
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
function readDue(
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
  const router = useRouter();
  const { headline, tone, gauge } = readDue(plan, vehicle.odometerUnit);
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
        </View>
        <Button
          label="Log"
          a11yLabel={`Log ${plan.title}`}
          icon="checkmark"
          size="xs"
          variant={overdue ? 'primary' : 'secondary'}
          onPress={() =>
            router.push({
              pathname: '/add/done',
              params: { vehicleId: vehicle.id, kind: 'MAINTENANCE' },
            })
          }
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
 * One done entry, as the web's logbook draws every entry, with what only a vehicle's own record
 * knows: where the odometer stood and how far since the last reading — the range of a tank, the
 * gap between services — the fill's quantity, who did it, and the note. The whole card opens it;
 * an entry still on this phone says so, and, if the server refused it, offers to let it go.
 */
function DoneRow({
  event,
  delta,
  firstOfDay,
  last,
  index,
}: {
  event: VehicleEvent;
  delta: number | null;
  firstOfDay: boolean;
  last: boolean;
  index: number;
}) {
  const theme = useTheme();
  const router = useRouter();
  const local = isLocal(event) ? event.local : null;
  const { quantity, rest: note } = fillQuantity(event.eventType, event.description);
  const facts = event.odometer !== null || quantity || event.provider;

  return (
    <TimelineRow occurredAt={event.occurredAt} firstOfDay={firstOfDay} last={last} index={index}>
      {/*
       * Not one still queued: it has no id on the server yet, and becomes pressable of its own
       * accord once it has been sent.
       */}
      <EntryCard
        onPress={
          local
            ? undefined
            : () =>
                router.push({
                  pathname: '/event/[id]',
                  params: { id: event.id, vehicleId: event.vehicleId },
                })
        }
        accessibilityLabel={`${new Date(event.occurredAt).toLocaleDateString()}, ${humanise(
          event.eventType,
        )}: ${event.title}`}
        accessibilityHint={local ? undefined : 'Opens the entry'}
      >
        <EntryHead
          eventType={event.eventType}
          title={event.title}
          cost={event.cost}
          tint={local ? (local.error ? theme.destructiveSoft : theme.warningSoft) : undefined}
        >
          {note ? <NotePreview text={note} /> : null}
          {facts ? (
            <Facts>
              {event.odometer !== null ? (
                <Fact icon="speedometer-outline">
                  <Text style={figure}>{formatDistance(event.odometer, event.odometerUnit)}</Text>
                  {delta !== null ? (
                    <Text style={[figure, { color: theme.foreground }]}>
                      {'  '}+{formatDistance(delta, event.odometerUnit)}
                    </Text>
                  ) : null}
                </Fact>
              ) : null}
              {quantity ? (
                <Fact
                  icon={event.eventType === 'CHARGE' ? 'battery-charging-outline' : 'water-outline'}
                >
                  <Text style={figure}>{quantity}</Text>
                </Fact>
              ) : null}
              {event.provider ? <Fact icon="storefront-outline">{event.provider}</Fact> : null}
            </Facts>
          ) : null}

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
                  <Text
                    style={[typeScale.caption, { color: theme.destructive, fontWeight: '700' }]}
                  >
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
        </EntryHead>
      </EntryCard>
    </TimelineRow>
  );
}

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

/** The logbook before it loads, on its road, so nothing moves when the entries arrive. */
function RailPlaceholders() {
  const theme = useTheme();
  return (
    <View accessibilityRole="progressbar" accessibilityLabel="Loading activity">
      {[0, 1, 2].map((index) => (
        <View key={index} style={styles.placeholderRow}>
          <View style={styles.railCell}>
            <Road color={theme.border} stopAt={index === 2 ? 40 : null} />
            <Skeleton width={34} height={33} radius={9} />
          </View>
          <View style={[styles.placeholderCard, { backgroundColor: theme.card }, rimmed(theme)]}>
            <Skeleton width={32} height={32} radius={12} />
            <View style={{ flex: 1, gap: 8 }}>
              <Skeleton width="40%" height={12} />
              <Skeleton width="70%" height={14} />
            </View>
          </View>
        </View>
      ))}
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
  const router = useRouter();
  const [showAllLater, setShowAllLater] = useState(false);

  // The same query the feed and the dock read: one request, three readers.
  const activity = useQuery(activityQuery(api, vehicle.id));
  const planned = activity.data?.planned ?? [];
  const urgent = planned.filter(needsYou);
  const later = planned.filter((item) => !needsYou(item));
  const late = planned.filter(isLate).length;

  const addPlanned = () =>
    router.push({ pathname: '/add/planned', params: { vehicleId: vehicle.id } });

  return (
    <View style={{ gap: spacing.sm }}>
      <SectionHeading
        title="Reminders"
        count={activity.isPending ? undefined : planned.length}
        trailing={
          activity.isPending || planned.length === 0 ? null : urgent.length === 0 ? (
            <StatusDot tone="success" label="All on track" />
          ) : (
            <View style={{ flexDirection: 'row', gap: spacing.md }}>
              {late > 0 ? <StatusDot tone="destructive" label={`${pad(late)} late`} /> : null}
              {urgent.length > late ? (
                <StatusDot tone="warning" label={`${pad(urgent.length - late)} soon`} />
              ) : null}
            </View>
          )
        }
      />

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
  railCell: { width: RAIL, alignItems: 'center' },
  older: { marginTop: spacing.sm, alignItems: 'stretch' },
  end: { fontSize: 11, letterSpacing: 0.8 },
  empty: {
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radius.xxl,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xxl,
  },
  emptyText: { fontWeight: '400', textAlign: 'center', marginBottom: spacing.sm },
  group: { marginTop: spacing.xs },

  emptyCompact: { paddingVertical: spacing.xl },

  reminder: { borderRadius: radius.xl, padding: 10 },
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
    borderRadius: radius.xl,
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
    borderRadius: radius.xxl,
    paddingVertical: spacing.sm,
    paddingLeft: spacing.md,
    paddingRight: spacing.sm,
  },
  syncChip: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  failed: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  discard: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  placeholderRow: { flexDirection: 'row', gap: spacing.sm, paddingBottom: spacing.sm },
  placeholderCard: {
    flex: 1,
    flexDirection: 'row',
    gap: 10,
    borderRadius: radius.xl,
    padding: 10,
  },
});
