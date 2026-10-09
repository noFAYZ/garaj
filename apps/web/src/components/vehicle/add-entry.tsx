'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { Check, ChevronDown, Paperclip, Plus, Sparkles, X } from 'lucide-react';
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from 'react';
import {
  EVENT_TYPES,
  TRIP_PURPOSES,
  type DistanceUnit,
  type EventType,
  type TripPurpose,
} from '@vehicle-os/domain';
import type { MaintenancePlan, VehicleEvent } from '@vehicle-os/contracts';
import { activityQuery, vehicleQuery } from '@vehicle-os/api-client/react';
import { ApiError } from '@vehicle-os/api-client';
import { stampForDay } from '@vehicle-os/ui';
import { api } from '@/lib/api';
import { DatePicker } from '@/components/ui/date-picker';
import { Emoji, type EmojiName } from '@/components/emoji';
import { Icon, type IconName } from '@/components/icons';
import { isImage } from '@/components/onboard-uploads';
import { FormError, Modal, MODAL_BAR } from '@/components/ui/modal';
import { Button, Field } from '@/components/ui/primitives';
import { matchTypeahead, nextEnabled, placeList } from '@/components/ui/select-position';
import { ReminderStatus, scheduleEmoji } from '@/components/vehicle/schedule-row';
import { readDue } from '@/lib/due';
import { eventEmoji } from '@/lib/event-emoji';
import { formatDate, formatMoney, fromMinorUnits, humanise, toMinorUnits } from '@/lib/format';
import { parseDone, parsePlanned, type Token } from '@/lib/quick-entry';
import {
  ATTACH_TYPES,
  attachable,
  attachFiles,
  currencyOfLine,
  PAPER,
  saveDone,
  savePlanned,
  symbolOf,
} from '@/lib/save-entry';
import { cn } from '@/lib/utils';
import { useVehicleUnits } from '@/lib/vehicle-units';

export type AddMode = 'done' | 'planned';

export const isAddMode = (value: string | null): value is AddMode =>
  value === 'done' || value === 'planned';

const MODES = [
  { value: 'done', label: 'Done', icon: 'check' },
  { value: 'planned', label: 'Reminder', icon: 'calendar' },
] as const satisfies readonly { value: AddMode; label: string; icon: IconName }[];

/**
 * The one way to add anything to a vehicle's activity, built to ask for as little as it can.
 *
 * - **Say it once.** One line, the way a person would say it — "Filled up 40 L, €62 at Shell,
 *   52,900 km" — read as it is typed (`lib/quick-entry`). What it picked out is marked in the line
 *   itself and lands in its field; nothing is hidden, and a field set by hand always wins.
 * - **Recognise, don't recall.** The kind is a list in the line itself, every kind with its glyph and
 *   the ones this vehicle uses first; the titles, amounts and places used before for that kind are
 *   one tap away; a reminder starts from a list of common jobs; a schedule that is due,
 *   or that the line names, is offered to complete.
 * - **Default, don't ask.** The kind is the one this vehicle logs most until the line or a tap says
 *   otherwise, the day is today, and the title may be left out — it is then the kind's name.
 * - **Disclose on demand.** Where it was done and a note are a tap away, opened by themselves when
 *   the line already says.
 * - **Say what will happen.** The button names what it will save — "Add fuel · €62.40",
 *   "Complete Oil change" — so the last look before pressing it is the check.
 *
 * Done or Reminder is the one question asked up front. The line carries across the switch, so
 * starting in the wrong one costs nothing. The dialog holds one size, so switching never moves it.
 */
