import { ArrowDownRight, ArrowRight, ArrowUpRight } from 'lucide-react';
import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Odometer } from '@/components/ui/instruments';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { formatCount, formatExact } from '../lib/format';
import { Spark, Sparkbars, TimeChart } from './chart';
import { Chip, Segmented } from './ui';

/*
 * Direction and verdict are separate: the arrow says up or down, the colour says whether that is
 * good. For most measures up is good; for failures (`better: 'down'`) a rise is red. A measure
 * moves when this window beats or trails the one before by 5% or more; with nothing to compare
 * against (the 90-day window is the longest the API keeps), it says nothing rather than guess.
 */
export type Direction = 'up' | 'down' | 'flat';
export type Better = 'up' | 'down';

export const directionOf = (now: number | undefined, before: number | undefined): Direction => {
  if (now === undefined || before === undefined) return 'flat';
  if (before === 0) return now > 0 ? 'up' : 'flat';
  const change = (now - before) / before;
  return change >= 0.05 ? 'up' : change <= -0.05 ? 'down' : 'flat';
};

/** This window against the one before, as an arrow and a percentage — never colour alone. */
export function Delta({
  now,
  before,
  days,
  better = 'up',
}: {
  now: number | undefined;
  before: number | undefined;
  days: number;
  better?: Better;
}) {
  if (now === undefined || before === undefined) return null;
  const direction = directionOf(now, before);
  const tone = direction === 'flat' ? 'muted' : direction === better ? 'success' : 'destructive';
  if (before === 0) {
    return now > 0 ? (
      <Chip tone={tone} title={`None in the ${days} days before`}>
        New
      </Chip>
    ) : null;
  }
  const change = Math.round(((now - before) / before) * 100);
  const Arrow =
    direction === 'up' ? ArrowUpRight : direction === 'down' ? ArrowDownRight : ArrowRight;
  return (
    <Chip tone={tone} title={`${formatExact(before)} in the ${days} days before`}>
      <Arrow className="-ml-1 size-3.5" aria-hidden="true" />
      <span className="font-mono tabular-nums">{Math.abs(change)}%</span>
      <span className="sr-only">
        {change > 0 ? 'up' : change < 0 ? 'down' : 'unchanged'} on the {days} days before
      </span>
    </Chip>
  );
}

export interface Metric {
  key: string;
  label: string;
  /** The big figure: a level (a total) or the window's sum. `undefined` while it loads. */
  value: number | undefined;
  /** A short line under it: "+25 in 30 days". */
  sub?: string;
  now?: number;
  before?: number;
  better?: Better;
  /** The running level per day, for the line. */
  levels?: number[];
  /** What each day added, for the columns. */
  daily?: number[];
  format?: (value: number) => string;
}

/**
 * Totals that are also the tabs of the chart under them: pick a figure, the chart draws it. The
 * figures turn like an odometer's drums, the lit tab's line is copper and the rest are grey, and
 * `extra` is one more cell that is not a tab — a live figure with no history to chart.
 */
