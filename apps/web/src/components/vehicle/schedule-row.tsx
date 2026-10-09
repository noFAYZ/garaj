'use client';

import { useMutation } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import type { MaintenancePlan, UpdateMaintenancePlan } from '@vehicle-os/contracts';
import {
  convertDistance,
  TASK_PRIORITIES,
  type DistanceUnit,
  type TaskPriority,
} from '@vehicle-os/domain';
import { ApiError } from '@vehicle-os/api-client';
import { api } from '@/lib/api';
import { addMonths, fromDay, toDay, todayDay } from '@/components/ui/calendar-math';
import { DateField } from '@/components/ui/date-picker';
import { Switch } from '@/components/motion/switch';
import { readDue, type GaugeReading } from '@/lib/due';
import { Emoji, type EmojiName } from '@/components/emoji';
import { Icon } from '@/components/icons';
import { FormError, Modal, ModalActions } from '@/components/ui/modal';
import { Button, Field } from '@/components/ui/primitives';
import { ConfirmDelete, RowMenu } from '@/components/ui/row-actions';
import { localDay, stampForDay } from '@vehicle-os/ui';
import { formatDate, formatDistance, humanise, toMinorUnits } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useVehicleUnits } from '@/lib/vehicle-units';

/**
 * The job, from what the schedule is called.
 *
 * Every schedule wearing the same spanner told you nothing; an oil change and a tyre rotation are
 * different jobs and now look it. Matched on the title because that is the only description a
 * schedule has — no match keeps the spanner.
 */
const JOB_EMOJI: readonly [readonly string[], EmojiName][] = [
  [['oil'], 'oil'],
  [['tyre', 'tyres', 'tire', 'tires', 'wheel', 'wheels'], 'tyre'],
  [['brake', 'brakes'], 'brake'],
  [['chain', 'belt'], 'chain'],
  [['battery', 'batteries'], 'battery'],
  [['filter', 'filters', 'air'], 'filter'],
  [['coolant', 'antifreeze', 'radiator'], 'coolant'],
  [['spark', 'plug', 'plugs', 'ignition'], 'spark'],
  [['inspection', 'inspect', 'mot', 'test'], 'inspection'],
  [['clean', 'cleaning', 'wash', 'valet'], 'cleaning'],
  [['insurance'], 'insurance'],
  [['registration', 'tax'], 'registration'],
];

/** Whole words only: a schedule called "Brake repair" is brakes, not an air filter. */
export function scheduleEmoji(title: string): EmojiName {
  const words = new Set(title.toLowerCase().split(/[^a-z]+/));
  const match = JOB_EMOJI.find(([keywords]) => keywords.some((word) => words.has(word)));
  return match?.[1] ?? 'maintenance';
}

/**
 * A reminder on the rail: a small upright tile — its glyph, what it is, when — with done on its
 * top-left corner and the menu on its top-right, so the tile is no taller than what it says. Fixed
 * width, so a rail of tasks and schedules lines up. No `title`, `group` or text alignment on the
 * tile itself: its dialogs mount inside it, and would inherit all three.
 */
export const CARD =
  'relative flex w-36 shrink-0 snap-start scroll-mt-36 flex-col items-center gap-2 rounded-2xl bg-card/50 px-2.5 pb-3 pt-3.5 transition-colors hover:bg-card';

/**
 * When a reminder is due, as a chip on its solid status tint — the pairs the contrast test checks,
 * so amber and red are always legible — rather than coloured text on the card.
 */
export const REMINDER_TONE = {
  late: 'bg-destructive-soft text-destructive',
  soon: 'bg-warning-soft text-warning',
  later: 'bg-muted text-muted-foreground',
  done: 'bg-success-soft text-success',
} as const;

export function ReminderStatus({
  tone,
  children,
}: {
  tone: keyof typeof REMINDER_TONE;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        'mt-auto inline-flex h-5 max-w-full items-center gap-1 truncate rounded-full px-2 text-[0.6875rem] font-semibold',
        REMINDER_TONE[tone],
      )}
    >
      {children}
    </span>
  );
}

/**
 * How each due status colours the row: the tile, the headline and the meter — ink when all is
 * well. The rail's ring wears the status on its arc alone, over the same grey track for every
 * status, so the colour on a rail of rings is only ever the part that has been used.
 */
const TONE: Record<
  MaintenancePlan['status'],
  { tile: string; headline: string; bar: string; ring: string }
