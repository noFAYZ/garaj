import { useMutation, useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
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
import { EVENT_TYPES, TRIP_PURPOSES, type EventType, type TripPurpose } from '@vehicle-os/domain';
import { activityQuery, vehiclesQuery } from '@vehicle-os/api-client/react';
import { amountOnly, digitsOnly, localDay, stampForDay } from '@vehicle-os/ui';
import { AddMode } from '@/components/add-mode';
import { api } from '@/lib/api';
import { eventEmoji, jobEmoji } from '@/lib/emoji';
import { BrandLogo } from '@/components/brand-logo';
import { fromParams, pickPhoto, uploadDocumentFile, type FileParams } from '@/lib/file-picker';
import { humanise, toMinorUnits } from '@/lib/format';
import {
  Chip,
  Eyebrow,
  FigureInput,
  Glyph,
  Headline,
  Panel,
  PanelCell,
  ToneTile,
} from '@/lib/instrument';
import { haptic, PressableScale, Rise } from '@/lib/motion';
import { enqueue, flush } from '@/lib/offline';
import { DateField } from '@/lib/date-picker';
import { radius, spacing, typeScale, useTheme } from '@/lib/theme';
import { Button, Empty } from '@/lib/ui';
import { useUnitsFor } from '@/lib/vehicle-units';

/**
 * What each kind actually asks for.
 *
 * "Cost" is a price on a purchase and a takings figure on a sale; "who" is a station at a pump, a
 * garage for a repair and an insurer for a policy. Asking every kind the same four questions in
 * the same words makes most of them wrong for most entries — so the words, and which fields
 * appear at all, come from here.
 *
 * A kind that is not listed falls back to the general wording, which is what the twelve rarer
 * ones want anyway.
 */
const KIND_FIELDS: Partial<
  Record<EventType, { cost?: string; who?: string; quantity?: string; odometer?: false }>
> = {
  FUEL: { cost: 'Cost', who: 'Station', quantity: 'Litres' },
  CHARGE: { cost: 'Cost', who: 'Charger', quantity: 'kWh' },
  MAINTENANCE: { cost: 'Cost', who: 'Garage' },
  REPAIR: { cost: 'Cost', who: 'Garage' },
  MODIFICATION: { cost: 'Cost', who: 'Fitted by' },
  INSPECTION: { cost: 'Fee', who: 'Tester' },
  INSURANCE: { cost: 'Premium', who: 'Insurer', odometer: false },
  REGISTRATION: { cost: 'Fee', who: 'Authority', odometer: false },
  PURCHASE: { cost: 'Price', who: 'Seller' },
  SALE: { cost: 'Sold for', who: 'Buyer' },
  CLEANING: { cost: 'Cost', who: 'Where' },
  TRIP: { cost: 'Spent', who: 'Where to' },
  PART_INSTALLED: { cost: 'Cost', who: 'Supplier' },
  VALUATION: { cost: 'Valued at', who: 'Valued by', odometer: false },
  NOTE: { odometer: false },
};

/*
 * The kinds logged week to week get a tile; the other twelve are a chip away. Eight, so the grid is
 * two even rows of four — the same eight the web offers.
 */
const COMMON = [
  'MAINTENANCE',
  'FUEL',
  'CHARGE',
  'REPAIR',
  'CLEANING',
  'INSPECTION',
  'EXPENSE',
  'NOTE',
] as const satisfies readonly EventType[];
const OTHER = EVENT_TYPES.filter((type) => !(COMMON as readonly string[]).includes(type));

const EXAMPLE: Partial<Record<EventType, string>> = {
  MAINTENANCE: 'Oil and filter change',
  FUEL: 'Filled up',
  CHARGE: 'Charged at home',
  REPAIR: 'Replaced the front pads',
  CLEANING: 'Full valet',
  INSPECTION: 'Annual inspection',
  EXPENSE: 'Parking permit',
  NOTE: 'Rattle from the dash at idle',
};

/**
 * Add something that happened, set the way the web's dialog is: the title first and large, what
 * kind of thing it was as a grid of glyphs, and the figures — when, the odometer, the cost — as one
 * instrument panel that reads back what was typed ("+580 km since the last reading").
 *
 * A done item that completes a schedule is filed through the schedule, so its clock restarts; an
 * unscheduled service goes in as a maintenance record, so it reaches the service history. Both are
 * the web's rules.
 */
export default function AddDoneScreen() {
  const theme = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ vehicleId?: string; kind?: string } & FileParams>();

  const vehicles = useQuery(vehiclesQuery(api));
  const [vehicleId, setVehicleId] = useState<string | null>(params.vehicleId ?? null);
  // The dock's fan opens this on the kind it named — "Service", "Expense" — rather than on Fuel.
  const [kind, setKind] = useState<EventType>(() =>
    EVENT_TYPES.includes(params.kind as EventType) ? (params.kind as EventType) : 'FUEL',
  );
  const [scheduleId, setScheduleId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [day, setDay] = useState(() => localDay());
  const [odometer, setOdometer] = useState('');
  const [cost, setCost] = useState('');
  const [showMore, setShowMore] = useState(false);
  const [who, setWho] = useState('');
  const [quantity, setQuantity] = useState('');
  // Mileage-log detail, asked only on a trip; a purpose is what puts it in the report.
  const [purpose, setPurpose] = useState<TripPurpose | null>(null);
  const [tripStart, setTripStart] = useState('');
  const [tripDistance, setTripDistance] = useState('');
  const [tripRate, setTripRate] = useState('');
  // A receipt photographed from the add sheet; kept with the vehicle's documents on save.
  const [receipt, setReceipt] = useState(() => fromParams(params));
  const [attachError, setAttachError] = useState<string | null>(null);
  const insets = useSafeAreaInsets();
  // The keyboard offset is the stack header over this screen: the status bar and its 44pt bar.
  const headerHeight = insets.top + 44;

  const list = vehicles.data?.data ?? [];
  const chosenId = vehicleId ?? list[0]?.id ?? null;
  const vehicle = list.find((item) => item.id === chosenId);
  const { currency, odometerUnit } = useUnitsFor(vehicle);
  const unit = odometerUnit === 'MI' ? 'mi' : 'km';

  // The chosen vehicle's schedules, so a service can complete one. Cached by the vehicle screen.
  const activity = useQuery({ ...activityQuery(api, chosenId ?? ''), enabled: Boolean(chosenId) });
  const schedules = (activity.data?.planned ?? []).flatMap((item) =>
    item.kind === 'SCHEDULE' ? [item.schedule] : [],
  );
  const schedule = schedules.find((item) => item.id === scheduleId) ?? null;

  const today = localDay();
  // What this kind asks for, and in whose words.
  const asks = KIND_FIELDS[kind] ?? {};
  const last = vehicle?.currentOdometer ?? null;
  const reading = odometer ? Number(odometer) : null;

  /*
   * Checked here, not left to the server: the entry is saved on the phone and this screen has
   * closed long before the server sees it, so there is no form left to show a refusal on.
   */
  const fieldErrors: Partial<Record<string, string>> | undefined =
    reading !== null && reading > 100_000_000
      ? { odometer: 'That is past 100,000,000.' }
      : undefined;

  /*
   * Saved to the phone, not posted. The queue sends it — now if there is signal, later if not —
   * and the feed shows it straight away, so adding an entry never waits on the network. That
   * wait was every save: several seconds against a database in another region.
   */
  const save = useMutation({
    mutationFn: async () => {
      const vehicleId = chosenId!;
      const when = stampForDay(day);
      const amount = cost && Number(cost) > 0 ? toMinorUnits(Number(cost), currency) : undefined;
      // The unit travels with the reading: the API refuses an odometer it cannot interpret.
      const odometerFields =
        reading !== null && asks.odometer !== false ? { odometer: reading, odometerUnit } : {};
      /*
       * The measured amount rides in the description, as the quick entry's litres do: the event
       * has no quantity column, and inventing one for two kinds would be a migration for a string.
       */
      const extraFields = {
        ...(who.trim() ? { provider: who.trim() } : {}),
        ...(quantity && asks.quantity
          ? { description: `${quantity} ${asks.quantity === 'Litres' ? 'L' : 'kWh'}` }
          : {}),
      };
      const labour =
        amount !== undefined ? { laborCostAmountMinor: amount, costCurrency: currency } : {};

      /*
       * The receipt goes first and needs signal; the entry itself is queued after it. In that
       * order a failed upload leaves nothing saved, so trying again cannot record it twice.
       * ponytail: not linked by eventId — a queued entry has no id until it syncs. Link it on the
       * web, or queue uploads, if receipts need to sit on their entry.
       */
      if (receipt) {
        await uploadDocumentFile(vehicleId, receipt, {
          documentType: 'RECEIPT',
          title: title.trim() || schedule?.title || humanise(kind),
          issuedOn: day,
        });
      }

      if (schedule) {
        await enqueue({
          kind: 'maintenance',
          vehicleId,
          planId: schedule.id,
          body: {
            performedAt: when,
            ...(title.trim() ? { workPerformed: title.trim() } : {}),
            ...odometerFields,
            ...extraFields,
            ...labour,
          },
        });
      } else if (kind === 'MAINTENANCE') {
        await enqueue({
          kind: 'maintenance-log',
          vehicleId,
          body: {
            title: title.trim() || EXAMPLE.MAINTENANCE!,
            performedAt: when,
            ...odometerFields,
            ...labour,
          },
        });
      } else {
        await enqueue({
          kind: 'event',
          vehicleId,
          body: {
            eventType: kind,
            title: title.trim() || humanise(kind),
            occurredAt: when,
            ...odometerFields,
            ...(amount !== undefined ? { costAmountMinor: amount, costCurrency: currency } : {}),
            ...(kind === 'TRIP' && purpose
              ? {
                  // A typed distance with no reading still needs its unit on the event.
                  ...(reading === null ? { odometerUnit } : {}),
                  trip: {
                    purpose,
                    ...(tripStart ? { startOdometer: Number(tripStart) } : {}),
                    ...(tripDistance ? { distance: Number(tripDistance) } : {}),
                    ...(tripRate && Number(tripRate) > 0
                      ? {
                          rateMinor: toMinorUnits(Number(tripRate), currency),
                          rateCurrency: currency,
                        }
                      : {}),
                  },
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

  if (vehicles.data && list.length === 0) {
    return <Empty title="No vehicles yet" description="Add a vehicle first." />;
  }

  const readingNote =
    reading !== null && last !== null
      ? reading >= last
        ? `+${(reading - last).toLocaleString()} ${unit} since the last reading`
        : `Below the last reading of ${last.toLocaleString()} ${unit}`
      : last !== null
        ? `Last read ${last.toLocaleString()} ${unit}`
        : 'Optional';

  const attach = async (source: 'camera' | 'library') => {
    setAttachError(null);
    try {
      const picked = await pickPhoto(source);
      if (picked) {
        haptic.selection();
        setReceipt(picked);
      }
    } catch (error) {
      setAttachError((error as Error).message);
    }
  };

  // The footer reads the entry back in one line, so what Save records is never a scroll away.
  const dayLabel =
    day === today ? 'Today' : day === localDay({ days: -1 }) ? 'Yesterday' : formatDay(day);
  const summary = [
    vehicle?.displayName,
    schedule ? schedule.title : humanise(kind),
    dayLabel,
    cost && Number(cost) > 0 ? `${cost} ${currency}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  // Completing a schedule is a service, so the question is only asked of one.
  const offerSchedules = schedules.length > 0 && kind === 'MAINTENANCE' && !schedule;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? headerHeight : 0}
      style={{ flex: 1, backgroundColor: theme.background }}
    >
      <Stack.Screen options={{ title: 'Add to activity' }} />
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <AddMode mode="done" vehicleId={chosenId ?? undefined} />

        {list.length > 1 && !params.vehicleId ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ marginHorizontal: -spacing.md }}
            contentContainerStyle={{ gap: spacing.sm, paddingHorizontal: spacing.md }}
          >
            {list.map((item) => {
              const selected = item.id === chosenId;
              return (
                <PressableScale
                  key={item.id}
                  onPress={() => {
                    if (!selected) haptic.selection();
                    setVehicleId(item.id);
                    setScheduleId(null);
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={item.displayName}
                  scaleTo={0.94}
                  style={[
                    styles.vehiclePill,
                    { backgroundColor: selected ? theme.primary : theme.card },
                  ]}
                >
                  <View style={[styles.vehicleLogo, { backgroundColor: theme.muted }]}>
                    <BrandLogo make={item.make ?? item.displayName} size={32} />
                  </View>
                  <Text
                    numberOfLines={1}
                    style={[
                      typeScale.label,
                      {
                        maxWidth: 150,
                        color: selected ? theme.primaryForeground : theme.foreground,
                      },
                    ]}
                  >
                    {item.displayName}
                  </Text>
                </PressableScale>
              );
            })}
          </ScrollView>
        ) : null}

        {schedule ? (
          <Rise style={[styles.note, { backgroundColor: theme.card }]}>
            <ToneTile tone="neutral" size={40}>
              <Glyph>{jobEmoji(schedule.title)}</Glyph>
            </ToneTile>
            <Text style={[typeScale.caption, { flex: 1, color: theme.mutedForeground }]}>
              Completes{' '}
              <Text style={{ color: theme.foreground, fontWeight: '600' }}>{schedule.title}</Text>,
              and its clock starts again from this date.
            </Text>
            <PressableScale
              onPress={() => setScheduleId(null)}
              accessibilityRole="button"
              accessibilityLabel="Do not complete a schedule"
              hitSlop={8}
            >
              <Ionicons name="close-circle" size={22} color={theme.mutedForeground} />
            </PressableScale>
          </Rise>
        ) : (
          <View style={{ gap: spacing.sm }}>
            <Eyebrow>What happened</Eyebrow>
            <View style={styles.grid}>
              {COMMON.map((option) => (
                <KindTile
                  key={option}
                  kind={option}
                  selected={kind === option}
                  onPress={() => setKind(option)}
                />
              ))}
            </View>
            {showMore || (OTHER as readonly string[]).includes(kind) ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={{ marginHorizontal: -spacing.md }}
                contentContainerStyle={{ gap: spacing.sm, paddingHorizontal: spacing.md }}
              >
                {OTHER.map((option) => (
                  <Chip
                    key={option}
                    label={humanise(option)}
                    selected={kind === option}
                    onPress={() => setKind(option)}
                    leading={<Glyph size={15}>{eventEmoji(option)}</Glyph>}
                  />
                ))}
              </ScrollView>
            ) : (
              <PressableScale
                onPress={() => setShowMore(true)}
                accessibilityRole="button"
                accessibilityLabel="More kinds"
                style={[styles.more, { backgroundColor: theme.muted }]}
              >
                <Text style={[typeScale.caption, { fontWeight: '600', color: theme.foreground }]}>
                  {OTHER.length} more kinds
                </Text>
                <Ionicons name="chevron-down" size={14} color={theme.foreground} />
              </PressableScale>
            )}
          </View>
        )}

        {offerSchedules ? (
          <View style={{ gap: spacing.sm }}>
            <Eyebrow>Completes a schedule?</Eyebrow>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ marginHorizontal: -spacing.md }}
              contentContainerStyle={{ gap: spacing.sm, paddingHorizontal: spacing.md }}
            >
              {schedules.map((item) => (
                <Chip
                  key={item.id}
                  label={item.title}
                  selected={false}
                  onPress={() => setScheduleId(item.id)}
                  leading={<Glyph size={15}>{jobEmoji(item.title)}</Glyph>}
                />
              ))}
            </ScrollView>
          </View>
        ) : null}

        <Headline
          label={schedule ? 'Work done' : 'Title'}
          value={title}
          onChangeText={setTitle}
          placeholder={schedule ? schedule.title : (EXAMPLE[kind] ?? humanise(kind))}
          note={schedule ? 'Optional — it takes the schedule’s name.' : undefined}
          error={fieldErrors?.title ?? fieldErrors?.workPerformed}
          returnKeyType="done"
        />

        <Panel>
          <PanelCell
            label="When"
            note={
              <View style={{ flexDirection: 'row', gap: spacing.xs }}>
                <Chip label="Today" selected={day === today} onPress={() => setDay(today)} />
                <Chip
                  label="Yesterday"
                  selected={day === localDay({ days: -1 })}
                  onPress={() => setDay(localDay({ days: -1 }))}
                />
              </View>
            }
          >
            <DateField value={day} onChange={setDay} max={today} label="When" />
          </PanelCell>

          {asks.odometer === false ? null : (
            <PanelCell
              label="Odometer"
              note={
                fieldErrors?.odometer ??
                (fieldErrors?.odometerUnit ? fieldErrors.odometerUnit : readingNote)
              }
              noteTone={
                fieldErrors?.odometer
                  ? 'destructive'
                  : reading !== null && last !== null && reading < last
                    ? 'warning'
                    : undefined
              }
            >
              <FigureInput
                unit={unit}
                value={reading !== null ? reading.toLocaleString() : ''}
                onChangeText={(text) => setOdometer(digitsOnly(text))}
                placeholder={last !== null ? last.toLocaleString() : '0'}
                keyboardType="number-pad"
                accessibilityLabel={`Odometer in ${unit}`}
              />
            </PanelCell>
          )}

          {/* A row when the kind measures something as well as paying for it. */}
          <View style={styles.pair}>
            <PanelCell
              label={asks.cost ?? 'Cost'}
              note={
                fieldErrors?.costAmountMinor ??
                (cost ? 'Filed as spending too' : 'Leave empty if it was free')
              }
              noteTone={fieldErrors?.costAmountMinor ? 'destructive' : undefined}
            >
              <FigureInput
                unit={currency}
                value={cost}
                onChangeText={(text) => setCost(amountOnly(text))}
                placeholder="0.00"
                keyboardType="decimal-pad"
                accessibilityLabel={`Cost in ${currency}`}
              />
            </PanelCell>

            {asks.quantity ? (
              <PanelCell label={asks.quantity}>
                <FigureInput
                  unit={asks.quantity === 'Litres' ? 'L' : 'kWh'}
                  value={quantity}
                  onChangeText={(text) => setQuantity(amountOnly(text))}
                  placeholder="0.0"
                  keyboardType="decimal-pad"
                  accessibilityLabel={asks.quantity}
                />
              </PanelCell>
            ) : null}
          </View>

          {kind === 'TRIP' && !schedule ? (
            <>
              <PanelCell label="For the mileage log" note="Business trips can be claimed">
                <View style={styles.chips}>
                  {TRIP_PURPOSES.map((option) => (
                    <Chip
                      key={option}
                      label={humanise(option)}
                      selected={purpose === option}
                      onPress={() => setPurpose(purpose === option ? null : option)}
                    />
                  ))}
                </View>
              </PanelCell>
              {purpose ? (
                <View style={styles.pair}>
                  <PanelCell
                    label="Start reading"
                    note={fieldErrors?.['trip.startOdometer'] ?? 'Odometer above is the end'}
                    noteTone={fieldErrors?.['trip.startOdometer'] ? 'destructive' : undefined}
                  >
                    <FigureInput
                      unit={unit}
                      value={tripStart}
                      onChangeText={(text) => setTripStart(digitsOnly(text))}
                      placeholder="0"
                      keyboardType="number-pad"
                      accessibilityLabel={`Start reading in ${unit}`}
                    />
                  </PanelCell>
                  <PanelCell
                    label="Or distance"
                    note={fieldErrors?.['trip.distance']}
                    noteTone={fieldErrors?.['trip.distance'] ? 'destructive' : undefined}
                  >
                    <FigureInput
                      unit={unit}
                      value={tripDistance}
                      onChangeText={(text) => setTripDistance(digitsOnly(text))}
                      placeholder="0"
                      keyboardType="number-pad"
                      accessibilityLabel={`Distance in ${unit}`}
                    />
                  </PanelCell>
                </View>
              ) : null}
              {purpose ? (
                <PanelCell
                  label={`Rate per ${unit}`}
                  note={fieldErrors?.['trip.rateCurrency'] ?? 'Kept on this trip'}
                  noteTone={fieldErrors?.['trip.rateCurrency'] ? 'destructive' : undefined}
                >
                  <FigureInput
                    unit={currency}
                    value={tripRate}
                    onChangeText={(text) => setTripRate(amountOnly(text))}
                    placeholder="0.00"
                    keyboardType="decimal-pad"
                    accessibilityLabel={`Rate per ${unit} in ${currency}`}
                  />
                </PanelCell>
              ) : null}
            </>
          ) : null}

          {asks.who ? (
            <PanelCell label={asks.who}>
              <TextInput
                value={who}
                onChangeText={setWho}
                placeholder="Optional"
                placeholderTextColor={theme.borderStrong}
                accessibilityLabel={asks.who}
                maxLength={200}
                style={[typeScale.headline, { color: theme.foreground, paddingVertical: 2 }]}
              />
            </PanelCell>
          ) : null}
        </Panel>

        {receipt ? (
          <Rise style={[styles.note, { backgroundColor: theme.card }]}>
            <Image
              source={{ uri: receipt.uri }}
              style={styles.receipt}
              contentFit="cover"
              accessibilityIgnoresInvertColors
            />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[typeScale.label, { color: theme.foreground }]}>Receipt attached</Text>
              <Text style={[typeScale.caption, { color: theme.mutedForeground }]}>
                Kept with this vehicle’s documents
              </Text>
            </View>
            <PressableScale
              onPress={() => setReceipt(null)}
              accessibilityRole="button"
              accessibilityLabel="Remove receipt"
              hitSlop={8}
            >
              <Ionicons name="close-circle" size={22} color={theme.mutedForeground} />
            </PressableScale>
          </Rise>
        ) : (
          <View style={[styles.note, { backgroundColor: theme.card }]}>
            <View style={[styles.attachIcon, { backgroundColor: theme.muted }]}>
              <Ionicons name="receipt-outline" size={18} color={theme.foreground} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[typeScale.label, { color: theme.foreground }]}>Receipt</Text>
              <Text numberOfLines={1} style={[typeScale.caption, { color: theme.mutedForeground }]}>
                Optional — needs signal to save
              </Text>
            </View>
            <PressableScale
              onPress={() => void attach('camera')}
              accessibilityRole="button"
              accessibilityLabel="Photograph a receipt"
              scaleTo={0.9}
              style={[styles.round, { backgroundColor: theme.muted }]}
            >
              <Ionicons name="camera-outline" size={18} color={theme.foreground} />
            </PressableScale>
            <PressableScale
              onPress={() => void attach('library')}
              accessibilityRole="button"
              accessibilityLabel="Choose a receipt from photos"
              scaleTo={0.9}
              style={[styles.round, { backgroundColor: theme.muted }]}
            >
              <Ionicons name="images-outline" size={18} color={theme.foreground} />
            </PressableScale>
          </View>
        )}

        {attachError ? (
          <View style={[styles.banner, { backgroundColor: theme.warningSoft }]}>
            <Text accessibilityRole="alert" style={[typeScale.caption, { color: theme.warning }]}>
              {attachError}
            </Text>
          </View>
        ) : null}

        {save.isError ? (
          <View style={[styles.banner, { backgroundColor: theme.destructiveSoft }]}>
            <Text
              accessibilityRole="alert"
              style={[typeScale.caption, { color: theme.destructive }]}
            >
              {receipt ? 'Could not save' : 'Could not save on this phone'}:{' '}
              {(save.error as Error).message}
            </Text>
          </View>
        ) : null}
      </ScrollView>

      {/* Pinned under the thumb: the entry read back in one line, and the button that saves it. */}
      <View
        style={[
          styles.footer,
          {
            backgroundColor: theme.background,
            paddingBottom: Math.max(insets.bottom, spacing.sm),
          },
        ]}
      >
        <View style={styles.footerSummary}>
          <Glyph size={15}>{schedule ? jobEmoji(schedule.title) : eventEmoji(kind)}</Glyph>
          <Text
            numberOfLines={1}
            style={[typeScale.caption, { flex: 1, color: theme.mutedForeground }]}
          >
            {summary}
          </Text>
          {receipt ? <Ionicons name="attach" size={15} color={theme.mutedForeground} /> : null}
        </View>
        <Button
          label="Add to record"
          variant="primary"
          loading={save.isPending}
          disabled={!chosenId || Boolean(fieldErrors)}
          onPress={() => save.mutate()}
        />
      </View>
    </KeyboardAvoidingView>
  );
}

function formatDay(day: string): string {
  return new Date(`${day}T00:00:00`).toLocaleDateString('en-US', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

function KindTile({
  kind,
  selected,
  onPress,
}: {
  kind: EventType;
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
      accessibilityLabel={humanise(kind)}
      scaleTo={0.93}
      style={[styles.tile, { backgroundColor: selected ? theme.primary : theme.card }]}
    >
      <Glyph size={22}>{eventEmoji(kind)}</Glyph>
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        style={[
          typeScale.caption,
          {
            fontSize: 12,
            fontWeight: '600',
            color: selected ? theme.primaryForeground : theme.mutedForeground,
          },
        ]}
      >
        {humanise(kind)}
      </Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  page: { padding: spacing.md, gap: spacing.lg, paddingBottom: spacing.xl },
  pair: { flexDirection: 'row', gap: StyleSheet.hairlineWidth },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, paddingTop: spacing.xs },
  vehiclePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 44,
    borderRadius: 999,
    paddingLeft: 5,
    paddingRight: 14,
  },
  vehicleLogo: {
    width: 32,
    height: 32,
    borderRadius: 999,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tile: {
    // Four to a row: a quarter of the width, less three gaps shared out.
    width: '22.9%',
    flexGrow: 1,
    height: 66,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    borderRadius: radius.lg,
    paddingHorizontal: 4,
  },
  more: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 32,
    borderRadius: 999,
    paddingHorizontal: 12,
  },
  note: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radius.lg,
    padding: 10,
  },
  receipt: { width: 44, height: 44, borderRadius: 10 },
  attachIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  round: {
    width: 40,
    height: 40,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  banner: { gap: 4, borderRadius: radius.lg, padding: 14 },
  footer: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, gap: 6 },
  footerSummary: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 2 },
});
