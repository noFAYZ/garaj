import type { CSSProperties, ReactNode } from 'react';
import type { EventType } from '@vehicle-os/domain';
import { Emoji } from '@/components/emoji';
import { Icon, type IconName } from '@/components/icons';
import { eventEmoji } from '@/lib/event-emoji';
import { formatDate, formatMoney, fromMinorUnits, humanise } from '@/lib/format';
import { cn } from '@/lib/utils';

/*
 * The logbook, as one set of parts: a vehicle's Activity and the home page's recent activity are
 * the same record read from two places, so an entry looks the same wherever it is read.
 *
 * Months are chapters with a sticky heading. Down the left runs the rail, a dashed line — a road
 * through the month — with a leaf off a desk calendar on each day's first entry, a quieter stop for
 * the rest of that day, and the month's own leaf heading its chapter. Beside it the entry's card,
 * every card in the same order: the kind's stamp stuck in its corner, the kind and title with what
 * it cost, the facts it records, then its note and attachments — so a column of them reads like a
 * ledger.
 */

type Money = { amountMinor: number; currency: string };

interface Entry {
  readonly occurredAt: string;
  readonly cost: Money | null;
}

export interface MonthGroup<T> {
  readonly key: string;
  readonly month: string;
  /** "Oct": the month's leaf on the rail. */
  readonly abbr: string;
  readonly year: string;
  readonly items: T[];
}

const MONTH = new Intl.DateTimeFormat('en-US', { month: 'long' });
const MONTH_ABBR = new Intl.DateTimeFormat('en-US', { month: 'short' });
const WEEKDAY = new Intl.DateTimeFormat('en-US', { weekday: 'short' });
const pad = (value: number) => String(value).padStart(2, '0');

/**
 * Consecutive runs, not a lookup keyed by month: the record arrives newest first, so walking it and
 * starting a group when the month changes keeps that order exactly. Local months, like the leaves —
 * entries carry the real time they were logged.
 */
