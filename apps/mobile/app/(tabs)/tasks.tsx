import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { memo, useRef } from 'react';
import { Animated, RefreshControl, type SectionList, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useDockSpace } from '@/components/dock';
import type { Task, TaskBuckets } from '@vehicle-os/contracts';
import type { TaskPriority } from '@vehicle-os/domain';
import { queryKeys, taskBucketsQuery, vehiclesQuery } from '@vehicle-os/api-client/react';
import { daysUntil } from '@vehicle-os/ui';
import { BrandLogo } from '@/components/brand-logo';
import { api } from '@/lib/api';
import { humanise } from '@/lib/format';
import { ToneTile, type Tone } from '@/lib/instrument';
import { CountUp, haptic, Pop, PressableScale, Pulse, Rise, useScrollY } from '@/lib/motion';
import { enqueue, flush } from '@/lib/offline';
import { figure, radius, spacing, typeScale, useTheme } from '@/lib/theme';
import { Button, CompactHeader, IconButton, LargeHeader, Skeleton } from '@/lib/ui';

type BucketKey = keyof TaskBuckets['counts'];

/** The order a person works through them; `someday` is deliberately last. */
const SECTIONS: { key: BucketKey; title: string; tone: Tone }[] = [
  { key: 'overdue', title: 'Overdue', tone: 'destructive' },
  { key: 'today', title: 'Today', tone: 'warning' },
  { key: 'thisWeek', title: 'This week', tone: 'neutral' },
  { key: 'upcoming', title: 'Upcoming', tone: 'neutral' },
  { key: 'someday', title: 'Someday', tone: 'neutral' },
];

/** The three that ask for attention get a reading at the top; later work does not. */
const READINGS: BucketKey[] = ['overdue', 'today', 'thisWeek'];

const PRIORITY_TONE: Record<TaskPriority, Tone> = {
  URGENT: 'destructive',
  HIGH: 'warning',
  MEDIUM: 'neutral',
  LOW: 'neutral',
};

const pad = (value: number) => String(value).padStart(2, '0');

const toggled = (task: Task): 'TODO' | 'COMPLETED' =>
  task.status === 'COMPLETED' ? 'TODO' : 'COMPLETED';

/** When, said the way a person would: late, today, in a few days, or on a date. */
function when(task: Task): { label: string; tone: Tone } | null {
  if (!task.dueDate) return null;
  const days = daysUntil(task.dueDate);
  if (days < 0)
    return { label: `${-days} ${days === -1 ? 'day' : 'days'} late`, tone: 'destructive' };
  if (days === 0) return { label: 'Today', tone: 'warning' };
  if (days === 1) return { label: 'Tomorrow', tone: 'neutral' };
  if (days <= 7) return { label: `In ${days} days`, tone: 'neutral' };
  return {
    label: new Date(`${task.dueDate}T00:00:00`).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    }),
    tone: 'neutral',
  };
}

/**
 * Everything to do, across every vehicle, in the order it is worked through.
 *
 * Ticking one off goes to the queue, not the network, so it works in a car park. The list updates
 * optimistically — a checkbox that does nothing until signal returns reads as a broken app. `flush`
 * never throws (a failed send stays queued), so only a write that never reached the queue rolls
 * the tick back.
 *
 * The box ticks; the rest of the row opens the vehicle. Completing is the one thing that should
 * never happen by brushing past a row.
 */
