'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { cn } from '@/lib/utils';

/*
 * The report's charts, drawn with divs and a little SVG against the house tokens.
 *
 * Not a charting library: Recharts is ~90 kB gzipped and brings its own layout engine to draw a
 * few dozen rectangles, and its defaults are the first thing that would have to be styled back
 * to these tokens. The mobile app draws the same five forms with react-native-svg
 * (`apps/mobile/components/charts.tsx`); the two follow one set of rules:
 *
 * - Colour carries identity only: each report group owns one hue (`CHART`) on every screen.
 *   Text stays in ink; a swatch beside it carries the series.
 * - Thin marks, a 2px gap of card between touching fills, bars rounded at the data end only.
 * - One recessive grid, one axis. Two measures of different scale get two charts.
 * - Hover (or tap) reads any mark out in words, and every chart has a table behind it for a
 *   screen reader — a chart with no text alternative is a picture of data.
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
      className={cn('inline-block size-2.5 shrink-0 rounded-[3px]', className)}
      style={{ backgroundColor: color }}
    />
  );
}

/**
 * Columns over time: one series, several stacked, or two side by side (`group`).
 *
 * The readout above is the tooltip — the hovered column's period, its total and, with more than
 * one series, each series' figure beside its swatch. At rest it names the window's total, so the
 * chart always says a number. Columns are not focus stops; the table under it is the same data.
 */
