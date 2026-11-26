import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import type { AiAttachment, EntryDraft, MaintenancePlan, Vehicle } from '@vehicle-os/contracts';
import {
  EVENT_TYPES,
  TRIP_PURPOSES,
  isKnownCurrency,
  minorUnitExponent,
  seedPartLines,
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
  spanOfDays,
  splitQuantity,
  stampForDay,
  symbolOf,
} from '@vehicle-os/ui';
import { newId } from '@vehicle-os/utils';
import { readDue } from '@/components/activity-feed';
import { DateKey, Fact, Line, PhotoKey, Rail, SelectCell, TwoWay } from '@/components/add-kit';
import { BrandLogo } from '@/components/brand-logo';
import { PartLinesField, toLine, useParts, type PartDraft } from '@/components/parts-kit';
import { photoKey, RemoteImage } from '@/components/remote-image';
import { vehicleIcon } from '@/components/vehicle-card';
import { api } from '@/lib/api';
import { DateField } from '@/lib/date-picker';
import { useReportDirty } from '@/lib/discard';
import { eventEmoji, jobEmoji } from '@/lib/emoji';
import { pickPhoto, readBase64, type PickedFile } from '@/lib/file-picker';
import { formatDistance, formatMoney, humanise, toMinorUnits } from '@/lib/format';
import {
  Eyebrow,
  FigureInput,
  formLabel,
  Glyph,
  Panel,
  PanelCell,
  Segmented,
} from '@/lib/instrument';
import { haptic, PressableScale, Pulse, Rise } from '@/lib/motion';
import { enqueue, enqueueUpload, flush } from '@/lib/offline';
import { MenuSheet } from '@/lib/pickers';
import { askForPush } from '@/lib/push';
import { figure, radius, spacing, typeScale, useTheme, leaf } from '@/lib/theme';
import { Button, Skeleton } from '@/lib/ui';
import { useUnitsFor } from '@/lib/vehicle-units';
import { dialog } from '@/lib/dialog';

export type ActivityMode = 'done' | 'planned';
export type QuickAction = 'fuel' | 'odometer' | 'service';
/** How it is said: one line that is read, or the fields one by one. Never both at once. */
export type EntryStyle = 'quick' | 'detailed';