> = {
  OVERDUE: {
    tile: 'bg-destructive-soft text-destructive',
    headline: 'text-destructive',
    bar: 'bg-destructive',
    ring: 'stroke-destructive',
  },
  DUE_SOON: {
    tile: 'bg-warning-soft text-warning',
    headline: 'text-warning',
    bar: 'bg-warning',
    ring: 'stroke-warning',
  },
  OK: {
    tile: 'bg-muted text-muted-foreground',
    headline: 'text-foreground',
    bar: 'bg-foreground',
    ring: 'stroke-info',
  },
  UNSCHEDULED: {
    tile: 'bg-muted text-muted-foreground',
    headline: 'text-muted-foreground',
    bar: 'bg-border-strong',
    ring: 'stroke-muted-foreground',
  },
};

/**
 * A repeating service in Coming up, read like a gauge.
 *
 * The question a schedule answers is "how close is it?", so that is the headline — "Due in 490 km",
 * "Overdue by 60 days" — and the meter under it shows how much of the interval has gone, whichever of
 * distance or time is further along. Logging the service stays one press away; editing and deleting
 * are occasional, so they sit behind ⋯ and open as dialogs rather than forms pushed into the list.
 */
export function ScheduleRow({
  vehicleId,
  schedule,
  currentOdometer,
  onChanged,
  layout = 'row',
}: {
  vehicleId: string;
  schedule: MaintenancePlan;
  currentOdometer: number | null;
  /** After a service is logged, the schedule edited or removed. */
  onChanged: () => void;
  /** `card`: the same schedule and actions as a small upright tile, one line high. */
  layout?: 'row' | 'card';
}) {
  const { odometerUnit } = useVehicleUnits(vehicleId);
  const unitLabel = odometerUnit === 'MI' ? 'mi' : 'km';
  const [sheet, setSheet] = useState<'complete' | 'edit' | 'delete' | null>(null);

  const remove = useMutation({
    mutationFn: () => api.maintenance.removePlan(vehicleId, schedule.id),
    onSuccess: () => {
      setSheet(null);
      onChanged();
    },
  });

  const finish = () => {
    setSheet(null);
    onChanged();
  };

  const reading = readDue(schedule, odometerUnit);
  const tone = TONE[schedule.status];
  const overdue = schedule.status === 'OVERDUE';

  const sheets = (
    <>
      {sheet === 'complete' ? (
        <Modal
          title={`Log ${schedule.title.toLowerCase()}`}
          description="The next due point counts from this service, not from today."
          icon="maintenance"
          onClose={() => setSheet(null)}
        >
          <CompleteForm
            vehicleId={vehicleId}
            plan={schedule}
            unitLabel={unitLabel}
            currentOdometer={currentOdometer}
            onDone={finish}
            onCancel={() => setSheet(null)}
          />
        </Modal>
      ) : null}

      {sheet === 'edit' ? (
        <Modal title="Edit schedule" icon="edit" size="lg" onClose={() => setSheet(null)}>
          <EditPlanForm
            vehicleId={vehicleId}
            plan={schedule}
            unitLabel={unitLabel}
            currentOdometer={currentOdometer}
            onDone={finish}
            onCancel={() => setSheet(null)}
          />
        </Modal>
      ) : null}

      {sheet === 'delete' ? (
        /*
         * Confirmed, because a schedule carries the interval and the last-done baseline — deleting
         * it loses when the next service is due, and the history it produced stays behind with
         * nothing explaining it.
         */
        <ConfirmDelete
          title={`Delete “${schedule.title}”?`}
          description="Its interval and when it is next due go with it. The services already logged stay in the history."
          confirmLabel="Delete schedule"
          pending={remove.isPending}
          error={remove.isError ? (remove.error as Error).message : null}
          onConfirm={() => remove.mutate()}
          onClose={() => setSheet(null)}
        />
      ) : null}
    </>
  );

  const menu = (className?: string) => (
    <RowMenu
      label={`More for ${schedule.title}`}
      className={className}
      items={[
        { label: 'Edit schedule', icon: 'edit', onSelect: () => setSheet('edit') },
        {
          label: 'Delete schedule',
          icon: 'trash',
          destructive: true,
          onSelect: () => setSheet('delete'),
        },
      ]}
    />
  );

  if (layout === 'card') {
    // Everything the ring does not draw, for the hover title and the screen reader.
    const detail = [
      reading.headline,
      reading.gauge ? `Last ${reading.gauge.from}` : null,
      reading.gauge ? `Next ${reading.gauge.to}` : null,
      `Every ${intervalSummary(schedule, true)}`,
    ]
      .filter(Boolean)
      .join('. ');
    const used = Math.min(1, reading.gauge?.progress ?? 0) * 100;
    return (
      <li id={`plan-${schedule.id}`} className={CARD}>
        <span className="absolute left-1 top-1">
          <Button
            size="icon-sm"
            variant="ghost"
            aria-haspopup="dialog"
            aria-label={`Log ${schedule.title}`}
            title="Log it"
            onClick={() => setSheet('complete')}
          >
            <Icon name="check" size={16} />
          </Button>
        </span>
        <span className="absolute right-1 top-1">{menu('')}</span>

        {/* The job's glyph inside a ring of the interval used: the dial, at a glance's size. */}
        <span
          role="img"
          aria-label={detail}
          title={detail}
          className="relative grid size-12 shrink-0 place-items-center"
        >
          <svg viewBox="0 0 48 48" aria-hidden="true" className="absolute inset-0 -rotate-90">
            <circle cx="24" cy="24" r="21" fill="none" strokeWidth="4" className="stroke-muted" />
            {used > 0 ? (
              <circle
                cx="24"
                cy="24"
                r="21"
                fill="none"
                strokeWidth="4"
                strokeLinecap="round"
                pathLength={100}
                strokeDasharray={`${used} 100`}
                className={cn('transition-[stroke-dasharray] duration-700 ease-out', tone.ring)}
              />
            ) : null}
          </svg>
          <Emoji name={scheduleEmoji(schedule.title)} size={20} />
        </span>

        <p className="line-clamp-2 text-center text-sm font-semibold leading-tight text-foreground">
          {schedule.title}
        </p>
        <ReminderStatus tone={overdue ? 'late' : schedule.status === 'DUE_SOON' ? 'soon' : 'later'}>
          {reading.headline}
        </ReminderStatus>

        {sheets}
      </li>
    );
  }

  return (
    // An anchor for the cockpit's warning lights; the margin clears the header and the tab strip.
    <li
      id={`plan-${schedule.id}`}
      className="scroll-mt-36 rounded-2xl bg-card/50 p-4 transition-colors hover:bg-card"
    >
      <div className="flex items-start gap-4">
        <span
          aria-hidden="true"
          className={cn('grid size-12 shrink-0 place-items-center rounded-2xl', tone.tile)}
        >
          <Emoji name={scheduleEmoji(schedule.title)} size={26} />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-foreground">{schedule.title}</p>
              <p className={cn('mt-0.5 text-lg font-semibold tracking-tight', tone.headline)}>
                {reading.headline}
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-1">
              <Button
                size="sm"
                // Overdue is the one state where logging the service is the thing to do next.
                variant={overdue ? 'primary' : 'secondary'}
                aria-haspopup="dialog"
                onClick={() => setSheet('complete')}
              >
                <Icon name="check" size={16} />
                Log service
              </Button>
              {menu()}
            </div>
          </div>

          {reading.gauge ? (
            <Gauge gauge={reading.gauge} fill={tone.bar} figure={tone.headline} />
          ) : null}

          <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1">
              <Icon name="refresh" size={12} />
              Every {intervalSummary(schedule)}
            </span>
            {schedule.lastPerformedAt ? null : (
              <span className="rounded-full bg-muted px-2.5 py-1">Never done</span>
            )}
          </div>
        </div>
      </div>

      {sheets}
    </li>
  );
}

