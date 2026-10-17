import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { AiAttachment, EntryDraft, Vehicle } from '@vehicle-os/contracts';
import {
  EVENT_TYPES,
  TRIP_PURPOSES,
  isKnownCurrency,
  minorUnitExponent,
  type EventType,
  type TripPurpose,
} from '@vehicle-os/domain';
import {
  activityQuery,
  dashboardQuery,
  garagesQuery,
  vehicleQuery,
  vehiclesQuery,
} from '@vehicle-os/api-client/react';
import {
  amountOnly,
  asksOdometer,
  commonJobs,
  costLabel,
  currencyOfLine,
  digitsOnly,
  duePresets,
  exampleLine,
  firstDue,
  intervalPresets,
  localDay,
  offersSchedule,
  parseDone,
  parsePlanned,
  photoRead,
  quantityUnit,
  rankKinds,
  splitQuantity,
  stampForDay,
  symbolOf,
} from '@vehicle-os/ui';
import { newId } from '@vehicle-os/utils';
import { Fact, Line, PhotoKey, Rail } from '@/components/add-kit';
import { BrandLogo } from '@/components/brand-logo';
import { photoKey, RemoteImage } from '@/components/remote-image';
import { vehicleIcon } from '@/components/vehicle-card';
import { api } from '@/lib/api';
import { DateField } from '@/lib/date-picker';
import { eventEmoji, jobEmoji } from '@/lib/emoji';
import { pickPhoto, readBase64, type PickedFile } from '@/lib/file-picker';
import { formatDistance, formatMoney, humanise, toMinorUnits } from '@/lib/format';
import { Eyebrow, FigureInput, Panel, PanelCell, Segmented } from '@/lib/instrument';
import { haptic, PressableScale, Pulse, Rise } from '@/lib/motion';
import { enqueue, enqueueUpload, flush } from '@/lib/offline';
import { figure, radius, spacing, typeScale, useTheme } from '@/lib/theme';
import { Button, Skeleton } from '@/lib/ui';
import { useUnitsFor } from '@/lib/vehicle-units';

export type ActivityMode = 'done' | 'planned';
export type QuickAction = 'fuel' | 'odometer' | 'service';

/** The pump-side three the + sheet offers as tiles, and what each starts the form on. */
export const QUICK_ACTIONS: readonly {
  kind: QuickAction;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  hint: string;
  starts: { kind: EventType; line: string };
}[] = [
  {
    kind: 'fuel',
    icon: 'water-outline',
    label: 'Fuel',
    hint: 'Litres, cost, odometer',
    starts: { kind: 'FUEL', line: '' },
  },
  {
    kind: 'odometer',
    icon: 'speedometer-outline',
    label: 'Odometer',
    hint: 'Just the reading',
    starts: { kind: 'NOTE', line: 'Odometer reading' },
  },
  {
    kind: 'service',
    icon: 'construct-outline',
    label: 'Service',
    hint: 'What was done, and cost',
    starts: { kind: 'MAINTENANCE', line: '' },
  },
];

/** Garage-wide work: a one-off for no vehicle in particular. */
const GARAGE = 'garage';
/** The reader takes these; anything else is attached and not read. */
const READABLE = new Set<string>(['image/jpeg', 'image/png', 'image/webp']);
/** The reader's limit on a photo, as base64 (about 3 MB of picture). */
const READ_LIMIT = 4_000_000;
/** The papers a service's photo is filed as, where the entry it belongs to has no id yet. */
const PAPER: Partial<Record<EventType, string>> = { MAINTENANCE: 'SERVICE_INVOICE' };

/*
 * The vehicle an entry was last saved for, so the next one from the app's own + starts there.
 * ponytail: for the session; after a restart the vehicle with the newest entry stands in.
 */
let lastVehicle: string | null = null;

/**
 * Adding to a vehicle's activity — the web's dialog (`vehicle/add-entry`), on the phone: the same
 * two modes, the same questions in the same order and words, from the same shared rules
 * (`@vehicle-os/ui`'s `add-forms` and its line reader).
 *
 * Done: the kind as a rail, one line read as it is typed ("Filled up 40 L, €62 at Shell, 52,900
 * km"), the figures as one panel, the facts as chips — the day, the place — and beside Save the
 * photo's key: the receipt, the invoice or the dashboard, read into whatever is still empty. A hand
 * wins over the line, the line over the photo.
 *
 * Reminder: the job as a chip or a line, once or on a repeat, its day or its interval.
 *
 * One component for the + sheet and for the add screens, so they cannot drift apart. Everything is
 * queued on the phone and sent when there is signal: the save is over before the network is
 * involved.
 */
