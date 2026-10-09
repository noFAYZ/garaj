import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { TaskPriority } from '@vehicle-os/domain';
import { garagesQuery, vehiclesQuery } from '@vehicle-os/api-client/react';
import { amountOnly, digitsOnly, localDay } from '@vehicle-os/ui';
import { newId } from '@vehicle-os/utils';
import { AddMode } from '@/components/add-mode';
import { BrandLogo } from '@/components/brand-logo';
import { api } from '@/lib/api';
import { jobEmoji } from '@/lib/emoji';
import { Chip, Eyebrow, FigureInput, Glyph, Headline, Panel, PanelCell } from '@/lib/instrument';
import { haptic, PressableScale, Rise } from '@/lib/motion';
import { enqueue, flush } from '@/lib/offline';
import { DateField } from '@/lib/date-picker';
import { radius, spacing, typeScale, useTheme } from '@/lib/theme';
import { Button } from '@/lib/ui';
import { toMinorUnits } from '@/lib/format';
import { useUnitsFor } from '@/lib/vehicle-units';

const NO_VEHICLE = 'none';

/**
 * The jobs people plan most, one tap from a title. A repeat also takes the interval the job
 * usually runs on, so "Oil change" arrives already set to a year or the distance.
 */
const JOBS: { title: string; months?: string; distance?: 'big' | 'small' }[] = [
  { title: 'Oil change', months: '12', distance: 'big' },
  { title: 'Tyre rotation', months: '6', distance: 'small' },
  { title: 'Brake check', months: '12' },
  { title: 'Annual inspection', months: '12' },
  { title: 'Insurance renewal', months: '12' },
  { title: 'Battery check', months: '12' },
  { title: 'Wash and clean', months: '1' },
];

const PRIORITIES: { value: TaskPriority; label: string }[] = [
  { value: 'LOW', label: 'Low' },
  { value: 'MEDIUM', label: 'Normal' },
  { value: 'HIGH', label: 'High' },
  { value: 'URGENT', label: 'Urgent' },
];

/**
 * Add something coming up: how often it happens first — that decides everything below it — then
 * which vehicle, the job, and either its day or its interval, with a pinned footer that reads the
 * plan back in one line.
 *
 * A one-off is a task (it may be garage-wide); a repeat is a schedule, which needs a vehicle
 * because its intervals count that vehicle's months and odometer.
 */