/**
 * The interval as one segmented gauge: a cell per month (or tenth of the distance) of whichever
 * measure arrives first, filled up to today, with last done and next due underneath. Past due,
 * every cell is full and the figure says by how much.
 */
function Gauge({ gauge, fill, figure }: { gauge: GaugeReading; fill: string; figure: string }) {
  const percent = Math.round(gauge.progress * 100);
  const used = gauge.progress * gauge.cells;

  return (
    <div className="mt-3.5">
      <div className="flex items-center gap-2.5">
        <Icon
          name={gauge.kind === 'distance' ? 'odometer' : 'calendar'}
          size={14}
          className="shrink-0 text-muted-foreground"
        />
        <div
          role="img"
          aria-label={`${percent}% of the interval used, last done ${gauge.from}, due ${gauge.to}`}
          className="flex h-2 flex-1 gap-[3px]"
        >
          {Array.from({ length: gauge.cells }, (_, index) => (
            <span key={index} className="flex-1 overflow-hidden rounded-[3px] bg-muted">
              <span
                className={cn('block h-full transition-[width] duration-700 ease-out', fill)}
                style={{ width: `${Math.min(1, Math.max(0, used - index)) * 100}%` }}
              />
            </span>
          ))}
        </div>
        <span
          aria-hidden="true"
          className={cn('w-11 shrink-0 text-right font-mono text-xs tabular-nums', figure)}
        >
          {percent > 100 ? `+${percent - 100}%` : `${percent}%`}
        </span>
      </div>
      <div
        aria-hidden="true"
        className="mt-1 flex justify-between gap-2 pr-[3.375rem] pl-6 font-mono text-[11px] tabular-nums text-muted-foreground"
      >
        <span className="truncate">{gauge.from}</span>
        <span className="truncate">{gauge.to}</span>
      </div>
    </div>
  );
}