/** The pump-side three the + sheet offers as tiles, and what each starts the form on. */
export const QUICK_ACTIONS: readonly {
  kind: QuickAction;
  icon: keyof typeof Ionicons.glyphMap;
  /** Its tile on the + sheet, in the web's own artwork — the dock's hand deals the same. */
  emoji: string;
  label: string;
  hint: string;
  starts: { kind: EventType; line: string; entry?: EntryStyle };
}[] = [
  {
    kind: 'fuel',
    icon: 'water-outline',
    emoji: '⛽',
    label: 'Fuel',
    hint: 'Litres and cost',
    starts: { kind: 'FUEL', line: '' },
  },
  {
    kind: 'odometer',
    icon: 'speedometer-outline',
    emoji: '🗺️',
    label: 'Odometer',
    hint: 'Just the reading',
    // One figure to type: its field, not a sentence around it.
    starts: { kind: 'NOTE', line: 'Odometer reading', entry: 'detailed' },
  },
  {
    kind: 'service',
    icon: 'construct-outline',
    emoji: '🧰',
    label: 'Service',
    hint: 'Work and parts',
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
/** The paper a service's photo is filed as, when the service itself cannot hold it yet. */
const SERVICE_PAPER = 'SERVICE_INVOICE' as const;
/** The kinds that put something into the vehicle, and so ask what went in. */
const PART_KINDS = new Set<EventType>(['MAINTENANCE', 'REPAIR', 'PART_INSTALLED', 'MODIFICATION']);

/*
 * The vehicle an entry was last saved for, so the next one from the app's own + starts there.
 * ponytail: for the session; after a restart the vehicle with the newest entry stands in.
 */
let lastVehicle: string | null = null;
/** The way of saying it chosen last, kept for the next entry the same way. */
let lastEntry: EntryStyle | null = null;

/** A field with something in it: `null` is untouched, and spaces are nothing. */
const typed = (value: string | null) => Boolean(value?.trim());

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
  initialScheduleId = null,
  initialPhoto = null,
  initialEntry,
  lead,
  inSheet = false,
  footerInset = 0,
  onDirty,
  onDone,
  onAddVehicle,
}: {
  /** Bound to one vehicle; absent, a rail of vehicles asks which. */
  vehicleId?: string;
  initialMode?: ActivityMode;
  initialKind?: EventType | null;
  initialLine?: string;
  /** A reminder's Log: the form opens on completing that schedule. */
  initialScheduleId?: string | null;
  /** A photo taken before the form opened — the sheet's "A receipt". */
  initialPhoto?: PickedFile | null;
  /** Opens on this way of saying it; else the one chosen last, else the line. */
  initialEntry?: EntryStyle;
  /** Beside the mode switch: the sheet's back key. */
  lead?: ReactNode;
  /** In the + sheet: the fields scroll in a bounded box over the footer. */
  inSheet?: boolean;
  /** Under the footer: the home indicator, on a screen. */
  footerInset?: number;
  /** Whether the form holds unsaved input, so its host can ask before closing it. */
  onDirty?: (dirty: boolean) => void;
  onDone: () => void;
  onAddVehicle: () => void;
}) {
  const theme = useTheme();
  const [mode, setMode] = useState<ActivityMode>(initialMode);
  const [entry, setEntryShown] = useState<EntryStyle>(initialEntry ?? lastEntry ?? 'quick');
  const setEntry = (next: EntryStyle) => {
    lastEntry = next;
    setEntryShown(next);
  };
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

  // Which vehicle: a cell of the form's first panel, scrolled with the form it is for.
  const select = vehicleId ? null : (
    <VehicleSelect
      vehicles={list}
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
        <View style={styles.heading}>
          <Text
            numberOfLines={1}
            accessibilityRole="header"
            style={[styles.headingTitle, { color: theme.foreground }]}
          >
            {initialScheduleId ? 'Log reminder' : mode === 'done' ? 'Log it' : 'Plan it'}
          </Text>
          {/* Bound to one vehicle there is no For to choose: the header says which. */}
          {vehicleId && vehicle ? (
            <Text numberOfLines={1} style={[typeScale.caption, { color: theme.mutedForeground }]}>
              {vehicle.displayName}
            </Text>
          ) : null}
        </View>
        {/*
         * What the form is, as a switch rather than tabs: it flips the form, it does not go
         * anywhere. Opened for a reminder, the form is for completing it: nothing to flip.
         */}
        {initialScheduleId ? null : (
          <View style={styles.modeSwitch}>
            <Segmented
              small
              variant="switch"
              value={mode}
              options={[
                { value: 'done', label: 'Done', icon: 'checkmark-done' },
                { value: 'planned', label: 'Reminder', icon: 'alarm-outline' },
              ]}
              onChange={setMode}
            />
          </View>
        )}
      </View>

      {waiting ? (
        <View style={{ gap: spacing.md }}>
          <Skeleton width="100%" height={66} radius={radius.xl} />
          <Skeleton width="100%" height={48} radius={radius.xl} />
        </View>
      ) : mode === 'done' ? (
        vehicle ? (
          <DoneForm
            key={vehicle.id}
            head={select}
            entry={entry}
            onEntry={setEntry}
            vehicle={vehicle}
            initialKind={initialKind}
            initialLine={initialLine}
            initialScheduleId={initialScheduleId}
            initialPhoto={initialPhoto}
            inSheet={inSheet}
            footerInset={footerInset}
            onDirty={onDirty}
            onDone={() => done(vehicle.id)}
          />
        ) : (
          <NoVehicle onAddVehicle={onAddVehicle} />
        )
      ) : (
        <PlannedForm
          key={garageWork ? GARAGE : (vehicle?.id ?? GARAGE)}
          head={select}
          entry={entry}
          onEntry={setEntry}
          vehicle={garageWork ? null : (vehicle ?? null)}
          inSheet={inSheet}
          footerInset={footerInset}
          onDirty={onDirty}
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

/**
 * Quick or Details, at the head of what it switches: the line that is read, or the fields one by
 * one. What either says is kept when switching, so a line half typed is a form half filled.
 */
function EntrySwitch({
  value,
  onChange,
}: {
  value: EntryStyle;
  onChange: (next: EntryStyle) => void;
}) {
  return (
    <TwoWay
      left="Quick"
      right="Details"
      on={value === 'detailed'}
      onChange={(on) => onChange(on ? 'detailed' : 'quick')}
      said="Details: each field on its own"
    />
  );
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
  entry,
  onEntry,
  vehicle,
  initialKind,
  initialLine,
  initialScheduleId,
  initialPhoto,
  inSheet,
  footerInset,
  onDirty,
  onDone,
}: {
  /** Beside the kind in the form's first panel: the vehicle's selector. */
  head: ReactNode;
  entry: EntryStyle;
  onEntry: (next: EntryStyle) => void;
  vehicle: Vehicle;
  initialKind: EventType | null;
  initialLine: string;
  initialScheduleId: string | null;
  initialPhoto: PickedFile | null;
  inSheet: boolean;
  footerInset: number;
  onDirty?: (dirty: boolean) => void;
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
  const [scheduleId, setScheduleId] = useState<string | null>(initialScheduleId);
  const [choosingKind, setChoosingKind] = useState(false);
  // The title as Details types it; `null` until then, and the line says it.
  const [titleSet, setTitle] = useState<string | null>(null);
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
  // What went in, once a line is touched; until then, what the reminder being completed names.
  const [linesSet, setLines] = useState<PartDraft[] | null>(null);
  const [saved, setSaved] = useState(false);
  // Something typed or a photo added: a kind or a day chip is one tap to choose again.
  useReportDirty(
    !saved &&
      (line.trim() !== initialLine.trim() ||
        [titleSet, odometerSet, costSet, quantitySet, placeSet, distanceSet, rate].some(typed) ||
        linesSet !== null ||
        photo !== initialPhoto),
    onDirty,
  );
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
  /*
   * Completing a reminder brings its parts, each the product fitted last time: "Oil change"
   * arrives with the oil and the filter already filled, and is saved as it was before.
   */
  const { current: fittedNow, positions: fittable } = useParts(vehicle);
  const takesParts = schedule !== null || PART_KINDS.has(kind);
  const readParts = receipt?.parts;
  const job = schedule?.title ?? null;
  const seeded = useMemo(
    () => seedPartLines(newId, vehicle, fittedNow, fittable, job, readParts),
    [job, readParts, fittable, fittedNow, vehicle],
  );
  const lines = takesParts ? (linesSet ?? seeded) : [];
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
  const titleShown = titleSet ?? (parsed.title.trim() || receipt?.note?.trim() || '');
  const title = titleShown.trim();
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
      // A part's label reads nothing but the part: that is a read too.
      const filled =
        found.some((value) => value !== undefined) ||
        Boolean(draft.note) ||
        Boolean(draft.parts?.length);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Three choices, as when this was the phone's own alert. Another from the library is a hold.
  const photoOptions = () =>
    dialog(
      `The ${photoIs}`,
      'Hold the photo to choose another from your library.',
      [
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
      ],
      { icon: 'image-outline' },
    );

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
      // In the same write as the entry: offline, the lines queue and replay with it.
      const parts = lines.length > 0 ? { parts: lines.map(toLine) } : {};
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
        const common = {
          // Chosen here, so a replay after a lost reply lands on this record rather than a second.
          id: newId(),
          performedAt: when,
          ...(where ? { provider: where } : {}),
          ...odometerFields,
          ...labour,
          ...parts,
        };
        if (schedule) {
          await enqueue({
            kind: 'maintenance',
            vehicleId,
            planId: schedule.id,
            body: { ...common, ...(title ? { workPerformed: title } : {}) },
          });
        } else {
          await enqueue({
            kind: 'maintenance-log',
            vehicleId,
            body: { ...common, title: title || humanise(kind) },
          });
        }
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
              documentType: SERVICE_PAPER,
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
            ...parts,
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
    !line.trim() &&
    !title &&
    !odometer &&
    !cost &&
    !quantity &&
    !photo &&
    !schedule &&
    !receipt?.note &&
    lines.length === 0;
  const odometerError =
    reading !== null && reading > 100_000_000 ? 'That is past 100,000,000' : null;
  // The day as a key in the footer, beside the photo's: nearly always today, so a button, not a field.
  const dateKey = (
    <DateField
      value={day}
      onChange={setDay}
      max={today}
      label="When"
      trigger={(_said, open) => (
        <DateKey day={day} today={today} said={dayChip(day)} marked={auto.day} onPress={open} />
      )}
    />
  );
  // Under the kind, when this vehicle last had one: what the card is, without a caption.
  const lastOfKind = logged?.find((event) => event.eventType === kind);
  const sinceLast = lastOfKind
    ? Math.max(0, Math.round((Date.now() - Date.parse(lastOfKind.occurredAt)) / 86_400_000))
    : null;
  const kindDetail = auto.kind
    ? 'Read from your line'
    : sinceLast === null
      ? 'None logged yet'
      : sinceLast === 0
        ? 'Last one today'
        : sinceLast === 1
          ? 'Last one yesterday'
          : `Last one ${spanOfDays(sinceLast)} ago`;
  const starts = line.trim() === '' && !schedule && again.length > 0;
  const chips =
    starts ||
    Boolean(price) ||
    Boolean(measure && quantity) ||
    (reading !== null && asksOdometer(kind)) ||
    Boolean(place) ||
    lines.length > 0;

  // Half a row each, so every note is a few words.
  const odometerCell = asksOdometer(kind) ? (
    <PanelCell
      label={mark('Odometer', auto.odometer)}
      note={
        odometerError ??
        (delta === null
          ? lastReading === null
            ? 'Optional'
            : `Last ${lastReading.toLocaleString()}`
          : delta >= 0
            ? `+${delta.toLocaleString()} ${unit}`
            : 'Below the last')
      }
      noteTone={odometerError ? 'destructive' : delta !== null && delta < 0 ? 'warning' : undefined}
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
  ) : null;
  const costCell = (
    <PanelCell
      label={mark(costLabel(kind), auto.cost)}
      note={cost ? 'Counts as spending' : 'Optional'}
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
  );
  const quantityCell = measure ? (
    <PanelCell
      label={mark(measure === 'L' ? 'Fuel' : 'Energy', auto.quantity)}
      note={measure === 'L' ? 'For economy' : 'For cost per kWh'}
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
  ) : null;

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
        {schedule ? (
          <>
            {head}
            <Completing
              schedule={schedule}
              unit={odometerUnit}
              onUnlink={() => {
                haptic.selection();
                setScheduleId(null);
              }}
            />
          </>
        ) : scheduleId !== null && activity.isPending ? (
          // The reminder it was opened for, while the vehicle's list arrives.
          <Skeleton width="100%" height={60} radius={radius.xl} />
        ) : (
          <>
            {/*
             * Which vehicle and what kind, a card each: what the entry is about, settled before what
             * happened is said. Each card's quiet line says what it is; a press opens its list.
             */}
            <View style={styles.selects}>
              {head}
              <SelectCell
                value={humanise(kind)}
                detail={kindDetail}
                lead={<Glyph size={22}>{eventEmoji(kind)}</Glyph>}
                marked={auto.kind}
                onPress={() => setChoosingKind(true)}
                accessibilityLabel={`Kind: ${humanise(kind)}`}
              />
            </View>
            {/* Up here, not under the figures: completing one decides what the rest are for. */}
            {offered.length > 0 ? (
              <Rail
                label="Complete a reminder"
                inset={spacing.lg}
                items={offered.map((item) => ({
                  key: item.id,
                  label: item.title,
                  // Pulled into the chip's round end, so the ring sits concentric with it.
                  glyph: (
                    <View style={{ marginLeft: -6 }}>
                      <DueRing plan={item} unit={odometerUnit} size={26} glyph={13} />
                    </View>
                  ),
                  selected: false,
                  marked: names(line, item.title),
                  onPress: () => setScheduleId(item.id),
                }))}
              />
            ) : null}
          </>
        )}

        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <Eyebrow style={[formLabel, { flex: 1 }]}>
              {schedule ? 'Work done' : 'What happened'}
            </Eyebrow>
            <EntrySwitch value={entry} onChange={onEntry} />
          </View>

          {entry === 'quick' ? (
            /*
             * Quick: one line, read as it is typed, and under it what was read from it — each a chip
             * that opens Details to change it. The fields themselves are not drawn beside the line.
             */
            <Rise key="quick" style={styles.body}>
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
              {chips ? (
                <View style={styles.wrap}>
                  {line.trim() === '' && !schedule
                    ? again.map((words) => (
                        <Fact
                          key={words}
                          icon="refresh"
                          label={words}
                          onPress={() => setLine(`${words} `)}
                        />
                      ))
                    : null}
                  {price ? (
                    <Fact
                      icon="cash-outline"
                      label={price}
                      marked={auto.cost}
                      onPress={() => onEntry('detailed')}
                    />
                  ) : null}
                  {measure && quantity ? (
                    <Fact
                      icon={measure === 'L' ? 'water-outline' : 'flash-outline'}
                      label={`${quantity} ${quantityIn}`}
                      marked={auto.quantity}
                      onPress={() => onEntry('detailed')}
                    />
                  ) : null}
                  {reading !== null && asksOdometer(kind) ? (
                    <Fact
                      icon="speedometer-outline"
                      label={`${reading.toLocaleString()} ${unit}`}
                      marked={auto.odometer}
                      onPress={() => onEntry('detailed')}
                    />
                  ) : null}
                  {place ? (
                    <Fact
                      icon="location-outline"
                      label={place}
                      marked={auto.place}
                      onRemove={() => setPlace('')}
                    />
                  ) : null}
                  {lines.length > 0 ? (
                    <Fact
                      icon="construct-outline"
                      label={`${lines.length} ${lines.length === 1 ? 'part' : 'parts'}`}
                      onPress={() => onEntry('detailed')}
                    />
                  ) : null}
                </View>
              ) : null}
              {odometerError || tripShort ? (
                <Text
                  accessibilityRole="alert"
                  style={[typeScale.caption, styles.hint, { color: theme.destructive }]}
                >
                  {odometerError ?? 'The mileage log needs how far: add it in Details.'}
                </Text>
              ) : line.trim() !== '' || title ? (
                <Text style={[typeScale.caption, styles.hint, { color: theme.mutedForeground }]}>
                  Saved as “{title || schedule?.title || humanise(kind)}”
                </Text>
              ) : null}
            </Rise>
          ) : (
            /*
             * Details: each thing on its own — the title as the line it will become, then the
             * figures, the day and the place as one panel, the way a logbook line reads.
             */
            <Rise key="detailed" style={styles.body}>
              <Panel>
                <View style={styles.row}>
                  <PanelCell label={schedule ? 'Work done' : 'Title'}>
                    <TextInput
                      value={titleShown}
                      onChangeText={setTitle}
                      placeholder={schedule?.title ?? humanise(kind)}
                      placeholderTextColor={theme.placeholder}
                      maxLength={200}
                      returnKeyType="done"
                      accessibilityLabel="Title"
                      style={[typeScale.headline, styles.textCell, { color: theme.foreground }]}
                    />
                  </PanelCell>
                </View>
                {measure ? (
                  <>
                    <View style={styles.row}>
                      {costCell}
                      {quantityCell}
                    </View>
                    {/*
                     * A row of its own, as every line of the panel: a cell is `flex: 1` to share a
                     * row, and straight in the column that let it shrink under its own label.
                     */}
                    {odometerCell ? <View style={styles.row}>{odometerCell}</View> : null}
                  </>
                ) : (
                  <View style={styles.row}>
                    {odometerCell}
                    {costCell}
                  </View>
                )}
                {trip && purpose ? (
                  <View style={styles.row}>
                    <PanelCell
                      label={mark('Distance', distanceSet === null && measured !== '')}
                      note={
                        tripShort
                          ? 'Needed for the log'
                          : distanceSet === null && measured
                            ? 'From the odometer'
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
                <View style={styles.row}>
                  <PanelCell label={mark('Where', auto.place)}>
                    <TextInput
                      value={place}
                      onChangeText={setPlace}
                      placeholder="Optional"
                      placeholderTextColor={theme.placeholder}
                      maxLength={120}
                      returnKeyType="done"
                      accessibilityLabel="Where"
                      style={[typeScale.headline, styles.textCell, { color: theme.foreground }]}
                    />
                  </PanelCell>
                </View>
              </Panel>
              {trip ? (
                <View style={styles.wrap}>
                  {TRIP_PURPOSES.map((option) => (
                    <Fact
                      key={option}
                      label={humanise(option)}
                      selected={purpose === option}
                      onPress={() => setPurpose(purpose === option ? null : option)}
                    />
                  ))}
                </View>
              ) : null}
              {takesParts ? (
                <PartLinesField vehicle={vehicle} lines={lines} onChange={setLines} />
              ) : null}
            </Rise>
          )}
        </View>

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
        {dateKey}
        <View style={{ flex: 1 }}>
          <Button
            label={action}
            icon={schedule ? 'checkmark' : undefined}
            variant="primary"
            pill
            loading={save.isPending}
            disabled={empty || tripShort || Boolean(odometerError)}
            onPress={() => save.mutate()}
          />
        </View>
      </View>
      {choosingKind ? (
        <KindSheet
          kinds={kinds}
          value={kind}
          onChange={setKind}
          onClose={() => setChoosingKind(false)}
        />
      ) : null}
    </View>
  );
}

/**
 * The reminder this entry completes, at the head of the form where the kind would be: its glyph,
 * its name and how due it is, in the tone its row wears. × logs a plain service instead.
 */
function Completing({
  schedule,
  unit,
  onUnlink,
}: {
  schedule: MaintenancePlan;
  unit: Vehicle['odometerUnit'];
  onUnlink: () => void;
}) {
  const theme = useTheme();
  const { headline, tone } = readDue(schedule, unit);
  const color =
    tone === 'destructive'
      ? theme.destructive
      : tone === 'warning'
        ? theme.warning
        : theme.mutedForeground;
  return (
    <Rise>
      <View
        accessible
        accessibilityLabel={`Completing ${schedule.title}, ${headline}`}
        style={[styles.completing, { backgroundColor: theme.muted }]}
      >
        <DueRing plan={schedule} unit={unit} size={44} glyph={22} />
        <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
          <Text numberOfLines={1} style={[styles.completingTitle, { color: theme.foreground }]}>
            {schedule.title}
          </Text>
          <Text numberOfLines={1} style={[styles.completingDue, { color }]}>
            {headline}
          </Text>
        </View>
        <PressableScale
          onPress={onUnlink}
          accessibilityRole="button"
          accessibilityLabel={`Not ${schedule.title}: log something else`}
          hitSlop={8}
          scaleTo={0.88}
          style={[styles.unlink, { backgroundColor: theme.cardRaised }]}
        >
          <Ionicons name="close" size={15} color={theme.mutedForeground} />
        </PressableScale>
      </View>
    </Rise>
  );
}

/**
 * How far along a reminder is, as a thin ring round its glyph, the way the Due tab's gauges read:
 * copper while it is coming, amber when it is close, full and red once it is late. Drawn still —
 * a ring per chip, so no sweep on the JS thread while the sheet opens.
 */
export function DueRing({
  plan,
  unit,
  size,
  glyph,
}: {
  plan: MaintenancePlan;
  unit: Vehicle['odometerUnit'];
  size: number;
  /** The glyph's own size inside the ring. */
  glyph: number;
}) {
  const theme = useTheme();
  const { tone, gauge } = readDue(plan, unit);
  const stroke = size > 32 ? 3 : 2.25;
  const r = (size - stroke) / 2;
  const round = 2 * Math.PI * r;
  // No baseline yet: an empty track, unless the plan is already late.
  const progress = Math.min(1, Math.max(0, gauge?.progress ?? (tone === 'destructive' ? 1 : 0)));
  const color =
    tone === 'destructive' ? theme.destructive : tone === 'warning' ? theme.warning : theme.primary;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg
        width={size}
        height={size}
        style={[StyleSheet.absoluteFill, { transform: [{ rotate: '-90deg' }] }]}
      >
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={theme.border}
          strokeWidth={stroke}
          fill="none"
        />
        {progress > 0 ? (
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${round * progress} ${round}`}
            fill="none"
          />
        ) : null}
      </Svg>
      <Glyph size={glyph}>{jobEmoji(plan.title)}</Glyph>
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
  entry,
  onEntry,
  vehicle,
  inSheet,
  footerInset,
  onDirty,
  onDone,
}: {
  /** The form's first panel: the vehicle's selector. */
  head: ReactNode;
  entry: EntryStyle;
  onEntry: (next: EntryStyle) => void;
  /** Null for garage-wide work: a one-off for no vehicle in particular. */
  vehicle: Vehicle | null;
  inSheet: boolean;
  footerInset: number;
  onDirty?: (dirty: boolean) => void;
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
  // The title as Details types it; `null` until then, and the line says it.
  const [titleSet, setTitle] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  useReportDirty(!saved && [line, titleSet, monthsSet, distanceSet].some(typed), onDirty);

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
  const titleShown = titleSet ?? parsed.title.trim();
  const title = titleShown.trim();
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
      // A reminder is the one thing here that wants to reach the phone later: ask now, once.
      void askForPush();
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
    setTitle(null);
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
            selected: line === job.line && titleSet === null,
            trailing:
              planned(job.label) && line !== job.line ? (
                <Ionicons name="checkmark" size={14} color={theme.success} />
              ) : undefined,
            onPress: () => fillLine(job.line),
          }))}
        />

        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <Eyebrow style={[formLabel, { flex: 1 }]}>What needs doing</Eyebrow>
            <EntrySwitch value={entry} onChange={onEntry} />
          </View>

          {entry === 'quick' ? (
            // Quick: the line, and under it when it was read to come due. A chip opens Details.
            <Rise key="quick" style={styles.body}>
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
              <View style={styles.wrap}>
                <Fact
                  icon={repeats ? 'repeat' : 'calendar-outline'}
                  label={
                    repeats
                      ? every
                        ? `Every ${every}`
                        : 'Repeats'
                      : due
                        ? `Due ${dayChip(due)}`
                        : 'No date'
                  }
                  marked={repeats ? auto.repeats : auto.due}
                  onPress={() => onEntry('detailed')}
                />
                {comesDue ? (
                  <Fact
                    icon="flag-outline"
                    label={`First due ${comesDue}`}
                    onPress={() => onEntry('detailed')}
                  />
                ) : null}
              </View>
              {missingInterval ? (
                <Text
                  accessibilityRole="alert"
                  style={[typeScale.caption, styles.hint, { color: theme.destructive }]}
                >
                  A repeat needs how often: say it, or set it in Details.
                </Text>
              ) : line.trim() !== '' ? (
                <Text style={[typeScale.caption, styles.hint, { color: theme.mutedForeground }]}>
                  {title ? `Saved as “${title}”` : 'Say what needs doing, then when.'}
                </Text>
              ) : null}
            </Rise>
          ) : (
            // Details: the title on its own, once or on a repeat, and its day or its interval.
            <Rise key="detailed" style={styles.body}>
              <Panel>
                <View style={styles.row}>
                  <PanelCell label="Title">
                    <TextInput
                      value={titleShown}
                      onChangeText={setTitle}
                      placeholder={repeats ? 'Rotate tyres' : 'Renew insurance'}
                      placeholderTextColor={theme.placeholder}
                      maxLength={200}
                      returnKeyType="done"
                      accessibilityLabel="Title"
                      style={[typeScale.headline, styles.textCell, { color: theme.foreground }]}
                    />
                  </PanelCell>
                </View>
              </Panel>
              {vehicle ? (
                <TwoWay
                  left="Once"
                  right={auto.repeats ? 'Repeats ✦' : 'Repeats'}
                  on={repeats}
                  onChange={setRepeats}
                  said="Repeats on an interval"
                />
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
                        selected={
                          everyMonths === preset.months && everyDistance === preset.distance
                        }
                        onPress={() => {
                          setMonths(preset.months);
                          setDistance(preset.distance);
                        }}
                      />
                    ))}
                  </View>
                  {comesDue ? (
                    <Text
                      style={[typeScale.caption, styles.hint, { color: theme.mutedForeground }]}
                    >
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
            </Rise>
          )}
        </View>

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
            pill
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
 * Which vehicle it is for, as a selector: the chosen one's picture and name in a cell, and pressed,
 * a sheet of every vehicle on the road — its picture, its name, where its odometer stands — the
 * chosen one washed in copper and ticked. A reminder may be for the garage as a whole.
 */
function VehicleSelect({
  vehicles,
  value,
  garage,
  onChange,
}: {
  vehicles: readonly Vehicle[];
  value: string | null;
  /** Offer garage-wide work, for a one-off reminder. */
  garage: boolean;
  onChange: (id: string) => void;
}) {
  const theme = useTheme();
  const { height } = useWindowDimensions();
  const [open, setOpen] = useState(false);
  if (vehicles.length === 0 && !garage) return null;
  const options: { id: string; vehicle: Vehicle | null }[] = [
    ...vehicles.map((vehicle) => ({ id: vehicle.id, vehicle })),
    ...(garage ? [{ id: GARAGE, vehicle: null }] : []),
  ];
  const current = options.find((option) => option.id === value) ?? null;
  const name = (option: { vehicle: Vehicle | null } | null) =>
    option ? (option.vehicle?.displayName ?? 'Garage work') : 'Choose';

  return (
    <>
      <SelectCell
        value={name(current)}
        detail={
          current?.vehicle
            ? current.vehicle.currentOdometer !== null
              ? formatDistance(current.vehicle.currentOdometer, current.vehicle.odometerUnit)
              : humanise(current.vehicle.vehicleType)
            : current
              ? 'No vehicle in particular'
              : undefined
        }
        lead={
          current?.vehicle ? (
            <VehicleThumb vehicle={current.vehicle} />
          ) : (
            <Ionicons name="home-outline" size={17} color={theme.mutedForeground} />
          )
        }
        // One vehicle and nothing else to choose: the cell says which, and opens nothing.
        onPress={options.length > 1 ? () => setOpen(true) : undefined}
        accessibilityLabel={`For: ${name(current)}`}
      />
      {open ? (
        <MenuSheet
          title="Which vehicle?"
          message={garage ? 'A one-off can be for the garage as a whole.' : undefined}
          onClose={() => setOpen(false)}
        >
          <ScrollView
            style={{ maxHeight: Math.round(height * 0.55) }}
            contentContainerStyle={styles.choices}
            accessibilityRole="radiogroup"
          >
            {options.map((option) => {
              const selected = option.id === value;
              return (
                <PressableScale
                  key={option.id}
                  onPress={() => {
                    if (!selected) {
                      haptic.selection();
                      onChange(option.id);
                    }
                    setOpen(false);
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  accessibilityLabel={
                    option.vehicle?.displayName ?? 'The garage, no vehicle in particular'
                  }
                  scaleTo={0.97}
                  style={[
                    styles.choice,
                    { backgroundColor: selected ? theme.primarySoft : theme.muted },
                  ]}
                >
                  <View style={[styles.thumb, { backgroundColor: theme.cardRaised }]}>
                    {option.vehicle ? (
                      <VehicleThumb vehicle={option.vehicle} />
                    ) : (
                      <Ionicons name="home-outline" size={17} color={theme.mutedForeground} />
                    )}
                  </View>
                  <View style={styles.choiceWords}>
                    <Text numberOfLines={1} style={[typeScale.label, { color: theme.foreground }]}>
                      {name(option)}
                    </Text>
                    <Text
                      numberOfLines={1}
                      style={[figure, styles.choiceReading, { color: theme.mutedForeground }]}
                    >
                      {option.vehicle
                        ? option.vehicle.currentOdometer !== null
                          ? formatDistance(
                              option.vehicle.currentOdometer,
                              option.vehicle.odometerUnit,
                            )
                          : humanise(option.vehicle.vehicleType)
                        : 'No vehicle'}
                    </Text>
                  </View>
                  {selected ? (
                    <View style={[styles.check, { backgroundColor: theme.primary }]}>
                      <Ionicons name="checkmark" size={13} color={theme.primaryForeground} />
                    </View>
                  ) : null}
                </PressableScale>
              );
            })}
          </ScrollView>
        </MenuSheet>
      ) : null}
    </>
  );
}

/**
 * Every kind, as a sheet of tiles three to a row — the ones this vehicle logs most first, as the
 * form ranks them — the chosen one washed in copper and ticked. A press chooses and closes.
 */
function KindSheet({
  kinds,
  value,
  onChange,
  onClose,
}: {
  kinds: readonly EventType[];
  value: EventType;
  onChange: (kind: EventType) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const { height } = useWindowDimensions();
  return (
    <MenuSheet title="What kind?" message="The ones you log most come first." onClose={onClose}>
      <ScrollView
        style={{ maxHeight: Math.round(height * 0.6) }}
        contentContainerStyle={styles.kindGrid}
        accessibilityRole="radiogroup"
      >
        {kinds.map((option) => {
          const selected = option === value;
          return (
            <PressableScale
              key={option}
              onPress={() => {
                if (!selected) haptic.selection();
                onChange(option);
                onClose();
              }}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={humanise(option)}
              scaleTo={0.94}
              style={[
                styles.kindTile,
                { backgroundColor: selected ? theme.primarySoft : theme.muted },
              ]}
            >
              <Glyph size={24}>{eventEmoji(option)}</Glyph>
              <Text numberOfLines={2} style={[styles.kindLabel, { color: theme.foreground }]}>
                {humanise(option)}
              </Text>
              {selected ? (
                <View style={[styles.check, styles.kindCheck, { backgroundColor: theme.primary }]}>
                  <Ionicons name="checkmark" size={12} color={theme.primaryForeground} />
                </View>
              ) : null}
            </PressableScale>
          );
        })}
      </ScrollView>
    </MenuSheet>
  );
}

/** A vehicle in miniature: its photo or cutout, else its make's badge, else its kind. */
function VehicleThumb({ vehicle, logo = 24 }: { vehicle: Vehicle; logo?: number }) {
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
    <BrandLogo make={vehicle.make} size={logo} />
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
  screen: { flex: 1, gap: spacing.sm + 2, paddingTop: spacing.sm },
  /*
   * In the + sheet: everything shrinks to the room the screen — less the keyboard — leaves, and
   * only the fields scroll; the mode switch and the Save row stay put. The fields run out to the
   * sheet's edges so a rail scrolls under them, padded back in.
   */
  sheet: { flexShrink: 1, gap: spacing.md },
  top: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 40 },
  heading: { flex: 1, minWidth: 0 },
  headingTitle: { fontSize: 18, lineHeight: 23, fontWeight: '700', letterSpacing: -0.45 },
  // Each side holds "Reminder" with its icon: a switch, not a bar across the sheet.
  modeSwitch: { width: 184 },
  section: { gap: spacing.sm },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingLeft: 4 },
  body: { gap: spacing.sm },
  // The cards that say what the entry is about, apart from one another.
  selects: { gap: spacing.sm },
  // A word field in the panel (the title, the place), the height of the figures around it.
  textCell: { minHeight: 26, padding: 0 },
  fields: { gap: spacing.md },
  sheetFields: { flexShrink: 1, marginHorizontal: -spacing.lg },
  sheetContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xs },
  screenContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl },
  row: { flexDirection: 'row', gap: StyleSheet.hairlineWidth },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm - 2 },
  hint: { paddingHorizontal: 4 },
  choices: { gap: 6 },
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 58,
    paddingLeft: 8,
    paddingRight: spacing.md,
    ...leaf('sm'),
  },
  choiceWords: { flex: 1, minWidth: 0 },
  choiceReading: { fontSize: 11.5, lineHeight: 15 },
  check: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  kindGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 8 },
  kindTile: {
    width: '31.9%',
    minHeight: 80,
    padding: 10,
    gap: 8,
    justifyContent: 'space-between',
    ...leaf('sm'),
  },
  kindLabel: { fontSize: 12.5, lineHeight: 16, fontWeight: '600' },
  kindCheck: { position: 'absolute', top: 8, right: 8 },
  twin: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 4 },
  scan: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 4 },
  banner: { borderRadius: radius.lg, padding: 14 },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingTop: spacing.sm,
  },
  completing: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    // A card like the selectors above it: filled, symmetric, no outline.
    borderRadius: radius.lg,
    paddingVertical: 8,
    paddingLeft: 9,
    paddingRight: 10,
  },
  completingTitle: { fontSize: 15, lineHeight: 19, fontWeight: '700', letterSpacing: -0.2 },
  completingDue: { fontSize: 12.5, lineHeight: 16, fontWeight: '600' },
  unlink: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saved: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: 14,
    padding: spacing.sm,
  },
  thumb: {
    width: 38,
    height: 38,
    borderRadius: 11,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  noVehicle: {
    alignItems: 'center',
    gap: spacing.xs,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
});
