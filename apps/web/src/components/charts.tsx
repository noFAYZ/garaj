'use client';

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/*
 * The report's charts, drawn with divs and a little SVG against the house tokens.
 *
 * Not a charting library: Recharts is ~90 kB gzipped and brings its own layout engine to draw a
 * few dozen rectangles, and its defaults are the first thing that would have to be styled back
 * to these tokens. The mobile app draws the same forms with react-native-svg
 * (`apps/mobile/components/charts.tsx`); the two follow one set of rules:
 *
 * - Colour carries identity only: each report group owns one hue (`CHART`) on every screen.
 *   Text stays in ink; a swatch beside it carries the series.
 * - Thin marks, a 2px gap of card between touching fills, bars rounded at the data end only.
 * - One recessive grid, one axis. Two measures of different scale get two charts.
 * - Hover (or tap) reads any mark out, and every chart has a table behind it for a screen
 *   reader — a chart with no text alternative is a picture of data.
 */

/** The series hues, as the tokens that theme them. */
export const CHART = {
  REFUELING: 'var(--color-chart-refuel)',
  SERVICES: 'var(--color-chart-service)',
  EXPENSES: 'var(--color-chart-expense)',
  income: 'var(--color-chart-income)',
  trip: 'var(--color-chart-trip)',
  neutral: 'var(--color-chart-neutral)',
} as const;

export interface ChartSeries {
  key: string;
  label: string;
  color: string;
}

export interface ColumnBucket {
  key: string;
  /** Under the column: `Sep`, `’25`. */
  label: string;
  /** In the readout: `September 2026`. */
  long: string;
  values: Record<string, number>;
}

export interface Slice {
  key: string;
  label: string;
  value: number;
  display: string;
  color: string;
}

const share = (value: number, total: number) => `${Math.round((value / (total || 1)) * 100)}%`;

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry!.contentRect.width));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

function Swatch({ color, className }: { color: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn('inline-block size-2 shrink-0 rounded-[2.5px]', className)}
      style={{ backgroundColor: color }}
    />
  );
}

/**
 * Columns over time, headed by their own figure: one series, several stacked, or two side by side
 * (`group`). At rest the head says `label` and the window's total (or `total`); hovering a column
 * turns it into that column's period and figure, each series beside its swatch. A quiet period
 * is a hairline, not a gap: nothing spent and nothing known are opposites. The columns rise from
 * the axis in a wave from the oldest. Columns are not focus stops; the table under it is the data.
 */