export default function AddPlannedScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ vehicleId?: string }>();

  const garages = useQuery(garagesQuery(api));
  const vehicles = useQuery(vehiclesQuery(api));

  const [title, setTitle] = useState('');
  const [vehicleId, setVehicleId] = useState<string>(params.vehicleId ?? NO_VEHICLE);
  const [repeats, setRepeats] = useState(false);
  const [dueDate, setDueDate] = useState('');
  const [everyMonths, setEveryMonths] = useState('');
  const [everyDistance, setEveryDistance] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('MEDIUM');
  /*
   * A one-off is as often due at a reading as on a date — "before 60,000 km" is how brake pads
   * and cambelts are actually described — and the contract has carried both all along.
   */
  const [dueOdometer, setDueOdometer] = useState('');
  const [estimate, setEstimate] = useState('');
  const [note, setNote] = useState('');

  const garageList = garages.data ?? [];
  const vehicleList = vehicles.data?.data ?? [];

  /*
   * A repeat has no meaning without a vehicle to count against, so turning it on with "garage
   * work" selected picks the first vehicle rather than leaving a form that cannot be saved.
   */
  const effectiveVehicleId =
    repeats && vehicleId === NO_VEHICLE ? (vehicleList[0]?.id ?? NO_VEHICLE) : vehicleId;
  const vehicle = vehicleList.find((item) => item.id === effectiveVehicleId);
  const { odometerUnit, currency } = useUnitsFor(vehicle);
  const unit = odometerUnit === 'MI' ? 'mi' : 'km';
  const bigDistance = odometerUnit === 'MI' ? 6000 : 10000;
  const smallDistance = odometerUnit === 'MI' ? 5000 : 8000;
  const garageId = vehicle?.garageId ?? garageList[0]?.id ?? null;

  /*
   * Saved to the phone and sent by the queue, like a done entry: planning a job in a car park with
   * no signal works, and with signal it no longer waits several seconds on the round trip.
   */
  const create = useMutation({
    mutationFn: async () => {
      const shared = {
        // The client chooses the id, so this works with no signal and a replay lands on one row.
        id: newId(),
        title: title.trim(),
        ...(note.trim() ? { description: note.trim() } : {}),
        ...(priority !== 'MEDIUM' ? { priority } : {}),
      };
      if (repeats) {
        await enqueue({
          kind: 'plan-create',
          vehicleId: effectiveVehicleId,
          body: {
            ...shared,
            ...(everyMonths ? { intervalMonths: Number(everyMonths) } : {}),
            ...(everyDistance
              ? { intervalDistance: Number(everyDistance), intervalDistanceUnit: odometerUnit }
              : {}),
          },
        });
      } else {
        await enqueue({
          kind: 'task-create',
          vehicleId: effectiveVehicleId !== NO_VEHICLE ? effectiveVehicleId : null,
          body: {
            ...shared,
            garageId: garageId!,
            ...(effectiveVehicleId !== NO_VEHICLE ? { vehicleId: effectiveVehicleId } : {}),
            ...(dueDate ? { dueDate } : {}),
            ...(dueOdometer ? { dueOdometer: Number(dueOdometer) } : {}),
            ...(estimate
              ? {
                  estimatedCostAmountMinor: toMinorUnits(Number(estimate), currency),
                  costCurrency: currency,
                }
              : {}),
          },
        });
      }
      void flush();
    },
    onSuccess: () => {
      haptic.success();
      router.back();
    },
  });

  // A repeat with no interval can never come due; the server refuses it, so the form does first.
  const missingInterval = repeats && !everyMonths && !everyDistance;
  const cannotSave =
    !title.trim() || missingInterval || (repeats ? effectiveVehicleId === NO_VEHICLE : !garageId);

  const today = localDay();
  const dueOptions = [
    { label: 'No date', day: '' },
    { label: 'Next week', day: localDay({ days: 7 }) },
    { label: 'Next month', day: localDay({ months: 1 }) },
    { label: 'In 3 months', day: localDay({ months: 3 }) },
  ];
  const presets = [
    { label: '6 months', months: '6', distance: '' },
    { label: '12 months', months: '12', distance: '' },
    { label: `${bigDistance.toLocaleString()} ${unit}`, months: '', distance: String(bigDistance) },
    {
      label: `12 mo or ${bigDistance.toLocaleString()} ${unit}`,
      months: '12',
      distance: String(bigDistance),
    },
  ];

  const pickJob = (job: (typeof JOBS)[number]) => {
    haptic.selection();
    setTitle(job.title);
    // The usual interval, only where none has been typed — a template never overwrites a choice.
    if (repeats && !everyMonths && !everyDistance) {
      setEveryMonths(job.months ?? '');
      setEveryDistance(
        job.distance === 'big'
          ? String(bigDistance)
          : job.distance === 'small'
            ? String(smallDistance)
            : '',
      );
    }
  };

  // The plan read back in words, in the footer, so what Save records is never a scroll away.
  const interval = [
    everyMonths ? `${everyMonths} mo` : null,
    everyDistance ? `${Number(everyDistance).toLocaleString()} ${unit}` : null,
  ]
    .filter(Boolean)
    .join(' or ');
  const cadence = repeats
    ? interval
      ? `every ${interval}`
      : 'no interval yet'
    : dueDate
      ? `due ${new Date(`${dueDate}T12:00:00`).toLocaleDateString('en-US', {
          day: 'numeric',
          month: 'short',
        })}`
      : 'no date';
  const summary = [
    title.trim() || (repeats ? 'A schedule' : 'A job'),
    cadence,
    vehicle?.displayName ?? (repeats ? null : 'garage-wide'),
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top + 44 : 0}
      style={{ flex: 1, backgroundColor: theme.background }}
    >
      <Stack.Screen options={{ title: 'Add to activity' }} />
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <AddMode
          mode="planned"
          vehicleId={effectiveVehicleId !== NO_VEHICLE ? effectiveVehicleId : undefined}
        />

        {/* The question everything else depends on, as two answers you can see before choosing. */}
        <View style={styles.cadenceRow}>
          <CadenceCard
            icon="calendar-outline"
            label="Once"
            hint="A job with a day"
            selected={!repeats}
            onPress={() => setRepeats(false)}
          />
          <CadenceCard
            icon="repeat"
            label="On a repeat"
            hint="Months or distance"
            selected={repeats}
            onPress={() => setRepeats(true)}
          />
        </View>

        {vehicleList.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ marginHorizontal: -spacing.md }}
            contentContainerStyle={{ gap: spacing.sm, paddingHorizontal: spacing.md }}
          >
            {/* Only a one-off can be garage-wide. */}
            {repeats ? null : (
              <VehiclePill
                label="Garage work"
                selected={effectiveVehicleId === NO_VEHICLE}
                onPress={() => setVehicleId(NO_VEHICLE)}
              />
            )}
            {vehicleList.map((item) => (
              <VehiclePill
                key={item.id}
                label={item.displayName}
                make={item.make ?? item.displayName}
                selected={item.id === effectiveVehicleId}
                onPress={() => setVehicleId(item.id)}
              />
            ))}
          </ScrollView>
        ) : null}

        <View style={{ gap: spacing.sm }}>
          <Headline
            label="What needs doing"
            value={title}
            onChangeText={setTitle}
            placeholder={repeats ? 'Oil and filter' : 'Book the annual inspection'}
            returnKeyType="done"
          />
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            style={{ marginHorizontal: -spacing.md }}
            contentContainerStyle={{ gap: spacing.sm, paddingHorizontal: spacing.md }}
          >
            {JOBS.map((job) => (
              <Chip
                key={job.title}
                label={job.title}
                selected={title.trim() === job.title}
                onPress={() => pickJob(job)}
                leading={<Glyph size={14}>{jobEmoji(job.title)}</Glyph>}
              />
            ))}
          </ScrollView>
        </View>

        {repeats ? (
          <Rise key="repeat" style={{ gap: spacing.sm }}>
            <Eyebrow>Every</Eyebrow>
            <View style={styles.wrap}>
              {presets.map((preset) => (
                <Chip
                  key={preset.label}
                  label={preset.label}
                  selected={everyMonths === preset.months && everyDistance === preset.distance}
                  onPress={() => {
                    setEveryMonths(preset.months);
                    setEveryDistance(preset.distance);
                  }}
                />
              ))}
            </View>
            <Panel direction="row">
              <PanelCell label="Months" note="By the calendar">
                <FigureInput
                  unit="mo"
                  value={everyMonths}
                  onChangeText={(text) => setEveryMonths(digitsOnly(text, 3))}
                  placeholder="—"
                  keyboardType="number-pad"
                  accessibilityLabel="Every how many months"
                />
              </PanelCell>
              <PanelCell
                label="Or distance"
                note={missingInterval ? 'Set at least one' : 'Whichever comes first'}
                noteTone={missingInterval ? 'warning' : undefined}
              >
                <FigureInput
                  unit={unit}
                  value={everyDistance ? Number(everyDistance).toLocaleString() : ''}
                  onChangeText={(text) => setEveryDistance(digitsOnly(text))}
                  placeholder="—"
                  keyboardType="number-pad"
                  accessibilityLabel={`Or every how many ${unit}`}
                />
              </PanelCell>
            </Panel>
            <View style={[styles.note, { backgroundColor: theme.card }]}>
              <Ionicons name="play-circle-outline" size={18} color={theme.mutedForeground} />
              <Text style={[typeScale.caption, { flex: 1, color: theme.mutedForeground }]}>
                Counting starts today
                {vehicle?.currentOdometer != null
                  ? ` at ${vehicle.currentOdometer.toLocaleString()} ${unit}`
                  : ''}
                . Log it as done and the clock restarts.
              </Text>
            </View>
          </Rise>
        ) : (
          <Rise key="once" style={{ gap: spacing.sm }}>
            <Eyebrow>When</Eyebrow>
            <View style={styles.wrap}>
              {dueOptions.map((option) => (
                <Chip
                  key={option.label}
                  label={option.label}
                  selected={dueDate === option.day}
                  onPress={() => setDueDate(option.day)}
                />
              ))}
            </View>
            <Panel>
              <PanelCell label="Due" note={dueDate ? undefined : 'No date — it waits until done'}>
                {dueDate ? (
                  <DateField value={dueDate} onChange={setDueDate} min={today} label="Due" />
                ) : (
                  <Text
                    onPress={() => setDueDate(localDay({ days: 7 }))}
                    accessibilityRole="button"
                    style={[
                      typeScale.headline,
                      { color: theme.mutedForeground, paddingVertical: 8 },
                    ]}
                  >
                    Pick a day
                  </Text>
                )}
              </PanelCell>

              {/* Or at a reading: cambelts and brake pads are described in kilometres, not dates. */}
              <View style={styles.pair}>
                <PanelCell label="Or by" note="Odometer">
                  <FigureInput
                    unit={unit}
                    value={dueOdometer ? Number(dueOdometer).toLocaleString() : ''}
                    onChangeText={(text) => setDueOdometer(digitsOnly(text, 9))}
                    placeholder="—"
                    keyboardType="number-pad"
                    accessibilityLabel={`Due at odometer in ${unit}`}
                  />
                </PanelCell>
                <PanelCell label="Estimate" note="What it should cost">
                  <FigureInput
                    unit={currency}
                    value={estimate}
                    onChangeText={(text) => setEstimate(amountOnly(text))}
                    placeholder="0.00"
                    keyboardType="decimal-pad"
                    accessibilityLabel={`Estimated cost in ${currency}`}
                  />
                </PanelCell>
              </View>
            </Panel>
          </Rise>
        )}

        <Panel>
          <PanelCell label="Note">
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder="Optional"
              placeholderTextColor={theme.borderStrong}
              accessibilityLabel="Note"
              maxLength={2000}
              style={[typeScale.headline, { color: theme.foreground, paddingVertical: 2 }]}
            />
          </PanelCell>
        </Panel>

        <View style={{ gap: spacing.sm }}>
          <Eyebrow>Priority</Eyebrow>
          <View style={styles.priorities}>
            {PRIORITIES.map((option) => {
              const selected = option.value === priority;
              const flag =
                option.value === 'URGENT'
                  ? theme.destructive
                  : option.value === 'HIGH'
                    ? theme.warning
                    : theme.mutedForeground;
              return (
                <PressableScale
                  key={option.value}
                  onPress={() => {
                    if (!selected) haptic.selection();
                    setPriority(option.value);
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`${option.label} priority`}
                  scaleTo={0.94}
                  style={[
                    styles.priority,
                    { backgroundColor: selected ? theme.primary : theme.card },
                  ]}
                >
                  <Ionicons
                    name={selected ? 'flag' : 'flag-outline'}
                    size={13}
                    color={selected ? theme.primaryForeground : flag}
                  />
                  <Text
                    style={[
                      typeScale.caption,
                      {
                        fontWeight: '600',
                        color: selected ? theme.primaryForeground : theme.foreground,
                      },
                    ]}
                  >
                    {option.label}
                  </Text>
                </PressableScale>
              );
            })}
          </View>
        </View>

        {create.isError ? (
          <View style={[styles.banner, { backgroundColor: theme.destructiveSoft }]}>
            <Text
              accessibilityRole="alert"
              style={[typeScale.caption, { color: theme.destructive }]}
            >
              Could not save on this phone: {(create.error as Error).message}
            </Text>
          </View>
        ) : null}
      </ScrollView>

      {/* Pinned under the thumb: the plan read back in one line, and the button that saves it. */}
      <View
        style={[
          styles.footer,
          { backgroundColor: theme.background, paddingBottom: Math.max(insets.bottom, spacing.sm) },
        ]}
      >
        <View style={styles.footerSummary}>
          <Ionicons
            name={repeats ? 'repeat' : 'calendar-outline'}
            size={14}
            color={theme.mutedForeground}
          />
          <Text
            numberOfLines={1}
            style={[typeScale.caption, { flex: 1, color: theme.mutedForeground }]}
          >
            {summary}
          </Text>
        </View>
        <Button
          label={repeats ? 'Add schedule' : 'Add to coming up'}
          variant="primary"
          loading={create.isPending}
          disabled={cannotSave}
          onPress={() => create.mutate()}
        />
      </View>
    </KeyboardAvoidingView>
  );
}