export function MetricTabs({
  label,
  metrics,
  days,
  dayKeys,
  modes,
  extra,
  className,
}: {
  label: string;
  metrics: Metric[];
  /** The window, for the deltas' wording. */
  days: number;
  /** The window's days, `YYYY-MM-DD`, aligned with each metric's series. */
  dayKeys: string[] | undefined;
  modes: readonly ('total' | 'daily')[];
  extra?: ReactNode;
  className?: string;
}) {
  const [key, setKey] = useState(metrics[0]!.key);
  const [mode, setMode] = useState(modes[0]!);
  const base = useId();
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const selected = metrics.find((metric) => metric.key === key) ?? metrics[0]!;
  const series = mode === 'total' ? selected.levels : selected.daily;
  const format = selected.format ?? formatCount;

  const onKeyDown = (event: KeyboardEvent, index: number) => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const next = (index + step + metrics.length) % metrics.length;
    tabs.current[next]?.focus();
    setKey(metrics[next]!.key);
  };

  return (
    <section
      aria-label={label}
      className={cn('flex flex-col rounded-2xl bg-card/50 p-2', className)}
    >
      <div
        className={cn(
          'grid grid-cols-2 gap-1',
          metrics.length + (extra ? 1 : 0) >= 4 ? 'lg:grid-cols-4' : 'lg:grid-cols-3',
        )}
      >
        <div role="tablist" aria-label={label} className="contents">
          {metrics.map((metric, index) => {
            const on = metric.key === selected.key;
            return (
              <button
                key={metric.key}
                ref={(node) => {
                  tabs.current[index] = node;
                }}
                id={`${base}-tab-${metric.key}`}
                type="button"
                role="tab"
                aria-selected={on}
                aria-controls={`${base}-panel`}
                tabIndex={on ? 0 : -1}
                onClick={() => setKey(metric.key)}
                onKeyDown={(event) => onKeyDown(event, index)}
                className={cn(
                  'group relative flex min-w-0 flex-col gap-2 overflow-hidden rounded-xl p-4 text-left transition-colors',
                  on ? 'bg-card' : 'hover:bg-card/60',
                )}
              >
                {/* The lit tab: a copper rule along its top, like a lamp over the gauge it names. */}
                <span
                  aria-hidden="true"
                  className={cn(
                    'absolute inset-x-4 top-0 h-[3px] rounded-b-full bg-primary transition-opacity',
                    on ? 'opacity-100' : 'opacity-0',
                  )}
                />
                <span className="truncate text-label uppercase text-muted-foreground">
                  {metric.label}
                </span>
                {metric.value === undefined ? (
                  <Skeleton className="h-9 w-24" />
                ) : (
                  <span className="truncate font-mono text-[1.9rem] font-semibold leading-9 tracking-tight">
                    {metric.value < 1_000_000 && Number.isInteger(metric.value) ? (
                      <Odometer
                        value={metric.value}
                        digits={Math.max(3, String(metric.value).length)}
                      />
                    ) : (
                      <span aria-hidden="true">{(metric.format ?? formatCount)(metric.value)}</span>
                    )}
                    <span className="sr-only">{formatExact(metric.value)}</span>
                  </span>
                )}
                <span className="flex min-h-6 flex-wrap items-center gap-x-2 gap-y-1">
                  {metric.sub ? (
                    <span className="font-mono text-xs font-semibold tabular-nums text-muted-foreground">
                      {metric.sub}
                    </span>
                  ) : null}
                  <Delta
                    now={metric.now}
                    before={metric.before}
                    days={days}
                    better={metric.better}
                  />
                </span>
                {mode === 'total' && metric.levels ? (
                  <Spark
                    values={metric.levels}
                    color={on ? 'var(--color-primary)' : 'var(--color-muted-foreground)'}
                  />
                ) : (
                  <Sparkbars
                    values={metric.daily}
                    color={
                      on
                        ? 'var(--color-primary)'
                        : 'color-mix(in oklch, var(--color-muted-foreground) 55%, transparent)'
                    }
                  />
                )}
              </button>
            );
          })}
        </div>
        {extra}
      </div>

      <div
        id={`${base}-panel`}
        role="tabpanel"
        aria-labelledby={`${base}-tab-${selected.key}`}
        className="flex flex-col gap-4 px-3 pb-3 pt-5 sm:px-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
            {selected.label}
            <span className="font-normal text-muted-foreground">
              {mode === 'total' ? 'running total' : 'per day'} · last {days} days
            </span>
          </p>
          {modes.length > 1 ? (
            <Segmented
              label="Show"
              size="sm"
              value={mode}
              onChange={setMode}
              options={modes.map((value) => ({
                value,
                label: value === 'total' ? 'Total' : 'Daily',
              }))}
            />
          ) : null}
        </div>
        {dayKeys && series ? (
          <TimeChart
            key={`${selected.key}-${mode}-${days}`}
            days={dayKeys}
            series={[
              {
                key: selected.key,
                label: selected.label,
                color: 'var(--color-primary)',
                values: series,
              },
            ]}
            mode={mode === 'total' ? 'area' : 'bars'}
            fit={mode === 'total'}
            trend={mode === 'daily' && days > 7}
            legend={false}
            format={format}
            caption={`${selected.label}, ${mode === 'total' ? 'running total' : 'added'} per day`}
            detail={
              mode === 'total' && selected.daily
                ? (i) => (
                    <span className="font-mono tabular-nums">
                      +{formatExact(selected.daily![i] ?? 0)} that day
                    </span>
                  )
                : undefined
            }
          />
        ) : (
          <Skeleton className="h-[220px] w-full rounded-xl" />
        )}
      </div>
    </section>
  );
}

/** The one cell of a tab row that is not a tab: a readout with no chart of its own. */
export function Cell({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-xl p-4">
      <span className="flex items-center gap-2 text-label uppercase text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  );
}
