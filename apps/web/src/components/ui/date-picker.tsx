'use client';

import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { cn } from '@/lib/utils';
import {
  addDays,
  addMonths,
  clamp,
  column,
  fromDay,
  monthGrid,
  ordered,
  toDay,
  todayDay,
  within,
  type Day,
} from './calendar-math';
import { placeList } from './select-position';

export type { Day };
export interface DateRange {
  /** `YYYY-MM-DD`, or '' for open. */
  readonly from: Day;
  readonly to: Day;
}

/** Tall enough that a calendar opens whole rather than scrolling. */
const PANEL_CAP = 520;

const MONTH = new Intl.DateTimeFormat('en-US', { month: 'long' });
const MONTH_SHORT = new Intl.DateTimeFormat('en-US', { month: 'short' });
const SPOKEN = new Intl.DateTimeFormat('en-US', {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  year: 'numeric',
});
const SHOWN = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});
const SHOWN_DAY = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
const SHOWN_FULL = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});
const WEEKDAYS = [
  ['Mo', 'Monday'],
  ['Tu', 'Tuesday'],
  ['We', 'Wednesday'],
  ['Th', 'Thursday'],
  ['Fr', 'Friday'],
  ['Sa', 'Saturday'],
  ['Su', 'Sunday'],
] as const;

const TRIGGER =
  'group relative flex h-10 w-full min-w-0 items-center gap-2 rounded-xl bg-input px-3 text-left text-sm transition-colors hover:bg-border aria-expanded:bg-border disabled:pointer-events-none disabled:opacity-50';

/*
 * The panel is a native popover, like `Select`'s list: it sits in the top layer, above a modal
 * dialog it opens from, and light dismiss — a click outside, Escape — closes only it. It is placed
 * by hand against its trigger before paint, and follows any scroll that moves the trigger.
 */