export function ColumnChart({
  buckets,
  series,
  mode = 'stack',
  format,
  formatAxis = format,
  label,
  total,
  trailing,
  legend = true,
  large = true,
  height = 168,
}: {
  buckets: readonly ColumnBucket[];
  series: readonly ChartSeries[];
  mode?: 'stack' | 'group';
  format: (value: number) => string;
  formatAxis?: (value: number) => string;
  /** What the resting figure is: "Running cost". */
  label: string;
  /** The resting figure, when it is not the sum of the columns (an average, say). */
  total?: number;
  /** Beside the label: a count, an action. */
  trailing?: ReactNode;
  /** The series key; off where a split under the chart names them instead. */
  legend?: boolean;
  /** The card's headline figure, or a smaller one inside a card that has its own. */
  large?: boolean;
  height?: number;
}) {
  const [active, setActive] = useState<number | null>(null);
  const totals = buckets.map((bucket) =>
    series.reduce((sum, line) => sum + (bucket.values[line.key] ?? 0), 0),
  );
  const peak =
    Math.max(
      ...buckets.flatMap((bucket, index) =>
        mode === 'stack' ? [totals[index]!] : series.map((line) => bucket.values[line.key] ?? 0),
      ),
      0,
    ) || 1;
  const shown = active === null ? null : buckets[active]!;
  // Every label while they fit; past eight, every other one or so, or they run into a smear.
  const every = buckets.length > 8 ? Math.ceil(buckets.length / 7) : 1;
  const headline =
    mode === 'group' && shown
      ? (shown.values[series[0]!.key] ?? 0)
      : shown
        ? totals[active!]!
        : (total ?? totals.reduce((sum, value) => sum + value, 0));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-0.5">
        <div className="flex min-h-6 items-center gap-2">
          <p
            aria-live="polite"
            className="min-w-0 flex-1 truncate text-label uppercase text-muted-foreground"
          >
            {shown ? shown.long : label}
          </p>
          {trailing}
        </div>
        <p
          className={cn(
            'truncate font-mono font-semibold tabular-nums tracking-tight text-foreground',
            large ? 'text-[2rem] leading-10' : 'text-xl',
          )}
        >
          {format(headline)}
        </p>
        {legend && series.length > 1 ? (
          <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
            {series.map((line) => (
              <li
                key={line.key}
                className="flex items-center gap-1.5 text-xs text-muted-foreground"
              >
                <Swatch color={line.color} />
                {line.label}
                {shown ? (
                  <span className="font-mono font-semibold tabular-nums text-foreground">
                    {format(shown.values[line.key] ?? 0)}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="relative" aria-hidden="true">
        {/* The grid: the peak and its half, labelled at the right, under the marks. */}
        {[1, 0.5].map((part) => (
          <div
            key={part}
            className="pointer-events-none absolute inset-x-0 flex items-center gap-2"
            style={{ top: `${(1 - part) * height}px` }}
          >
            <span className="h-px flex-1 bg-border/70" />
            <span className="w-10 text-right font-mono text-[10px] tabular-nums text-muted-foreground">
              {formatAxis(peak * part)}
            </span>
          </div>
        ))}
        {/* Positioned, so it paints over the grid: an absolute sibling otherwise lands on top. */}
        <div
          className="relative flex items-end gap-1 border-b border-border pr-12"
          style={{ height }}
          onMouseLeave={() => setActive(null)}
        >
          {buckets.map((bucket, index) => {
            const dim = active !== null && active !== index;
            return (
              <div
                key={bucket.key}
                onMouseEnter={() => setActive(index)}
                onClick={() => setActive(active === index ? null : index)}
                className="flex h-full min-w-0 flex-1 cursor-default items-end justify-center"
              >
                <div
                  className={cn(
                    'bar-grow flex h-full w-full max-w-7 items-end transition-opacity duration-150',
                    mode === 'stack' ? 'flex-col-reverse justify-start gap-[2px]' : 'gap-[2px]',
                    dim && 'opacity-35',
                  )}
                  style={{ '--i': index } as CSSProperties}
                >
                  {totals[index] === 0 ? (
                    <span className="h-0.5 w-full rounded-full bg-border" />
                  ) : (
                    series.map((line, position) => {
                      const value = bucket.values[line.key] ?? 0;
                      if (mode === 'stack' && value <= 0) return null;
                      const top =
                        mode === 'group' ||
                        series
                          .slice(position + 1)
                          .every((next) => (bucket.values[next.key] ?? 0) <= 0);
                      return (
                        <span
                          key={line.key}
                          className={cn(
                            'shrink-0',
                            value > 0 && 'min-h-[3px]',
                            mode === 'group' ? 'flex-1' : 'w-full',
                            top ? 'rounded-t-[4px]' : '',
                          )}
                          style={{
                            height:
                              value > 0 ? `max(3px, calc(${(value / peak) * 100}% - 2px))` : 0,
                            backgroundColor: line.color,
                          }}
                        />
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-1.5 flex gap-1 pr-12">
          {buckets.map((bucket, index) => (
            // Centred and allowed past its column: on a phone a column is narrower than "SEP",
            // and the skipped labels leave the room either side.
            <span
              key={bucket.key}
              className={cn(
                'flex min-w-0 flex-1 justify-center whitespace-nowrap font-mono text-[10px] uppercase tabular-nums',
                active === index ? 'text-foreground' : 'text-muted-foreground',
                index % every !== 0 && active !== index && 'invisible',
              )}
            >
              {bucket.label}
            </span>
          ))}
        </div>
      </div>

      <table className="sr-only">
        <caption>{label}</caption>
        <thead>
          <tr>
            <th scope="col">Period</th>
            {series.map((line) => (
              <th key={line.key} scope="col">
                {line.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {buckets.map((bucket) => (
            <tr key={bucket.key}>
              <th scope="row">{bucket.long}</th>
              {series.map((line) => (
                <td key={line.key}>{format(bucket.values[line.key] ?? 0)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export interface LineSeries {
  key: string;
  label: string;
  color: string;
  /** Oldest first; `x` in epoch milliseconds. */
  points: readonly { x: number; y: number }[];
}

/**
 * Lines over time on one axis. The pointer moves a crosshair to the nearest moment and the
 * readout names every series there; at rest it reads the latest. The scale fits the data rather
 * than starting at zero — lines are read by their shape — and an optional `reference` draws a
 * level (an average) as a dashed rule.
 */
export function LineChart({
  series,
  formatY,
  formatX,
  formatAxis = formatY,
  reference,
  height = 150,
  area = false,
}: {
  series: readonly LineSeries[];
  formatY: (value: number) => string;
  formatX: (x: number) => string;
  /** The scale's labels, when the readout's format is too wide for the gutter. */
  formatAxis?: (value: number) => string;
  reference?: { value: number; label: string };
  height?: number;
  /** A soft fill under a single line, for a figure that accumulates. */
  area?: boolean;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [cursor, setCursor] = useState<number | null>(null);

  const all = series.flatMap((line) => line.points);
  const xs = [...new Set(all.map((point) => point.x))].sort((a, b) => a - b);
  const ys = [...all.map((point) => point.y), ...(reference ? [reference.value] : [])];
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const low = Math.min(...ys);
  const high = Math.max(...ys);
  const pad = (high - low) * 0.12 || Math.abs(high) * 0.1 || 1;
  const minY = low - pad;
  const maxY = high + pad;

  const axis = 48;
  const plotWidth = Math.max(0, width - axis);
  const top = 8;
  const plotHeight = height - top - 6;
  const toX = (x: number) =>
    maxX === minX ? plotWidth / 2 : ((x - minX) / (maxX - minX)) * plotWidth;
  const toY = (y: number) => top + (1 - (y - minY) / (maxY - minY)) * plotHeight;
  const ticks = [high, low];
  const path = (points: readonly { x: number; y: number }[]) =>
    points
      .map(
        (point, index) =>
          `${index === 0 ? 'M' : 'L'}${toX(point.x).toFixed(1)} ${toY(point.y).toFixed(1)}`,
      )
      .join(' ');

  const at = cursor ?? maxX;
  const reading = series.map((line) => {
    const upTo = line.points.filter((point) => point.x <= at);
    return { line, point: upTo[upTo.length - 1] ?? line.points[0] };
  });
  const only = series.length === 1 ? series[0]! : null;

  const move = (clientX: number, left: number) => {
    const x =
      minX + (Math.min(Math.max(clientX - left, 0), plotWidth) / (plotWidth || 1)) * (maxX - minX);
    setCursor(
      xs.reduce(
        (best, candidate) => (Math.abs(candidate - x) < Math.abs(best - x) ? candidate : best),
        xs[0]!,
      ),
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1" aria-live="polite">
        <span className="font-mono text-[10px] font-semibold uppercase tabular-nums text-muted-foreground">
          {formatX(at)}
        </span>
        {reading.map(({ line, point }) => (
          <span key={line.key} className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Swatch color={line.color} />
            {series.length > 1 ? line.label : null}
            <span className="font-mono font-semibold tabular-nums text-foreground">
              {point ? formatY(point.y) : '—'}
            </span>
          </span>
        ))}
      </div>

      <div
        ref={ref}
        className="relative touch-pan-y"
        style={{ height }}
        onPointerMove={(event) =>
          move(event.clientX, event.currentTarget.getBoundingClientRect().left)
        }
        onPointerDown={(event) =>
          move(event.clientX, event.currentTarget.getBoundingClientRect().left)
        }
        onPointerLeave={() => setCursor(null)}
        aria-hidden="true"
      >
        {width > 0 ? (
          <svg width={width} height={height} className="trail-wipe overflow-visible">
            {ticks.map((tick) => (
              <line
                key={tick}
                x1={0}
                x2={plotWidth}
                y1={toY(tick)}
                y2={toY(tick)}
                stroke="var(--color-border)"
                strokeWidth={1}
              />
            ))}
            {reference ? (
              <line
                x1={0}
                x2={plotWidth}
                y1={toY(reference.value)}
                y2={toY(reference.value)}
                stroke="var(--color-muted-foreground)"
                strokeWidth={1}
                strokeDasharray="3 4"
              />
            ) : null}
            {only && only.points.length > 1 ? (
              <path
                d={`${path(only.points)} L${toX(only.points.at(-1)!.x)} ${top + plotHeight} L${toX(only.points[0]!.x)} ${top + plotHeight} Z`}
                fill={only.color}
                opacity={area ? 0.14 : 0.07}
              />
            ) : null}
            {cursor !== null ? (
              <line
                x1={toX(at)}
                x2={toX(at)}
                y1={top}
                y2={top + plotHeight}
                stroke="var(--color-muted-foreground)"
                strokeWidth={1}
              />
            ) : null}
            {series.map((line) => (
              <path
                key={line.key}
                d={path(line.points)}
                fill="none"
                stroke={line.color}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ))}
            {reading.map(({ line, point }) =>
              point ? (
                <circle
                  key={line.key}
                  cx={toX(point.x)}
                  cy={toY(point.y)}
                  r={4.5}
                  fill={line.color}
                  stroke="var(--color-card)"
                  strokeWidth={2}
                />
              ) : null,
            )}
          </svg>
        ) : null}
        {width > 0
          ? ticks.map((tick) => (
              <span
                key={tick}
                className="absolute right-0 w-11 text-right font-mono text-[10px] tabular-nums text-muted-foreground"
                style={{ top: toY(tick) - 7 }}
              >
                {formatAxis(tick)}
              </span>
            ))
          : null}
      </div>

      <div
        className="flex justify-between pr-12 font-mono text-[10px] uppercase tabular-nums text-muted-foreground"
        aria-hidden="true"
      >
        <span>{formatX(minX)}</span>
        {reference ? <span>┄ {reference.label}</span> : null}
        <span>{formatX(maxX)}</span>
      </div>

      <table className="sr-only">
        <caption>{series.map((line) => line.label).join(' and ')}</caption>
        <tbody>
          {series.flatMap((line) =>
            line.points.map((point) => (
              <tr key={`${line.key}-${point.x}`}>
                <th scope="row">
                  {line.label}, {formatX(point.x)}
                </th>
                <td>{formatY(point.y)}</td>
              </tr>
            )),
          )}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Magnitudes compared, largest first: the name and its count, the figure, and a bar against the
 * largest (or `max`). `columns={2}` sets short bars side by side, for scores out of a hundred.
 */
export function RankBars({
  rows,
  color,
  max,
  columns = 1,
}: {
  rows: readonly {
    key: string;
    label: string;
    count?: number;
    value: number;
    display: string;
    color?: string;
  }[];
  color?: string;
  max?: number;
  columns?: 1 | 2;
}) {
  const top = max ?? (Math.max(...rows.map((row) => row.value), 0) || 1);
  return (
    <ul className={cn('grid gap-x-6 gap-y-3', columns === 2 && 'grid-cols-2')}>
      {rows.map((row, index) => (
        <li
          key={row.key}
          className="stagger min-w-0 animate-rise"
          style={{ '--i': index } as CSSProperties}
        >
          <div className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate text-sm font-medium text-foreground">
              {row.label}
              {row.count ? (
                <span className="ml-2 font-mono text-xs tabular-nums text-muted-foreground">
                  {String(row.count).padStart(2, '0')}
                </span>
              ) : null}
            </span>
            <span className="shrink-0 font-mono text-sm font-semibold tabular-nums text-foreground">
              {row.display}
            </span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.max(2, Math.min(100, (row.value / top) * 100))}%`,
                backgroundColor: row.color ?? color,
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * A whole in a few parts: one bar of them side by side with a gap of card between, and a key of
 * each part's share. `onSelect` makes each key the way into what it counts.
 */
export function SplitBar({
  parts,
  onSelect,
}: {
  parts: readonly Slice[];
  onSelect?: (key: string) => void;
}) {
  const total = parts.reduce((sum, part) => sum + part.value, 0);
  const shown = parts.filter((part) => part.value > 0);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex h-2 gap-[2px]" aria-hidden="true">
        {shown.map((part) => (
          <span
            key={part.key}
            style={{ flexGrow: part.value, backgroundColor: part.color }}
            className="min-w-[3px] rounded-[3px]"
          />
        ))}
      </div>
      <ul className="flex flex-wrap gap-1.5">
        {shown.map((part) => {
          const body = (
            <>
              <Swatch color={part.color} />
              <span className="font-semibold text-foreground">{part.label}</span>
              <span className="font-mono font-semibold tabular-nums text-muted-foreground">
                {share(part.value, total)}
              </span>
            </>
          );
          return (
            <li key={part.key}>
              {onSelect ? (
                <button
                  type="button"
                  onClick={() => onSelect(part.key)}
                  aria-label={`${part.label}: ${part.display}, ${share(part.value, total)}. Open ${part.label}`}
                  className="flex h-7 items-center gap-1.5 rounded-full bg-muted px-2.5 text-xs transition-colors hover:bg-border"
                >
                  {body}
                </button>
              ) : (
                <span className="mr-2 flex h-7 items-center gap-1.5 text-xs" title={part.display}>
                  {body}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** A trend at a glance: one line over a soft fill, its latest point marked. Oldest first. */
export function Spark({
  values,
  color,
  height = 40,
}: {
  values: readonly number[];
  color: string;
  height?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const high = Math.max(...values, 0) || 1;
  const step = values.length > 1 ? width / (values.length - 1) : 0;
  const point = (value: number, index: number) =>
    [index * step, 3 + (1 - value / high) * (height - 6)] as const;
  const line = values
    .map((value, index) => {
      const [x, y] = point(value, index);
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');
  const [lastX, lastY] = point(values.at(-1) ?? 0, values.length - 1);
  return (
    <div ref={ref} style={{ height }} aria-hidden="true">
      {width > 0 && values.length > 1 ? (
        <svg width={width} height={height} className="trail-wipe overflow-visible">
          <path d={`${line} L${width} ${height} L0 ${height} Z`} fill={color} opacity={0.14} />
          <path d={line} fill="none" stroke={color} strokeWidth={1.75} strokeLinejoin="round" />
          <circle
            cx={lastX}
            cy={lastY}
            r={3.5}
            fill={color}
            stroke="var(--color-card)"
            strokeWidth={1.5}
          />
        </svg>
      ) : null}
    </div>
  );
}

/**
 * Prices side by side on one scale, cheapest to dearest: each place a dot on the span between
 * them, the figure at the end. The cheapest wears the good-news colour.
 */
export function Ladder({
  rows,
  color,
}: {
  rows: readonly { key: string; label: string; value: number; display: string }[];
  color: string;
}) {
  const low = Math.min(...rows.map((row) => row.value));
  const high = Math.max(...rows.map((row) => row.value));
  return (
    <ul className="flex flex-col gap-3">
      {rows.map((row, index) => {
        const at = high === low ? 0.5 : (row.value - low) / (high - low);
        const best = index === 0 && rows.length > 1;
        return (
          <li key={row.key} className="flex items-center gap-3">
            <span className="w-1/3 min-w-0 truncate text-sm font-medium text-foreground">
              {row.label}
              {best ? <span className="sr-only">, cheapest</span> : null}
            </span>
            <span className="relative mx-1.5 flex h-3.5 flex-1 items-center" aria-hidden="true">
              <span className="h-0.5 w-full rounded-full bg-border" />
              <span
                className={cn(
                  'absolute size-3 -translate-x-1/2 rounded-full ring-2 ring-card',
                  best && 'bg-success',
                )}
                style={{ left: `${at * 100}%`, backgroundColor: best ? undefined : color }}
              />
            </span>
            <span className="min-w-12 text-right font-mono text-xs font-semibold tabular-nums text-foreground">
              {row.display}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