/**
 * "5,000 km or 6 months" — the intervals as they were entered, not as they were converted.
 * `short` is the card's: "5,000 km · 6 mo".
 */
function intervalSummary(plan: MaintenancePlan, short = false): string {
  const parts: string[] = [];
  if (plan.intervalDistance) {
    parts.push(formatDistance(plan.intervalDistance, plan.intervalDistanceUnit));
  }
  if (plan.intervalMonths) {
    parts.push(
      short
        ? `${plan.intervalMonths} mo`
        : `${plan.intervalMonths} ${plan.intervalMonths === 1 ? 'month' : 'months'}`,
    );
  }
  if (plan.intervalEngineHours) {
    parts.push(`${plan.intervalEngineHours} ${short ? 'h' : 'engine hours'}`);
  }
  return parts.length > 0 ? parts.join(short ? ' · ' : ' or ') : 'no interval';
}

function CompleteForm({
  vehicleId,
  plan,
  unitLabel,
  currentOdometer,
  onDone,
  onCancel,
}: {
  vehicleId: string;
  plan: MaintenancePlan;
  unitLabel: string;
  currentOdometer: number | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  // The vehicle's own currency, not this form's guess at it.
  const { currency } = useVehicleUnits(vehicleId);
  // Today where the person is, not in UTC — just after midnight UTC's date is still yesterday.
  const [performedAt, setPerformedAt] = useState(() => localDay());
  // Prefilled from the vehicle: the odometer at completion is what the next interval counts
  // from, and a blank field invites logging the work with no baseline at all.
  const [odometer, setOdometer] = useState(currentOdometer === null ? '' : String(currentOdometer));
  const [provider, setProvider] = useState('');
  const [workPerformed, setWorkPerformed] = useState('');
  const [parts, setParts] = useState('');
  const [labour, setLabour] = useState('');

  const mutation = useMutation({
    mutationFn: () =>
      api.maintenance.complete(vehicleId, plan.id, {
        // The real time it was logged, so it sorts among the day's other entries (`stampForDay`).
        performedAt: stampForDay(performedAt),
        // The unit travels with the reading: the API refuses an odometer it cannot interpret.
        ...(odometer
          ? { odometer: Number(odometer), odometerUnit: unitLabel === 'mi' ? 'MI' : 'KM' }
          : {}),
        ...(provider ? { provider } : {}),
        ...(workPerformed ? { workPerformed } : {}),
        // Minor units per unit depend on the currency — 25 JPY is 25, 25 USD is 2500.
        ...(parts ? { partsCostAmountMinor: toMinorUnits(Number(parts), currency) } : {}),
        ...(labour ? { laborCostAmountMinor: toMinorUnits(Number(labour), currency) } : {}),
        ...(parts || labour ? { costCurrency: currency } : {}),
      }),
    onSuccess: onDone,
  });

  const fieldErrors = mutation.error instanceof ApiError ? mutation.error.fields : undefined;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        mutation.mutate();
      }}
      className="flex flex-col gap-4"
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <DateField
          label="Performed on"
          value={performedAt}
          onChange={setPerformedAt}
          error={fieldErrors?.performedAt}
          hint="Back-dating is fine."
          required
        />
        <Field
          label="Odometer"
          type="number"
          inputMode="numeric"
          min={0}
          suffix={unitLabel}
          value={odometer}
          onChange={(event) => setOdometer(event.target.value)}
          error={fieldErrors?.odometer}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field
          label="Who did it"
          value={provider}
          onChange={(event) => setProvider(event.target.value)}
          placeholder="Yourself, or the shop"
          error={fieldErrors?.provider}
        />
        <Field
          label="Work performed"
          value={workPerformed}
          onChange={(event) => setWorkPerformed(event.target.value)}
          placeholder="Oil, filter, sump washer"
          error={fieldErrors?.workPerformed}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field
          label="Parts"
          type="number"
          inputMode="decimal"
          min={0}
          step="0.01"
          suffix={currency}
          value={parts}
          onChange={(event) => setParts(event.target.value)}
          error={fieldErrors?.partsCostAmountMinor}
        />
        <Field
          label="Labour"
          type="number"
          inputMode="decimal"
          min={0}
          step="0.01"
          suffix={currency}
          value={labour}
          onChange={(event) => setLabour(event.target.value)}
          error={fieldErrors?.laborCostAmountMinor}
        />
      </div>

      {mutation.isError && !fieldErrors ? (
        <FormError>{(mutation.error as Error).message}</FormError>
      ) : null}

      <ModalActions>
        <Button variant="ghost" onClick={onCancel} disabled={mutation.isPending}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={mutation.isPending}>
          Log service
        </Button>
      </ModalActions>
    </form>
  );
}