export function ColumnChart({
  buckets,
  series,
  mode = 'stack',
  format,
  formatAxis = format,
  caption,
  height = 176,
}: {
  buckets: readonly ColumnBucket[];
  series: readonly ChartSeries[];
  mode?: 'stack' | 'group';
  format: (value: number) => string;
  formatAxis?: (value: number) => string;
  /** What the resting readout says the total is of: "12 months, running spend". */
  caption: string;
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
  const grand = totals.reduce((sum, value) => sum + value, 0);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex min-h-12 flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <p aria-live="polite" className="text-xs text-muted-foreground">
            {shown ? shown.long : caption}
          </p>
          <p className="font-mono text-2xl font-semibold tabular-nums tracking-tight text-foreground">
            {mode === 'group' && shown
              ? format(shown.values[series[0]!.key] ?? 0)
              : format(shown ? totals[active!]! : grand)}
          </p>
        </div>
        {series.length > 1 ? (
          <ul className="flex flex-wrap gap-x-4 gap-y-1">
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
        {[1, 0.5].map((share) => (
          <div
            key={share}
            className="pointer-events-none absolute inset-x-0 flex items-center gap-2"
            style={{ top: `${(1 - share) * height}px` }}
          >
            <span className="h-px flex-1 bg-border/70" />
            <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
              {formatAxis(peak * share)}
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
                    'flex h-full w-full max-w-7 items-end transition-opacity duration-150',
                    mode === 'stack' ? 'flex-col-reverse justify-start gap-[2px]' : 'gap-[2px]',
                    dim && 'opacity-40',
                  )}
                >
                  {totals[index] === 0 ? (
                    // A quiet period is a mark, not a gap: nothing spent and no data are opposites.
                    <span className="h-0.5 w-full rounded-full bg-border" />
                  ) : (
                    series.map((line, position) => {
                      const value = bucket.values[line.key] ?? 0;
                      if (mode === 'stack' && value <= 0) return null;
                      const share = (value / peak) * 100;
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
                            height: value > 0 ? `max(3px, calc(${share}% - 2px))` : 0,
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
        <caption>{caption}</caption>
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

export interface Slice {
  key: string;
  label: string;
  value: number;
  display: string;
  color: string;
}

/**
 * Part of a whole, as a ring with its key beside it. The key names every slice with its share
 * and figure, so no slice is told by colour alone; hovering either one lifts the slice and the
 * centre reads it. `onSelect` makes each key row the way into what it counts.
 */
export function Donut({
  slices,
  total,
  centre,
  onSelect,
  size = 168,
  thickness = 20,
}: {
  slices: readonly Slice[];
  total: string;
  centre: string;
  onSelect?: (key: string) => void;
  size?: number;
  thickness?: number;
}) {
  const [hovered, setHovered] = useState<string | null>(null);
  const sum = slices.reduce((acc, slice) => acc + slice.value, 0) || 1;
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const gap = slices.length > 1 ? 3 : 0;
  const active = slices.find((slice) => slice.key === hovered) ?? null;
  const share = (value: number) => `${Math.round((value / sum) * 100)}%`;

  let offset = 0;
  const arcs = slices.map((slice) => {
    const length = (slice.value / sum) * circumference;
    const arc = { slice, dash: Math.max(0.5, length - gap), offset };
    offset += length;
    return arc;
  });

  return (
    <div className="flex flex-col items-center gap-6 sm:flex-row">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
          {arcs.map(({ slice, dash, offset: start }) => (
            <circle
              key={slice.key}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={slice.color}
              strokeWidth={active?.key === slice.key ? thickness + 4 : thickness}
              strokeDasharray={`${dash} ${circumference}`}
              strokeDashoffset={-start}
              className="transition-[stroke-width,opacity] duration-150"
              opacity={active && active.key !== slice.key ? 0.35 : 1}
              onMouseEnter={() => setHovered(slice.key)}
              onMouseLeave={() => setHovered(null)}
            />
          ))}
        </svg>
        <div className="pointer-events-none absolute inset-0 grid place-content-center px-7 text-center">
          <span className="truncate text-label uppercase text-muted-foreground">
            {active?.label ?? centre}
          </span>
          <span className="truncate font-mono text-lg font-semibold tabular-nums tracking-tight text-foreground">
            {active?.display ?? total}
          </span>
          {active ? (
            <span className="font-mono text-xs tabular-nums text-muted-foreground">
              {share(active.value)}
            </span>
          ) : null}
        </div>
      </div>

      <ul className="flex w-full min-w-0 flex-1 flex-col gap-1">
        {slices.map((slice) => {
          const body = (
            <>
              <Swatch color={slice.color} />
              <span className="min-w-0 flex-1 truncate text-left text-sm font-medium text-foreground">
                {slice.label}
              </span>
              <span className="font-mono text-sm tabular-nums text-foreground">
                {slice.display}
              </span>
              <span className="w-10 text-right font-mono text-xs tabular-nums text-muted-foreground">
                {share(slice.value)}
              </span>
            </>
          );
          const shared = {
            onMouseEnter: () => setHovered(slice.key),
            onMouseLeave: () => setHovered(null),
            className: cn(
              'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 transition-colors',
              active?.key === slice.key ? 'bg-muted' : '',
            ),
          };
          return (
            <li key={slice.key}>
              {onSelect ? (
                <button
                  type="button"
                  {...shared}
                  onFocus={() => setHovered(slice.key)}
                  onBlur={() => setHovered(null)}
                  onClick={() => onSelect(slice.key)}
                  aria-label={`${slice.label}: ${slice.display}, ${share(slice.value)}. Open ${slice.label}`}
                  className={cn(shared.className, 'hover:bg-muted')}
                >
                  {body}
                </button>
              ) : (
                <div {...shared}>{body}</div>
              )}
            </li>
          );
        })}
      </ul>
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
 * level (an average) as a dashed rule, labelled.
 */
export function LineChart({
  series,
  formatY,
  formatX,
  formatAxis = formatY,
  reference,
  height = 180,
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
  const ticks = [high, (high + low) / 2, low];

  const at = cursor ?? maxX;
  const reading = series.map((line) => {
    const upTo = line.points.filter((point) => point.x <= at);
    return { line, point: upTo[upTo.length - 1] ?? line.points[0] };
  });

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
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1" aria-live="polite">
        <span className="font-mono text-xs font-semibold uppercase tabular-nums text-muted-foreground">
          {formatX(at)}
        </span>
        {reading.map(({ line, point }) => (
          <span key={line.key} className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Swatch color={line.color} />
            {line.label}
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
          <svg width={width} height={height} className="overflow-visible">
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
            {area && series.length === 1 && series[0]!.points.length > 1 ? (
              <path
                d={`${series[0]!.points
                  .map(
                    (point, index) => `${index === 0 ? 'M' : 'L'}${toX(point.x)} ${toY(point.y)}`,
                  )
                  .join(
                    ' ',
                  )} L${toX(series[0]!.points.at(-1)!.x)} ${top + plotHeight} L${toX(series[0]!.points[0]!.x)} ${top + plotHeight} Z`}
                fill={series[0]!.color}
                opacity={0.12}
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
                d={line.points
                  .map(
                    (point, index) =>
                      `${index === 0 ? 'M' : 'L'}${toX(point.x).toFixed(1)} ${toY(point.y).toFixed(1)}`,
                  )
                  .join(' ')}
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

/** Magnitudes compared, largest first: label and figure, then a bar against the largest or `max`. */
export function RankBars({
  rows,
  color,
  max,
}: {
  rows: readonly { key: string; label: string; note?: string; value: number; display: string }[];
  color: string;
  max?: number;
}) {
  const top = max ?? (Math.max(...rows.map((row) => row.value), 0) || 1);
  return (
    <ul className="flex flex-col gap-3.5">
      {rows.map((row, index) => (
        <li
          key={row.key}
          className="stagger animate-rise"
          style={{ '--i': index } as CSSProperties}
        >
          <div className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate text-sm font-medium text-foreground">
              {row.label}
            </span>
            <span className="shrink-0 font-mono text-sm tabular-nums text-foreground">
              {row.display}
            </span>
          </div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.max(2, Math.min(100, (row.value / top) * 100))}%`,
                backgroundColor: color,
              }}
            />
          </div>
          {row.note ? (
            <p className="mt-1 truncate text-xs text-muted-foreground">{row.note}</p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** A whole in a few parts, side by side with a gap of card between, and a key with figures. */
export function SplitBar({ parts }: { parts: readonly Slice[] }) {
  const total = parts.reduce((sum, part) => sum + part.value, 0) || 1;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex h-3 gap-[2px] overflow-hidden rounded-full" aria-hidden="true">
        {parts
          .filter((part) => part.value > 0)
          .map((part) => (
            <span
              key={part.key}
              style={{ flexGrow: part.value, backgroundColor: part.color }}
              className="min-w-[3px]"
            />
          ))}
      </div>
      <ul className="flex flex-col gap-1.5">
        {parts.map((part) => (
          <li key={part.key} className="flex items-center gap-2.5 text-sm">
            <Swatch color={part.color} />
            <span className="min-w-0 flex-1 truncate text-muted-foreground">{part.label}</span>
            <span className="font-mono tabular-nums text-foreground">{part.display}</span>
            <span className="w-10 text-right font-mono text-xs tabular-nums text-muted-foreground">
              {Math.round((part.value / total) * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