function useAnchoredPanel(open: boolean, onClosed: () => void) {
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  // A pointerdown on the trigger light-dismisses an open panel before the click arrives; the click
  // must then leave it closed rather than open it again.
  const openAtPointerDown = useRef(false);

  useLayoutEffect(() => {
    const list = panel.current;
    const anchor = trigger.current;
    if (!list || !anchor) return;
    if (!open) {
      if (list.matches(':popover-open')) list.hidePopover();
      return;
    }
    if (!list.matches(':popover-open')) list.showPopover();

    const place = () => {
      const spot = placeList(
        anchor.getBoundingClientRect(),
        { height: list.scrollHeight, width: list.offsetWidth },
        { width: window.innerWidth, height: window.innerHeight },
        PANEL_CAP,
      );
      list.style.top = `${spot.top}px`;
      list.style.left = `${spot.left}px`;
      list.style.maxHeight = `${spot.maxHeight}px`;
      list.style.transformOrigin = spot.up ? 'bottom' : 'top';
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
    const list = panel.current;
    if (!list) return;
    const onToggle = (event: Event) => {
      if ((event as ToggleEvent).newState !== 'closed') return;
      onClosed();
      // Escape leaves focus in a hidden panel; hand it back to the trigger, never to the page. A
      // click elsewhere has already moved focus where it was meant to go.
      const focused = document.activeElement;
      if (!focused || focused === document.body || list.contains(focused)) {
        trigger.current?.focus({ preventScroll: true });
      }
    };
    list.addEventListener('toggle', onToggle);
    return () => list.removeEventListener('toggle', onToggle);
  }, [onClosed]);

  const triggerProps = {
    onPointerDown: () => {
      openAtPointerDown.current = panel.current?.matches(':popover-open') ?? false;
    },
  };
  return { trigger, panel, openAtPointerDown, triggerProps };
}

type Mark = 'single' | 'start' | 'end' | 'between' | null;

/** How a range paints a day; `end` may be the day under the pointer while the range is drawn. */
function markOf(day: Day, start: Day, end: Day): Mark {
  const [from, to] = ordered(start, end);
  if (from === to) return day === from ? 'single' : null;
  if (day === from) return 'start';
  if (day === to) return 'end';
  return day > from && day < to ? 'between' : null;
}

/**
 * The calendar: a month of days, or — from its title — the months of a year and the years of a
 * dozen, so a purchase date twenty years back is three presses, not 240.
 *
 * A grid with one tab stop. The arrows move a day or a week, Page Up/Down a month (with Shift, a
 * year), Home/End the ends of the week; Enter picks. Today carries a dot under its number. Six weeks
 * always, so the panel never changes height from one month to the next.
 */
function Calendar({
  initial,
  min,
  max,
  mark,
  onPick,
  onHover,
}: {
  initial: Day;
  min?: Day;
  max?: Day;
  mark: (day: Day) => Mark;
  onPick: (day: Day) => void;
  onHover?: (day: Day | null) => void;
}) {
  const [cursor, setCursor] = useState(initial);
  const [view, setView] = useState<'days' | 'months' | 'years'>('days');
  const root = useRef<HTMLDivElement>(null);
  const moved = useRef(true);
  const date = fromDay(cursor)!;
  const year = date.getFullYear();
  const month = date.getMonth();
  const today = todayDay();

  // The keyboard follows the cursor: on opening, after an arrow, and into a new view.
  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    root.current?.querySelector<HTMLButtonElement>('[data-cursor]')?.focus({ preventScroll: true });
  }, [cursor, view]);

  const go = (next: Day) => {
    moved.current = true;
    setCursor(clamp(next, min, max));
  };
  const switchTo = (next: typeof view) => {
    moved.current = true;
    setView(next);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const steps: Record<string, () => Day> = {
      ArrowLeft: () => addDays(cursor, -1),
      ArrowRight: () => addDays(cursor, 1),
      ArrowUp: () => addDays(cursor, -7),
      ArrowDown: () => addDays(cursor, 7),
      PageUp: () => addMonths(cursor, event.shiftKey ? -12 : -1),
      PageDown: () => addMonths(cursor, event.shiftKey ? 12 : 1),
      Home: () => addDays(cursor, -column(cursor)),
      End: () => addDays(cursor, 6 - column(cursor)),
    };
    const step = steps[event.key];
    if (!step) return;
    event.preventDefault();
    go(step());
  };

  const monthStart = toDay(new Date(year, month, 1));
  const header = (
    title: ReactNode,
    titleLabel: string,
    onTitle: (() => void) | null,
    back: { label: string; to: Day; blocked: boolean },
    on: { label: string; to: Day; blocked: boolean },
  ) => (
    <div className="flex items-center justify-between gap-2 pb-2">
      <NavButton label={back.label} blocked={back.blocked} onClick={() => go(back.to)}>
        <ChevronLeft className="size-4" aria-hidden="true" />
      </NavButton>
      {onTitle ? (
        <button
          type="button"
          onClick={onTitle}
          aria-label={titleLabel}
          className="flex items-center gap-1.5 rounded-lg px-2 py-1 transition-colors hover:bg-muted"
        >
          {title}
          <ChevronDown className="size-3.5 text-muted-foreground" aria-hidden="true" />
        </button>
      ) : (
        <span className="px-2 py-1">{title}</span>
      )}
      <NavButton label={on.label} blocked={on.blocked} onClick={() => go(on.to)}>
        <ChevronRight className="size-4" aria-hidden="true" />
      </NavButton>
    </div>
  );

  if (view === 'years') {
    const first = Math.floor(year / 12) * 12;
    return (
      <div ref={root}>
        {header(
          <span className="font-mono text-sm font-semibold tabular-nums text-foreground">
            {first} – {first + 11}
          </span>,
          '',
          null,
          {
            label: 'Earlier years',
            to: addMonths(cursor, -12 * 12),
            blocked: Boolean(min && `${first - 1}-12-31` < min),
          },
          {
            label: 'Later years',
            to: addMonths(cursor, 12 * 12),
            blocked: Boolean(max && `${first + 12}-01-01` > max),
          },
        )}
        <div className="grid grid-cols-3 gap-1.5">
          {Array.from({ length: 12 }, (_, index) => {
            const candidate = first + index;
            const allowed =
              !(min && `${candidate}-12-31` < min) && !(max && `${candidate}-01-01` > max);
            const current = candidate === year;
            return (
              <button
                key={candidate}
                type="button"
                disabled={!allowed}
                data-cursor={current || undefined}
                onClick={() => {
                  go(addMonths(cursor, (candidate - year) * 12));
                  switchTo('months');
                }}
                className={cn(
                  'h-11 rounded-xl font-mono text-sm font-semibold tabular-nums transition-colors',
                  current ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-muted',
                  candidate === Number(today.slice(0, 4)) &&
                    !current &&
                    'ring-1 ring-inset ring-border-strong',
                  !allowed && 'pointer-events-none opacity-30',
                )}
              >
                {candidate}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  if (view === 'months') {
    return (
      <div ref={root}>
        {header(
          <span className="font-mono text-sm font-semibold tabular-nums text-foreground">
            {year}
          </span>,
          `Choose year, ${year}`,
          () => switchTo('years'),
          {
            label: 'Previous year',
            to: addMonths(cursor, -12),
            blocked: Boolean(min && `${year - 1}-12-31` < min),
          },
          {
            label: 'Next year',
            to: addMonths(cursor, 12),
            blocked: Boolean(max && `${year + 1}-01-01` > max),
          },
        )}
        <div className="grid grid-cols-3 gap-1.5">
          {Array.from({ length: 12 }, (_, index) => {
            const first = toDay(new Date(year, index, 1));
            const last = toDay(new Date(year, index + 1, 0));
            const allowed = !(min && last < min) && !(max && first > max);
            const current = index === month;
            return (
              <button
                key={index}
                type="button"
                disabled={!allowed}
                data-cursor={current || undefined}
                onClick={() => {
                  go(addMonths(cursor, index - month));
                  switchTo('days');
                }}
                className={cn(
                  'h-11 rounded-xl text-sm font-semibold transition-colors',
                  current ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-muted',
                  !allowed && 'pointer-events-none opacity-30',
                )}
              >
                {MONTH_SHORT.format(new Date(year, index, 1))}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  const days = monthGrid(year, month);
  return (
    <div ref={root}>
      {header(
        <span className="flex items-baseline gap-1.5">
          <span className="text-sm font-bold text-foreground">{MONTH.format(date)}</span>
          <span className="font-mono text-xs tabular-nums text-muted-foreground">{year}</span>
        </span>,
        `Choose month, ${MONTH.format(date)} ${year}`,
        () => switchTo('months'),
        {
          label: 'Previous month',
          to: addMonths(cursor, -1),
          blocked: Boolean(min && addDays(monthStart, -1) < min),
        },
        {
          label: 'Next month',
          to: addMonths(cursor, 1),
          blocked: Boolean(max && addMonths(monthStart, 1) > max),
        },
      )}
      <div
        role="grid"
        aria-label={`${MONTH.format(date)} ${year}`}
        onKeyDown={onKeyDown}
        onPointerLeave={() => onHover?.(null)}
      >
        <div role="row" className="grid grid-cols-7 pb-1">
          {WEEKDAYS.map(([short, long]) => (
            <span
              key={short}
              role="columnheader"
              aria-label={long}
              className="grid h-7 place-items-center text-[0.6875rem] font-semibold text-muted-foreground"
            >
              {short}
            </span>
          ))}
        </div>
        {[0, 1, 2, 3, 4, 5].map((week) => (
          <div key={week} role="row" className="grid grid-cols-7">
            {days.slice(week * 7, week * 7 + 7).map((day, index) => {
              const shown = fromDay(day)!;
              const outside = shown.getMonth() !== month;
              const allowed = within(day, min, max);
              const marked = mark(day);
              const end = marked === 'single' || marked === 'start' || marked === 'end';
              return (
                <div
                  key={day}
                  role="gridcell"
                  aria-selected={marked !== null}
                  className={cn(
                    'py-0.5',
                    // The range's band runs edge to edge and rounds off at the week's ends.
                    marked === 'between' && 'bg-primary-soft',
                    marked === 'between' && index === 0 && 'rounded-l-xl',
                    marked === 'between' && index === 6 && 'rounded-r-xl',
                    marked === 'start' &&
                      'bg-[linear-gradient(to_right,transparent_50%,var(--color-primary-soft)_50%)]',
                    marked === 'end' &&
                      'bg-[linear-gradient(to_left,transparent_50%,var(--color-primary-soft)_50%)]',
                  )}
                >
                  <button
                    type="button"
                    tabIndex={day === cursor ? 0 : -1}
                    data-cursor={day === cursor || undefined}
                    disabled={!allowed}
                    aria-label={SPOKEN.format(shown)}
                    aria-current={day === today ? 'date' : undefined}
                    onClick={() => onPick(day)}
                    onPointerEnter={() => onHover?.(day)}
                    onFocus={() => {
                      setCursor(day);
                      onHover?.(day);
                    }}
                    className={cn(
                      'relative mx-auto grid size-9 place-items-center rounded-xl font-mono text-sm tabular-nums transition-[background-color,color,scale] duration-150 active:scale-90',
                      end
                        ? 'bg-primary font-semibold text-primary-foreground'
                        : marked === 'between'
                          ? 'text-foreground hover:bg-primary-soft'
                          : outside
                            ? 'text-muted-foreground/45 hover:bg-muted'
                            : 'text-foreground hover:bg-muted',
                      day === today && !end && 'font-bold',
                      !allowed && 'pointer-events-none opacity-25',
                    )}
                  >
                    {shown.getDate()}
                    {day === today ? (
                      <span
                        aria-hidden="true"
                        className={cn(
                          'absolute bottom-1 size-1 rounded-full',
                          end ? 'bg-primary-foreground' : 'bg-primary',
                        )}
                      />
                    ) : null}
                  </button>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function NavButton({
  label,
  blocked,
  onClick,
  children,
}: {
  label: string;
  blocked: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={blocked}
      onClick={onClick}
      className="grid size-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
    >
      {children}
    </button>
  );
}

function QuickChip({
  selected = false,
  onClick,
  children,
  className,
}: {
  selected?: boolean;
  onClick: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        'h-8 shrink-0 rounded-lg px-2.5 text-xs font-semibold transition-colors',
        selected
          ? 'bg-primary-soft text-foreground'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
        className,
      )}
    >
      {children}
    </button>
  );
}

const PANEL =
  'm-0 max-w-[calc(100vw-1rem)] animate-pop overflow-y-auto overscroll-contain rounded-2xl border-0 bg-popover p-3 text-foreground shadow-float [inset:auto]';

interface PickerBase {
  /** Names the control; with its value, it is what a screen reader hears on the trigger. */
  label: string;
  min?: Day;
  max?: Day;
  placeholder?: string;
  disabled?: boolean;
  /** For a `<label htmlFor>` elsewhere; pressing that label opens the picker. */
  id?: string;
  describedBy?: string;
  invalid?: boolean;
  className?: string;
  /** For a trigger set into a surface that already draws the field — a spec-sheet cell, a reading. */
  triggerClassName?: string;
  /** Leave the calendar glyph off a trigger whose surface already says it is a date. */
  hideIcon?: boolean;
}

/**
 * A date, chosen from a calendar rather than typed into the browser's own control — which looks
 * different in every browser, cannot be styled, and on desktop opens a calendar no one can find.
 *
 * The trigger shows the day in words ("Sun, Oct 4, 2026"). The panel adds what a native picker
 * lacks: the days that matter one press away (yesterday, today, tomorrow, as the bounds allow), a
 * jump to any month and year from the title, and Clear when the field may be empty. Values are
 * `YYYY-MM-DD` strings, exactly what `<input type="date">` gave, so callers change nothing else.
 */
export function DatePicker({
  value,
  onChange,
  required = false,
  label,
  min,
  max,
  placeholder = 'Pick a date',
  disabled,
  id,
  describedBy,
  invalid,
  className,
  triggerClassName,
  hideIcon = false,
  shown,
}: PickerBase & {
  /** `YYYY-MM-DD`, or '' for none. */
  value: Day;
  onChange: (value: Day) => void;
  required?: boolean;
  /** The day as the trigger says it, where the date in full is too long: "Today", "Sat 3 Oct". */
  shown?: (day: Day) => string;
}) {
  const [open, setOpen] = useState(false);
  const onClosed = useCallback(() => setOpen(false), []);
  const { trigger, panel, openAtPointerDown, triggerProps } = useAnchoredPanel(open, onClosed);
  const panelId = useId();
  const date = value ? fromDay(value) : null;
  const today = todayDay();

  const pick = (day: Day) => {
    if (day !== value) onChange(day);
    trigger.current?.focus({ preventScroll: true });
    setOpen(false);
  };
  const quick = [
    { label: 'Yesterday', day: addDays(today, -1) },
    { label: 'Today', day: today },
    { label: 'Tomorrow', day: addDays(today, 1) },
  ].filter((option) => within(option.day, min, max));

  return (
    <div className={cn('relative min-w-0', className)}>
      <button
        ref={trigger}
        id={id}
        type="button"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`${label}, ${date ? SPOKEN.format(date) : 'not set'}`}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        {...triggerProps}
        onClick={() => {
          if (openAtPointerDown.current || open) {
            openAtPointerDown.current = false;
            setOpen(false);
            return;
          }
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
        className={cn(TRIGGER, invalid && 'ring-2 ring-destructive', triggerClassName)}
      >
        {hideIcon ? null : (
          <CalendarDays
            aria-hidden="true"
            className="size-4 shrink-0 text-muted-foreground transition-colors group-aria-expanded:text-foreground"
          />
        )}
        <span
          className={cn(
            'min-w-0 flex-1 truncate',
            date ? 'text-foreground' : 'text-muted-foreground',
          )}
        >
          {date ? (shown?.(value) ?? SHOWN.format(date)) : placeholder}
        </span>
      </button>

      {/* Keeps a required date required: the form's own check stops on it, and focus lands here. */}
      {required ? (
        <input
          tabIndex={-1}
          aria-hidden="true"
          required
          value={value}
          onChange={() => {}}
          onInvalid={() => trigger.current?.focus()}
          className="sr-only"
        />
      ) : null}

      {/* No display utility here: a closed popover is hidden with `display: none`. */}
      <div
        ref={panel}
        id={panelId}
        role="dialog"
        aria-label={`Choose ${label.toLowerCase()}`}
        popover="auto"
        className={cn(PANEL, 'w-[19rem]')}
      >
        {open ? (
          <>
            <Calendar
              initial={clamp(date ? value : today, min, max)}
              min={min}
              max={max}
              mark={(day) => (day === value ? 'single' : null)}
              onPick={pick}
            />
            <div className="mt-2 flex items-center gap-1 border-t border-border/60 pt-2">
              {quick.map((option) => (
                <QuickChip
                  key={option.label}
                  selected={value === option.day}
                  onClick={() => pick(option.day)}
                >
                  {option.label}
                </QuickChip>
              ))}
              {!required && value ? (
                <QuickChip onClick={() => pick('')} className="ml-auto">
                  Clear
                </QuickChip>
              ) : null}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

/** "Jan 1 – Oct 5, 2026": the year once when both ends share it. */
export function formatRange(range: DateRange, placeholder = 'Any time'): string {
  const from = range.from ? fromDay(range.from) : null;
  const to = range.to ? fromDay(range.to) : null;
  if (from && to) {
    if (range.from === range.to) return SHOWN_FULL.format(from);
    const sameYear = from.getFullYear() === to.getFullYear();
    return `${(sameYear ? SHOWN_DAY : SHOWN_FULL).format(from)} – ${SHOWN_FULL.format(to)}`;
  }
  if (from) return `From ${SHOWN_FULL.format(from)}`;
  if (to) return `Until ${SHOWN_FULL.format(to)}`;
  return placeholder;
}

/**
 * A span of days, drawn on one calendar: the first press sets one end, the band follows the pointer
 * to show what the second would make, and the second press sets the other end — in either order.
 * Beside the calendar, the spans people actually ask for, one press each. `clearable` adds "All
 * time" for a range that may be left open.
 */
export function DateRangePicker({
  value,
  onChange,
  clearable = false,
  label,
  min,
  max,
  placeholder = 'Any time',
  disabled,
  id,
  describedBy,
  invalid,
  className,
  triggerClassName,
  hideIcon = false,
}: PickerBase & {
  value: DateRange;
  onChange: (value: DateRange) => void;
  clearable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  // The first end, while the second is still to be picked.
  const [anchor, setAnchor] = useState<Day | null>(null);
  const [hover, setHover] = useState<Day | null>(null);
  const onClosed = useCallback(() => {
    setOpen(false);
    setAnchor(null);
    setHover(null);
  }, []);
  const { trigger, panel, openAtPointerDown, triggerProps } = useAnchoredPanel(open, onClosed);
  const panelId = useId();
  const today = todayDay();
  const text = formatRange(value, placeholder);

  const commit = (next: DateRange) => {
    onChange(next);
    trigger.current?.focus({ preventScroll: true });
    onClosed();
  };
  const pick = (day: Day) => {
    if (anchor === null) {
      setAnchor(day);
      return;
    }
    const [from, to] = ordered(anchor, day);
    commit({ from, to });
  };

  const presets: { label: string; range: DateRange }[] = [
    { label: 'Last 7 days', range: { from: addDays(today, -6), to: today } },
    { label: 'Last 30 days', range: { from: addDays(today, -29), to: today } },
    { label: 'This month', range: { from: `${today.slice(0, 7)}-01`, to: today } },
    { label: 'This year', range: { from: `${today.slice(0, 4)}-01-01`, to: today } },
    { label: 'Last 12 months', range: { from: addDays(addMonths(today, -12), 1), to: today } },
  ].map((preset) => ({
    ...preset,
    range: { from: clamp(preset.range.from, min, max), to: clamp(preset.range.to, min, max) },
  }));

  const mark = (day: Day): Mark => {
    if (anchor !== null) return markOf(day, anchor, hover ?? anchor);
    if (value.from && value.to) return markOf(day, value.from, value.to);
    if (value.from || value.to) return day === (value.from || value.to) ? 'single' : null;
    return null;
  };

  return (
    <div className={cn('relative min-w-0', className)}>
      <button
        ref={trigger}
        id={id}
        type="button"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`${label}, ${text}`}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        {...triggerProps}
        onClick={() => {
          if (openAtPointerDown.current || open) {
            openAtPointerDown.current = false;
            onClosed();
            return;
          }
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
        className={cn(TRIGGER, invalid && 'ring-2 ring-destructive', triggerClassName)}
      >
        {hideIcon ? null : (
          <CalendarDays
            aria-hidden="true"
            className="size-4 shrink-0 text-muted-foreground transition-colors group-aria-expanded:text-foreground"
          />
        )}
        <span
          className={cn(
            'min-w-0 flex-1 truncate',
            value.from || value.to ? 'text-foreground' : 'text-muted-foreground',
          )}
        >
          {text}
        </span>
      </button>

      <div
        ref={panel}
        id={panelId}
        role="dialog"
        aria-label={`Choose ${label.toLowerCase()}`}
        popover="auto"
        className={cn(PANEL, 'w-[19rem] sm:w-[29rem]')}
      >
        {open ? (
          <div className="flex flex-col gap-3 sm:flex-row">
            <div
              role="group"
              aria-label="Common ranges"
              className="flex flex-wrap gap-1 sm:w-32 sm:shrink-0 sm:flex-col sm:flex-nowrap sm:border-r sm:border-border/60 sm:pr-3"
            >
              {presets.map((preset) => (
                <QuickChip
                  key={preset.label}
                  selected={value.from === preset.range.from && value.to === preset.range.to}
                  onClick={() => commit(preset.range)}
                  className="sm:text-left"
                >
                  {preset.label}
                </QuickChip>
              ))}
              {clearable ? (
                <QuickChip
                  selected={!value.from && !value.to}
                  onClick={() => commit({ from: '', to: '' })}
                  className="sm:text-left"
                >
                  All time
                </QuickChip>
              ) : null}
            </div>
            <div className="min-w-0 flex-1">
              <Calendar
                initial={clamp(value.to || value.from || today, min, max)}
                min={min}
                max={max}
                mark={mark}
                onPick={pick}
                onHover={anchor !== null ? setHover : undefined}
              />
              <p
                aria-live="polite"
                className="mt-2 border-t border-border/60 pt-2 text-xs text-muted-foreground"
              >
                {anchor !== null ? (
                  <>
                    <span className="font-semibold text-foreground">
                      {SHOWN_FULL.format(fromDay(anchor)!)}
                    </span>{' '}
                    — now pick the other end
                  </>
                ) : (
                  'Pick the first day, then the last'
                )}
              </p>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

interface FieldFrame {
  label: string;
  hint?: string;
  error?: string;
  className?: string;
}

/** The label, the control, and its hint or error — `Field`'s frame around any picker. */
function Framed({
  label,
  hint,
  error,
  className,
  children,
}: FieldFrame & {
  children: (props: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        {label}
      </label>
      {children({
        id,
        describedBy: cn(hint && !error && hintId, error && errorId) || undefined,
        invalid: Boolean(error),
      })}
      {hint && !error ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** A labelled date, shaped like `Field`: the drop-in for `<Field type="date">`. */
export function DateField({
  label,
  hint,
  error,
  className,
  ...picker
}: FieldFrame &
  Omit<
    Parameters<typeof DatePicker>[0],
    'label' | 'id' | 'describedBy' | 'invalid' | 'className'
  >) {
  return (
    <Framed label={label} hint={hint} error={error} className={className}>
      {(frame) => <DatePicker label={label} {...frame} {...picker} />}
    </Framed>
  );
}

/** A labelled span of days, shaped like `Field`. */
export function DateRangeField({
  label,
  hint,
  error,
  className,
  ...picker
}: FieldFrame &
  Omit<
    Parameters<typeof DateRangePicker>[0],
    'label' | 'id' | 'describedBy' | 'invalid' | 'className'
  >) {
  return (
    <Framed label={label} hint={hint} error={error} className={className}>
      {(frame) => <DateRangePicker label={label} {...frame} {...picker} />}
    </Framed>
  );
}