export function AddActivity({
  vehicleId,
  initialMode = 'done',
  initialKind = null,
  initialLine = '',
  initialPhoto = null,
  lead,
  inSheet = false,
  footerInset = 0,
  onDone,
  onAddVehicle,
}: {
  /** Bound to one vehicle; absent, a rail of vehicles asks which. */
  vehicleId?: string;
  initialMode?: ActivityMode;
  initialKind?: EventType | null;
  initialLine?: string;
  /** A photo taken before the form opened — the sheet's "A receipt". */
  initialPhoto?: PickedFile | null;
  /** Beside the mode switch: the sheet's back key. */
  lead?: ReactNode;
  /** In the + sheet: the fields scroll in a bounded box over the footer. */
  inSheet?: boolean;
  /** Under the footer: the home indicator, on a screen. */
  footerInset?: number;
  onDone: () => void;
  onAddVehicle: () => void;
}) {
  const [mode, setMode] = useState<ActivityMode>(initialMode);
  const vehicles = useQuery(vehiclesQuery(api));
  const bound = useQuery({ ...vehicleQuery(api, vehicleId ?? ''), enabled: Boolean(vehicleId) });
  // Already in cache from Home: the default vehicle is the one with the newest entry.
  const dashboard = useQuery({ ...dashboardQuery(api), enabled: !vehicleId });
  const [chosen, setChosen] = useState<string | null>(null);

  // Only what is still on the road: a vehicle sold or archived takes no fuel.
  const list = (vehicles.data?.data ?? []).filter(
    (vehicle) => vehicle.status !== 'SOLD' && vehicle.status !== 'ARCHIVED',
  );
  const known = (id: string | null | undefined): id is string =>
    Boolean(id) && list.some((vehicle) => vehicle.id === id);
  const pickedId =
    [chosen, lastVehicle, dashboard.data?.recentActivity[0]?.vehicleId, list[0]?.id]
      .filter(known)
      .at(0) ?? null;
  // Only a one-off can be for the garage as a whole.
  const garageWork = !vehicleId && chosen === GARAGE && mode === 'planned';
  const vehicle = vehicleId
    ? (bound.data ?? list.find((candidate) => candidate.id === vehicleId))
    : list.find((candidate) => candidate.id === pickedId);

  // Nothing to draw until the vehicle it is for is known: never "no vehicle" while it loads.
  const waiting = vehicleId
    ? !vehicle && bound.isPending
    : // Unbound, the default is the vehicle last logged: known once the dashboard is.
      vehicles.isPending || (dashboard.isPending && !chosen && !lastVehicle);

  // Which vehicle, scrolled with the form it is for rather than fixed over it.
  const picker = vehicleId ? null : (
    <VehiclePicker
      vehicles={list}
      loading={vehicles.isPending}
      value={garageWork ? GARAGE : pickedId}
      garage={mode === 'planned'}
      onChange={setChosen}
    />
  );

  const done = (id: string | null) => {
    if (id) lastVehicle = id;
    onDone();
  };

  return (
    <View style={inSheet ? styles.sheet : styles.screen}>
      <View style={[styles.top, inSheet ? null : { paddingHorizontal: spacing.lg }]}>
        {lead}
        <View style={{ flex: 1 }}>
          <Segmented
            value={mode}
            options={[
              { value: 'done', label: 'Done' },
              { value: 'planned', label: 'Reminder' },
            ]}
            onChange={setMode}
          />
        </View>
      </View>

      {waiting ? (
        picker
      ) : mode === 'done' ? (
        vehicle ? (
          <DoneForm
            key={vehicle.id}
            head={picker}
            vehicle={vehicle}
            initialKind={initialKind}
            initialLine={initialLine}
            initialPhoto={initialPhoto}
            inSheet={inSheet}
            footerInset={footerInset}
            onDone={() => done(vehicle.id)}
          />
        ) : (
          <NoVehicle onAddVehicle={onAddVehicle} />
        )
      ) : (
        <PlannedForm
          key={garageWork ? GARAGE : (vehicle?.id ?? GARAGE)}
          head={picker}
          vehicle={garageWork ? null : (vehicle ?? null)}
          inSheet={inSheet}
          footerInset={footerInset}
          onDone={() => done(garageWork ? null : (vehicle?.id ?? null))}
        />
      )}
    </View>
  );
}

/* ------------------------------------------------------------------------------------------- */