export function groupByMonth<T extends Entry>(items: readonly T[]): MonthGroup<T>[] {
  const groups: MonthGroup<T>[] = [];
  for (const item of items) {
    const date = new Date(item.occurredAt);
    const key = `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
    if (groups.at(-1)?.key !== key) {
      groups.push({
        key,
        month: MONTH.format(date),
        abbr: MONTH_ABBR.format(date),
        year: String(date.getFullYear()),
        items: [],
      });
    }
    groups.at(-1)!.items.push(item);
  }
  return groups;
}

/** Whether the entry at `index` is the first of its day — the one that hangs the day's leaf. */
export function startsDay(items: readonly Entry[], index: number): boolean {
  return (
    index === 0 ||
    new Date(items[index - 1]!.occurredAt).toDateString() !==
      new Date(items[index]!.occurredAt).toDateString()
  );
}

/** The month's spend, when every cost in it shares a currency; null with none, or a mix. */
function monthTotal(items: readonly Entry[]): string | null {
  const costs = items.flatMap((item) => (item.cost ? [item.cost] : []));
  if (costs.length === 0) return null;
  const currency = costs[0]!.currency;
  if (costs.some((cost) => cost.currency !== currency)) return null;
  return formatMoney({
    amountMinor: costs.reduce((sum, cost) => sum + cost.amountMinor, 0),
    currency,
  });
}

/**
 * A month's chapter heading. On the rail, the month's own leaf — the same desk-calendar leaf as
 * the days below it, its band in the brand colour so a chapter is a landmark down a long record —
 * then a rule and what it cost (when every cost in it shares a currency). The leaf already says the
 * month, so its name is written out only for a screen reader.
 * Fixed height and opaque, so entries scrolling under it never show through. `className` says
 * where it sticks: under whatever else sticks above it.
 */
export function MonthHeading({
  group,
  className,
}: {
  group: MonthGroup<Entry>;
  className: string;
}) {
  const total = monthTotal(group.items);
  return (
    <h3
      className={cn(
        // The rail's columns, so the month's leaf stands over the days' leaves.
        'z-[5] grid h-14 grid-cols-[3rem_minmax(0,1fr)] items-center gap-x-2.5 bg-background sm:gap-x-3',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="mx-auto flex w-11 flex-col overflow-hidden rounded-xl bg-card text-center ring-1 ring-border"
      >
        <span className="bg-primary text-[0.625rem] font-bold uppercase leading-4 tracking-wider text-primary-foreground">
          {group.abbr}
        </span>
        <span className="py-1 font-mono text-xs font-semibold leading-4 tabular-nums text-foreground">
          {group.year}
        </span>
      </span>
      <span className="flex min-w-0 items-center gap-3">
        <span className="sr-only">
          {group.month} {group.year}
        </span>
        <span aria-hidden="true" className="h-px min-w-4 flex-1 bg-border" />
        {total ? (
          <span className="flex shrink-0 flex-col items-end">
            <span className="text-label uppercase text-muted-foreground">Spent</span>
            <span className="font-mono text-sm font-semibold leading-tight tabular-nums text-foreground">
              {total}
            </span>
          </span>
        ) : null}
      </span>
    </h3>
  );
}

/**
 * The entry's surface: its parts stacked at one rhythm, lifting a little under the pointer like
 * every card in the app.
 */
export const ENTRY_CARD =
  'relative flex min-w-0 flex-col gap-3 rounded-2xl bg-card/50 p-3.5 transition-[background-color,translate,box-shadow] duration-200 hover:-translate-y-0.5 hover:bg-card hover:shadow-float';

/** One line of the logbook: the day on the rail, and the entry (`children`). */
export function TimelineRow({
  occurredAt,
  firstOfDay,
  last,
  index,
  children,
}: {
  occurredAt: string;
  firstOfDay: boolean;
  /** The month's last entry, where the rail stops rather than trailing off below the group. */
  last: boolean;
  /** Position in its month, for the entrance stagger. */
  index: number;
  children: ReactNode;
}) {
  const date = new Date(occurredAt);
  return (
    <li
      className="group/row stagger relative grid animate-rise grid-cols-[3rem_minmax(0,1fr)] gap-x-2.5 pb-3 sm:gap-x-3"
      style={{ '--i': index } as CSSProperties}
    >
      <div aria-hidden="true" className="relative flex items-start justify-center">
        <span
          className={cn(
            'absolute top-0 w-0.5 bg-[repeating-linear-gradient(to_bottom,var(--color-border-strong)_0_6px,transparent_6px_12px)]',
            last ? 'h-10' : '-bottom-3',
          )}
        />
        {/* Under anything that sticks above the record — the low z-index is the point. */}
        {firstOfDay ? (
          <span className="relative z-[1] flex w-11 flex-col overflow-hidden rounded-xl bg-card text-center ring-4 ring-background">
            <span className="bg-muted text-[0.625rem] font-semibold uppercase leading-4 tracking-wider text-muted-foreground">
              {WEEKDAY.format(date)}
            </span>
            <span className="py-1.5 font-mono text-lg font-semibold leading-none tabular-nums text-foreground">
              {pad(date.getDate())}
            </span>
          </span>
        ) : (
          // Level with the middle of the card's glyph.
          <span className="relative z-[1] mt-7 size-3 rounded-full border-2 border-border-strong bg-background" />
        )}
      </div>
      {children}
    </li>
  );
}

/**
 * The entry's kind as its glyph on a tile — the card's corner and the head of the entry's own
 * dialog, so the two read as one thing. Hidden from a screen reader, which hears the kind in the
 * heading beside it.
 */
export function KindIcon({
  eventType,
  size = 26,
  className,
}: {
  eventType: EventType;
  size?: number;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn('grid shrink-0 place-items-center rounded-xl bg-muted', className)}
    >
      <Emoji name={eventEmoji(eventType)} size={size} />
    </span>
  );
}

/**
 * An entry's head, always in the same order so a column of cards lines up: the kind's glyph in the
 * corner; beside it the kind — the one bold word on the card — over the title, with what it cost
 * level with them; then the rest of the entry (`children`: its note, attachments, and `Facts` last)
 * in the same column. A title that only repeats the kind ("Fuel", filed under Fuel) is left out.
 * Pointing at the entry tips the glyph a little.
 */
export function EntryHead({
  eventType,
  title,
  occurredAt,
  cost,
  children,
}: {
  eventType: EventType;
  title: string;
  occurredAt: string;
  cost: Money | null;
  children?: ReactNode;
}) {
  const kind = humanise(eventType);
  const titled = title.trim() !== '' && title.trim().toLowerCase() !== kind.toLowerCase();
  return (
    <div className="flex gap-3">
      <KindIcon
        eventType={eventType}
        className="size-11 transition-transform duration-300 ease-out group-hover/row:-rotate-6 group-hover/row:scale-105"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        <div className="flex min-h-11 items-center gap-3">
          <h4 className="min-w-0 flex-1">
            <time dateTime={occurredAt} className="sr-only">
              {formatDate(occurredAt)}:{' '}
            </time>
            <span className="block truncate font-mono text-xs font-bold uppercase tracking-wider text-foreground">
              {kind}
            </span>
            {titled ? (
              <>
                <span className="sr-only">: </span>
                <span className="mt-0.5 line-clamp-2 text-sm text-foreground">{title}</span>
              </>
            ) : null}
          </h4>
          {cost ? <Amount money={cost} /> : null}
        </div>
        {children}
      </div>
    </div>
  );
}

/** The foot of an entry: its `Fact`s as a row of badges. */
export function Facts({ children }: { children: ReactNode }) {
  return <div className="flex min-w-0 flex-wrap gap-1.5">{children}</div>;
}

/** One thing an entry records — a reading, who did it, which vehicle — as a badge: glyph, value. */
export function Fact({ icon, children }: { icon: IconName; children: ReactNode }) {
  return (
    // Wraps rather than truncates: on a phone a reading and its distance share a narrow card.
    <span className="inline-flex min-h-6 min-w-0 items-center gap-1.5 rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground">
      <Icon name={icon} size={14} className="shrink-0" />
      <span className="min-w-0 [overflow-wrap:anywhere]">{children}</span>
    </span>
  );
}

/**
 * The note in one line, under the title. A fill's quantity ("40 L", "32 kWh") is kept at the front
 * of its note by the quick entry; `fillQuantity` (`lib/quick-entry`) lifts it out so it can stand as a fact instead.
 */
export function NotePreview({ text }: { text: string }) {
  return (
    <p title={text} className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
      <Icon name="document" size={14} className="shrink-0" />
      <span className="truncate">{text}</span>
    </p>
  );
}

/**
 * Money set as a figure: the whole units at reading size, the symbol and the cents smaller and
 * quieter — the part the eye compares down a list first, then the change.
 */
export function Amount({ money, large = false }: { money: Money; large?: boolean }) {
  const parts = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: money.currency,
  }).formatToParts(fromMinorUnits(money.amountMinor, money.currency));
  return (
    <span className="shrink-0 whitespace-nowrap font-mono tabular-nums">
      <span className="sr-only">{formatMoney(money)}</span>
      <span aria-hidden="true">
        {parts.map((part, i) => (
          <span
            key={i}
            className={
              part.type === 'integer' || part.type === 'group'
                ? cn(
                    'tracking-tight text-foreground',
                    large ? 'text-2xl font-semibold' : 'text-lg font-medium',
                  )
                : cn('font-medium text-muted-foreground', large ? 'text-sm' : 'text-xs')
            }
          >
            {part.value}
          </span>
        ))}
      </span>
    </span>
  );
}
