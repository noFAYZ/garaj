import type { CSSProperties } from 'react';
import { Emoji, type EmojiName } from '@/components/emoji';

interface Entry {
  day: string;
  weekday: string;
  emoji: EmojiName;
  title: string;
  type: string;
  odometer?: string;
  /** Distance since the reading before it, as the logbook shows it. */
  since?: string;
  where?: string;
  cost: string;
  /** Where it lies in the heap, relative to its line: across (a share of the row), down, tilt. */
  heap: [x: string, y: string, tilt: string];
}

/** The Daily Driver's logbook in the demo garage, as the app shows it. */
const MONTHS: { month: string; summary: string; entries: Entry[] }[] = [
  {
    month: 'September 2026',
    summary: '1 entry · $59.80',
    entries: [
      {
        day: '11',
        weekday: 'Fri',
        emoji: 'fuel',
        title: 'Fill-up',
        type: 'Fuel',
        odometer: '92,310 km',
        since: '+830 km',
        where: 'BP',
        cost: '$59.80',
        heap: ['7%', '226px', '-8deg'],
      },
    ],
  },
  {
    month: 'August 2026',
    summary: '2 entries · $109.70',
    entries: [
      {
        day: '26',
        weekday: 'Wed',
        emoji: 'cleaning',
        title: 'Full valet',
        type: 'Cleaning',
        where: 'Sparkle Wash',
        cost: '$45.00',
        heap: ['-9%', '106px', '6deg'],
      },
      {
        day: '15',
        weekday: 'Sat',
        emoji: 'fuel',
        title: 'Fill-up',
        type: 'Fuel',
        odometer: '91,480 km',
        since: '+840 km',
        where: 'Shell',
        cost: '$64.70',
        heap: ['12%', '-14px', '-11deg'],
      },
    ],
  },
  {
    month: 'July 2026',
    summary: '1 entry · $60.10',
    entries: [
      {
        day: '17',
        weekday: 'Fri',
        emoji: 'fuel',
        title: 'Fill-up',
        type: 'Fuel',
        odometer: '90,640 km',
        since: '+820 km',
        where: 'Shell',
        cost: '$60.10',
        heap: ['-5%', '-122px', '9deg'],
      },
    ],
  },
  {
    month: 'June 2026',
    summary: '1 entry · $63.20',
    entries: [
      {
        day: '17',
        weekday: 'Wed',
        emoji: 'fuel',
        title: 'Fill-up',
        type: 'Fuel',
        odometer: '89,820 km',
        since: '+870 km',
        where: 'BP',
        cost: '$63.20',
        heap: ['3%', '-246px', '-3deg'],
      },
    ],
  },
];

/**
 * The glovebox, sorted: five receipts in a heap that file themselves into the logbook as the
 * stage scrolls up the screen (landing.css, "The glovebox, sorted"). The markup is the finished
 * logbook — a reader without scroll-driven animation, or who asked for less motion, gets exactly
 * that, and so does a screen reader.
 *
 * Laid out as the product lays out its Done list: a stamp, the rail with each entry's marker, and
 * the entry — title and cost, then its type, the odometer with the distance since the reading
 * before, and where.
 */
export function Logbook() {
  let index = -1;
  return (
    <div className="sort-stage flex flex-col gap-6">
      {MONTHS.map((group) => (
        <section key={group.month} aria-label={group.month}>
          <h3 className="sort-late mb-3 flex items-baseline justify-between gap-3 text-label uppercase text-muted-foreground">
            {group.month}
            <span className="font-mono text-xs normal-case tracking-normal">{group.summary}</span>
          </h3>
          <ol className="relative flex flex-col gap-2">
            {group.entries.length > 1 ? (
              <span
                aria-hidden="true"
                className="sort-late absolute bottom-10 left-[calc(4.25rem-0.5px)] top-6 w-px bg-border-strong"
              />
            ) : null}
            {group.entries.map((entry) => {
              index += 1;
              const [x, y, tilt] = entry.heap;
              return (
                <li
                  key={`${entry.day}-${entry.title}`}
                  className="sort-item relative grid grid-cols-[2.25rem_2.5rem_minmax(0,1fr)] items-start gap-3"
                  style={{ '--i': index, '--px': x, '--py': y, '--pr': tilt } as CSSProperties}
                >
                  <p className="sort-late pt-1.5 text-center">
                    <span className="block font-mono text-base font-semibold leading-5 tabular-nums">
                      {entry.day}
                    </span>
                    <span className="block text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                      {entry.weekday}
                    </span>
                  </p>
                  <span className="relative mt-1 grid size-10 place-items-center rounded-full bg-muted ring-4 ring-background">
                    <Emoji name={entry.emoji} size={20} />
                  </span>
                  <div className="relative isolate rounded-2xl bg-card px-4 py-3">
                    {/* The receipt it was: torn paper over the row, falling away as it lands. */}
                    <span
                      aria-hidden="true"
                      className="sort-paper receipt absolute -inset-y-1.5 inset-x-0 -z-10 bg-muted"
                    />
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="truncate text-sm font-semibold">{entry.title}</p>
                      <p className="shrink-0 font-mono text-sm font-semibold tabular-nums">
                        {entry.cost}
                      </p>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                      <span className="rounded-full bg-muted px-2.5 py-1 font-semibold">
                        {entry.type}
                      </span>
                      {entry.odometer ? (
                        <span className="rounded-full bg-muted px-2.5 py-1 font-mono tabular-nums text-muted-foreground">
                          {entry.odometer}{' '}
                          <span className="font-semibold text-foreground">{entry.since}</span>
                        </span>
                      ) : null}
                      {entry.where ? (
                        <span className="text-muted-foreground">{entry.where}</span>
                      ) : null}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}