const PRIORITY_BARS: Record<TaskPriority, number> = { LOW: 1, MEDIUM: 2, HIGH: 3, URGENT: 4 };

const digits = (value: string, max: number) =>
  value.replace(/\D/g, '').replace(/^0+/, '').slice(0, max);

/** How far off a due point is, in the chip the rail uses — so a preview reads like the real thing. */
function DueChip({ remaining, unit }: { remaining: number; unit: 'days' | string }) {
  const days = unit === 'days';
  const amount = Math.abs(remaining).toLocaleString();
  const tone = remaining < 0 ? 'late' : remaining <= (days ? 14 : 500) ? 'soon' : 'later';
  const text =
    remaining < 0
      ? `${amount} ${days ? (Math.abs(remaining) === 1 ? 'day' : 'days') : unit} over`
      : remaining === 0
        ? days
          ? 'Today'
          : 'Now'
        : days && remaining >= 60
          ? `In ${Math.round(remaining / 30.44)} mo`
          : `In ${amount} ${days ? (remaining === 1 ? 'day' : 'days') : unit}`;
  return (
    <span
      className={cn(
        'inline-flex h-5 shrink-0 items-center rounded-full px-2 text-[0.6875rem] font-semibold',
        REMINDER_TONE[tone],
      )}
    >
      {text}
    </span>
  );
}

/**
 * One way the schedule comes due, before and after the edit: the new value, with what it was struck
 * through in small type above it when the edit moved it, and how far off it is.
 */
function DueLine({
  icon,
  label,
  before,
  after,
  changed,
  remaining,
}: {
  icon: 'calendar' | 'odometer';
  label: string;
  before: string | null;
  after: string | null;
  changed: boolean;
  remaining: ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2.5 rounded-xl bg-card px-2.5 py-2">
      <span aria-hidden="true" className="shrink-0 text-muted-foreground">
        <Icon name={icon} size={16} />
      </span>
      <dt className="sr-only">{label}</dt>
      <dd className="flex min-w-0 flex-1 flex-col font-mono tabular-nums leading-tight">
        {changed && before ? (
          <span className="truncate text-[0.6875rem] text-muted-foreground line-through decoration-1">
            {before}
            <span className="sr-only">, now</span>
          </span>
        ) : null}
        <span
          key={after ?? 'none'}
          className={cn(
            'truncate text-sm font-semibold',
            after ? 'text-foreground' : 'font-sans font-medium text-muted-foreground',
            changed && 'animate-pop',
          )}
        >
          {after ?? 'Not counted'}
        </span>
      </dd>
      {after ? <dd className="shrink-0">{remaining}</dd> : null}
    </div>
  );
}

