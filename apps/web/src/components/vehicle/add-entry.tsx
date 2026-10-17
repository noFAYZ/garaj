'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { Camera, Check, MapPin, Paperclip, Sparkles, X } from 'lucide-react';
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ClipboardEvent,
  type DragEvent,
  type ReactNode,
  type Ref,
} from 'react';
import {
  EVENT_TYPES,
  TRIP_PURPOSES,
  isKnownCurrency,
  minorUnitExponent,
  type EventType,
  type TripPurpose,
} from '@vehicle-os/domain';
import type { EntryDraft, MaintenancePlan } from '@vehicle-os/contracts';
import { activityQuery, vehicleQuery } from '@vehicle-os/api-client/react';
import { ApiError } from '@vehicle-os/api-client';
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
  type Token,
} from '@vehicle-os/ui';
import { api } from '@/lib/api';
import { toAttachment } from '@/lib/ai-files';
import { DatePicker } from '@/components/ui/date-picker';
import { Emoji } from '@/components/emoji';
import { Icon, type IconName } from '@/components/icons';
import { isImage } from '@/components/onboard-uploads';
import { FormError, Modal, MODAL_BAR } from '@/components/ui/modal';
import { Button } from '@/components/ui/primitives';
import { REMINDER_TONE, ReminderStatus, scheduleEmoji } from '@/components/vehicle/schedule-row';
import { readDue } from '@/lib/due';
import { eventEmoji } from '@/lib/event-emoji';
import { formatDate, formatMoney, humanise, toMinorUnits } from '@/lib/format';
import { ATTACH_TYPES, attachable, attachFiles, saveDone, savePlanned } from '@/lib/save-entry';
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
 * The one way to add anything to a vehicle's activity — the phone's form, in a dialog, asking the
 * same few things in the same order with the same words (`@vehicle-os/ui`'s `add-forms`).
 *
 * Done: what kind, one line, the figures, the facts around it, the receipt.
 * - **Say it once.** "Filled up 40 L, €62 at Shell, 52,900 km" is read as it is typed: the kind,
 *   the litres, the cost, the place and the reading land where they go, marked ✦. A field set by
 *   hand always wins, the line next, the receipt last — so a receipt only fills what is empty.
 * - **Recognise, don't recall.** Every kind is a chip, the ones this vehicle logs first; a schedule
 *   that is due, or that the line names, is offered to complete.
 * - **Default, don't ask.** The day is today, a chip away from any other; the title may be left out.
 * - **Say what will happen.** The button names what it will save — "Add fuel · €62.40".
 *
 * Reminder: the job, as a chip or a line, then once or on a repeat. The line carries across the
 * switch, so starting in the wrong one costs nothing; the dialog holds one size, so it never moves.
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

const unitLabel = (unit: string) => (unit === 'MI' ? 'mi' : 'km');

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

/** Where reading the receipt stands; the file it is reading, so removing that file undoes it. */
type Scan =
  | { readonly state: 'reading'; readonly file: File }
  | { readonly state: 'read'; readonly file: File; readonly draft: EntryDraft }
  | { readonly state: 'nothing' | 'failed'; readonly file: File };

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
  const logged = useQuery(activityQuery(api, vehicleId)).data?.done.data;
  /*
   * The kinds in the order this vehicle uses them, settled once its record arrives: a refetch
   * while the dialog is open must not reshuffle the chips under the pointer.
   */
  const [ranked, setRanked] = useState<EventType[] | null>(null);
  if (ranked === null && logged) setRanked(rankKinds(EVENT_TYPES, logged));
  const kinds = ranked ?? rankKinds(EVENT_TYPES, []);
  const composer = useRef<HTMLInputElement>(null);
  const parsed = useMemo(() => parseDone(line, { lastReading }), [line, lastReading]);

  // Set by hand; `null` is "not touched", and then the line, the receipt, the default decide.
  const [kindSet, setKind] = useState<EventType | null>(null);
  const [scheduleId, setScheduleId] = useState<string | null>(null);
  const [daySet, setDay] = useState<string | null>(null);
  const [odometerSet, setOdometer] = useState<string | null>(null);
  const [costSet, setCost] = useState<string | null>(null);
  const [quantitySet, setQuantity] = useState<string | null>(null);
  // '' once its chip is dropped: neither the line nor the receipt says it any more.
  const [placeSet, setPlace] = useState<string | null>(null);
  // Mileage-log detail, only asked for on a trip.
  const [purpose, setPurpose] = useState<TripPurpose | null>(null);
  const [distanceSet, setDistance] = useState<string | null>(null);
  const [rate, setRate] = useState('');
  // Files to go up with the entry once it exists: photos to its gallery, papers to its documents.
  const [files, setFiles] = useState<File[]>([]);
  const [scan, setScan] = useState<Scan | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const picker = useRef<HTMLInputElement>(null);
  // Each read is numbered, so only the newest one fills anything.
  const asked = useRef(0);

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
  /*
   * The amount is saved in the currency it was written in: "€62" is euros whatever the vehicle
   * counts in, and so is a receipt printed in euros. Typed by hand, it is the vehicle's own.
   */
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
  // Filled for the person — by the line or the receipt — and untouched since.
  const auto = {
    kind: !schedule && kindSet === null && parsed.kind !== null,
    odometer: odometerSet === null && odometer !== '',
    cost: costSet === null && cost !== '',
    quantity: quantitySet === null && quantity !== '',
    place: placeSet === null && place !== '',
    day: daySet === null && day !== today,
  };
  const unit = unitLabel(odometerUnit);
  const symbol = symbolOf(currency);
  const trip = kind === 'TRIP' && !schedule;
  // A trip's distance, measured from the last reading when the line gives the new one.
  const measured =
    odometer && lastReading !== null && Number(odometer) > lastReading
      ? String(Number(odometer) - lastReading)
      : '';
  const distance = distanceSet ?? measured;
  // A purpose puts the trip in the mileage log, and the log needs how far: asked, not dropped.
  const tripShort = trip && purpose !== null && !distance;

  /*
   * The schedules worth offering: what the line names, and to work on the vehicle what is due —
   * to a service, all of them. Completing one restarts its clock, so it is offered, never chosen.
   */
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
    .toSorted((a, b) => Number(names(line, b.title)) - Number(names(line, a.title)));

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

  /** The receipt, read into whatever is still empty. */
  const read = async (file: File) => {
    const ticket = ++asked.current;
    setScan({ state: 'reading', file });
    try {
      const attachment = await toAttachment(file);
      if (!attachment) {
        if (ticket === asked.current) setScan(null);
        return;
      }
      const draft = await api.ai.draftEntry({
        kind: photoRead(kind).draft,
        currency,
        unit: odometerUnit,
        attachments: [attachment],
      });
      if (ticket !== asked.current) return;
      const found = [draft.amount, draft.litres, draft.provider, draft.date, draft.odometer];
      setScan(
        found.some((value) => value !== undefined) || draft.note
          ? { state: 'read', file, draft }
          : { state: 'nothing', file },
      );
    } catch {
      // Offline, reading off, the provider down: the file is attached all the same.
      if (ticket === asked.current) setScan({ state: 'failed', file });
    }
  };

  /** Adds files once each, keeping only what can be attached; a new photo or PDF is read. */
  const stage = (incoming: Iterable<File>) => {
    const fresh = [...incoming]
      .filter(attachable)
      .filter((file) => !files.some((have) => have.name === file.name && have.size === file.size));
    if (fresh.length === 0) return;
    setFiles((now) => [...now, ...fresh]);
    const readable = fresh.find((file) => isImage(file) || file.type === 'application/pdf');
    if (readable) void read(readable);
  };
  const unstage = (file: File) => {
    setFiles((now) => now.filter((item) => item !== file));
    if (scan?.file === file) {
      asked.current += 1;
      setScan(null);
    }
  };
  const hasFiles = (event: DragEvent) => event.dataTransfer.types.includes('Files');

  const mutation = useMutation({
    mutationFn: async (): Promise<string[]> => {
      // The chosen day at the current time of day, so it sorts among the day's other entries.
      const when = stampForDay(day);
      const reading =
        odometer && asksOdometer(kind) ? { odometer: Number(odometer), odometerUnit } : {};
      // A human amount in; minor units out — 25 JPY is 25, 25 USD is 2500.
      const amount =
        cost && Number(cost) > 0 ? toMinorUnits(Number(cost), costCurrency) : undefined;
      const where = place.trim();
      // The measured amount leads the note, where the logbook reads it back (`fillQuantity`).
      const note = measure && quantity ? `${quantity} ${quantityIn}` : '';
      // A read still on its way has nothing left to fill: what is on screen is the entry now.
      asked.current += 1;

      if (schedule) {
        /*
         * Completing a repeating item: one request writes the service record, this activity item
         * and — with a cost — the spending, and restarts the schedule's clock. The entry takes
         * the schedule's name; what was typed is the work done.
         */
        const done = await api.maintenance.complete(vehicleId, schedule.id, {
          performedAt: when,
          ...(title ? { workPerformed: title } : {}),
          ...(where ? { provider: where } : {}),
          ...reading,
          ...(amount !== undefined ? { laborCostAmountMinor: amount, costCurrency } : {}),
        });
        return attachFiles(vehicleId, done.record.eventId, files, 'MAINTENANCE');
      }

      const saved = await saveDone({
        vehicleId,
        kind,
        title,
        when,
        ...('odometer' in reading ? { odometer: reading.odometer } : {}),
        odometerUnit,
        ...(amount !== undefined ? { amountMinor: amount } : {}),
        currency: costCurrency,
        place: where,
        note,
        // A purpose is what makes a trip part of the mileage log; without one it is just a note.
        ...(trip && purpose && distance
          ? {
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
      });
      return [...saved.warnings, ...(await attachFiles(vehicleId, saved.eventId, files, kind))];
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
  // Nothing said, typed or attached: there is no entry yet, only its kind.
  const empty =
    !line.trim() && !odometer && !cost && !quantity && !files.length && !schedule && !title;
  const action = saved
    ? 'Close'
    : schedule
      ? `Complete ${schedule.title}`
      : `Add ${humanise(kind).toLowerCase()}${price ? ` · ${price}` : ''}`;

  const fillLine = (text: string) => {
    onLineChange(text);
    requestAnimationFrame(() => {
      const input = composer.current;
      if (!input) return;
      input.focus();
      input.setSelectionRange(text.length, text.length);
    });
  };

  // The figures a logbook line is made of, as one panel: only the ones this kind takes.
  const cells: ReactNode[] = [];
  if (asksOdometer(kind)) {
    cells.push(
      <Reading
        key="odometer"
        wide
        label="Odometer"
        auto={auto.odometer}
        note={readingNote}
        tone={below ? 'warning' : undefined}
        error={fieldErrors?.odometer ?? fieldErrors?.odometerUnit}
      >
        {(id, describedBy) => (
          <FigureInput
            id={id}
            describedBy={describedBy}
            unit={unit}
            value={odometer ? Number(odometer).toLocaleString() : ''}
            placeholder={lastReading !== null ? lastReading.toLocaleString() : '0'}
            onChange={(text) => setOdometer(digitsOnly(text))}
          />
        )}
      </Reading>,
    );
  }
  cells.push(
    <Reading
      key="cost"
      wide={!measure}
      label={costLabel(kind)}
      auto={auto.cost}
      note={cost ? 'Filed as spending too' : 'Empty if it was free'}
      error={fieldErrors?.costAmountMinor ?? fieldErrors?.costCurrency}
    >
      {(id, describedBy) => (
        <FigureInput
          id={id}
          describedBy={describedBy}
          unit={costCurrency}
          decimal
          value={cost}
          placeholder="0.00"
          onChange={(text) => setCost(amountOnly(text))}
        />
      )}
    </Reading>,
  );
  if (measure) {
    cells.push(
      <Reading
        key="quantity"
        label={measure === 'L' ? 'Fuel' : 'Energy'}
        auto={auto.quantity}
        note={measure === 'L' ? 'For the economy figures' : 'For the cost per kWh'}
      >
        {(id, describedBy) => (
          <FigureInput
            id={id}
            describedBy={describedBy}
            unit={quantityIn}
            decimal
            value={quantity}
            placeholder="0.0"
            onChange={(text) => setQuantity(amountOnly(text))}
          />
        )}
      </Reading>,
    );
  }
  if (trip && purpose) {
    cells.push(
      <Reading
        key="distance"
        label="Distance"
        auto={distanceSet === null && measured !== ''}
        note={
          tripShort
            ? 'Needed for the mileage log'
            : distanceSet === null && measured
              ? 'From the last reading'
              : 'Or give the odometer'
        }
        tone={tripShort ? 'warning' : undefined}
        error={fieldErrors?.['trip.distance'] ?? fieldErrors?.['trip.startOdometer']}
      >
        {(id, describedBy) => (
          <FigureInput
            id={id}
            describedBy={describedBy}
            unit={unit}
            value={distance ? Number(distance).toLocaleString() : ''}
            placeholder="0"
            onChange={(text) => setDistance(digitsOnly(text))}
          />
        )}
      </Reading>,
      <Reading
        key="rate"
        label={`Rate per ${unit}`}
        note="Kept on this trip"
        error={fieldErrors?.['trip.rateCurrency']}
      >
        {(id, describedBy) => (
          <FigureInput
            id={id}
            describedBy={describedBy}
            unit={currency}
            decimal
            value={rate}
            placeholder="0.00"
            onChange={(text) => setRate(amountOnly(text))}
          />
        )}
      </Reading>,
    );
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (saved) return onDone();
        if (!empty && !tripShort) mutation.mutate();
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
            Drop to attach — a receipt is read
          </span>
        </div>
      ) : null}
      <div className="scrollbar-slim flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 pb-6 pt-1 [&>*]:shrink-0">
        <Rail label="Kind">
          {kinds.map((option) => (
            <Chip
              key={option}
              selected={option === kind}
              disabled={schedule !== null && option !== kind}
              onClick={() => {
                // Choosing a kind is choosing not to complete a schedule.
                setScheduleId(null);
                setKind(option);
              }}
              lead={<Emoji name={eventEmoji(option)} size={18} />}
              auto={option === kind && auto.kind}
            >
              {humanise(option)}
            </Chip>
          ))}
        </Rail>

        <div className="flex flex-col gap-2">
          <Composer
            ref={composer}
            label={schedule ? 'Work done' : 'What happened'}
            value={line}
            onChange={onLineChange}
            tokens={parsed.tokens}
            placeholder={
              schedule
                ? `${schedule.title}, ${symbol}80 at Kwik Fit`
                : exampleLine(kind, humanise(kind), symbol)
            }
            // A pasted screenshot of a receipt is attached, and read, not typed.
            onPaste={(event) => {
              if (event.clipboardData.files.length === 0) return;
              event.preventDefault();
              stage(event.clipboardData.files);
            }}
            error={fieldErrors?.title ?? fieldErrors?.workPerformed}
          />
          {line.trim() === '' && again.length > 0 && !schedule ? (
            <div className="flex min-w-0 items-center gap-2">
              <span className="shrink-0 pl-1 text-label uppercase text-muted-foreground">
                Again
              </span>
              <div className="scroll-fade-x -mr-6 flex min-w-0 gap-1.5 overflow-x-auto py-0.5 pr-6 [scrollbar-width:none]">
                {again.map((words) => (
                  <Chip key={words} small onClick={() => fillLine(`${words} `)}>
                    {words}
                  </Chip>
                ))}
              </div>
            </div>
          ) : (
            <p className="px-1 text-xs text-muted-foreground">
              {line.trim() === '' && !receipt?.note
                ? 'Say it in one go — amounts, km, the day and “at” a place are picked out.'
                : `Saved as “${title || schedule?.title || humanise(kind)}”`}
            </p>
          )}
        </div>

        <div style={{ '--cells': cells.length } as CSSProperties} className={PANEL}>
          {cells}
        </div>

        {/* The facts around it, as chips: the day, the place, a trip's purpose, its files. */}
        <div className="flex flex-wrap items-center gap-1.5">
          <DatePicker
            label="When"
            required
            max={today}
            value={day}
            onChange={setDay}
            shown={dayChip}
            className="shrink-0"
            triggerClassName={cn(CHIP_PICKER, auto.day && 'ring-1 ring-inset ring-foreground/30')}
          />
          {place ? (
            <span className="inline-flex h-8 animate-pop items-center gap-1.5 rounded-full bg-muted pl-2.5 pr-1 text-xs font-semibold text-foreground">
              <MapPin aria-hidden="true" className="size-3.5 text-muted-foreground" />
              <span className="max-w-[12rem] truncate">{place}</span>
              {auto.place ? <Auto /> : null}
              <button
                type="button"
                aria-label={`Not at ${place}`}
                onClick={() => setPlace('')}
                className="grid size-6 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-border hover:text-foreground"
              >
                <X className="size-3" aria-hidden="true" />
              </button>
            </span>
          ) : null}
          {trip
            ? TRIP_PURPOSES.map((option) => (
                <Chip
                  key={option}
                  small
                  selected={purpose === option}
                  onClick={() => setPurpose(purpose === option ? null : option)}
                >
                  {humanise(option)}
                </Chip>
              ))
            : null}
          {files.map((file) => (
            <StagedFile
              key={`${file.name}-${file.size}`}
              file={file}
              reading={scan?.file === file && scan.state === 'reading'}
              onRemove={() => unstage(file)}
            />
          ))}
        </div>

        {offered.length > 0 ? (
          <Rail label="Completes a schedule">
            {offered.map((item) => {
              const selected = item.id === scheduleId;
              return (
                <Chip
                  key={item.id}
                  selected={selected}
                  onClick={() => setScheduleId(selected ? null : item.id)}
                  lead={
                    selected ? (
                      <Check className="size-4" strokeWidth={3} aria-hidden="true" />
                    ) : (
                      <Emoji name={scheduleEmoji(item.title)} size={18} />
                    )
                  }
                  auto={!selected && names(line, item.title)}
                >
                  {item.title}
                  {selected ? null : (
                    <span
                      className={cn(
                        '-mr-1.5 inline-flex h-6 items-center rounded-full px-2 text-[0.6875rem]',
                        REMINDER_TONE[
                          item.status === 'OVERDUE'
                            ? 'late'
                            : item.status === 'DUE_SOON'
                              ? 'soon'
                              : 'later'
                        ],
                      )}
                    >
                      {readDue(item, odometerUnit).headline}
                    </span>
                  )}
                </Chip>
              );
            })}
          </Rail>
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

      <div className={MODAL_BAR}>
        <ReceiptKey
          name={photoRead(kind).name}
          files={files}
          reading={scan?.state === 'reading'}
          read={scan?.state === 'read'}
          onPress={() => picker.current?.click()}
        />
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
        <ScanNote scan={scan} name={photoRead(kind).name} />
        {saved ? null : (
          <Button variant="ghost" onClick={onCancel} disabled={mutation.isPending}>
            Cancel
          </Button>
        )}
        <Button
          type="submit"
          variant="primary"
          loading={mutation.isPending}
          disabled={(empty || tripShort) && !saved}
          className="max-w-[16rem] sm:max-w-none"
        >
          <span className="truncate">{action}</span>
        </Button>
      </div>
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
  const jobs = commonJobs(unit);
  const presets = duePresets();
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
  const comesDue = repeats
    ? firstDue(
        everyMonths ? Number(everyMonths) : null,
        everyDistance ? Number(everyDistance) : null,
        odometer,
        unit,
      )
    : null;

  const fillLine = (text: string) => {
    onLineChange(text);
    // A job's own cadence decides once or repeats, so a choice made before it does not stick.
    setRepeats(null);
    setMonths(null);
    setDistance(null);
    setDue(null);
    requestAnimationFrame(() => {
      const input = composer.current;
      if (!input) return;
      input.focus();
      input.setSelectionRange(text.length, text.length);
    });
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        mutation.mutate();
      }}
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="scrollbar-slim flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 pb-6 pt-1 [&>*]:shrink-0">
        <Rail label="Common jobs">
          {jobs.map((job) => (
            <Chip
              key={job.label}
              selected={line === job.line}
              onClick={() => fillLine(job.line)}
              lead={<Emoji name={scheduleEmoji(job.label)} size={18} />}
            >
              {job.label}
              {planned(job.label) && line !== job.line ? (
                <Check className="size-3.5 text-success" strokeWidth={3} aria-label="Planned" />
              ) : null}
            </Chip>
          ))}
        </Rail>

        <div className="flex flex-col gap-2">
          <Composer
            ref={composer}
            label="What needs doing"
            value={line}
            onChange={onLineChange}
            tokens={parsed.tokens}
            placeholder={
              repeats ? `Rotate tyres every 10,000 ${unit}` : 'Renew insurance on 11 Nov'
            }
            error={fieldErrors?.title}
          />
          <p className="px-1 text-xs text-muted-foreground">
            {line.trim() === ''
              ? 'Pick a job, or say it — “every 10,000 km”, “on 11 Nov”, “next month”.'
              : title
                ? `Saved as “${title}”`
                : 'Say what needs doing, then when.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div
            role="group"
            aria-label="How often"
            className="inline-flex gap-0.5 rounded-full bg-muted p-1"
          >
            {CADENCES.map((option) => {
              const selected = repeats === option.repeats;
              return (
                <button
                  key={option.label}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setRepeats(option.repeats)}
                  className={cn(
                    'inline-flex h-8 items-center gap-1.5 rounded-full px-3.5 text-sm font-semibold transition-[background-color,color,scale] active:scale-[0.97]',
                    selected
                      ? 'bg-card text-foreground shadow-[0_1px_2px_var(--color-shadow)]'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  <Icon name={option.icon} size={15} />
                  {option.label}
                  {selected && auto.repeats ? <Auto /> : null}
                </button>
              );
            })}
          </div>
          {/* A second schedule for the same job is usually a mistake; said, not refused. */}
          {twin && repeats ? (
            <span className="inline-flex min-w-0 animate-pop items-center gap-1.5 text-xs text-muted-foreground">
              <Emoji name={scheduleEmoji(twin.title)} size={16} />
              <span className="truncate">Already planned: {twin.title}</span>
              <ReminderStatus
                tone={
                  twin.status === 'OVERDUE' ? 'late' : twin.status === 'DUE_SOON' ? 'soon' : 'later'
                }
              >
                {readDue(twin, odometerUnit).headline}
              </ReminderStatus>
            </span>
          ) : null}
        </div>

        {repeats ? (
          <div key="repeat" className="flex animate-rise flex-col gap-3">
            <div style={{ '--cells': 2 } as CSSProperties} className={PANEL}>
              <Reading
                label="Every"
                auto={auto.months}
                note="By the calendar"
                error={fieldErrors?.intervalMonths}
              >
                {(id, describedBy) => (
                  <FigureInput
                    id={id}
                    describedBy={describedBy}
                    unit="months"
                    value={everyMonths}
                    placeholder="—"
                    onChange={(text) => setMonths(digitsOnly(text, 3))}
                  />
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
                  <FigureInput
                    id={id}
                    describedBy={describedBy}
                    unit={unit}
                    value={everyDistance ? Number(everyDistance).toLocaleString() : ''}
                    placeholder="—"
                    onChange={(text) => setDistance(digitsOnly(text))}
                  />
                )}
              </Reading>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {intervalPresets(unit).map((preset) => (
                <Chip
                  key={preset.label}
                  small
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
            {comesDue ? (
              <p className="flex items-center gap-1.5 px-1 text-xs text-muted-foreground">
                <Icon name="calendar" size={14} />
                First due <span className="font-semibold text-foreground">{comesDue}</span>
                <span className="max-sm:hidden">— then on from each time it is done</span>
              </p>
            ) : null}
          </div>
        ) : (
          <div key="once" className="flex animate-rise flex-col gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              {presets.map((option) => (
                <Chip
                  key={option.label}
                  small
                  selected={due === option.day}
                  onClick={() => setDue(option.day)}
                >
                  {option.label}
                </Chip>
              ))}
              <DatePicker
                label="Due"
                min={localDay()}
                value={due}
                onChange={setDue}
                shown={dayChip}
                placeholder="Pick a day"
                className="shrink-0"
                triggerClassName={cn(
                  CHIP_PICKER,
                  due && !presets.some((option) => option.day === due)
                    ? 'bg-primary text-primary-foreground hover:bg-primary [&_*]:text-primary-foreground'
                    : auto.due && 'ring-1 ring-inset ring-foreground/30',
                )}
              />
            </div>
            <p
              className={cn(
                'px-1 text-xs',
                fieldErrors?.dueDate ? 'text-destructive' : 'text-muted-foreground',
              )}
            >
              {fieldErrors?.dueDate ??
                (due
                  ? `Due ${fromToday(due)}`
                  : 'No date — it waits on the list until it is done.')}
            </p>
          </div>
        )}

        {mutation.isError && !fieldErrors ? (
          <FormError>{(mutation.error as Error).message}</FormError>
        ) : null}
      </div>

      <div className={MODAL_BAR}>
        <span className="mr-auto hidden items-center gap-1.5 text-xs text-muted-foreground sm:inline-flex">
          <kbd className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[0.6875rem] font-semibold text-foreground">
            Enter
          </kbd>
          to save
        </span>
        <Button variant="ghost" onClick={onCancel} disabled={mutation.isPending}>
          Cancel
        </Button>
        <Button
          type="submit"
          variant="primary"
          loading={mutation.isPending}
          disabled={!title || missingInterval || (!repeats && !garageId)}
          className="max-w-[16rem] sm:max-w-none"
        >
          <span className="truncate">{action}</span>
        </Button>
      </div>
    </form>
  );
}

const CADENCES = [
  { repeats: false, label: 'Once', icon: 'calendar' },
  { repeats: true, label: 'Repeats', icon: 'refresh' },
] as const satisfies readonly { repeats: boolean; label: string; icon: IconName }[];

/** "today", "tomorrow", "in 37 days" — how far off a `YYYY-MM-DD` is, in the viewer's own days. */
function fromToday(day: string): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((new Date(`${day}T00:00:00`).getTime() - today.getTime()) / 86_400_000);
  return days <= 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`;
}

/* ------------------------------------------------------------------------------------------- */

/**
 * A panel of readings: cells with hairlines between them, two across on a phone and one row from
 * `sm` — the add-vehicle dialog's panel and the phone's `Panel`, drawn the same way.
 */
const PANEL =
  'grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-border ring-1 ring-border sm:grid-cols-[repeat(var(--cells),minmax(0,1fr))]';

/** A date picker worn as a chip in a row of facts. */
const CHIP_PICKER =
  'h-8 w-auto gap-1.5 rounded-full bg-muted px-3 text-xs font-semibold hover:bg-border aria-expanded:bg-border';

/** A row of chips that scrolls sideways under its label, edge to edge of the dialog. */
function Rail({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  const rail = useRef<HTMLDivElement>(null);
  const shown = useRef<{ chip: Element | null; left: number }>({ chip: null, left: -1 });
  /*
   * The chosen chip is kept in view — a kind the line picked may sit past the edge — once per
   * choice, and again only if the order moves it: a rail scrolled by hand is left where it is.
   */
  useEffect(() => {
    const row = rail.current;
    const chip = row?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!row || !chip) return;
    const left = chip.offsetLeft - row.offsetLeft;
    if (shown.current.chip === chip && shown.current.left === left) return;
    shown.current = { chip, left };
    if (left < row.scrollLeft || left + chip.offsetWidth > row.scrollLeft + row.clientWidth) {
      row.scrollTo({ left: left - 24, behavior: 'smooth' });
    }
  });
  return (
    <div role="group" aria-labelledby={id} className="flex min-w-0 flex-col gap-1.5">
      <span id={id} className="px-1 text-label uppercase text-muted-foreground">
        {label}
      </span>
      <div
        ref={rail}
        className="scroll-fade-x -mx-6 flex gap-1.5 overflow-x-auto px-6 py-0.5 [scrollbar-width:none]"
      >
        {children}
      </div>
    </div>
  );
}

/**
 * The line. Large, on its own surface, marked ✦ as the line that is read. What the reader picked
 * out is marked in place: a pill behind each figure, date or place taken into a field, a dotted
 * underline under a word that set the kind.
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
  onPaste,
  error,
}: {
  ref: Ref<HTMLInputElement>;
  label: string;
  value: string;
  onChange: (value: string) => void;
  tokens: readonly Token[];
  placeholder: string;
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

  const TYPE = 'text-lg font-semibold leading-[3rem] tracking-tight';

  return (
    <div className="flex flex-col gap-1.5">
      <div
        className={cn(
          'flex items-center gap-3 rounded-2xl bg-muted/60 pl-4 pr-4 transition-colors hover:bg-muted focus-within:bg-muted has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring',
          error && 'ring-2 ring-inset ring-destructive',
        )}
      >
        <Sparkles
          aria-hidden="true"
          className={cn(
            'size-4 shrink-0 transition-colors',
            tokens.length ? 'text-foreground' : 'text-muted-foreground',
          )}
        />
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
              'relative block h-12 w-full bg-transparent text-foreground outline-none placeholder:text-muted-foreground/60',
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

/** Marks a value filled for the person — by the line or a receipt — rather than by a hand. */
function Auto() {
  return (
    <span title="Filled for you — check it" className="inline-flex text-foreground">
      <Sparkles className="size-3" aria-hidden="true" />
      <span className="sr-only">, filled for you</span>
    </span>
  );
}

/** One cell of an instrument panel: eyebrow, the figure being typed, and a live line under it. */
function Reading({
  label,
  note,
  tone,
  auto = false,
  wide = false,
  error,
  children,
}: {
  label: string;
  note: ReactNode;
  tone?: 'warning';
  auto?: boolean;
  /** The whole row on a phone, where the panel is two across — the app's own panel. */
  wide?: boolean;
  error?: string;
  children: (id: string, describedBy: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div
      className={cn(
        // Opaque in every state: the hairlines between cells are the panel through the gaps.
        'flex min-w-0 flex-col gap-1 bg-card px-4 py-3 transition-colors focus-within:bg-muted',
        wide && 'max-sm:col-span-2',
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

/**
 * A figure typed into a reading: mono, large, its unit beside it. Text with a numeric keyboard
 * rather than `type="number"`, so a reading carries its separators — 42,150 is a distance.
 */
function FigureInput({
  id,
  describedBy,
  unit,
  decimal = false,
  value,
  placeholder,
  onChange,
}: {
  id: string;
  describedBy: string;
  unit: string;
  decimal?: boolean;
  value: string;
  placeholder: string;
  onChange: (text: string) => void;
}) {
  return (
    <span className="flex items-baseline gap-1.5">
      <input
        id={id}
        size={1}
        inputMode={decimal ? 'decimal' : 'numeric'}
        autoComplete="off"
        placeholder={placeholder}
        aria-describedby={describedBy}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-w-0 flex-1 bg-transparent font-mono text-2xl font-semibold tabular-nums tracking-tight text-foreground outline-none placeholder:text-muted-foreground/40"
      />
      <span className="text-sm font-semibold text-muted-foreground">{unit}</span>
    </span>
  );
}

function Chip({
  selected = false,
  disabled = false,
  small = false,
  auto = false,
  lead,
  onClick,
  children,
}: {
  selected?: boolean;
  disabled?: boolean;
  small?: boolean;
  /** Chosen by the line, not a hand. */
  auto?: boolean;
  lead?: ReactNode;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full font-semibold transition-[background-color,color,scale,opacity] active:scale-[0.97] disabled:opacity-40',
        small ? 'h-8 px-3 text-xs' : 'h-9 pl-2.5 pr-3.5 text-sm',
        selected
          ? 'bg-primary text-primary-foreground'
          : 'bg-muted text-muted-foreground hover:bg-border hover:text-foreground',
      )}
    >
      {lead}
      {children}
      {auto ? <Sparkles className="size-3" aria-label="read from what you typed" /> : null}
    </button>
  );
}

/**
 * The receipt's key, in the foot beside Save: a camera with the reader's spark until something is
 * attached, then the photo itself — pulsing while it is read, ticked once it has filled something.
 * The same key the phone has, there beside its Save.
 */
function ReceiptKey({
  name,
  files,
  reading,
  read,
  onPress,
}: {
  /** What the photo is to this kind: a receipt, an invoice, the dashboard. */
  name: string;
  files: readonly File[];
  reading: boolean;
  read: boolean;
  onPress: () => void;
}) {
  const photo = files.find(isImage) ?? null;
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!photo) return;
    const next = URL.createObjectURL(photo);
    setUrl(next);
    return () => {
      URL.revokeObjectURL(next);
      setUrl(null);
    };
  }, [photo]);

  return (
    <button
      type="button"
      onClick={onPress}
      aria-label={
        files.length
          ? `${files.length} attached${reading ? `, reading the ${name}` : ''}. Attach more`
          : `Attach the ${name} — it is read into the entry`
      }
      title={files.length ? 'Attach more' : `Attach the ${name}: it fills what is empty`}
      className={cn(
        'relative grid size-10 shrink-0 place-items-center overflow-hidden rounded-xl bg-muted text-foreground ring-1 ring-inset transition-[background-color,scale] hover:bg-border active:scale-[0.95]',
        files.length ? 'ring-primary' : 'ring-border',
        reading && 'animate-pulse',
      )}
    >
      {url ? (
        <img src={url} alt="" className="absolute inset-0 size-full object-cover" />
      ) : files.length ? (
        <Paperclip className="size-4" aria-hidden="true" />
      ) : (
        <Camera className="size-[1.125rem]" aria-hidden="true" />
      )}
      {read ? (
        <span className="absolute bottom-0.5 right-0.5 grid size-3.5 animate-pop place-items-center rounded-full bg-success text-background ring-2 ring-card">
          <Check className="size-2.5" strokeWidth={4} aria-hidden="true" />
        </span>
      ) : files.length ? null : (
        <span className="absolute right-1 top-1 grid size-3.5 place-items-center rounded-full bg-primary text-primary-foreground">
          <Sparkles className="size-2" aria-hidden="true" />
        </span>
      )}
    </button>
  );
}

/** What reading the receipt came to, beside its key; "Enter to save" when there is nothing. */
function ScanNote({ scan, name }: { scan: Scan | null; name: string }) {
  const said =
    scan?.state === 'reading'
      ? `Reading the ${name}…`
      : scan?.state === 'read'
        ? `Filled from the ${name} — check before saving`
        : scan?.state === 'nothing'
          ? `Nothing on the ${name} to fill; it stays attached`
          : scan?.state === 'failed'
            ? `Could not read the ${name}; it stays attached`
            : null;
  return (
    <span
      role="status"
      className="mr-auto flex min-w-0 items-center gap-1.5 truncate text-xs text-muted-foreground"
    >
      {said ? (
        <>
          {scan?.state === 'read' ? (
            <Sparkles className="size-3 shrink-0 text-foreground" aria-hidden="true" />
          ) : null}
          <span className={cn('truncate', scan?.state === 'reading' && 'text-shimmer')}>
            {said}
          </span>
        </>
      ) : (
        <span className="hidden items-center gap-1.5 sm:inline-flex">
          <kbd className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[0.6875rem] font-semibold text-foreground">
            Enter
          </kbd>
          to save
        </span>
      )}
    </span>
  );
}

/** A file waiting to go up with the entry, as a chip: its picture or its type, and its ×. */
function StagedFile({
  file,
  reading,
  onRemove,
}: {
  file: File;
  reading: boolean;
  onRemove: () => void;
}) {
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
    <span className="inline-flex h-8 max-w-[14rem] animate-pop items-center gap-1.5 rounded-full bg-muted pl-1 pr-1 text-xs font-semibold text-foreground">
      <span
        className={cn(
          'relative grid size-6 shrink-0 place-items-center overflow-hidden rounded-full bg-card text-muted-foreground',
          reading && 'animate-pulse',
        )}
      >
        {image && url && !broken ? (
          <img
            src={url}
            alt=""
            onError={() => setBroken(true)}
            className="absolute inset-0 size-full object-cover"
          />
        ) : (
          <span className="font-mono text-[0.5rem] uppercase">{extension.slice(0, 4)}</span>
        )}
      </span>
      <span className="min-w-0 truncate">{file.name}</span>
      <button
        type="button"
        aria-label={`Remove ${file.name}`}
        onClick={onRemove}
        className="grid size-6 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-border hover:text-foreground"
      >
        <X className="size-3" aria-hidden="true" />
      </button>
    </span>
  );
}