export function AddEntryDialog({
  vehicleId,
  garageId,
  mode,
  onModeChange,
  schedules,
  onDone,
  onClose,
  initialLine = '',
}: {
  vehicleId: string;
  garageId: string | undefined;
  mode: AddMode;
  onModeChange: (mode: AddMode) => void;
  schedules: readonly MaintenancePlan[];
  onDone: () => void;
  onClose: () => void;
  /** What was already typed elsewhere — the home screen's add line — to start from. */
  initialLine?: string;
}) {
  const [line, setLine] = useState(initialLine);

  return (
    <Modal
      title="Add to activity"
      size="lg"
      fill
      onClose={onClose}
      header={(titleId) => (
        <div className="flex items-center gap-3">
          <h2 id={titleId} className="sr-only">
            Add to activity
          </h2>
          <div
            role="group"
            aria-label="Kind of item"
            className="inline-flex gap-0.5 rounded-full bg-muted p-1"
          >
            {MODES.map((option) => {
              const selected = mode === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => onModeChange(option.value)}
                  className={cn(
                    'inline-flex h-9 items-center gap-2 rounded-full px-4 text-sm font-semibold transition-[background-color,color,scale] active:scale-[0.97]',
                    selected
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  <Icon name={option.icon} size={16} />
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>
      )}
    >
      {/* Keyed, so switching replays the entrance rather than swapping fields in place. */}
      <div key={mode} className="-mx-6 -mb-6 flex min-h-0 flex-1 animate-rise flex-col">
        {mode === 'done' ? (
          <DoneForm
            vehicleId={vehicleId}
            schedules={schedules}
            line={line}
            onLineChange={setLine}
            onDone={onDone}
            onCancel={onClose}
          />
        ) : (
          <PlannedForm
            vehicleId={vehicleId}
            garageId={garageId}
            schedules={schedules}
            line={line}
            onLineChange={setLine}
            onDone={onDone}
            onCancel={onClose}
          />
        )}
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------------------------------- */

/** The kinds people log week to week, in the order a new vehicle offers them. */
const COMMON_KINDS = [
  'FUEL',
  'MAINTENANCE',
  'REPAIR',
  'CLEANING',
  'CHARGE',
  'INSPECTION',
  'EXPENSE',
  'NOTE',
] as const satisfies readonly EventType[];

/** Examples in the line's own grammar, so the placeholder teaches what it can read. */
const EXAMPLE: Partial<Record<EventType, string>> = {
  FUEL: 'Filled up 40 L, €62 at Shell, 52,900 km',
  CHARGE: 'Charged 32 kWh, €9 at Ionity',
  MAINTENANCE: 'Oil and filter change, €189 at Kwik Fit',
  REPAIR: 'Replaced the front pads, €240 yesterday',
  CLEANING: 'Full valet, €35 on Saturday',
  INSPECTION: 'Annual inspection passed, €55',
  EXPENSE: 'Parking permit €120',
  INSURANCE: 'Renewed the policy, €640',
  REGISTRATION: 'Road tax for the year, €190',
  TRIP: 'Drove to Galway, 52,900 km',
  NOTE: 'Rattle from the dash at idle',
};

/** A calendar day in the viewer's own zone, as `YYYY-MM-DD` — `toISOString` is a day off at night. */
function localDay(shift: { days?: number; months?: number } = {}): string {
  const date = new Date();
  date.setDate(date.getDate() + (shift.days ?? 0));
  date.setMonth(date.getMonth() + (shift.months ?? 0));
  return date.toLocaleDateString('en-CA');
}

const digitsOnly = (value: string) =>
  value
    .replace(/\D/g, '')
    .replace(/^0+(?=\d)/, '')
    .slice(0, 9);

/** Up to two decimals, one point, no leading zeros — what a price can be typed as. */
const amountOnly = (value: string) => {
  const [whole = '', ...rest] = value.replace(/[^\d.]/g, '').split('.');
  const cleaned = whole.replace(/^0+(?=\d)/, '').slice(0, 9);
  return rest.length ? `${cleaned}.${rest.join('').slice(0, 2)}` : cleaned;
};

const unitLabel = (unit: string) => (unit === 'MI' ? 'mi' : 'km');

/**
 * What this vehicle's record says about how it is logged: its kinds by use, and per kind the
 * titles, amounts and places used lately — the material for one-tap suggestions. Read from the
 * activity entry the page already holds, newest first.
 */
function useHabits(vehicleId: string) {
  const feed = useQuery(activityQuery(api, vehicleId));
  const events = feed.data?.done.data;
  return useMemo(() => {
    const done = events ?? [];
    const counts = new Map<EventType, number>();
    for (const event of done) counts.set(event.eventType, (counts.get(event.eventType) ?? 0) + 1);
    const used = [...counts].sort((a, b) => b[1] - a[1]).map(([kind]) => kind);
    const kinds = [...new Set<EventType>([...used, ...COMMON_KINDS])];

    const recent = (kind: EventType) => {
      const ofKind = done.filter((event) => event.eventType === kind);
      const distinct = <T,>(items: (T | null)[], key: (item: T) => string, limit: number) => {
        const seen = new Set<string>();
        const out: T[] = [];
        for (const item of items) {
          if (item === null || seen.has(key(item))) continue;
          seen.add(key(item));
          out.push(item);
          if (out.length === limit) break;
        }
        return out;
      };
      return {
        titles: distinct(
          ofKind.map((event: VehicleEvent) =>
            event.title.trim().toLowerCase() === humanise(kind).toLowerCase() ? null : event.title,
          ),
          (title) => title.toLowerCase(),
          3,
        ),
        amounts: distinct(
          ofKind.map((event) => event.cost),
          (cost) => `${cost.amountMinor}${cost.currency}`,
          2,
        ),
        places: distinct(
          ofKind.map((event) => event.provider),
          (place) => place.toLowerCase(),
          3,
        ),
      };
    };
    return { kinds, used, counts, usual: used[0] ?? null, recent };
  }, [events]);
}

/** Whether a schedule is named in the line: any word of its title of three letters or more. */
function names(line: string, title: string): boolean {
  const words = new Set(line.toLowerCase().split(/[^a-z]+/));
  return title
    .toLowerCase()
    .split(/[^a-z]+/)
    .some((word) => word.length >= 3 && words.has(word));
}

function DoneForm({
  vehicleId,
  schedules,
  line,
  onLineChange,
  onDone,
  onCancel,
}: {
  vehicleId: string;
  schedules: readonly MaintenancePlan[];
  line: string;
  onLineChange: (line: string) => void;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { currency, odometerUnit } = useVehicleUnits(vehicleId);
  const lastReading = useQuery(vehicleQuery(api, vehicleId)).data?.currentOdometer ?? null;
  const habits = useHabits(vehicleId);
  const composer = useRef<HTMLInputElement>(null);
  const parsed = useMemo(() => parseDone(line, { lastReading }), [line, lastReading]);

  // Set by hand; `null` is "not touched", and then the line, then the default, decide.
  const [kindSet, setKind] = useState<EventType | null>(null);
  const [scheduleId, setScheduleId] = useState<string | null>(null);
  const [daySet, setDay] = useState<string | null>(null);
  const [odometerSet, setOdometer] = useState<string | null>(null);
  const [costSet, setCost] = useState<string | null>(null);
  // The currency of an amount taken from an earlier entry, which may not be the vehicle's.
  const [costCurrencySet, setCostCurrency] = useState<string | null>(null);
  const [placeSet, setPlace] = useState<string | null>(null);
  const [noteSet, setNote] = useState<string | null>(null);
  const [opened, setOpened] = useState<{ place: boolean; note: boolean }>({
    place: false,
    note: false,
  });
  const [warnings, setWarnings] = useState<string[]>([]);
  // Files to go up with the entry once it exists: photos to its gallery, papers to its documents.
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const picker = useRef<HTMLInputElement>(null);
  // Mileage-log detail, only asked for on a trip.
  const [purpose, setPurpose] = useState<TripPurpose | null>(null);
  const [tripStart, setTripStart] = useState('');
  const [tripDistance, setTripDistance] = useState('');
  const [tripRate, setTripRate] = useState('');

  const schedule = schedules.find((item) => item.id === scheduleId) ?? null;
  const kind: EventType = schedule
    ? 'MAINTENANCE'
    : (kindSet ?? parsed.kind ?? habits.usual ?? 'MAINTENANCE');
  const today = localDay();
  const day = daySet ?? parsed.day ?? today;
  const odometer = odometerSet ?? (parsed.odometer !== null ? String(parsed.odometer) : '');
  const cost = costSet ?? parsed.amount ?? '';
  /*
   * The amount is saved in the currency it was written in: "€62" is euros whatever the vehicle
   * counts in. A bare "$" is the vehicle's own dollar when it counts in one, else the US dollar.
   */
  const lineCurrency = currencyOfLine(parsed.currency, currency);
  const costCurrency = costCurrencySet ?? (costSet === null ? lineCurrency : null) ?? currency;
  const symbol = symbolOf(currency);
  const place = placeSet ?? parsed.place ?? '';
  const note = noteSet ?? parsed.quantity ?? '';
  const auto = {
    kind: !schedule && kindSet === null && parsed.kind !== null,
    day: daySet === null && parsed.day !== null,
    odometer: odometerSet === null && parsed.odometer !== null,
    cost: costSet === null && parsed.amount !== null,
    place: placeSet === null && parsed.place !== null,
    note: noteSet === null && parsed.quantity !== null,
  };
  const showPlace = opened.place || place !== '';
  const showNote = opened.note || note !== '';
  const recent = habits.recent(kind);
  const unit = unitLabel(odometerUnit);

  /*
   * The schedules worth offering: what is due, what the line names, and — when the kind is a
   * service — the rest too. Completing one restarts its clock, so it is offered, never chosen.
   */
  const offered = schedules
    .filter(
      (item) =>
        item.id === scheduleId ||
        item.status === 'OVERDUE' ||
        item.status === 'DUE_SOON' ||
        names(line, item.title) ||
        kind === 'MAINTENANCE',
    )
    .toSorted((a, b) => Number(names(line, b.title)) - Number(names(line, a.title)));

  const mutation = useMutation({
    mutationFn: async (): Promise<string[]> => {
      // The chosen day at the current time of day, so it sorts among the day's other entries.
      const when = stampForDay(day);
      const reading = odometer ? { odometer: Number(odometer), odometerUnit } : {};
      // A human amount in; minor units out — 25 JPY is 25, 25 USD is 2500.
      const amount =
        cost && Number(cost) > 0 ? toMinorUnits(Number(cost), costCurrency) : undefined;
      const words = parsed.title.trim();
      const said = note.trim();
      const where = place.trim();

      /*
       * The files go up once the entry exists, addressed to it. One that fails does not undo the
       * entry — that would lose what was typed for a file — it is said, and the rest still go.
       */
      const attach = (eventId: string | null | undefined, filed: EventType) =>
        attachFiles(vehicleId, eventId, files, filed);

      if (schedule) {
        /*
         * Completing a repeating item: one request writes the service record, this activity item
         * and — with a cost — the spending, and restarts the schedule's clock. The entry takes
         * the schedule's name; what was typed is the work done.
         */
        const work = [words, said].filter(Boolean).join('\n');
        const done = await api.maintenance.complete(vehicleId, schedule.id, {
          performedAt: when,
          ...(work ? { workPerformed: work } : {}),
          ...(where ? { provider: where } : {}),
          ...reading,
          ...(amount !== undefined ? { laborCostAmountMinor: amount, costCurrency } : {}),
        });
        return attach(done.record.eventId, 'MAINTENANCE');
      }

      const saved = await saveDone({
        vehicleId,
        kind,
        title: words,
        when,
        ...(odometer ? { odometer: Number(odometer) } : {}),
        odometerUnit,
        ...(amount !== undefined ? { amountMinor: amount } : {}),
        currency: costCurrency,
        place: where,
        note: said,
        // A purpose is what makes a trip part of the mileage log; without one it is just a note.
        ...(kind === 'TRIP' && purpose
          ? {
              trip: {
                purpose,
                ...(tripStart ? { startOdometer: Number(tripStart) } : {}),
                ...(tripDistance ? { distance: Number(tripDistance) } : {}),
                ...(tripRate && Number(tripRate) > 0
                  ? { rateMinor: toMinorUnits(Number(tripRate), currency), rateCurrency: currency }
                  : {}),
              },
            }
          : {}),
      });
      return [...saved.warnings, ...(await attach(saved.eventId, kind))];
    },
    meta: { toast: 'Added to activity' },
    onSuccess: (messages) => {
      /*
       * A save can succeed and still be worth a word — most often an odometer lower than the last
       * reading. Said, not blocked: a cluster swap is a real reason for one.
       */
      if (messages.length > 0) {
        setWarnings(messages);
        return;
      }
      onDone();
    },
  });

  const fieldErrors = mutation.error instanceof ApiError ? mutation.error.fields : undefined;
  const saved = warnings.length > 0;
  const below = odometer !== '' && lastReading !== null && Number(odometer) < lastReading;
  const readingNote = odometer
    ? lastReading === null
      ? 'First reading'
      : below
        ? `Below the last, ${lastReading.toLocaleString()} ${unit}`
        : `+${(Number(odometer) - lastReading).toLocaleString()} ${unit} since last`
    : lastReading !== null
      ? `Last ${lastReading.toLocaleString()} ${unit}`
      : 'Optional';
  const price =
    cost && Number(cost) > 0
      ? formatMoney({
          amountMinor: toMinorUnits(Number(cost), costCurrency),
          currency: costCurrency,
        })
      : null;
  const action = saved
    ? 'Close'
    : schedule
      ? `Complete ${schedule.title}`
      : `Add ${humanise(kind).toLowerCase()}${price ? ` · ${price}` : ''}`;
  const withFiles =
    !saved && files.length > 0
      ? `${action} · ${files.length} ${files.length === 1 ? 'file' : 'files'}`
      : action;

  /** Adds files once each, keeping only what can be attached. */
  const stage = (incoming: Iterable<File>) => {
    const fresh = [...incoming].filter(attachable);
    if (fresh.length === 0) return;
    setFiles((now) => [
      ...now,
      ...fresh.filter(
        (file) => !now.some((have) => have.name === file.name && have.size === file.size),
      ),
    ]);
  };
  const hasFiles = (event: DragEvent) => event.dataTransfer.types.includes('Files');

  const fillLine = (text: string) => {
    onLineChange(text);
    requestAnimationFrame(() => {
      const input = composer.current;
      if (!input) return;
      input.focus();
      input.setSelectionRange(text.length, text.length);
    });
  };

  // Every kind, in the line's own list: what this vehicle logs first, with how often, then the rest.
  const kindGroups: PickerGroup[] = [
    {
      label: 'Used on this vehicle',
      options: habits.used.map((option) => ({
        value: option,
        label: humanise(option),
        emoji: eventEmoji(option),
        aside: String(habits.counts.get(option) ?? ''),
      })),
    },
    {
      label: habits.used.length > 0 ? 'Everything else' : 'Kinds',
      options: [...new Set<EventType>([...COMMON_KINDS, ...EVENT_TYPES])]
        .filter((option) => !habits.used.includes(option))
        .map((option) => ({ value: option, label: humanise(option), emoji: eventEmoji(option) })),
    },
  ].filter((group) => group.options.length > 0);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (saved) return onDone();
        mutation.mutate();
      }}
      /*
       * Files dropped anywhere on the form are attached. The depth counts enters against leaves,
       * which fire for every child the pointer crosses.
       */
      onDragEnter={(event) => {
        if (!hasFiles(event)) return;
        dragDepth.current += 1;
        setDragging(true);
      }}
      onDragOver={(event) => {
        if (hasFiles(event)) event.preventDefault();
      }}
      onDragLeave={(event) => {
        if (!hasFiles(event)) return;
        dragDepth.current -= 1;
        if (dragDepth.current <= 0) setDragging(false);
      }}
      onDrop={(event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        stage(event.dataTransfer.files);
      }}
      className="relative flex min-h-0 flex-1 flex-col"
    >
      {dragging ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-4 inset-y-2 z-10 grid animate-pop place-items-center rounded-2xl border-2 border-dashed border-foreground/40 bg-card/85 backdrop-blur-sm"
        >
          <span className="flex flex-col items-center gap-2 text-sm font-semibold text-foreground">
            <Paperclip className="size-5" />
            Drop to attach
          </span>
        </div>
      ) : null}
      <div className="scrollbar-slim flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 pb-6 pt-1 [&>*]:shrink-0">
        <div className="flex flex-col gap-2">
          <Composer
            ref={composer}
            label={schedule ? 'Work done' : 'What happened'}
            value={line}
            onChange={onLineChange}
            tokens={parsed.tokens}
            placeholder={(schedule
              ? `${schedule.title}, €80 at Kwik Fit`
              : (EXAMPLE[kind] ?? `${humanise(kind)}, €20`)
            ).replaceAll('€', symbol)}
            lead={
              <GlyphPicker
                ariaLabel="Kind"
                groups={kindGroups}
                value={kind}
                onChange={(next) => {
                  // Choosing a kind is choosing not to complete a schedule.
                  setScheduleId(null);
                  setKind(next as EventType);
                }}
                emoji={schedule ? scheduleEmoji(schedule.title) : eventEmoji(kind)}
                label={humanise(kind)}
                auto={auto.kind}
              />
            }
            // A pasted screenshot of a receipt is attached, not typed.
            onPaste={(event) => {
              if (event.clipboardData.files.length === 0) return;
              event.preventDefault();
              stage(event.clipboardData.files);
            }}
            error={fieldErrors?.title ?? fieldErrors?.workPerformed}
          />
          {line.trim() === '' && recent.titles.length > 0 && !schedule ? (
            <Suggestions label="Again">
              {recent.titles.map((title) => (
                <Chip key={title} quiet onClick={() => fillLine(`${title} `)}>
                  {title}
                </Chip>
              ))}
            </Suggestions>
          ) : (
            <p className="px-1 text-xs text-muted-foreground">
              {line.trim() === ''
                ? 'Say it in one go — amounts, km, the day and “at” a place are picked out.'
                : parsed.title
                  ? `Saved as “${parsed.title}”`
                  : schedule
                    ? `Saved as “${schedule.title}”`
                    : `Saved as “${humanise(kind)}”`}
            </p>
          )}
        </div>

        {offered.length > 0 ? (
          <fieldset className="flex min-w-0 flex-col">
            <legend className="mb-2 flex items-center gap-2 text-label uppercase text-muted-foreground">
              Completes a schedule
              <span className="font-mono tabular-nums">
                {String(offered.length).padStart(2, '0')}
              </span>
            </legend>
            <div className="scroll-fade-x -mx-6 flex snap-x gap-2 overflow-x-auto scroll-px-6 px-6 py-0.5 [scrollbar-width:none]">
              {offered.map((item) => (
                <ScheduleCard
                  key={item.id}
                  schedule={item}
                  unit={odometerUnit}
                  selected={item.id === scheduleId}
                  named={names(line, item.title)}
                  onToggle={() => setScheduleId(item.id === scheduleId ? null : item.id)}
                />
              ))}
            </div>
            {schedule ? (
              <p className="mt-2 px-1 text-xs text-muted-foreground">
                Filed as a service on {schedule.title}; its clock starts again from this day.
              </p>
            ) : null}
          </fieldset>
        ) : null}

        {/*
         * The figures as an instrument panel. A date, a distance and a sum are what a logbook line
         * is made of, so they sit together — each filled from the line or typed here.
         */}
        <div className="grid grid-cols-1 divide-y divide-border overflow-hidden rounded-2xl bg-muted/60 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)_minmax(0,1fr)] sm:divide-x sm:divide-y-0">
          <Reading
            label="When"
            auto={auto.day}
            error={fieldErrors?.occurredAt ?? fieldErrors?.performedAt}
            note={
              <span className="flex gap-1">
                {[
                  { day: today, label: 'Today' },
                  { day: localDay({ days: -1 }), label: 'Yesterday' },
                ].map((option) => (
                  <button
                    key={option.label}
                    type="button"
                    aria-pressed={day === option.day}
                    onClick={() => setDay(option.day)}
                    className={cn(
                      'rounded-full px-2 py-0.5 font-semibold transition-colors',
                      day === option.day
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-muted-foreground hover:bg-border hover:text-foreground',
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </span>
            }
          >
            {(id) => (
              <DatePicker
                id={id}
                label="When"
                required
                max={today}
                value={day}
                onChange={setDay}
                hideIcon
                triggerClassName={READING_DATE}
              />
            )}
          </Reading>

          <Reading
            label="Odometer"
            auto={auto.odometer}
            note={readingNote}
            tone={below ? 'warning' : undefined}
            error={fieldErrors?.odometer ?? fieldErrors?.odometerUnit}
          >
            {(id, describedBy) => (
              <span className="flex items-baseline gap-1.5">
                {/*
                 * Text with a numeric keyboard, not `type="number"`, so the reading carries its
                 * separators: 42150 is a number, 42,150 is a distance. State holds digits only.
                 */}
                <input
                  id={id}
                  size={1}
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder={lastReading !== null ? lastReading.toLocaleString() : '0'}
                  aria-describedby={describedBy}
                  value={odometer ? Number(odometer).toLocaleString() : ''}
                  onChange={(event) => setOdometer(digitsOnly(event.target.value))}
                  className="min-w-0 flex-1 bg-transparent font-mono text-2xl font-semibold tabular-nums tracking-tight text-foreground outline-none placeholder:text-muted-foreground/40"
                />
                <span className="text-sm font-semibold text-muted-foreground">{unit}</span>
              </span>
            )}
          </Reading>

          <Reading
            label="Cost"
            auto={auto.cost}
            note={
              cost ? (
                'Filed as spending too'
              ) : recent.amounts.length > 0 ? (
                <span className="flex gap-1">
                  {recent.amounts.map((money) => {
                    const value = String(fromMinorUnits(money.amountMinor, money.currency));
                    return (
                      <button
                        key={`${money.amountMinor}${money.currency}`}
                        type="button"
                        onClick={() => {
                          setCost(amountOnly(value));
                          setCostCurrency(money.currency);
                        }}
                        title="Same as before"
                        className="rounded-full bg-muted px-2 py-0.5 font-mono font-semibold tabular-nums text-muted-foreground transition-colors hover:bg-border hover:text-foreground"
                      >
                        {formatMoney(money)}
                      </button>
                    );
                  })}
                </span>
              ) : (
                'Empty if it was free'
              )
            }
            error={fieldErrors?.costAmountMinor ?? fieldErrors?.costCurrency}
          >
            {(id, describedBy) => (
              <span className="flex items-baseline gap-1.5">
                <input
                  id={id}
                  size={1}
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0.00"
                  aria-describedby={describedBy}
                  value={cost}
                  onChange={(event) => setCost(amountOnly(event.target.value))}
                  className="min-w-0 flex-1 bg-transparent font-mono text-2xl font-semibold tabular-nums tracking-tight text-foreground outline-none placeholder:text-muted-foreground/40"
                />
                <span className="text-sm font-semibold text-muted-foreground">{costCurrency}</span>
              </span>
            )}
          </Reading>
        </div>

        {/* What only some entries need: opened by a tap, or by the line already saying it. */}
        {showPlace ? (
          <Extra label="Where" auto={auto.place}>
            {(id) => (
              <>
                <input
                  id={id}
                  autoComplete="off"
                  value={place}
                  maxLength={200}
                  placeholder="Kwik Fit, Shell, yourself"
                  onChange={(event) => setPlace(event.target.value)}
                  className="w-full bg-transparent text-base font-semibold text-foreground outline-none placeholder:text-muted-foreground/50"
                />
                {recent.places.length > 0 && place === '' ? (
                  <span className="mt-2 flex flex-wrap gap-1">
                    {recent.places.map((name) => (
                      <Chip key={name} quiet small onClick={() => setPlace(name)}>
                        {name}
                      </Chip>
                    ))}
                  </span>
                ) : null}
              </>
            )}
          </Extra>
        ) : null}

        {showNote ? (
          <Extra label="Note" auto={auto.note}>
            {(id) => (
              <textarea
                id={id}
                rows={2}
                value={note}
                maxLength={5000}
                placeholder="What was done, what to watch"
                onChange={(event) => setNote(event.target.value)}
                onKeyDown={(event) => {
                  // ⌘/Ctrl+Enter saves from the note, where Enter is a new line.
                  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
                className="field-sizing-content min-h-12 w-full resize-none bg-transparent text-[0.9375rem] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/50"
              />
            )}
          </Extra>
        ) : null}

        {files.length > 0 ? (
          <section
            aria-label="Attachments"
            className="flex animate-rise flex-col gap-2 rounded-2xl bg-muted/60 px-4 py-3"
          >
            <p className="flex items-center gap-2 text-label uppercase text-muted-foreground">
              Attachments
              <span className="font-mono tabular-nums">
                {String(files.length).padStart(2, '0')}
              </span>
            </p>
            <ul className="flex flex-wrap gap-2">
              {files.map((file) => (
                <StagedFile
                  key={`${file.name}-${file.size}`}
                  file={file}
                  onRemove={() => setFiles((now) => now.filter((item) => item !== file))}
                />
              ))}
              <li>
                <button
                  type="button"
                  onClick={() => picker.current?.click()}
                  aria-label="Attach more"
                  title="Attach more"
                  className="grid size-16 place-items-center rounded-xl border border-dashed border-border-strong text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <Plus className="size-4" aria-hidden="true" />
                </button>
              </li>
            </ul>
            <p className="text-xs text-muted-foreground">
              Photos join its gallery; papers are filed as{' '}
              {humanise(PAPER[kind] ?? 'RECEIPT').toLowerCase()}s.
            </p>
          </section>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {showPlace ? null : (
            <AddExtra onClick={() => setOpened((now) => ({ ...now, place: true }))}>Where</AddExtra>
          )}
          {showNote ? null : (
            <AddExtra onClick={() => setOpened((now) => ({ ...now, note: true }))}>Note</AddExtra>
          )}
          {files.length > 0 ? null : (
            <AddExtra
              icon={<Paperclip className="size-3.5" aria-hidden="true" />}
              onClick={() => picker.current?.click()}
            >
              Attach
            </AddExtra>
          )}
          <input
            ref={picker}
            type="file"
            multiple
            hidden
            accept={ATTACH_TYPES}
            onChange={(event) => {
              stage(event.target.files ?? []);
              event.target.value = '';
            }}
          />
        </div>

        {kind === 'TRIP' && !schedule ? (
          <fieldset className="flex flex-col gap-3 rounded-2xl bg-muted/60 p-4">
            <legend className="sr-only">Mileage log</legend>
            <p className="text-label uppercase text-muted-foreground">For the mileage log</p>
            <div role="group" aria-label="Trip purpose" className="flex flex-wrap gap-2">
              {TRIP_PURPOSES.map((option) => (
                <Chip
                  key={option}
                  selected={purpose === option}
                  onClick={() => setPurpose(purpose === option ? null : option)}
                >
                  {humanise(option)}
                </Chip>
              ))}
            </div>
            {purpose ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Field
                  label="Start reading"
                  inputMode="numeric"
                  value={tripStart}
                  onChange={(event) => setTripStart(event.target.value.replace(/\D/g, ''))}
                  suffix={unit}
                  hint="With the odometer above as the end."
                  error={fieldErrors?.['trip.startOdometer']}
                />
                <Field
                  label="Or distance"
                  inputMode="numeric"
                  value={tripDistance}
                  onChange={(event) => setTripDistance(event.target.value.replace(/\D/g, ''))}
                  suffix={unit}
                  error={fieldErrors?.['trip.distance']}
                />
                <Field
                  label={`Rate per ${unit}`}
                  inputMode="decimal"
                  value={tripRate}
                  onChange={(event) => setTripRate(amountOnly(event.target.value))}
                  suffix={currency}
                  hint="Kept on this trip; later rate changes do not touch it."
                  error={fieldErrors?.['trip.rateCurrency']}
                />
              </div>
            ) : null}
          </fieldset>
        ) : null}

        {saved ? (
          <div role="status" className="flex flex-col gap-1 rounded-2xl bg-warning-soft p-3.5">
            <p className="text-sm font-semibold text-foreground">Saved, with a note</p>
            {warnings.map((warning) => (
              <p key={warning} className="text-sm text-warning">
                {warning}
              </p>
            ))}
          </div>
        ) : null}

        {mutation.isError && !fieldErrors ? (
          <FormError>{(mutation.error as Error).message}</FormError>
        ) : null}
      </div>

      <Footer
        label={withFiles}
        loading={mutation.isPending}
        onCancel={onCancel}
        hideCancel={saved}
      />
    </form>
  );
}

/* ------------------------------------------------------------------------------------------- */

function PlannedForm({
  vehicleId,
  garageId,
  schedules,
  line,
  onLineChange,
  onDone,
  onCancel,
}: {
  vehicleId: string;
  garageId: string | undefined;
  schedules: readonly MaintenancePlan[];
  line: string;
  onLineChange: (line: string) => void;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { odometerUnit } = useVehicleUnits(vehicleId);
  const odometer = useQuery(vehicleQuery(api, vehicleId)).data?.currentOdometer ?? null;
  const composer = useRef<HTMLInputElement>(null);
  const jobsId = useId();
  const parsed = useMemo(() => parsePlanned(line), [line]);
  const [repeatsSet, setRepeats] = useState<boolean | null>(null);
  const [dueSet, setDue] = useState<string | null>(null);
  const [monthsSet, setMonths] = useState<string | null>(null);
  const [distanceSet, setDistance] = useState<string | null>(null);

  const repeats = repeatsSet ?? (parsed.everyMonths !== null || parsed.everyDistance !== null);
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
  const unit = unitLabel(odometerUnit);
  const bigDistance = odometerUnit === 'MI' ? 6000 : 10000;
  const glyph = scheduleEmoji(title);
  const common = jobs(unit, bigDistance);
  // What is already planned for the same job — the same name, or the same kind of work.
  const planned = (job: string) =>
    schedules.find(
      (item) =>
        item.title.toLowerCase() === job.toLowerCase() ||
        (scheduleEmoji(job) !== 'maintenance' && scheduleEmoji(item.title) === scheduleEmoji(job)),
    ) ?? null;
  const twin = title ? planned(title) : null;

  const mutation = useMutation({
    mutationFn: () =>
      savePlanned({
        vehicleId,
        garageId: garageId!,
        title,
        repeats,
        ...(everyMonths ? { everyMonths: Number(everyMonths) } : {}),
        ...(everyDistance ? { everyDistance: Number(everyDistance) } : {}),
        odometerUnit,
        ...(due ? { due } : {}),
      }),
    meta: { toast: repeats ? 'Schedule added' : 'Reminder added' },
    onSuccess: onDone,
  });

  const fieldErrors = mutation.error instanceof ApiError ? mutation.error.fields : undefined;
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
    : `Add reminder${due ? ` · ${formatDate(`${due}T12:00:00Z`)}` : ''}`;

  const fillLine = (text: string) => {
    onLineChange(text);
    requestAnimationFrame(() => {
      const input = composer.current;
      if (!input) return;
      input.focus();
      input.setSelectionRange(text.length, text.length);
    });
  };

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
      label: `12 months or ${bigDistance.toLocaleString()} ${unit}`,
      months: '12',
      distance: String(bigDistance),
    },
  ];

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        mutation.mutate();
      }}
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="scrollbar-slim flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 pb-6 pt-1 [&>*]:shrink-0">
        <div className="flex flex-col gap-2">
          <Composer
            ref={composer}
            label="What needs doing"
            value={line}
            onChange={onLineChange}
            tokens={parsed.tokens}
            placeholder={
              repeats
                ? `Rotate tyres every ${bigDistance.toLocaleString()} ${unit}`
                : 'Renew insurance on 11 Nov'
            }
            lead={
              <GlyphPicker
                ariaLabel="Common jobs"
                groups={[
                  {
                    label: 'Common jobs',
                    options: common.map((job) => ({
                      value: job.line,
                      label: job.label,
                      emoji: job.emoji,
                      aside: planned(job.label) ? 'Planned' : undefined,
                    })),
                  },
                ]}
                value=""
                onChange={fillLine}
                emoji={glyph}
                label={
                  common.find((job) => job.emoji === glyph && glyph !== 'maintenance')?.label ??
                  'Jobs'
                }
              />
            }
            error={fieldErrors?.title}
          />
          <p className="px-1 text-xs text-muted-foreground">
            {line.trim() === ''
              ? 'Pick a job below, or say it — “every 10,000 km”, “on 11 Nov”, “next month”.'
              : title
                ? `Saved as “${title}”`
                : 'Say what needs doing, then when.'}
          </p>
        </div>

        {/*
         * What first, then when. With nothing said yet the common jobs are the whole page — one
         * press writes a full line; the cadence controls arrive once there is something to time.
         */}
        {line.trim() === '' ? (
          <section aria-labelledby={jobsId} className="flex animate-rise flex-col gap-2.5">
            <h3 id={jobsId} className="px-1 text-label uppercase text-muted-foreground">
              Common jobs
            </h3>
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {common.map((job, index) => (
                <li
                  key={job.label}
                  className="stagger animate-rise"
                  style={{ '--i': index } as CSSProperties}
                >
                  <JobTile
                    job={job}
                    unit={unit}
                    planned={planned(job.label) !== null}
                    onPick={() => fillLine(job.line)}
                  />
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <>
            {/* A second schedule for the same job is usually a mistake; said, not refused. */}
            {twin && repeats ? (
              <div className="flex animate-rise items-center gap-3 rounded-2xl bg-muted/60 p-2.5 pr-3.5">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-card">
                  <Emoji name={scheduleEmoji(twin.title)} size={22} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-xs text-muted-foreground">Already planned</span>
                  <span className="block truncate text-sm font-semibold text-foreground">
                    {twin.title}
                  </span>
                </span>
                <ReminderStatus
                  tone={
                    twin.status === 'OVERDUE'
                      ? 'late'
                      : twin.status === 'DUE_SOON'
                        ? 'soon'
                        : 'later'
                  }
                >
                  {readDue(twin, odometerUnit).headline}
                </ReminderStatus>
              </div>
            ) : null}

            <CadenceSwitch repeats={repeats} auto={auto.repeats} onChange={setRepeats} />

            {repeats ? (
              <div key="repeat" className="flex animate-rise flex-col gap-3">
                <div className="flex flex-wrap gap-2">
                  {presets.map((preset) => (
                    <Chip
                      key={preset.label}
                      selected={everyMonths === preset.months && everyDistance === preset.distance}
                      onClick={() => {
                        setMonths(preset.months);
                        setDistance(preset.distance);
                      }}
                    >
                      {preset.label}
                    </Chip>
                  ))}
                </div>
                {/* Pick, then see what it does; the exact figures to fine-tune sit under it. */}
                <Forecast
                  months={everyMonths ? Number(everyMonths) : null}
                  distance={everyDistance ? Number(everyDistance) : null}
                  odometer={odometer}
                  unit={unit}
                />
                <div className="grid grid-cols-1 divide-y divide-border overflow-hidden rounded-2xl bg-muted/60 sm:grid-cols-2 sm:divide-x sm:divide-y-0">
                  <Reading
                    label="Every"
                    auto={auto.months}
                    note="By the calendar"
                    error={fieldErrors?.intervalMonths}
                  >
                    {(id, describedBy) => (
                      <span className="flex items-baseline gap-1.5">
                        <input
                          id={id}
                          size={1}
                          inputMode="numeric"
                          autoComplete="off"
                          placeholder="—"
                          aria-describedby={describedBy}
                          value={everyMonths}
                          onChange={(event) =>
                            setMonths(digitsOnly(event.target.value).slice(0, 3))
                          }
                          className="min-w-0 flex-1 bg-transparent font-mono text-2xl font-semibold tabular-nums tracking-tight text-foreground outline-none placeholder:text-muted-foreground/40"
                        />
                        <span className="text-sm font-semibold text-muted-foreground">months</span>
                      </span>
                    )}
                  </Reading>
                  <Reading
                    label="Or every"
                    auto={auto.distance}
                    note={missingInterval ? 'Set at least one interval' : 'Whichever comes first'}
                    tone={missingInterval ? 'warning' : undefined}
                    error={fieldErrors?.intervalDistance}
                  >
                    {(id, describedBy) => (
                      <span className="flex items-baseline gap-1.5">
                        <input
                          id={id}
                          size={1}
                          inputMode="numeric"
                          autoComplete="off"
                          placeholder="—"
                          aria-describedby={describedBy}
                          value={everyDistance ? Number(everyDistance).toLocaleString() : ''}
                          onChange={(event) => setDistance(digitsOnly(event.target.value))}
                          className="min-w-0 flex-1 bg-transparent font-mono text-2xl font-semibold tabular-nums tracking-tight text-foreground outline-none placeholder:text-muted-foreground/40"
                        />
                        <span className="text-sm font-semibold text-muted-foreground">{unit}</span>
                      </span>
                    )}
                  </Reading>
                </div>
              </div>
            ) : (
              <div key="once" className="flex animate-rise flex-col gap-3">
                <div className="flex flex-wrap gap-2">
                  {dueOptions.map((option) => (
                    <Chip
                      key={option.label}
                      selected={due === option.day}
                      onClick={() => setDue(option.day)}
                    >
                      {option.label}
                    </Chip>
                  ))}
                </div>
                <div className="overflow-hidden rounded-2xl bg-muted/60">
                  <Reading
                    label="Due"
                    auto={auto.due}
                    note={
                      // The trigger already says the day; the line says how far off it is.
                      due
                        ? fromToday(due).replace(/^./, (letter) => letter.toUpperCase())
                        : 'No date — it waits until done'
                    }
                    error={fieldErrors?.dueDate}
                  >
                    {(id, describedBy) => (
                      <DatePicker
                        id={id}
                        label="Due"
                        min={localDay()}
                        describedBy={describedBy}
                        value={due}
                        onChange={setDue}
                        placeholder="No date"
                        hideIcon
                        triggerClassName={READING_DATE}
                      />
                    )}
                  </Reading>
                </div>
              </div>
            )}
          </>
        )}

        {mutation.isError && !fieldErrors ? (
          <FormError>{(mutation.error as Error).message}</FormError>
        ) : null}
      </div>

      <Footer
        label={action}
        loading={mutation.isPending}
        disabled={!title || missingInterval || (!repeats && !garageId)}
        onCancel={onCancel}
      />
    </form>
  );
}

/** "1 yr", "18 mo": an interval as it reads on a tile. */
const span = (months: number) => (months % 12 === 0 ? `${months / 12} yr` : `${months} mo`);

/** A job's cadence, read from its own line by the same reader as the composer. */
function cadenceOf(line: string, unit: string): string {
  const read = parsePlanned(line);
  const parts = [
    read.everyMonths ? span(read.everyMonths) : null,
    // "20k km": a tile is narrow, and a round interval reads at a glance.
    read.everyDistance
      ? `${read.everyDistance % 1000 === 0 ? `${read.everyDistance / 1000}k` : read.everyDistance.toLocaleString()} ${unit}`
      : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'Once';
}

/** "today", "tomorrow", "in 37 days" — how far off a `YYYY-MM-DD` is, in the viewer's own days. */
function fromToday(day: string): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((new Date(`${day}T00:00:00`).getTime() - today.getTime()) / 86_400_000);
  return days <= 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`;
}

/** Calendar months on, holding the day where the month has it — 31 Jan and a month is 28 Feb. */
function monthsOn(from: Date, months: number): Date {
  const target = new Date(from.getFullYear(), from.getMonth() + months, 1);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(from.getDate(), last));
  return target;
}

/**
 * A common job as a tile: its glyph, its name, and the cadence its line sets — or that this
 * vehicle already has it planned. One press writes the whole line.
 */
function JobTile({
  job,
  unit,
  planned,
  onPick,
}: {
  job: { label: string; line: string; emoji: EmojiName };
  unit: string;
  planned: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      className="group flex w-full items-center gap-2.5 rounded-2xl bg-muted/60 p-2 pr-2.5 text-left transition-[background-color,scale] hover:bg-muted active:scale-[0.98]"
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-card shadow-[0_1px_2px_var(--color-shadow)] transition-transform duration-300 ease-out group-hover:-rotate-6 group-hover:scale-105 motion-reduce:transform-none">
        <Emoji name={job.emoji} size={22} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 text-sm font-semibold leading-tight text-foreground">
          {job.label}
        </span>
        {planned ? (
          <span className="flex items-center gap-1 text-[0.6875rem] font-semibold text-success">
            <Check className="size-3" strokeWidth={3} aria-hidden="true" />
            Planned
          </span>
        ) : (
          <span className="block truncate font-mono text-[0.6875rem] tabular-nums text-muted-foreground">
            {cadenceOf(job.line, unit)}
          </span>
        )}
      </span>
    </button>
  );
}

const CADENCES = [
  { repeats: false, label: 'Once', note: 'On a date, or whenever', icon: 'calendar' },
  { repeats: true, label: 'Repeats', note: 'By time or distance', icon: 'refresh' },
] as const satisfies readonly { repeats: boolean; label: string; note: string; icon: IconName }[];

/**
 * Once or on a repeat, as two cards that say what each means rather than two bare words. No visible
 * heading — the cards are the question — and the mark that the line chose one sits on that card.
 */
function CadenceSwitch({
  repeats,
  auto,
  onChange,
}: {
  repeats: boolean;
  auto: boolean;
  onChange: (repeats: boolean) => void;
}) {
  return (
    <fieldset className="min-w-0">
      <legend className="sr-only">When</legend>
      <div className="grid grid-cols-2 gap-2">
        {CADENCES.map((option) => {
          const selected = repeats === option.repeats;
          return (
            <button
              key={option.label}
              type="button"
              aria-pressed={selected}
              onClick={() => onChange(option.repeats)}
              className={cn(
                'flex min-w-0 items-center gap-3 rounded-2xl p-2.5 text-left transition-[background-color,box-shadow,scale] active:scale-[0.98]',
                selected
                  ? 'bg-primary-soft ring-2 ring-inset ring-primary'
                  : 'bg-muted/60 hover:bg-muted',
              )}
            >
              <span
                className={cn(
                  'grid size-9 shrink-0 place-items-center rounded-xl transition-colors',
                  selected ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground',
                )}
              >
                <Icon name={option.icon} size={18} />
              </span>
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                  {option.label}
                  {selected && auto ? <Auto /> : null}
                </span>
                {/* On a phone the card is too narrow to say it; the label carries it. */}
                <span className="hidden truncate text-xs text-muted-foreground sm:block">
                  {option.note}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

const LEAF_MONTH = new Intl.DateTimeFormat('en-US', { month: 'short' });
const SAID_MONTH = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' });

/**
 * What saving a repeat will do, drawn before it is saved: from today, the next three times it comes
 * due, as the month leaves the logbook uses with the reading under each. A new schedule counts from
 * the vehicle as it is now — today's date and its current reading — so this is the server's
 * answer, provided each one is done when it comes due. The first leaf is lit: that is the one the
 * rail will show.
 */
function Forecast({
  months,
  distance,
  odometer,
  unit,
}: {
  months: number | null;
  distance: number | null;
  odometer: number | null;
  unit: string;
}) {
  if (!months && !distance) return null;
  const today = new Date();
  const stops = [1, 2, 3].map((step) => ({
    step,
    date: months ? monthsOn(today, months * step) : null,
    // With no reading yet the distance can only be said as how far on.
    reading: distance
      ? odometer !== null
        ? `${(odometer + distance * step).toLocaleString()} ${unit}`
        : `+${(distance * step).toLocaleString()} ${unit}`
      : null,
  }));

  return (
    <section
      aria-label="When it comes due"
      className="animate-rise rounded-2xl bg-muted px-4 pb-3.5 pt-3"
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-label uppercase text-muted-foreground">Comes due</h3>
        <span className="text-xs text-muted-foreground">If done on time</span>
      </div>
      <ol className="relative mt-3 grid grid-cols-4 gap-1">
        {/* The road between the stops, behind them. */}
        <span
          aria-hidden="true"
          className="absolute inset-x-[12.5%] top-5 border-t-2 border-dashed border-border-strong"
        />
        <li className="relative flex flex-col items-center gap-1.5 text-center">
          <span aria-hidden="true" className="grid h-10 place-items-center">
            <span className="size-3.5 rounded-full border-[3px] border-foreground bg-muted ring-4 ring-muted" />
          </span>
          <span className="text-[0.6875rem] font-semibold text-foreground">Today</span>
          {distance && odometer !== null ? (
            <span className="font-mono text-[0.6875rem] tabular-nums text-muted-foreground">
              {odometer.toLocaleString()}
            </span>
          ) : null}
        </li>
        {stops.map((stop) => (
          <li
            key={stop.step}
            className="relative flex min-w-0 flex-col items-center gap-1.5 text-center"
          >
            <span className="sr-only">
              {[stop.date ? SAID_MONTH.format(stop.date) : null, stop.reading]
                .filter(Boolean)
                .join(' or ')}
            </span>
            {stop.date ? (
              <span
                aria-hidden="true"
                className="flex w-12 flex-col overflow-hidden rounded-xl bg-card text-center ring-1 ring-border"
              >
                <span
                  className={cn(
                    'text-[0.625rem] font-bold uppercase leading-4 tracking-wider',
                    stop.step === 1
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-border text-muted-foreground',
                  )}
                >
                  {LEAF_MONTH.format(stop.date)}
                </span>
                <span className="py-0.5 font-mono text-xs font-semibold leading-5 tabular-nums text-foreground">
                  {stop.date.getFullYear()}
                </span>
              </span>
            ) : (
              <span
                aria-hidden="true"
                className={cn(
                  'grid h-10 place-items-center rounded-xl px-2 ring-1',
                  stop.step === 1
                    ? 'bg-primary text-primary-foreground ring-primary'
                    : 'bg-card text-foreground ring-border',
                )}
              >
                <Icon name="odometer" size={18} />
              </span>
            )}
            {stop.reading ? (
              <span
                aria-hidden="true"
                className="max-w-full truncate font-mono text-[0.6875rem] tabular-nums text-muted-foreground"
              >
                {stop.reading}
              </span>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}

/* ------------------------------------------------------------------------------------------- */

/**
 * The line. Large, on its own surface, led by what it will save — a list in the line itself, its
 * glyph changing as the words do. What the reader picked out is marked in place: a pill behind each
 * figure, date or place taken into a field, a dotted underline under a word that set the kind.
 *
 * The marks are a copy of the text laid exactly behind the input — same face, size and spacing,
 * the copy's own letters transparent — kept scrolled with it.
 */
function Composer({
  ref,
  label,
  value,
  onChange,
  tokens,
  placeholder,
  lead,
  onPaste,
  error,
}: {
  ref: Ref<HTMLInputElement>;
  label: string;
  value: string;
  onChange: (value: string) => void;
  tokens: readonly Token[];
  placeholder: string;
  /** What leads the line: the picker of what it is. */
  lead: ReactNode;
  onPaste?: (event: ClipboardEvent<HTMLInputElement>) => void;
  error?: string;
}) {
  const id = useId();
  const mirror = useRef<HTMLDivElement>(null);
  const sync = (input: HTMLInputElement) => {
    if (mirror.current) mirror.current.scrollLeft = input.scrollLeft;
  };

  const pieces: ReactNode[] = [];
  let at = 0;
  for (const token of tokens) {
    if (token.start > at) pieces.push(value.slice(at, token.start));
    pieces.push(
      <mark
        key={token.start}
        className={cn(
          'rounded-md text-transparent',
          token.kind === 'kind'
            ? 'bg-transparent underline decoration-muted-foreground decoration-dotted decoration-2 underline-offset-[6px]'
            : 'bg-border shadow-[0_0_0_3px_var(--color-border)]',
        )}
      >
        {value.slice(token.start, token.end)}
      </mark>,
    );
    at = token.end;
  }
  pieces.push(value.slice(at));

  const TYPE = 'text-lg font-semibold leading-[3rem] tracking-tight sm:text-xl';

  return (
    <div className="flex flex-col gap-1.5">
      <div
        className={cn(
          'flex items-center gap-3 rounded-2xl bg-muted/60 p-2 pr-4 transition-colors focus-within:bg-muted',
          error && 'ring-2 ring-inset ring-destructive',
        )}
      >
        {lead}
        <div className="relative min-w-0 flex-1">
          <label htmlFor={id} className="sr-only">
            {label}
          </label>
          <div
            ref={mirror}
            aria-hidden="true"
            className={cn(
              'pointer-events-none absolute inset-0 overflow-hidden whitespace-pre text-transparent',
              TYPE,
            )}
          >
            {pieces}
          </div>
          <input
            ref={ref}
            id={id}
            size={1}
            autoComplete="off"
            spellCheck={false}
            value={value}
            maxLength={200}
            placeholder={placeholder}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-error` : undefined}
            onChange={(event) => {
              onChange(event.target.value);
              sync(event.target);
            }}
            onPaste={onPaste}
            onScroll={(event) => sync(event.currentTarget)}
            onKeyUp={(event) => sync(event.currentTarget)}
            onClick={(event) => sync(event.currentTarget)}
            className={cn(
              'relative block h-12 w-full bg-transparent text-foreground outline-none placeholder:text-muted-foreground/50',
              TYPE,
            )}
          />
        </div>
      </div>
      {error ? (
        <p id={`${id}-error`} className="px-1 text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Marks a value the line supplied rather than a hand — so it is clear where it came from. */
function Auto() {
  return (
    <span title="Read from what you typed" className="inline-flex text-foreground">
      <Sparkles className="size-3" aria-hidden="true" />
      <span className="sr-only">, read from what you typed</span>
    </span>
  );
}

function Suggestions({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="shrink-0 pl-1 text-label uppercase text-muted-foreground">{label}</span>
      <div className="scroll-fade-x -mr-6 flex min-w-0 gap-1.5 overflow-x-auto pr-6 py-0.5 [scrollbar-width:none]">
        {children}
      </div>
    </div>
  );
}

/** A date picker's trigger set as a reading's figure: no field of its own, the cell is the field. */
const READING_DATE =
  'h-auto bg-transparent px-0 font-mono text-base font-semibold tabular-nums hover:bg-transparent aria-expanded:bg-transparent focus-visible:outline-none';

/** One cell of an instrument panel: eyebrow, the figure being typed, and a live line under it. */
function Reading({
  label,
  note,
  tone,
  auto = false,
  error,
  children,
}: {
  label: string;
  note: ReactNode;
  tone?: 'warning';
  auto?: boolean;
  error?: string;
  children: (id: string, describedBy: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div
      className={cn(
        'flex min-w-0 flex-col gap-1 px-4 py-3 transition-colors focus-within:bg-muted',
        error && 'ring-2 ring-inset ring-destructive',
      )}
    >
      <label
        htmlFor={id}
        className="flex items-center gap-1.5 text-label uppercase text-muted-foreground"
      >
        {label}
        {auto ? <Auto /> : null}
      </label>
      {children(id, `${id}-note`)}
      <div
        id={`${id}-note`}
        aria-live="polite"
        className={cn(
          'min-h-5 truncate text-xs',
          error
            ? 'text-destructive'
            : tone === 'warning'
              ? 'text-foreground'
              : 'text-muted-foreground',
        )}
      >
        {/* A dot carries the warning: amber text is only contrast-tested on its own soft tint. */}
        {tone === 'warning' && !error ? (
          <span
            aria-hidden="true"
            className="mr-1.5 inline-block size-1.5 rounded-full bg-warning align-middle"
          />
        ) : null}
        {error ?? note}
      </div>
    </div>
  );
}

/** A field only some entries need, on the same surface as the panel. */
function Extra({
  label,
  auto,
  children,
}: {
  label: string;
  auto: boolean;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className="flex animate-rise flex-col gap-1 rounded-2xl bg-muted/60 px-4 py-3 transition-colors focus-within:bg-muted">
      <label
        htmlFor={id}
        className="flex items-center gap-1.5 text-label uppercase text-muted-foreground"
      >
        {label}
        {auto ? <Auto /> : null}
      </label>
      {children(id)}
    </div>
  );
}

function AddExtra({
  onClick,
  icon,
  children,
}: {
  onClick: () => void;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-9 items-center gap-1.5 rounded-full border border-dashed border-border-strong px-3.5 text-sm font-semibold text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
    >
      {icon ?? <Plus className="size-3.5" aria-hidden="true" />}
      {children}
    </button>
  );
}

function Chip({
  selected = false,
  quiet = false,
  small = false,
  onClick,
  children,
}: {
  selected?: boolean;
  /** A suggestion rather than a choice: lighter, and never pressed. */
  quiet?: boolean;
  small?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={quiet ? undefined : selected}
      onClick={onClick}
      className={cn(
        'inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full font-semibold transition-[background-color,color,scale] active:scale-[0.97]',
        small ? 'h-7 px-2.5 text-xs' : quiet ? 'h-8 px-3 text-xs' : 'h-9 px-3.5 text-sm',
        selected
          ? 'bg-primary text-primary-foreground'
          : quiet
            ? 'bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground'
            : 'bg-muted text-muted-foreground hover:bg-border hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}

function Footer({
  label,
  loading,
  disabled = false,
  onCancel,
  hideCancel = false,
}: {
  label: string;
  loading: boolean;
  disabled?: boolean;
  onCancel: () => void;
  hideCancel?: boolean;
}) {
  return (
    <div className={MODAL_BAR}>
      <span className="mr-auto hidden items-center gap-1.5 text-xs text-muted-foreground sm:inline-flex">
        <kbd className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[0.6875rem] font-semibold text-foreground">
          Enter
        </kbd>
        to save
      </span>
      {hideCancel ? null : (
        <Button variant="ghost" onClick={onCancel} disabled={loading}>
          Cancel
        </Button>
      )}
      <Button
        type="submit"
        variant="primary"
        loading={loading}
        disabled={disabled}
        className="max-w-[16rem] sm:max-w-none"
      >
        <span className="truncate">{label}</span>
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------- */

interface PickerOption {
  value: string;
  label: string;
  emoji: EmojiName;
  /** Set at the right of the row: how often it is used, or that it is already planned. */
  aside?: string;
}

interface PickerGroup {
  label: string;
  options: readonly PickerOption[];
}

/**
 * A choice made from inside the line: the glyph that leads it is the trigger, and the list opens
 * under it — every option, grouped, each with its glyph. A native popover like `Select`'s, so it
 * sits above the dialog, light dismiss and Escape close only the list, and focus stays on the
 * trigger while the arrows, Home, End and typed letters move through it.
 */
function GlyphPicker({
  groups,
  value,
  onChange,
  ariaLabel,
  emoji,
  label,
  auto = false,
}: {
  groups: readonly PickerGroup[];
  /** The chosen option; '' when the list offers starting points rather than a value. */
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  emoji: EmojiName;
  /** Said beside the glyph from `sm`, and always to a screen reader. */
  label: string;
  /** The line chose it, not a hand. */
  auto?: boolean;
}) {
  const baseId = useId();
  const listId = `${baseId}-list`;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const openAtPointerDown = useRef(false);
  const typed = useRef({ query: '', at: 0 });

  const options = groups.flatMap((group) => group.options);
  const none = options.map(() => false);
  const selectedIndex = options.findIndex((option) => option.value === value);

  const show = (index: number) => {
    setActive(index);
    setOpen(true);
  };
  const choose = (index: number) => {
    const option = options[index];
    if (!option) return;
    onChange(option.value);
    setOpen(false);
    triggerRef.current?.focus({ preventScroll: true });
  };

  useLayoutEffect(() => {
    const list = listRef.current;
    const trigger = triggerRef.current;
    if (!list || !trigger) return;
    if (!open) {
      if (list.matches(':popover-open')) list.hidePopover();
      return;
    }
    if (!list.matches(':popover-open')) list.showPopover();
    const place = () => {
      const spot = placeList(
        trigger.getBoundingClientRect(),
        { height: list.scrollHeight, width: list.offsetWidth },
        { width: window.innerWidth, height: window.innerHeight },
      );
      list.style.top = `${spot.top}px`;
      list.style.left = `${spot.left}px`;
      list.style.maxHeight = `${spot.maxHeight}px`;
      list.style.transformOrigin = spot.up ? 'bottom left' : 'top left';
    };
    const onScroll = (event: Event) => {
      if (!list.contains(event.target as Node)) place();
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const onToggle = (event: Event) => {
      if ((event as ToggleEvent).newState === 'closed') setOpen(false);
    };
    list.addEventListener('toggle', onToggle);
    return () => list.removeEventListener('toggle', onToggle);
  }, []);

  useLayoutEffect(() => {
    if (!open || active < 0) return;
    document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [open, active, listId]);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const { key } = event;
    if (!open) {
      if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Enter' || key === ' ') {
        event.preventDefault();
        show(selectedIndex >= 0 ? selectedIndex : 0);
      }
      return;
    }
    switch (key) {
      case 'ArrowDown':
      case 'ArrowUp':
        event.preventDefault();
        setActive((current) => nextEnabled(none, current, key === 'ArrowDown' ? 1 : -1));
        return;
      case 'Home':
      case 'End':
        event.preventDefault();
        setActive(nextEnabled(none, -1, key === 'Home' ? 1 : -1));
        return;
      case 'Enter':
      case ' ':
        event.preventDefault();
        choose(active);
        return;
      case 'Tab':
        setOpen(false);
        return;
    }
    if (key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) return;
    const recent = event.timeStamp - typed.current.at < 500;
    typed.current = { query: recent ? typed.current.query + key : key, at: event.timeStamp };
    const match = matchTypeahead(
      options.map((option) => option.label),
      none,
      typed.current.query,
      active,
    );
    if (match >= 0) setActive(match);
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
        aria-label={`${ariaLabel}: ${label}${auto ? ', read from what you typed' : ''}`}
        onPointerDown={() => {
          openAtPointerDown.current = listRef.current?.matches(':popover-open') ?? false;
        }}
        onClick={() => {
          if (openAtPointerDown.current || open) {
            openAtPointerDown.current = false;
            setOpen(false);
            return;
          }
          show(selectedIndex >= 0 ? selectedIndex : 0);
        }}
        onKeyDown={onKeyDown}
        className="group relative flex h-12 shrink-0 items-center gap-2 rounded-xl bg-card pl-2.5 pr-2 text-sm font-semibold text-foreground transition-[background-color,scale] hover:bg-border active:scale-[0.97] aria-expanded:bg-border"
      >
        <span key={emoji} className="grid animate-pop place-items-center">
          <Emoji name={emoji} size={26} />
        </span>
        <span className="hidden max-w-[7.5rem] truncate sm:inline">{label}</span>
        <ChevronDown
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-aria-expanded:rotate-180"
        />
        {auto ? (
          <span
            aria-hidden="true"
            className="absolute -right-1 -top-1 grid size-4 place-items-center rounded-full bg-foreground text-background"
          >
            <Sparkles className="size-2.5" />
          </span>
        ) : null}
      </button>

      <div
        ref={listRef}
        id={listId}
        role="listbox"
        popover="auto"
        aria-label={ariaLabel}
        onMouseDown={(event) => event.preventDefault()}
        className="scrollbar-slim m-0 w-72 max-w-[calc(100vw-1rem)] animate-pop overflow-y-auto overscroll-contain rounded-2xl border-0 bg-popover p-1.5 text-foreground shadow-float [inset:auto]"
      >
        {open
          ? groups.map((group) => (
              <div key={group.label} role="group" aria-label={group.label}>
                <div
                  aria-hidden="true"
                  className="px-2.5 pb-1 pt-2.5 text-label uppercase text-muted-foreground"
                >
                  {group.label}
                </div>
                {group.options.map((option) => {
                  const index = options.indexOf(option);
                  const selected = index === selectedIndex;
                  return (
                    <div
                      key={option.value}
                      id={`${listId}-${index}`}
                      role="option"
                      aria-selected={selected}
                      onPointerMove={() => {
                        if (index !== active) setActive(index);
                      }}
                      onClick={() => choose(index)}
                      className={cn(
                        'flex cursor-pointer items-center gap-3 rounded-xl px-2.5 py-2 text-sm transition-colors',
                        index === active ? 'bg-muted text-foreground' : 'text-muted-foreground',
                        selected && 'font-semibold text-foreground',
                      )}
                    >
                      <Emoji name={option.emoji} size={20} />
                      <span className="min-w-0 flex-1 truncate">{option.label}</span>
                      {option.aside ? (
                        <span className="font-mono text-xs tabular-nums text-muted-foreground">
                          {option.aside}
                        </span>
                      ) : null}
                      {selected ? <Check aria-hidden="true" className="size-4 shrink-0" /> : null}
                    </div>
                  );
                })}
              </div>
            ))
          : null}
      </div>
    </>
  );
}

/**
 * A schedule offered to complete: its job's glyph, its name, and how close it is on its own status
 * tint — the same reading its card on the rail gives — with a check that fills when chosen.
 */
function ScheduleCard({
  schedule,
  unit,
  selected,
  named,
  onToggle,
}: {
  schedule: MaintenancePlan;
  unit: DistanceUnit;
  selected: boolean;
  /** The line names it — why it is first. */
  named: boolean;
  onToggle: () => void;
}) {
  const due = readDue(schedule, unit);
  const tone =
    schedule.status === 'OVERDUE' ? 'late' : schedule.status === 'DUE_SOON' ? 'soon' : 'later';
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onToggle}
      className={cn(
        'flex w-64 shrink-0 snap-start items-center gap-3 rounded-2xl p-2.5 pr-3 text-left transition-[background-color,box-shadow,scale] active:scale-[0.98]',
        selected
          ? 'bg-primary-soft ring-2 ring-inset ring-foreground'
          : 'bg-muted/60 hover:bg-muted',
      )}
    >
      <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-card">
        <Emoji name={scheduleEmoji(schedule.title)} size={24} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col items-start gap-1">
        <span className="flex w-full min-w-0 items-center gap-1.5">
          <span className="truncate text-sm font-semibold text-foreground">{schedule.title}</span>
          {named ? <Auto /> : null}
        </span>
        <ReminderStatus tone={tone}>{due.headline}</ReminderStatus>
      </span>
      <span
        aria-hidden="true"
        className={cn(
          'grid size-6 shrink-0 place-items-center rounded-full transition-colors',
          selected ? 'bg-primary text-primary-foreground' : 'ring-1 ring-inset ring-border-strong',
        )}
      >
        {selected ? <Check className="size-3.5" strokeWidth={3} /> : null}
      </span>
    </button>
  );
}

/** A file waiting to go up with the entry: its picture, or its type, and the way to drop it. */
function StagedFile({ file, onRemove }: { file: File; onRemove: () => void }) {
  const image = isImage(file);
  const [url, setUrl] = useState<string | null>(null);
  // A HEIC the browser cannot draw falls back to the file tile rather than a broken image.
  const [broken, setBroken] = useState(false);
  useEffect(() => {
    if (!image) return;
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file, image]);
  const extension = file.name.includes('.') ? file.name.split('.').at(-1)! : '';

  return (
    <li className="group relative size-16 shrink-0 animate-pop overflow-hidden rounded-xl bg-card">
      {image && url && !broken ? (
        <img
          src={url}
          alt={file.name}
          onError={() => setBroken(true)}
          className="absolute inset-0 size-full object-cover"
        />
      ) : (
        <span className="flex size-full flex-col items-center justify-center gap-1 text-muted-foreground">
          <Icon name="document" size={20} />
          <span className="max-w-14 truncate font-mono text-[0.625rem] font-semibold uppercase tracking-wider">
            {extension}
          </span>
          <span className="sr-only">{file.name}</span>
        </span>
      )}
      <button
        type="button"
        aria-label={`Remove ${file.name}`}
        title="Remove"
        onClick={onRemove}
        className="absolute right-1 top-1 grid size-5 place-items-center rounded-full bg-background/85 text-foreground opacity-0 shadow-float backdrop-blur transition-opacity focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
      >
        <X className="size-3" aria-hidden="true" />
      </button>
    </li>
  );
}

/** Reminders people set, ready-made: picking one writes the whole line in its own grammar. */
function jobs(unit: string, big: number) {
  const km = (times: number) => `${(big * times).toLocaleString()} ${unit}`;
  return [
    { label: 'Oil change', line: `Oil change every 12 months or ${km(1)}` },
    { label: 'Tyre rotation', line: `Rotate tyres every ${km(1)}` },
    { label: 'Brake check', line: 'Brake check every 12 months' },
    { label: 'Air filter', line: `Air filter every 24 months or ${km(2)}` },
    { label: 'Spark plugs', line: `Spark plugs every 36 months or ${km(4)}` },
    { label: 'Coolant', line: 'Coolant every 24 months' },
    { label: 'Battery check', line: 'Battery check every 12 months' },
    { label: 'Timing belt', line: `Timing belt every 60 months or ${km(10)}` },
    { label: 'Annual inspection', line: 'Annual inspection yearly' },
    { label: 'Full valet', line: 'Full valet every 3 months' },
    { label: 'Insurance renewal', line: 'Renew insurance in a year' },
    { label: 'Registration', line: 'Renew registration in a year' },
  ].map((job) => ({ ...job, emoji: scheduleEmoji(job.label) }));
}