/** An interval as a reading: the figure typed big, its unit, a way to stop counting it, and a note. */
function IntervalCell({
  label,
  unit,
  value,
  max,
  note,
  error,
  onChange,
}: {
  label: string;
  unit: string;
  value: string;
  max: number;
  note: ReactNode;
  error?: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-0.5 px-3.5 py-2.5 transition-colors focus-within:bg-muted">
      <label htmlFor={id} className="text-label uppercase text-muted-foreground">
        {label}
      </label>
      <span className="flex items-baseline gap-1">
        <input
          id={id}
          size={1}
          inputMode="numeric"
          autoComplete="off"
          placeholder="—"
          aria-describedby={`${id}-note`}
          aria-invalid={error ? true : undefined}
          value={value ? Number(value).toLocaleString() : ''}
          onChange={(event) => onChange(digits(event.target.value, max))}
          className="min-w-0 flex-1 bg-transparent font-mono text-xl font-semibold tabular-nums tracking-tight text-foreground outline-none placeholder:text-muted-foreground/40"
        />
        <span className="text-xs font-semibold text-muted-foreground">{unit}</span>
        {value ? (
          <button
            type="button"
            aria-label={`Stop counting ${unit}`}
            title="Stop counting this"
            onClick={() => onChange('')}
            className="grid size-5 shrink-0 self-center place-items-center rounded-full text-muted-foreground transition-colors hover:bg-border hover:text-foreground"
          >
            <X className="size-3" aria-hidden="true" />
          </button>
        ) : null}
      </span>
      <p
        id={`${id}-note`}
        aria-live="polite"
        className={cn(
          'min-h-4 truncate text-xs',
          error ? 'text-destructive' : 'text-muted-foreground',
        )}
      >
        {error ?? note}
      </p>
    </div>
  );
}

/** Four bars, lit up to the level: priority read like signal strength rather than four words. */
function PriorityBars({ level, lit }: { level: number; lit: boolean }) {
  return (
    // On a phone the four words already fill the control; the bars join them from `sm`.
    <span aria-hidden="true" className="hidden h-2.5 items-end gap-[2px] sm:flex">
      {[1, 2, 3, 4].map((bar) => (
        <span
          key={bar}
          style={{ height: `${bar * 25}%` }}
          className={cn(
            'w-[3px] rounded-full transition-colors',
            bar <= level ? (lit ? 'bg-primary' : 'bg-muted-foreground') : 'bg-border-strong',
          )}
        />
      ))}
    </span>
  );
}

/**
 * Correcting a schedule.
 *
 * A wrong interval used to be fixable only by deleting the plan and adding it back, which threw
 * away the last-done baseline with it — so the next due date was recomputed from nothing and the
 * schedule silently restarted. Editing keeps that baseline, and the form shows what that means
 * before it is saved: the next due date and reading, as they were and as they will be, counted
 * from the last service the way the server counts them.
 *
 * Only what changed is sent: a PATCH echoing the whole plan would overwrite an interval somebody
 * else corrected between this list loading and the save. With nothing changed there is nothing to
 * save, and the button says so.
 */