export default function TasksScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const dockSpace = useDockSpace();
  const { y, onScroll } = useScrollY();
  const queryClient = useQueryClient();
  const list = useRef<SectionList<Task, SectionData>>(null);
  const buckets = useQuery(taskBucketsQuery(api));
  // Already cached by the other tabs; only for each task's maker logo.
  const vehicles = useQuery(vehiclesQuery(api));
  const makes = new Map((vehicles.data?.data ?? []).map((vehicle) => [vehicle.id, vehicle.make]));

  const complete = useMutation({
    mutationFn: async (task: Task) => {
      await enqueue({ kind: 'task-status', taskId: task.id, status: toggled(task) });
      await flush();
    },
    onMutate: async (task) => {
      const key = queryKeys.taskBuckets();
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<TaskBuckets>(key);
      if (previous) {
        const flip = (items: Task[]) =>
          items.map((item) => (item.id === task.id ? { ...item, status: toggled(task) } : item));
        queryClient.setQueryData<TaskBuckets>(key, {
          ...previous,
          overdue: flip(previous.overdue),
          today: flip(previous.today),
          thisWeek: flip(previous.thisWeek),
          upcoming: flip(previous.upcoming),
          someday: flip(previous.someday),
        });
      }
      return { previous };
    },
    onError: (_error, _task, context) => {
      if (context?.previous) queryClient.setQueryData(queryKeys.taskBuckets(), context.previous);
    },
    onSettled: (_data, _error, task) => {
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
      // A vehicle's task is also a planned item in that vehicle's activity.
      if (task.vehicleId) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.activity(task.vehicleId) });
      }
    },
  });

  const data = buckets.data;
  const sections = SECTIONS.map((section) => ({
    ...section,
    data: data?.[section.key] ?? [],
  })).filter((section) => section.data.length > 0);
  const all = sections.flatMap((section) => section.data);
  const open = data ? all.filter((task) => task.status !== 'COMPLETED').length : undefined;

  const jump = (key: BucketKey) => {
    const index = sections.findIndex((section) => section.key === key);
    if (index < 0) return;
    haptic.selection();
    list.current?.scrollToLocation({ sectionIndex: index, itemIndex: 0, viewOffset: 48 });
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <AnimatedSectionList
        ref={list}
        sections={sections}
        keyExtractor={(task) => task.id}
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={[
          styles.page,
          { paddingTop: insets.top + spacing.sm, paddingBottom: dockSpace },
        ]}
        stickySectionHeadersEnabled={false}
        // Rows differ in height, so a jump far down the list may need a second measured attempt.
        onScrollToIndexFailed={() => undefined}
        refreshControl={
          <RefreshControl
            refreshing={buckets.isFetching && !buckets.isPending}
            onRefresh={() => void buckets.refetch()}
            tintColor={theme.mutedForeground}
          />
        }
        ListHeaderComponent={
          <View style={{ gap: spacing.lg, marginBottom: spacing.xs }}>
            <Rise>
              <LargeHeader
                eyebrow="Across every vehicle"
                title="Tasks"
                count={open}
                y={y}
                actions={
                  <IconButton
                    icon="add"
                    tone="primary"
                    label="Plan something"
                    onPress={() => router.push('/add/planned')}
                  />
                }
              />
            </Rise>

            {/* Three readings that are also the way to their section. */}
            <Rise index={1} style={styles.readings}>
              {READINGS.map((key) => {
                const section = SECTIONS.find((item) => item.key === key)!;
                const count = data?.counts[key];
                const hot = count !== undefined && count > 0 && section.tone !== 'neutral';
                const tint = !hot
                  ? theme.card
                  : section.tone === 'destructive'
                    ? theme.destructiveSoft
                    : theme.warningSoft;
                const ink = !hot
                  ? theme.foreground
                  : section.tone === 'destructive'
                    ? theme.destructive
                    : theme.warning;
                return (
                  <PressableScale
                    key={key}
                    onPress={() => jump(key)}
                    disabled={!count}
                    accessibilityRole="button"
                    accessibilityLabel={`${section.title}: ${count ?? 0}`}
                    accessibilityHint={count ? 'Scrolls to them' : undefined}
                    scaleTo={0.95}
                    style={[
                      styles.reading,
                      { backgroundColor: tint, borderColor: hot ? 'transparent' : theme.hairline },
                    ]}
                  >
                    <View style={styles.readingTop}>
                      {hot && section.tone === 'destructive' ? (
                        <Pulse color={ink} size={6} />
                      ) : null}
                      <Text
                        style={[typeScale.overline, { color: hot ? ink : theme.mutedForeground }]}
                      >
                        {section.title.toUpperCase()}
                      </Text>
                    </View>
                    {count === undefined ? (
                      <Skeleton width={44} height={34} />
                    ) : (
                      <CountUp
                        value={count}
                        format={(value) => pad(Math.round(value))}
                        style={[figure, styles.readingValue, { color: ink }]}
                      />
                    )}
                  </PressableScale>
                );
              })}
            </Rise>
          </View>
        }
        ListEmptyComponent={
          buckets.isPending ? (
            <View
              accessibilityRole="progressbar"
              accessibilityLabel="Loading tasks"
              style={[styles.group, { backgroundColor: theme.card, borderColor: theme.hairline }]}
            >
              {(['70%', '52%', '84%'] as const).map((width) => (
                <View key={width} style={styles.row}>
                  <Skeleton width={26} height={26} radius={999} />
                  <View style={{ flex: 1, gap: 6 }}>
                    <Skeleton width={width} height={14} />
                    <Skeleton width="30%" height={10} />
                  </View>
                </View>
              ))}
            </View>
          ) : (
            <View
              style={[styles.empty, { backgroundColor: theme.card, borderColor: theme.hairline }]}
            >
              <Pop>
                <ToneTile tone="success" size={64}>
                  <Ionicons name="checkmark-done" size={30} color={theme.success} />
                </ToneTile>
              </Pop>
              <Text style={[typeScale.title, { color: theme.foreground }]}>
                Nothing on the list
              </Text>
              <Text
                style={[typeScale.caption, { color: theme.mutedForeground, textAlign: 'center' }]}
              >
                Planned jobs, soonest first.
              </Text>
              <Button
                label="Plan something"
                icon="add"
                variant="primary"
                onPress={() => router.push('/add/planned')}
              />
            </View>
          )
        }
        renderSectionHeader={({ section }) => {
          const bar =
            section.tone === 'destructive'
              ? theme.destructive
              : section.tone === 'warning'
                ? theme.warning
                : theme.borderStrong;
          return (
            <View style={styles.sectionHeader}>
              {section.tone === 'destructive' ? (
                <Pulse color={bar} size={7} />
              ) : (
                <View style={[styles.sectionDot, { backgroundColor: bar }]} />
              )}
              <Text
                accessibilityRole="header"
                style={[typeScale.overline, { flex: 1, color: theme.foreground }]}
              >
                {section.title.toUpperCase()}
              </Text>
              <Text style={[typeScale.caption, figure, { color: theme.mutedForeground }]}>
                {pad(section.data.length)}
              </Text>
            </View>
          );
        }}
        // `mutate` is stable across renders, so a memoised row only re-renders when its task does.
        renderItem={({ item, index, section }) => (
          <Rise index={index}>
            <TaskRow
              task={item}
              make={item.vehicleId ? (makes.get(item.vehicleId) ?? null) : null}
              first={index === 0}
              last={index === section.data.length - 1}
              onToggle={complete.mutate}
            />
          </Rise>
        )}
      />
      <CompactHeader title="Tasks" y={y} />
    </View>
  );
}