function CadenceCard({
  icon,
  label,
  hint,
  selected,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  hint: string;
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const ink = selected ? theme.primaryForeground : theme.foreground;
  return (
    <PressableScale
      onPress={() => {
        if (!selected) haptic.selection();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      accessibilityHint={hint}
      scaleTo={0.96}
      style={[styles.cadence, { backgroundColor: selected ? theme.primary : theme.card }]}
    >
      <View
        style={[
          styles.cadenceIcon,
          { backgroundColor: selected ? theme.primaryForeground : theme.muted },
        ]}
      >
        <Ionicons name={icon} size={18} color={selected ? theme.primary : theme.foreground} />
      </View>
      <View>
        <Text style={[typeScale.label, { color: ink }]}>{label}</Text>
        <Text
          numberOfLines={1}
          style={[
            typeScale.caption,
            {
              color: selected ? theme.primaryForeground : theme.mutedForeground,
              opacity: selected ? 0.75 : 1,
            },
          ]}
        >
          {hint}
        </Text>
      </View>
    </PressableScale>
  );
}

function VehiclePill({
  label,
  make,
  selected,
  onPress,
}: {
  label: string;
  /** Absent for garage-wide work, which gets the garage glyph instead of a logo. */
  make?: string;
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <PressableScale
      onPress={() => {
        if (!selected) haptic.selection();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      scaleTo={0.94}
      style={[styles.pill, { backgroundColor: selected ? theme.primary : theme.card }]}
    >
      <View style={[styles.pillLogo, { backgroundColor: theme.muted }]}>
        {make ? (
          <BrandLogo make={make} size={32} />
        ) : (
          <Ionicons name="home-outline" size={15} color={theme.foreground} />
        )}
      </View>
      <Text
        numberOfLines={1}
        style={[
          typeScale.label,
          { maxWidth: 150, color: selected ? theme.primaryForeground : theme.foreground },
        ]}
      >
        {label}
      </Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  page: { padding: spacing.md, gap: spacing.lg, paddingBottom: spacing.xl },
  pair: { flexDirection: 'row', gap: StyleSheet.hairlineWidth },
  cadenceRow: { flexDirection: 'row', gap: spacing.sm },
  cadence: { flex: 1, gap: 10, borderRadius: radius.lg, padding: 12 },
  cadenceIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 44,
    borderRadius: 999,
    paddingLeft: 5,
    paddingRight: 14,
  },
  pillLogo: {
    width: 32,
    height: 32,
    borderRadius: 999,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  note: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radius.lg,
    padding: 12,
  },
  priorities: { flexDirection: 'row', gap: spacing.sm },
  priority: {
    flex: 1,
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    borderRadius: radius.md,
  },
  banner: { gap: 4, borderRadius: radius.lg, padding: 14 },
  footer: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, gap: 6 },
  footerSummary: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 2 },
});