/** "Today", "Yesterday", "Sat 3 Oct": a day as a chip says it. */
function dayChip(day: string): string {
  if (day === localDay()) return 'Today';
  if (day === localDay({ days: -1 })) return 'Yesterday';
  if (day === localDay({ days: 1 })) return 'Tomorrow';
  return new Date(`${day}T12:00:00`).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

/** Whether a schedule is named in the line: any word of its title of three letters or more. */
function names(line: string, title: string): boolean {
  const words = new Set(line.toLowerCase().split(/[^a-z]+/));
  return title
    .toLowerCase()
    .split(/[^a-z]+/)
    .some((word) => word.length >= 3 && words.has(word));
}

/** Where reading the photo stands, said under the form. */
type Scan =
  | { readonly state: 'reading' }
  | { readonly state: 'read'; readonly draft: EntryDraft }
  | { readonly state: 'nothing' | 'failed' };

function DoneForm({
  head,
  vehicle,
  initialKind,
  initialLine,
  initialPhoto,
  inSheet,
  footerInset,
  onDone,
}: {
  /** What scrolls above the form: the vehicle picker. */
  head: ReactNode;
  vehicle: Vehicle;
  initialKind: EventType | null;
  initialLine: string;
  initialPhoto: PickedFile | null;
  inSheet: boolean;
  footerInset: number;
  onDone: () => void;
}) {
  const theme = useTheme();
  const { currency, odometerUnit } = useUnitsFor(vehicle);
  const unit = odometerUnit === 'MI' ? 'mi' : 'km';
  const lastReading = vehicle.currentOdometer;
  // Cached by the vehicle screen: the kinds this vehicle logs, and what is due on it.
  const activity = useQuery(activityQuery(api, vehicle.id));
  const logged = activity.data?.done.data;
  const schedules = (activity.data?.planned ?? []).flatMap((item) =>
    item.kind === 'SCHEDULE' ? [item.schedule] : [],
  );
  // Settled once the record arrives, so a refetch never reshuffles the chips under a thumb.
  const [ranked, setRanked] = useState<EventType[] | null>(null);
  if (ranked === null && logged) setRanked(rankKinds(EVENT_TYPES, logged));
  const kinds = ranked ?? rankKinds(EVENT_TYPES, []);

  const [line, setLine] = useState(initialLine);
  const parsed = useMemo(() => parseDone(line, { lastReading }), [line, lastReading]);
  // Set by hand; `null` is "not touched", and then the line, the photo, the default decide.
  const [kindSet, setKind] = useState<EventType | null>(initialKind);
  const [scheduleId, setScheduleId] = useState<string | null>(null);
  const [daySet, setDay] = useState<string | null>(null);
  const [odometerSet, setOdometer] = useState<string | null>(null);
  const [costSet, setCost] = useState<string | null>(null);
  const [quantitySet, setQuantity] = useState<string | null>(null);
  // '' once its chip is dropped: neither the line nor the photo says it any more.
  const [placeSet, setPlace] = useState<string | null>(null);
  const [purpose, setPurpose] = useState<TripPurpose | null>(null);
  const [distanceSet, setDistance] = useState<string | null>(null);
  const [rate, setRate] = useState('');
  const [photo, setPhoto] = useState<PickedFile | null>(initialPhoto);
  const [scan, setScan] = useState<Scan | null>(null);
  const [saved, setSaved] = useState(false);
  // Each photo's read is numbered, so only the newest one fills anything.
  const asked = useRef(0);
  useEffect(
    () => () => {
      asked.current += 1;
    },
    [],
  );

  const receipt = scan?.state === 'read' ? scan.draft : null;
  const schedule = schedules.find((item) => item.id === scheduleId) ?? null;
  const kind: EventType = schedule ? 'MAINTENANCE' : (kindSet ?? parsed.kind ?? kinds[0]!);
  const today = localDay();
  const day = daySet ?? parsed.day ?? receipt?.date ?? today;
  const odometer =
    odometerSet ??
    (parsed.odometer !== null
      ? String(parsed.odometer)
      : receipt?.odometer !== undefined
        ? String(receipt.odometer)
        : '');
  // Saved in the currency it was written in: "€62", or a receipt printed in euros, is euros.
  const fromReceipt = costSet === null && parsed.amount === null && receipt?.amount !== undefined;
  const costCurrency =
    costSet === null && parsed.amount !== null
      ? (currencyOfLine(parsed.currency, currency) ?? currency)
      : fromReceipt
        ? // A code the reader made up is not money anyone can format: the vehicle's own.
          receipt!.currency && isKnownCurrency(receipt!.currency)
          ? receipt!.currency
          : currency
        : currency;
  const cost =
    costSet ??
    parsed.amount ??
    (fromReceipt ? receipt!.amount!.toFixed(minorUnitExponent(costCurrency)) : '');
  const said = splitQuantity(parsed.quantity);
  const measure = quantityUnit(kind);
  const quantityIn = said?.unit ?? measure ?? 'L';
  const quantity =
    quantitySet ??
    said?.amount ??
    (measure === 'L' && receipt?.litres !== undefined ? String(receipt.litres) : '');
  const place = placeSet ?? parsed.place ?? receipt?.provider ?? '';
  const title = parsed.title.trim() || receipt?.note?.trim() || '';
  const auto = {
    kind: !schedule && kindSet === null && parsed.kind !== null,
    odometer: odometerSet === null && odometer !== '',
    cost: costSet === null && cost !== '',
    quantity: quantitySet === null && quantity !== '',
    place: placeSet === null && place !== '',
    day: daySet === null && day !== today,
  };
  const mark = (label: string, filled: boolean) => (filled ? `${label} ✦` : label);
  const trip = kind === 'TRIP' && !schedule;
  const measured =
    odometer && lastReading !== null && Number(odometer) > lastReading
      ? String(Number(odometer) - lastReading)
      : '';
  const distance = distanceSet ?? measured;
  // A purpose puts the trip in the mileage log, and the log needs how far: asked, not dropped.
  const tripShort = trip && purpose !== null && !distance;
  const reading = odometer ? Number(odometer) : null;
  const delta = reading !== null && lastReading !== null ? reading - lastReading : null;
  const photoIs = photoRead(kind).name;

  const offered = schedules
    .filter(
      (item) =>
        item.id === scheduleId ||
        offersSchedule(
          kind,
          item.status === 'OVERDUE' || item.status === 'DUE_SOON',
          names(line, item.title),
        ),
    )
    // `sort` on the array `filter` made: Hermes has no `toSorted`.
    .sort((a, b) => Number(names(line, b.title)) - Number(names(line, a.title)));

  // The vehicle's own titles for this kind, as one-press starts while the line is empty.
  const again = useMemo(() => {
    const seen = new Set<string>();
    for (const event of logged ?? []) {
      if (event.eventType !== kind) continue;
      const words = event.title.trim();
      if (!words || words.toLowerCase() === humanise(kind).toLowerCase()) continue;
      seen.add(words);
      if (seen.size === 3) break;
    }
    return [...seen];
  }, [logged, kind]);

  /** The photo, read into whatever is still empty. */
  const read = async (file: PickedFile) => {
    const ticket = ++asked.current;
    if (!READABLE.has(file.mimeType)) {
      setScan(null);
      return;
    }
    setScan({ state: 'reading' });
    try {
      const data = await readBase64(file.uri);
      if (data.length > READ_LIMIT) throw new Error('Too large to read');
      const draft = await api.ai.draftEntry({
        kind: photoRead(kind).draft,
        currency,
        unit: odometerUnit,
        attachments: [{ mimeType: file.mimeType as AiAttachment['mimeType'], data }],
      });
      if (ticket !== asked.current) return;
      const found = [draft.amount, draft.litres, draft.provider, draft.date, draft.odometer];
      const filled = found.some((value) => value !== undefined) || Boolean(draft.note);
      if (filled) haptic.success();
      setScan(filled ? { state: 'read', draft } : { state: 'nothing' });
    } catch {
      // Offline, reading off, the provider down: the photo is attached all the same.
      if (ticket === asked.current) setScan({ state: 'failed' });
    }
  };

  // A photo handed over with the form — the sheet's "A receipt" — is read as it opens.
  const handed = useRef(initialPhoto);
  useEffect(() => {
    if (handed.current) void read(handed.current);
    handed.current = null;
    // Once, on mount: the photo it was opened with.
  }, []);

  const attach = async (source: 'camera' | 'library') => {
    let picked: PickedFile | null = null;
    try {
      // Less than the usual quality: still sharp to read, and quick to send to be read.
      picked = await pickPhoto(source, 0.55);
    } catch {
      // A refused or missing camera is not worth an alert over an optional photo: the library.
      if (source === 'camera') picked = await pickPhoto('library', 0.55).catch(() => null);
    }
    if (!picked) return;
    haptic.light();
    setPhoto(picked);
    void read(picked);
  };

  // Three choices at most — all an Android alert shows. Another from the library is a hold.
  const photoOptions = () =>
    Alert.alert(`The ${photoIs}`, 'Hold the photo to choose another from your library.', [
      { text: 'Retake', onPress: () => void attach('camera') },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          asked.current += 1;
          setPhoto(null);
          setScan(null);
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);

  const save = useMutation({
    mutationFn: async () => {
      const vehicleId = vehicle.id;
      const when = stampForDay(day);
      // The unit travels with the reading: the API refuses an odometer it cannot interpret.
      const odometerFields =
        reading !== null && asksOdometer(kind) ? { odometer: reading, odometerUnit } : {};
      const amount =
        cost && Number(cost) > 0 ? toMinorUnits(Number(cost), costCurrency) : undefined;
      const where = place.trim();
      // The measured amount leads the note, where the logbook reads it back as a fact.
      const note = measure && quantity ? `${quantity} ${quantityIn}` : '';
      const labour = amount !== undefined ? { laborCostAmountMinor: amount, costCurrency } : {};
      // A read still on its way has nothing left to fill: what is on screen is the entry now.
      asked.current += 1;
      const upload = photo
        ? {
            kind: 'upload' as const,
            vehicleId,
            uri: photo.uri,
            name: photo.name,
            mimeType: photo.mimeType,
            size: photo.size,
          }
        : null;

      if (schedule || kind === 'MAINTENANCE') {
        /*
         * A service goes in as a maintenance record, as on the web, so the history a buyer reads
         * has it; completing a schedule also restarts its clock.
         */
        const body = {
          performedAt: when,
          ...(schedule
            ? title
              ? { workPerformed: title }
              : {}
            : { title: title || humanise(kind) }),
          ...(where ? { provider: where } : {}),
          ...odometerFields,
          ...labour,
        };
        await enqueue(
          schedule
            ? { kind: 'maintenance', vehicleId, planId: schedule.id, body }
            : { kind: 'maintenance-log', vehicleId, body },
        );
        /*
         * ponytail: a queued service has no event id to file its photo against, so the photo is
         * kept as the service's invoice in Documents. Link it once the server takes a client id
         * for the service's event.
         */
        if (upload) {
          await enqueueUpload({
            ...upload,
            target: 'document',
            body: {
              documentType: PAPER.MAINTENANCE,
              title: title || schedule?.title || humanise(kind),
              issuedOn: day,
            },
          });
        }
      } else {
        // The entry's id is chosen here, so the photo queued behind it can already name it.
        const eventId = newId();
        await enqueue({
          kind: 'event',
          vehicleId,
          body: {
            id: eventId,
            eventType: kind,
            title: title || humanise(kind),
            occurredAt: when,
            ...(note ? { description: note } : {}),
            ...(where ? { provider: where } : {}),
            ...odometerFields,
            ...(amount !== undefined ? { costAmountMinor: amount, costCurrency } : {}),
            // A purpose is what puts a trip in the mileage log.
            ...(trip && purpose && distance
              ? {
                  // A typed distance with no reading still needs its unit on the event.
                  ...(reading === null ? { odometerUnit } : {}),
                  trip: {
                    purpose,
                    // Measured from the last reading is evidence; a typed distance is a claim.
                    ...(distanceSet === null && measured
                      ? { startOdometer: lastReading }
                      : { distance: Number(distance) }),
                    ...(rate && Number(rate) > 0
                      ? { rateMinor: toMinorUnits(Number(rate), currency), rateCurrency: currency }
                      : {}),
                  },
                }
              : {}),
          },
        });
        if (upload) await enqueueUpload({ ...upload, target: 'photo', body: { eventId } });
      }
      void flush();
    },
    onSuccess: () => {
      // Felt as well as seen: at a pump the phone is often already on its way to a pocket.
      haptic.success();
      setSaved(true);
      // Long enough to read the confirmation, short enough not to be in the way.
      setTimeout(onDone, 900);
    },
  });

  if (saved) {
    return (
      <Rise style={[styles.saved, { backgroundColor: theme.successSoft }]}>
        <Ionicons name="checkmark-circle" size={20} color={theme.success} />
        <Text style={[typeScale.caption, { flex: 1, color: theme.success, fontWeight: '600' }]}>
          Saved. Sends itself.
        </Text>
      </Rise>
    );
  }

  const price =
    cost && Number(cost) > 0
      ? formatMoney({
          amountMinor: toMinorUnits(Number(cost), costCurrency),
          currency: costCurrency,
        })
      : null;
  const action = schedule
    ? `Complete ${schedule.title}`
    : `Add ${humanise(kind).toLowerCase()}${price ? ` · ${price}` : ''}`;
  const empty =
    !line.trim() && !odometer && !cost && !quantity && !photo && !schedule && !receipt?.note;
  const odometerError =
    reading !== null && reading > 100_000_000 ? 'That is past 100,000,000' : null;

  return (
    <View style={inSheet ? styles.sheet : { flex: 1 }}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        style={inSheet ? styles.sheetFields : { flex: 1 }}
        contentContainerStyle={[
          styles.fields,
          inSheet ? styles.sheetContent : styles.screenContent,
        ]}
      >
        {head}
        <Rail
          label="Kind"
          inset={spacing.lg}
          items={kinds.map((option) => ({
            key: option,
            label: humanise(option),
            glyph: eventEmoji(option),
            selected: option === kind,
            marked: option === kind && auto.kind,
            disabled: schedule !== null && option !== kind,
            onPress: () => {
              // Choosing a kind is choosing not to complete a schedule.
              setScheduleId(null);
              setKind(option);
            },
          }))}
        />

        <View style={{ gap: 6 }}>
          <Line
            value={line}
            onChangeText={setLine}
            lit={parsed.tokens.length > 0}
            placeholder={
              schedule
                ? `${schedule.title}, ${symbolOf(currency)}80`
                : exampleLine(kind, humanise(kind), symbolOf(currency))
            }
            accessibilityLabel={schedule ? 'Work done' : 'What happened'}
            accessibilityHint="Amounts, kilometres, the day and “at” a place are picked out"
            returnKeyType="done"
          />
          {line.trim() === '' && again.length > 0 && !schedule ? (
            <View style={styles.wrap}>
              {again.map((words) => (
                <Fact
                  key={words}
                  icon="refresh"
                  label={words}
                  onPress={() => setLine(`${words} `)}
                />
              ))}
            </View>
          ) : (
            <Text style={[typeScale.caption, styles.hint, { color: theme.mutedForeground }]}>
              {line.trim() === '' && !receipt?.note
                ? 'Say it in one go — amounts, km, the day and “at” a place are picked out.'
                : `Saved as “${title || schedule?.title || humanise(kind)}”`}
            </Text>
          )}
        </View>

        {/* The figures a logbook line is made of, as one panel: only the ones this kind takes. */}
        <Panel>
          {asksOdometer(kind) ? (
            <PanelCell
              label={mark('Odometer', auto.odometer)}
              note={
                odometerError ??
                (delta === null
                  ? lastReading === null
                    ? 'Optional'
                    : `Last ${lastReading.toLocaleString()} ${unit}`
                  : delta >= 0
                    ? `+${delta.toLocaleString()} ${unit} since the last reading`
                    : 'Below the last reading')
              }
              noteTone={
                odometerError ? 'destructive' : delta !== null && delta < 0 ? 'warning' : undefined
              }
            >
              <FigureInput
                unit={unit}
                value={reading !== null ? reading.toLocaleString() : ''}
                onChangeText={(text) => setOdometer(digitsOnly(text, 10))}
                placeholder={lastReading !== null ? lastReading.toLocaleString() : '0'}
                keyboardType="number-pad"
                accessibilityLabel={`Odometer in ${unit}`}
              />
            </PanelCell>
          ) : null}
          <View style={styles.row}>
            <PanelCell
              label={mark(costLabel(kind), auto.cost)}
              note={cost ? 'Filed as spending too' : 'Empty if it was free'}
            >
              <FigureInput
                unit={costCurrency}
                value={cost}
                onChangeText={(text) => setCost(amountOnly(text))}
                placeholder="0.00"
                keyboardType="decimal-pad"
                accessibilityLabel={`${costLabel(kind)} in ${costCurrency}`}
              />
            </PanelCell>
            {measure ? (
              <PanelCell
                label={mark(measure === 'L' ? 'Fuel' : 'Energy', auto.quantity)}
                note={measure === 'L' ? 'For the economy' : 'For the cost per kWh'}
              >
                <FigureInput
                  unit={quantityIn}
                  value={quantity}
                  onChangeText={(text) => setQuantity(amountOnly(text))}
                  placeholder="0.0"
                  keyboardType="decimal-pad"
                  accessibilityLabel={`${measure === 'L' ? 'Fuel' : 'Energy'} in ${quantityIn}`}
                />
              </PanelCell>
            ) : null}
          </View>
          {trip && purpose ? (
            <View style={styles.row}>
              <PanelCell
                label={mark('Distance', distanceSet === null && measured !== '')}
                note={
                  tripShort
                    ? 'Needed for the log'
                    : distanceSet === null && measured
                      ? 'From the last reading'
                      : 'Or the odometer'
                }
                noteTone={tripShort ? 'warning' : undefined}
              >
                <FigureInput
                  unit={unit}
                  value={distance ? Number(distance).toLocaleString() : ''}
                  onChangeText={(text) => setDistance(digitsOnly(text))}
                  placeholder="0"
                  keyboardType="number-pad"
                  accessibilityLabel={`Distance in ${unit}`}
                />
              </PanelCell>
              <PanelCell label={`Rate per ${unit}`} note="Kept on this trip">
                <FigureInput
                  unit={currency}
                  value={rate}
                  onChangeText={(text) => setRate(amountOnly(text))}
                  placeholder="0.00"
                  keyboardType="decimal-pad"
                  accessibilityLabel={`Rate per ${unit} in ${currency}`}
                />
              </PanelCell>
            </View>
          ) : null}
        </Panel>

        {/* The facts around it, as chips: the day, the place, a trip's purpose. */}
        <View style={styles.wrap}>
          <DateField
            value={day}
            onChange={setDay}
            max={today}
            label="When"
            trigger={(_said, open) => (
              <Fact icon="calendar-outline" label={dayChip(day)} marked={auto.day} onPress={open} />
            )}
          />
          {place ? (
            <Fact
              icon="location-outline"
              label={place}
              marked={auto.place}
              onRemove={() => setPlace('')}
            />
          ) : null}
          {trip
            ? TRIP_PURPOSES.map((option) => (
                <Fact
                  key={option}
                  label={humanise(option)}
                  selected={purpose === option}
                  onPress={() => setPurpose(purpose === option ? null : option)}
                />
              ))
            : null}
        </View>

        {offered.length > 0 ? (
          <Rail
            label="Completes a schedule"
            inset={spacing.lg}
            items={offered.map((item) => ({
              key: item.id,
              label: item.title,
              glyph: item.id === scheduleId ? undefined : jobEmoji(item.title),
              selected: item.id === scheduleId,
              marked: item.id !== scheduleId && names(line, item.title),
              trailing:
                item.id === scheduleId ? (
                  <Ionicons name="checkmark" size={15} color={theme.primaryForeground} />
                ) : item.status === 'OVERDUE' || item.status === 'DUE_SOON' ? (
                  <View
                    style={[
                      styles.dot,
                      {
                        backgroundColor:
                          item.status === 'OVERDUE' ? theme.destructive : theme.warning,
                      },
                    ]}
                  />
                ) : undefined,
              onPress: () => setScheduleId(item.id === scheduleId ? null : item.id),
            }))}
          />
        ) : null}

        {scan ? <ScanNote scan={scan} photo={photoIs} /> : null}

        {save.isError ? (
          <View style={[styles.banner, { backgroundColor: theme.destructiveSoft }]}>
            <Text
              accessibilityRole="alert"
              style={[typeScale.caption, { color: theme.destructive }]}
            >
              Could not save on this phone: {(save.error as Error).message}
            </Text>
          </View>
        ) : null}
      </ScrollView>

      <View
        style={[
          styles.footer,
          inSheet
            ? null
            : {
                paddingHorizontal: spacing.lg,
                paddingBottom: footerInset,
                borderTopColor: theme.hairline,
                borderTopWidth: StyleSheet.hairlineWidth,
                backgroundColor: theme.background,
              },
        ]}
      >
        <PhotoKey
          photo={photo}
          name={photoIs}
          reading={scan?.state === 'reading'}
          read={scan?.state === 'read'}
          onPress={photo ? photoOptions : () => void attach('camera')}
          onLongPress={() => void attach('library')}
        />
        <View style={{ flex: 1 }}>
          <Button
            label={action}
            variant="primary"
            size="lg"
            loading={save.isPending}
            disabled={empty || tripShort || Boolean(odometerError)}
            onPress={() => save.mutate()}
          />
        </View>
      </View>
    </View>
  );
}

/** What reading the photo came to, in a line under the form. */
function ScanNote({ scan, photo }: { scan: Scan; photo: string }) {
  const theme = useTheme();
  const said =
    scan.state === 'reading'
      ? `Reading the ${photo}…`
      : scan.state === 'read'
        ? `Filled from the ${photo} — what was empty. Check before saving.`
        : scan.state === 'nothing'
          ? `Nothing on the ${photo} to fill. It stays attached.`
          : `Could not read the ${photo} just now. It stays attached.`;
  return (
    <Rise key={scan.state}>
      <View
        style={styles.scan}
        accessible
        accessibilityLiveRegion="polite"
        accessibilityLabel={said}
      >
        {scan.state === 'reading' ? (
          <Pulse color={theme.primary} size={7} />
        ) : (
          <Ionicons
            name={scan.state === 'read' ? 'sparkles' : 'information-circle-outline'}
            size={14}
            color={scan.state === 'read' ? theme.foreground : theme.mutedForeground}
          />
        )}
        <Text style={[typeScale.caption, { flex: 1, color: theme.mutedForeground }]}>{said}</Text>
      </View>
    </Rise>
  );
}

/* ------------------------------------------------------------------------------------------- */

function PlannedForm({
  head,
  vehicle,
  inSheet,
  footerInset,
  onDone,
}: {
  /** What scrolls above the form: the vehicle picker. */
  head: ReactNode;
  /** Null for garage-wide work: a one-off for no vehicle in particular. */
  vehicle: Vehicle | null;
  inSheet: boolean;
  footerInset: number;
  onDone: () => void;
}) {
  const theme = useTheme();
  const garages = useQuery(garagesQuery(api));
  const { odometerUnit } = useUnitsFor(vehicle);
  const unit = odometerUnit === 'MI' ? 'mi' : 'km';
  const activity = useQuery({
    ...activityQuery(api, vehicle?.id ?? ''),
    enabled: Boolean(vehicle),
  });
  const schedules = (activity.data?.planned ?? []).flatMap((item) =>
    item.kind === 'SCHEDULE' ? [item.schedule] : [],
  );

  const [line, setLine] = useState('');
  const parsed = useMemo(() => parsePlanned(line), [line]);
  const [repeatsSet, setRepeats] = useState<boolean | null>(null);
  const [dueSet, setDue] = useState<string | null>(null);
  const [monthsSet, setMonths] = useState<string | null>(null);
  const [distanceSet, setDistance] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // A repeat counts a vehicle's months and odometer: garage-wide work is always a one-off.
  const repeats =
    vehicle !== null &&
    (repeatsSet ?? (parsed.everyMonths !== null || parsed.everyDistance !== null));
  const due = dueSet ?? parsed.due ?? '';
  const everyMonths = monthsSet ?? (parsed.everyMonths !== null ? String(parsed.everyMonths) : '');
  const everyDistance =
    distanceSet ?? (parsed.everyDistance !== null ? String(parsed.everyDistance) : '');
  const auto = {
    repeats: repeatsSet === null && repeats,
    due: dueSet === null && parsed.due !== null,
    months: monthsSet === null && parsed.everyMonths !== null,
    distance: distanceSet === null && parsed.everyDistance !== null,
  };
  const title = parsed.title.trim();
  const jobs = commonJobs(unit);
  const presets = duePresets();
  const today = localDay();
  const garageId = vehicle?.garageId ?? garages.data?.[0]?.id ?? null;
  // What is already planned for the same job — the same name, or the same kind of work.
  const planned = (job: string) =>
    schedules.find(
      (item) =>
        item.title.toLowerCase() === job.toLowerCase() ||
        (jobEmoji(job) !== '🧰' && jobEmoji(item.title) === jobEmoji(job)),
    ) ?? null;
  const twin = title ? planned(title) : null;

  const save = useMutation({
    mutationFn: async () => {
      // The client chooses the id, so this works with no signal and a replay lands on one row.
      const id = newId();
      if (repeats && vehicle) {
        await enqueue({
          kind: 'plan-create',
          vehicleId: vehicle.id,
          body: {
            id,
            title,
            ...(everyMonths ? { intervalMonths: Number(everyMonths) } : {}),
            ...(everyDistance
              ? { intervalDistance: Number(everyDistance), intervalDistanceUnit: odometerUnit }
              : {}),
          },
        });
      } else {
        await enqueue({
          kind: 'task-create',
          vehicleId: vehicle?.id ?? null,
          body: {
            id,
            title,
            garageId: garageId!,
            ...(vehicle ? { vehicleId: vehicle.id } : {}),
            ...(due ? { dueDate: due } : {}),
          },
        });
      }
      void flush();
    },
    onSuccess: () => {
      haptic.success();
      setSaved(true);
      setTimeout(onDone, 900);
    },
  });

  if (saved) {
    return (
      <Rise style={[styles.saved, { backgroundColor: theme.successSoft }]}>
        <Ionicons name="checkmark-circle" size={20} color={theme.success} />
        <Text style={[typeScale.caption, { flex: 1, color: theme.success, fontWeight: '600' }]}>
          Saved. Sends itself.
        </Text>
      </Rise>
    );
  }

  // A repeat with no interval can never come due; the server refuses it, so the form does first.
  const missingInterval = repeats && !everyMonths && !everyDistance;
  const every = [
    everyDistance ? `${Number(everyDistance).toLocaleString()} ${unit}` : null,
    everyMonths ? `${everyMonths} mo` : null,
  ]
    .filter(Boolean)
    .join(' or ');
  const action = repeats
    ? `Add schedule${every ? ` · every ${every}` : ''}`
    : `Add reminder${due ? ` · ${dayChip(due)}` : ''}`;
  const comesDue = repeats
    ? firstDue(
        everyMonths ? Number(everyMonths) : null,
        everyDistance ? Number(everyDistance) : null,
        vehicle?.currentOdometer ?? null,
        unit,
      )
    : null;
  const custom = due !== '' && !presets.some((option) => option.day === due);

  const fillLine = (text: string) => {
    setLine(text);
    // A job's own cadence decides once or repeats, so a choice made before it does not stick.
    setRepeats(null);
    setMonths(null);
    setDistance(null);
    setDue(null);
  };

  return (
    <View style={inSheet ? styles.sheet : { flex: 1 }}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        style={inSheet ? styles.sheetFields : { flex: 1 }}
        contentContainerStyle={[
          styles.fields,
          inSheet ? styles.sheetContent : styles.screenContent,
        ]}
      >
        {head}
        <Rail
          label="Common jobs"
          inset={spacing.lg}
          items={jobs.map((job) => ({
            key: job.label,
            label: job.label,
            glyph: jobEmoji(job.label),
            selected: line === job.line,
            trailing:
              planned(job.label) && line !== job.line ? (
                <Ionicons name="checkmark" size={14} color={theme.success} />
              ) : undefined,
            onPress: () => fillLine(job.line),
          }))}
        />

        <View style={{ gap: 6 }}>
          <Line
            value={line}
            onChangeText={setLine}
            lit={parsed.tokens.length > 0}
            placeholder={
              repeats ? `Rotate tyres every 10,000 ${unit}` : 'Renew insurance on 11 Nov'
            }
            accessibilityLabel="What needs doing"
            accessibilityHint="“Every 10,000 km”, “on 11 Nov” and “next month” are picked out"
            returnKeyType="done"
          />
          <Text style={[typeScale.caption, styles.hint, { color: theme.mutedForeground }]}>
            {line.trim() === ''
              ? 'Pick a job, or say it — “every 10,000 km”, “on 11 Nov”, “next month”.'
              : title
                ? `Saved as “${title}”`
                : 'Say what needs doing, then when.'}
          </Text>
        </View>

        {vehicle ? (
          <View style={styles.cadence}>
            <Segmented
              small
              value={repeats ? 'repeats' : 'once'}
              options={[
                { value: 'once', label: 'Once' },
                { value: 'repeats', label: auto.repeats ? 'Repeats ✦' : 'Repeats' },
              ]}
              onChange={(next) => setRepeats(next === 'repeats')}
            />
          </View>
        ) : null}

        {/* A second schedule for the same job is usually a mistake; said, not refused. */}
        {twin && repeats ? (
          <Rise style={styles.twin}>
            <Ionicons name="alert-circle-outline" size={15} color={theme.mutedForeground} />
            <Text style={[typeScale.caption, { flex: 1, color: theme.mutedForeground }]}>
              Already planned:{' '}
              <Text style={{ fontWeight: '600', color: theme.foreground }}>{twin.title}</Text>
            </Text>
          </Rise>
        ) : null}

        {repeats ? (
          <Rise key="repeats" style={{ gap: spacing.sm }}>
            <Panel direction="row">
              <PanelCell label={auto.months ? 'Every ✦' : 'Every'} note="By the calendar">
                <FigureInput
                  unit="mo"
                  value={everyMonths}
                  onChangeText={(text) => setMonths(digitsOnly(text, 3))}
                  placeholder="—"
                  keyboardType="number-pad"
                  accessibilityLabel="Every how many months"
                />
              </PanelCell>
              <PanelCell
                label={auto.distance ? 'Or every ✦' : 'Or every'}
                note={missingInterval ? 'Set at least one' : 'Whichever comes first'}
                noteTone={missingInterval ? 'warning' : undefined}
              >
                <FigureInput
                  unit={unit}
                  value={everyDistance ? Number(everyDistance).toLocaleString() : ''}
                  onChangeText={(text) => setDistance(digitsOnly(text))}
                  placeholder="—"
                  keyboardType="number-pad"
                  accessibilityLabel={`Or every how many ${unit}`}
                />
              </PanelCell>
            </Panel>
            <View style={styles.wrap}>
              {intervalPresets(unit).map((preset) => (
                <Fact
                  key={preset.label}
                  label={preset.label}
                  selected={everyMonths === preset.months && everyDistance === preset.distance}
                  onPress={() => {
                    setMonths(preset.months);
                    setDistance(preset.distance);
                  }}
                />
              ))}
            </View>
            {comesDue ? (
              <Text style={[typeScale.caption, styles.hint, { color: theme.mutedForeground }]}>
                First due{' '}
                <Text style={[figure, { fontWeight: '600', color: theme.foreground }]}>
                  {comesDue}
                </Text>
              </Text>
            ) : null}
          </Rise>
        ) : (
          <Rise key="once" style={{ gap: spacing.sm }}>
            <View style={styles.wrap}>
              {presets.map((option) => (
                <Fact
                  key={option.label}
                  label={option.label}
                  selected={due === option.day}
                  marked={due === option.day && auto.due && option.day !== ''}
                  onPress={() => setDue(option.day)}
                />
              ))}
              <DateField
                value={due}
                onChange={setDue}
                min={today}
                label="Due"
                trigger={(_said, open) => (
                  <Fact
                    icon="calendar-outline"
                    label={custom ? dayChip(due) : 'Pick a day'}
                    selected={custom}
                    marked={custom && auto.due}
                    onPress={open}
                  />
                )}
              />
            </View>
            <Text style={[typeScale.caption, styles.hint, { color: theme.mutedForeground }]}>
              {due
                ? `Due ${dayChip(due).toLowerCase() === 'today' ? 'today' : `on ${dayChip(due)}`}`
                : vehicle
                  ? 'No date — it waits on the list until it is done.'
                  : 'Garage-wide, with no date — it waits on the list until it is done.'}
            </Text>
          </Rise>
        )}

        {save.isError ? (
          <View style={[styles.banner, { backgroundColor: theme.destructiveSoft }]}>
            <Text
              accessibilityRole="alert"
              style={[typeScale.caption, { color: theme.destructive }]}
            >
              Could not save on this phone: {(save.error as Error).message}
            </Text>
          </View>
        ) : null}
      </ScrollView>

      <View
        style={[
          styles.footer,
          inSheet
            ? null
            : {
                paddingHorizontal: spacing.lg,
                paddingBottom: footerInset,
                borderTopColor: theme.hairline,
                borderTopWidth: StyleSheet.hairlineWidth,
                backgroundColor: theme.background,
              },
        ]}
      >
        <View style={{ flex: 1 }}>
          <Button
            label={action}
            variant="primary"
            size="lg"
            loading={save.isPending}
            disabled={!title || missingInterval || (!repeats && !garageId)}
            onPress={() => save.mutate()}
          />
        </View>
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------------------------------- */

/**
 * Which vehicle it is for: each a card in a row — its picture or badge, its name, where its
 * odometer stands — the chosen one washed in copper and ticked. A reminder may be for the garage.
 */
function VehiclePicker({
  vehicles,
  loading,
  value,
  garage,
  onChange,
}: {
  vehicles: readonly Vehicle[];
  loading: boolean;
  value: string | null;
  /** Offer garage-wide work, for a one-off reminder. */
  garage: boolean;
  onChange: (id: string) => void;
}) {
  const theme = useTheme();
  if (loading) {
    return (
      <View style={styles.pickRow}>
        <Skeleton width={150} height={52} radius={radius.lg} />
        <Skeleton width={150} height={52} radius={radius.lg} />
      </View>
    );
  }
  if (vehicles.length === 0 && !garage) return null;
  const options: { id: string; vehicle: Vehicle | null }[] = [
    ...vehicles.map((vehicle) => ({ id: vehicle.id, vehicle })),
    ...(garage ? [{ id: GARAGE, vehicle: null }] : []),
  ];
  return (
    <View style={{ gap: 6 }}>
      <Eyebrow>For</Eyebrow>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        accessibilityRole="radiogroup"
        style={styles.pickRail}
        contentContainerStyle={styles.pickRow}
      >
        {options.map(({ id, vehicle }) => {
          const selected = id === value;
          return (
            <PressableScale
              key={id}
              onPress={() => {
                if (selected) return;
                haptic.selection();
                onChange(id);
              }}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={vehicle?.displayName ?? 'The garage, no vehicle in particular'}
              scaleTo={0.95}
              style={[
                styles.pick,
                {
                  backgroundColor: selected ? theme.primarySoft : theme.muted,
                  borderColor: selected ? theme.primary : 'transparent',
                },
              ]}
            >
              <View style={[styles.thumb, { backgroundColor: theme.cardRaised }]}>
                {vehicle ? (
                  <VehicleThumb vehicle={vehicle} />
                ) : (
                  <Ionicons name="home-outline" size={17} color={theme.mutedForeground} />
                )}
              </View>
              <View style={styles.pickWords}>
                <Text
                  numberOfLines={1}
                  style={[typeScale.label, styles.pickName, { color: theme.foreground }]}
                >
                  {vehicle?.displayName ?? 'Garage work'}
                </Text>
                <Text
                  numberOfLines={1}
                  style={[figure, styles.pickReading, { color: theme.mutedForeground }]}
                >
                  {vehicle
                    ? vehicle.currentOdometer !== null
                      ? formatDistance(vehicle.currentOdometer, vehicle.odometerUnit)
                      : humanise(vehicle.vehicleType)
                    : 'No vehicle'}
                </Text>
              </View>
              {selected ? (
                <Ionicons name="checkmark-circle" size={17} color={theme.primary} />
              ) : null}
            </PressableScale>
          );
        })}
      </ScrollView>
    </View>
  );
}

/** A vehicle in miniature: its photo or cutout, else its make's badge, else its kind. */
function VehicleThumb({ vehicle }: { vehicle: Vehicle }) {
  const theme = useTheme();
  const photo = vehicle.primaryPhoto?.thumbnailUrl ? vehicle.primaryPhoto : null;
  return photo ? (
    <RemoteImage
      uri={photo.thumbnailUrl}
      cacheKey={photoKey(photo, 'thumb')}
      style={StyleSheet.absoluteFill}
      contentFit={photo.isCutout ? 'contain' : 'cover'}
      accessible={false}
    />
  ) : vehicle.make ? (
    <BrandLogo make={vehicle.make} size={24} />
  ) : (
    <Ionicons name={vehicleIcon(vehicle.vehicleType)} size={17} color={theme.mutedForeground} />
  );
}

function NoVehicle({ onAddVehicle }: { onAddVehicle: () => void }) {
  const theme = useTheme();
  return (
    <View style={[styles.noVehicle, { backgroundColor: theme.muted }]}>
      <Text style={[typeScale.label, { color: theme.foreground }]}>Nothing to add it to yet</Text>
      <Text style={[typeScale.caption, { color: theme.mutedForeground, textAlign: 'center' }]}>
        Add a vehicle, and a fill-up is a few taps from here.
      </Text>
      <Button label="Add a vehicle" icon="add" variant="primary" size="sm" onPress={onAddVehicle} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, gap: spacing.md, paddingTop: spacing.sm },
  /*
   * In the + sheet: everything shrinks to the room the screen — less the keyboard — leaves, and
   * only the fields scroll; the mode switch and the Save row stay put. The fields run out to the
   * sheet's edges so a rail scrolls under them, padded back in.
   */
  sheet: { flexShrink: 1, gap: spacing.md },
  top: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  fields: { gap: spacing.md },
  sheetFields: { flexShrink: 1, marginHorizontal: -spacing.lg },
  sheetContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xs },
  screenContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl },
  row: { flexDirection: 'row', gap: StyleSheet.hairlineWidth },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm - 2 },
  hint: { paddingHorizontal: 4 },
  cadence: { width: 220 },
  twin: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 4 },
  dot: { width: 7, height: 7, borderRadius: 999 },
  scan: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 4 },
  banner: { borderRadius: radius.lg, padding: 14 },
  footer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingTop: spacing.sm + 2,
  },
  saved: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: 14,
    padding: spacing.sm,
  },
  pickRail: { marginHorizontal: -spacing.lg },
  pickRow: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg },
  pick: {
    height: 54,
    maxWidth: 220,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingLeft: 7,
    paddingRight: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1.5,
  },
  thumb: {
    width: 38,
    height: 38,
    borderRadius: 11,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickWords: { flexShrink: 1, minWidth: 0 },
  pickName: { fontSize: 13.5, lineHeight: 18 },
  pickReading: { fontSize: 11, lineHeight: 14 },
  noVehicle: {
    alignItems: 'center',
    gap: spacing.xs,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
});