const TaskRow = memo(function TaskRow({
  task,
  make,
  first,
  last,
  onToggle,
}: {
  task: Task;
  make: string | null;
  first: boolean;
  last: boolean;
  onToggle: (task: Task) => void;
}) {
  const theme = useTheme();
  const router = useRouter();
  const done = task.status === 'COMPLETED';
  const due = when(task);
  const urgent = task.priority === 'URGENT' || task.priority === 'HIGH';

  const toggle = () => {
    // A tick you can feel: the one confirmation that works with the phone in a pocket.
    if (done) haptic.selection();
    else haptic.success();
    onToggle(task);
  };

  return (
    <PressableScale
      onPress={
        task.vehicleId
          ? () => router.push({ pathname: '/vehicle/[id]', params: { id: task.vehicleId! } })
          : toggle
      }
      accessibilityRole={task.vehicleId ? 'button' : 'checkbox'}
      accessibilityState={task.vehicleId ? undefined : { checked: done }}
      accessibilityLabel={[task.title, task.vehicleName, due?.label].filter(Boolean).join(', ')}
      accessibilityHint={task.vehicleId ? `Opens ${task.vehicleName}` : undefined}
      scaleTo={0.99}
      style={[
        styles.row,
        {
          backgroundColor: theme.card,
          borderColor: theme.hairline,
          borderLeftWidth: StyleSheet.hairlineWidth,
          borderRightWidth: StyleSheet.hairlineWidth,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderBottomWidth: last ? StyleSheet.hairlineWidth : 0,
          borderTopLeftRadius: first ? radius.lg : 0,
          borderTopRightRadius: first ? radius.lg : 0,
          borderBottomLeftRadius: last ? radius.lg : 0,
          borderBottomRightRadius: last ? radius.lg : 0,
        },
      ]}
    >
      <PressableScale
        onPress={toggle}
        hitSlop={10}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: done }}
        accessibilityLabel={done ? `Mark ${task.title} not done` : `Complete ${task.title}`}
        scaleTo={0.75}
        style={[
          styles.check,
          done
            ? { backgroundColor: theme.primary, borderColor: theme.primary }
            : { backgroundColor: 'transparent', borderColor: theme.borderStrong },
        ]}
      >
        {/* Popped in fresh on every tick, so completing one feels like it landed. */}
        {done ? (
          <Pop>
            <Ionicons name="checkmark" size={16} color={theme.primaryForeground} />
          </Pop>
        ) : null}
      </PressableScale>

      <View style={{ flex: 1, minWidth: 0, gap: 5 }}>
        <Text
          numberOfLines={2}
          style={[
            typeScale.label,
            {
              fontWeight: '600',
              color: done ? theme.mutedForeground : theme.foreground,
              textDecorationLine: done ? 'line-through' : 'none',
            },
          ]}
        >
          {task.title}
        </Text>
        <View style={styles.meta}>
          {due ? <DueChip label={due.label} tone={done ? 'neutral' : due.tone} /> : null}
          {urgent && !done ? (
            <View style={styles.priority}>
              <Ionicons
                name="flag"
                size={11}
                color={
                  PRIORITY_TONE[task.priority] === 'destructive' ? theme.destructive : theme.warning
                }
              />
              <Text style={[typeScale.caption, { fontSize: 12, color: theme.mutedForeground }]}>
                {humanise(task.priority)}
              </Text>
            </View>
          ) : null}
        </View>
      </View>

      {task.vehicleId ? (
        <View style={styles.vehicle}>
          <View style={[styles.logo, { backgroundColor: theme.muted }]}>
            {make ? (
              <BrandLogo make={make} size={28} />
            ) : (
              <Ionicons name="car-sport-outline" size={14} color={theme.mutedForeground} />
            )}
          </View>
          <Ionicons name="chevron-forward" size={14} color={theme.mutedForeground} />
        </View>
      ) : null}
    </PressableScale>
  );
});