function EditPlanForm({
  vehicleId,
  plan,
  unitLabel,
  currentOdometer,
  onDone,
  onCancel,
}: {
  vehicleId: string;
  plan: MaintenancePlan;
  unitLabel: string;
  currentOdometer: number | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const titleId = useId();
  const [title, setTitle] = useState(plan.title);
  const [distance, setDistance] = useState(plan.intervalDistance?.toString() ?? '');
  const [months, setMonths] = useState(plan.intervalMonths?.toString() ?? '');
  const [priority, setPriority] = useState<TaskPriority>(plan.priority);
  const [isActive, setIsActive] = useState(plan.isActive);

  const vehicleUnit: DistanceUnit = unitLabel === 'mi' ? 'MI' : 'KM';
  // The interval keeps the unit it was set in: a 6,000 mi interval on a km vehicle stays miles.
  const distanceUnit: DistanceUnit = plan.intervalDistanceUnit ?? vehicleUnit;
  const distanceLabel = distanceUnit === 'MI' ? 'mi' : 'km';
  const distanceWas = plan.intervalDistance?.toString() ?? '';
  const monthsWas = plan.intervalMonths?.toString() ?? '';
  const changed = {
    title: title.trim() !== plan.title,
    distance: distance !== distanceWas,
    months: months !== monthsWas,
    priority: priority !== plan.priority,
    active: isActive !== plan.isActive,
  };
  const changes = [
    changed.title && 'name',
    (changed.distance || changed.months) && 'interval',
    changed.priority && 'priority',
    changed.active && (isActive ? 'resumed' : 'paused'),
  ].filter((change): change is string => Boolean(change));
  // A repeat with nothing to count can never come due; the add form refuses it, and so does this.
  const noInterval = !distance && !months && !plan.intervalEngineHours;

  // What the next due point becomes, from the baseline the edit keeps.
  const baseDay = plan.lastPerformedAt ? toDay(new Date(plan.lastPerformedAt)) : null;
  const nextDate = !months
    ? null
    : changed.months
      ? baseDay
        ? addMonths(baseDay, Number(months))
        : null
      : plan.nextDueDate;
  const nextReading = !distance
    ? null
    : changed.distance
      ? plan.lastPerformedOdometer !== null
        ? Math.round(
            plan.lastPerformedOdometer +
              convertDistance(Number(distance), distanceUnit, vehicleUnit),
          )
        : null
      : plan.nextDueOdometer;
  const showDay = (day: string | null) =>
    day ? formatDate(`${day.slice(0, 10)}T12:00:00Z`) : null;
  const showReading = (reading: number | null) =>
    reading === null ? null : formatDistance(reading, vehicleUnit);
  const daysTo = (day: string) =>
    Math.round((fromDay(day)!.getTime() - fromDay(todayDay())!.getTime()) / 86_400_000);

  const mutation = useMutation({
    mutationFn: () => {
      const patch: Record<string, unknown> = {};

      if (changed.title) patch.title = title.trim();
      if (changed.priority) patch.priority = priority;
      if (changed.active) patch.isActive = isActive;

      // An emptied interval means "stop counting this one" — which the contract expresses as
      // null, and which is exactly how a plan goes from distance-and-time to time only.
      if (changed.distance) {
        patch.intervalDistance = distance === '' ? null : Number(distance);
        if (distance !== '') patch.intervalDistanceUnit = distanceUnit;
      }
      if (changed.months) patch.intervalMonths = months === '' ? null : Number(months);

      return api.maintenance.updatePlan(vehicleId, plan.id, patch as UpdateMaintenancePlan);
    },
    onSuccess: onDone,
  });

  const fieldErrors = mutation.error instanceof ApiError ? mutation.error.fields : undefined;
  const glyph = scheduleEmoji(title || plan.title);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        mutation.mutate();
      }}
      className="flex flex-col gap-3"
    >
      {/* The job: its glyph follows the name as it is retyped. */}
      <div className="flex flex-col gap-1.5">
        <div
          className={cn(
            'flex items-center gap-2.5 rounded-2xl bg-muted/60 p-1.5 pr-3.5 transition-colors focus-within:bg-muted',
            fieldErrors?.title && 'ring-2 ring-inset ring-destructive',
          )}
        >
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-card shadow-[0_1px_2px_var(--color-shadow)]">
            <Emoji key={glyph} name={glyph} size={22} className="animate-pop" />
          </span>
          <label htmlFor={titleId} className="sr-only">
            What it is
          </label>
          <input
            id={titleId}
            value={title}
            maxLength={120}
            required
            autoComplete="off"
            onChange={(event) => setTitle(event.target.value)}
            aria-invalid={fieldErrors?.title ? true : undefined}
            className="h-10 min-w-0 flex-1 bg-transparent text-lg font-semibold tracking-tight text-foreground outline-none placeholder:text-muted-foreground/50"
            placeholder="What it is"
          />
        </div>
        {fieldErrors?.title ? (
          <p className="px-1 text-xs text-destructive">{fieldErrors.title}</p>
        ) : null}
      </div>

      <div className="grid grid-cols-2 divide-x divide-border overflow-hidden rounded-2xl bg-muted/60">
        <IntervalCell
          label="Every"
          unit={distanceLabel}
          value={distance}
          max={7}
          onChange={setDistance}
          error={fieldErrors?.intervalDistance}
          note={
            changed.distance
              ? `Was ${distanceWas ? `${Number(distanceWas).toLocaleString()} ${distanceLabel}` : 'not counted'}`
              : distance
                ? 'By distance'
                : 'Not counted'
          }
        />
        <IntervalCell
          label="Or every"
          unit="months"
          value={months}
          max={3}
          onChange={setMonths}
          error={fieldErrors?.intervalMonths}
          note={
            noInterval ? (
              <>
                <span
                  aria-hidden="true"
                  className="mr-1.5 inline-block size-1.5 rounded-full bg-warning align-middle"
                />
                Set at least one interval
              </>
            ) : changed.months ? (
              `Was ${monthsWas ? `${monthsWas} months` : 'not counted'}`
            ) : distance && months ? (
              'Whichever comes first'
            ) : months ? (
              'By the calendar'
            ) : (
              'Not counted'
            )
          }
        />
      </div>

      <section aria-label="Next due" className="rounded-2xl bg-muted/60 p-2 pt-2">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-1.5 pb-2">
          <h3 className="text-label uppercase text-muted-foreground">Next due</h3>
          {baseDay ? (
            <span className="text-xs text-muted-foreground">
              From last done · {showDay(baseDay)}
              {plan.lastPerformedOdometer !== null
                ? ` · ${formatDistance(plan.lastPerformedOdometer, vehicleUnit)}`
                : ''}
            </span>
          ) : null}
        </div>
        <dl className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {plan.nextDueDate || months ? (
            <DueLine
              icon="calendar"
              label="By date"
              before={showDay(plan.nextDueDate)}
              after={showDay(nextDate)}
              changed={changed.months}
              remaining={nextDate ? <DueChip remaining={daysTo(nextDate)} unit="days" /> : null}
            />
          ) : null}
          {plan.nextDueOdometer !== null || distance ? (
            <DueLine
              icon="odometer"
              label="By distance"
              before={showReading(plan.nextDueOdometer)}
              after={showReading(nextReading)}
              changed={changed.distance}
              remaining={
                nextReading !== null && currentOdometer !== null ? (
                  <DueChip remaining={nextReading - currentOdometer} unit={unitLabel} />
                ) : null
              }
            />
          ) : null}
        </dl>
        {!isActive ? (
          <p className="px-1.5 pt-2 text-xs text-muted-foreground">
            Paused — none of this comes due until it is resumed.
          </p>
        ) : null}
      </section>

      <div className="flex flex-col gap-2 sm:flex-row">
        <fieldset className="min-w-0 flex-1">
          <legend className="sr-only">Priority</legend>
          <div className="grid grid-cols-4 gap-0.5 rounded-xl bg-muted/60 p-0.5">
            {TASK_PRIORITIES.map((level) => {
              const selected = priority === level;
              return (
                <button
                  key={level}
                  type="button"
                  aria-pressed={selected}
                  aria-label={`${humanise(level)} priority`}
                  onClick={() => setPriority(level)}
                  className={cn(
                    'flex h-9 min-w-0 items-center justify-center gap-1.5 rounded-[10px] px-1 text-xs font-semibold transition-[background-color,color,box-shadow] active:scale-[0.97]',
                    selected
                      ? 'bg-card text-foreground shadow-[0_1px_2px_var(--color-shadow)] ring-1 ring-border'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  <PriorityBars level={PRIORITY_BARS[level]} lit={selected} />
                  <span className="truncate">{humanise(level)}</span>
                </button>
              );
            })}
          </div>
        </fieldset>

        {/*
         * Pausing rather than deleting. A schedule that does not apply this season is still the
         * record of how often the work is due, and deleting it to silence it loses that.
         */}
        <div
          title={isActive ? 'Counts towards what is due' : 'Kept, but never comes due'}
          className="flex h-10 shrink-0 items-center justify-between gap-3 rounded-xl bg-muted/60 pl-3.5 pr-1.5 sm:w-40"
        >
          <span className="text-sm font-semibold text-foreground">
            {isActive ? 'Counting' : 'Paused'}
          </span>
          <Switch checked={isActive} onCheckedChange={setIsActive} ariaLabel="Counting" />
        </div>
      </div>

      {mutation.isError && !fieldErrors ? (
        <FormError>{(mutation.error as Error).message}</FormError>
      ) : null}

      <ModalActions
        aside={
          <span aria-live="polite">
            {changes.length ? (
              <>
                <span className="font-mono tabular-nums text-foreground">{changes.length}</span>{' '}
                {changes.length === 1 ? 'change' : 'changes'}
                <span className="hidden sm:inline"> · {changes.join(', ')}</span>
              </>
            ) : (
              'No changes yet'
            )}
          </span>
        }
      >
        <Button variant="ghost" onClick={onCancel} disabled={mutation.isPending}>
          Cancel
        </Button>
        <Button
          type="submit"
          variant="primary"
          loading={mutation.isPending}
          disabled={changes.length === 0 || !title.trim() || noInterval}
        >
          {changes.length === 0 ? 'Nothing to save' : 'Save changes'}
        </Button>
      </ModalActions>
    </form>
  );
}