function DueChip({ label, tone }: { label: string; tone: Tone }) {
  const theme = useTheme();
  const [background, color] =
    tone === 'destructive'
      ? [theme.destructiveSoft, theme.destructive]
      : tone === 'warning'
        ? [theme.warningSoft, theme.warning]
        : [theme.muted, theme.mutedForeground];
  return (
    <View style={[styles.chip, { backgroundColor: background }]}>
      <Ionicons name="time-outline" size={11} color={color} />
      <Text style={[typeScale.caption, { fontSize: 12, lineHeight: 16, fontWeight: '600', color }]}>
        {label}
      </Text>
    </View>
  );
}

type SectionData = (typeof SECTIONS)[number] & { data: Task[] };

/*
 * `Animated.SectionList` loses the item generic, so it is cast back once here rather than at
 * every prop.
 */
const AnimatedSectionList = Animated.SectionList as unknown as typeof SectionList<
  Task,
  SectionData
>;

const styles = StyleSheet.create({
  page: { paddingHorizontal: spacing.lg },
  readings: { flexDirection: 'row', gap: spacing.sm },
  reading: {
    flex: 1,
    minWidth: 0,
    gap: spacing.sm,
    borderRadius: radius.lg,
    padding: spacing.md + 2,
    borderWidth: StyleSheet.hairlineWidth,
  },
  readingTop: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  readingValue: { fontSize: 30, lineHeight: 34, fontWeight: '400', letterSpacing: -1.4 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.xl,
    marginBottom: spacing.sm + 2,
    paddingHorizontal: 2,
  },
  sectionDot: { width: 7, height: 7, borderRadius: 999 },
  group: { borderRadius: radius.lg, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 60,
    paddingHorizontal: spacing.md + 2,
    paddingVertical: spacing.md,
  },
  check: {
    width: 26,
    height: 26,
    borderRadius: 999,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  meta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  priority: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  vehicle: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  logo: {
    width: 32,
    height: 32,
    borderRadius: 10,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: {
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.xl,
    paddingVertical: spacing.xxl,
  },
});
