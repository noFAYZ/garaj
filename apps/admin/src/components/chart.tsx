import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { cn } from '@/lib/utils';
import { dayLabel, formatCount, formatExact, percent } from '../lib/format';

/*
 * The console's charts, drawn as SVG against the house tokens — the web app's rule, for the same
 * reason: a charting library is ~90 kB to draw a few dozen rectangles, and its defaults are the
 * first thing that would have to be styled back to these tokens.
 *
 * - Copper is the measure being looked at; status colours mean status; grey is context.
 * - One recessive grid on round numbers, one axis. Thin marks; bars rounded at the data end.
 * - The pointer (or the arrow keys) reads any day out in words, and every chart has a table
 *   behind it for a screen reader — a chart with no text alternative is a picture of data.
 */

export interface Series {
  key: string;
  label: string;
  color: string;
  /** One per day, aligned with the chart's `days`. */
  values: number[];
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.round(entry!.contentRect.width)),
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/** Steps of 1, 2, 2.5 or 5 at the right power of ten, so the grid sits on round numbers. */
export function niceTicks(low: number, high: number, count = 4, integer = true): number[] {
  const top = high > low ? high : low + 1;
  const raw = (top - low) / count;
  const power = 10 ** Math.floor(Math.log10(raw));
  const unit = raw / power;
  let step = (unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 2.5 ? 2.5 : unit <= 5 ? 5 : 10) * power;
  if (integer) step = Math.max(1, Math.round(step));
  const start = Math.floor(low / step) * step;
  const ticks: number[] = [];
  for (let value = start; value < top + step; value += step) {
    ticks.push(Number(value.toFixed(6)));
    if (value >= top) break;
  }
  return ticks;
}

/**
 * A smooth line that never overshoots its points (monotone cubic, Fritsch–Carlson): a curve that
 * dipped below zero between two days would draw a count nobody measured.
 */
export function monotonePath(points: readonly (readonly [number, number])[]): string {
  const n = points.length;
  if (n === 0) return '';
  const [x0, y0] = points[0]!;
  if (n === 1) return `M${x0},${y0}`;
  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(points[i + 1]![0] - points[i]![0]);
    slope.push((points[i + 1]![1] - points[i]![1]) / (dx[i] || 1));
  }
  const tangent = points.map((_, i) => {
    if (i === 0) return slope[0]!;
    if (i === n - 1) return slope[n - 2]!;
    const a = slope[i - 1]!;
    const b = slope[i]!;
    if (a * b <= 0) return 0;
    return (
      (3 * (dx[i - 1]! + dx[i]!)) / ((2 * dx[i]! + dx[i - 1]!) / a + (dx[i]! + 2 * dx[i - 1]!) / b)
    );
  });
  let d = `M${x0.toFixed(2)},${y0.toFixed(2)}`;
  for (let i = 0; i < n - 1; i++) {
    const [xa, ya] = points[i]!;
    const [xb, yb] = points[i + 1]!;
    const third = dx[i]! / 3;
    d += `C${(xa + third).toFixed(2)},${(ya + tangent[i]! * third).toFixed(2)} ${(xb - third).toFixed(2)},${(yb - tangent[i + 1]! * third).toFixed(2)} ${xb.toFixed(2)},${yb.toFixed(2)}`;
  }
  return d;
}

/** The trailing average over `window` days: the trend under a noisy daily count. */
export const movingAverage = (values: readonly number[], window = 7) =>
  values.map((_, i) => {
    const slice = values.slice(Math.max(0, i - window + 1), i + 1);
    return slice.reduce((sum, value) => sum + value, 0) / slice.length;
  });

const todayUtc = () => new Date().toISOString().slice(0, 10);

export function Swatch({ color, className }: { color: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn('inline-block size-2.5 shrink-0 rounded-[3px]', className)}
      style={{ backgroundColor: color }}
    />
  );
}

/**
 * Days across, as a smooth line (`area`) or as columns (`bars`, stacked when there are several
 * series). A line is for a level the product stood at — its scale can `fit` the window, since a
 * total of 400 growing by 12 is a flat line from zero; a column is for a count made each day, and
 * always stands on zero.
 */
export function TimeChart({
  days,
  series,
  mode,
  fit = false,
  trend = false,
  format = formatCount,
  height = 220,
  compact = false,
  legend = series.length > 1,
  caption,
  detail,
}: {
  days: readonly string[];
  series: readonly Series[];
  mode: 'area' | 'bars';
  /** A line's scale from the window's low rather than from zero. */
  fit?: boolean;
  /** A 7-day average of the bars' total, drawn over them. */
  trend?: boolean;
  format?: (value: number) => string;
  height?: number;
  /** No scale and a short frame: a histogram strip above a list. */
  compact?: boolean;
  legend?: boolean;
  /** What the table behind the chart is a table of. */
  caption: string;
  /** More lines in the readout for a day, under the series figures. */
  detail?: (index: number) => ReactNode;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [cursor, setCursor] = useState<number | null>(null);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const gradient = useId();
  const n = days.length;
  const shown = series.filter((line) => !hidden.has(line.key));
  const bars = mode === 'bars';

  const totals = days.map((_, i) => shown.reduce((sum, line) => sum + (line.values[i] ?? 0), 0));
  const average = trend ? movingAverage(totals) : [];
  const all = bars ? [...totals, ...average] : shown.flatMap((line) => line.values);
  const high = Math.max(0, ...all);
  const low = bars || !fit ? 0 : Math.min(...all);
  const span = high - low || 1;
  const ticks = niceTicks(fit && !bars ? Math.max(0, low - span * 0.15) : 0, high, compact ? 2 : 4);
  const floor = ticks[0]!;
  const ceiling = ticks.at(-1)!;

  const left = compact ? 0 : 40;
  const right = compact ? 0 : 8;
  const top = compact ? 4 : 10;
  const bottom = compact ? 2 : 24;
  const plotWidth = Math.max(0, width - left - right);
  const plotHeight = height - top - bottom;
  const band = n ? plotWidth / n : 0;
  const gap = band > 7 ? Math.min(6, band * 0.28) : band > 3 ? 1 : 0.5;
  const x = (i: number) =>
    bars ? left + i * band + band / 2 : left + (n <= 1 ? plotWidth / 2 : (i * plotWidth) / (n - 1));
  const y = (value: number) => top + (1 - (value - floor) / (ceiling - floor || 1)) * plotHeight;
  const base = y(floor);

  const at = cursor === null ? null : Math.min(cursor, n - 1);
  const pick = (clientX: number, box: DOMRect) => {
    const px = clientX - box.left - left;
    const i = bars
      ? Math.floor(px / (band || 1))
      : Math.round(px / ((plotWidth || 1) / Math.max(n - 1, 1)));
    setCursor(Math.min(Math.max(i, 0), n - 1));
  };
  const onKeyDown = (event: KeyboardEvent) => {
    const step = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
    if (step) {
      event.preventDefault();
      setCursor((current) =>
        Math.min(Math.max((current ?? n - 1) + (current === null ? 0 : step), 0), n - 1),
      );
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      setCursor(event.key === 'Home' ? 0 : n - 1);
    } else if (event.key === 'Escape') {
      setCursor(null);
    }
  };

  // Every label while they fit, then every few, always ending on the newest day.
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(plotWidth / 76))));
  const labels = days.map((day, i) => ({ day, i })).filter(({ i }) => (n - 1 - i) % every === 0);
  const today = todayUtc();
  const toggle = (key: string) =>
    setHidden((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else if (shown.length > 1) next.add(key);
      return next;
    });

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {/* The key: a toggle per series when there are several; the average line named whenever drawn. */}
      {(legend && series.length > 1) || trend ? (
        <div className="flex flex-wrap items-center gap-x-1 gap-y-1">
          {(legend && series.length > 1 ? series : []).map((line) => {
            const off = hidden.has(line.key);
            return (
              <button
                key={line.key}
                type="button"
                aria-pressed={!off}
                onClick={() => toggle(line.key)}
                className={cn(
                  'flex h-7 items-center gap-2 rounded-full px-2.5 text-xs font-semibold transition-colors hover:bg-muted',
                  off ? 'text-muted-foreground/60 line-through' : 'text-muted-foreground',
                )}
              >
                <Swatch color={line.color} className={off ? 'opacity-30' : undefined} />
                {line.label}
              </button>
            );
          })}
          {trend ? (
            <span className="flex h-7 items-center gap-2 px-2.5 text-xs text-muted-foreground">
              <span aria-hidden="true" className="h-0.5 w-3.5 rounded-full bg-foreground/60" />
              7-day average
            </span>
          ) : null}
        </div>
      ) : null}

      <div
        ref={ref}
        role="group"
        aria-roledescription="chart"
        tabIndex={0}
        aria-label={`${caption}. The table after it has every day.`}
        onKeyDown={onKeyDown}
        onPointerMove={(event) => pick(event.clientX, event.currentTarget.getBoundingClientRect())}
        onPointerDown={(event) => pick(event.clientX, event.currentTarget.getBoundingClientRect())}
        onPointerLeave={() => setCursor(null)}
        onBlur={() => setCursor(null)}
        className="relative touch-pan-y select-none rounded-lg outline-offset-4"
        style={{ height }}
      >
        {width > 0 && n > 0 ? (
          <svg
            width={width}
            height={height}
            className="absolute inset-0 overflow-visible"
            aria-hidden="true"
          >
            <defs>
              <linearGradient id={gradient} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" stopColor={shown[0]?.color ?? 'currentColor'} stopOpacity="0.3" />
                <stop offset="1" stopColor={shown[0]?.color ?? 'currentColor'} stopOpacity="0" />
              </linearGradient>
            </defs>

            {/* The grid: round numbers, dashed and quiet, labelled at the left. */}
            {(compact ? [floor] : ticks).map((tick) => (
              <g key={tick}>
                <line
                  x1={left}
                  x2={left + plotWidth}
                  y1={y(tick)}
                  y2={y(tick)}
                  stroke="var(--color-border)"
                  strokeDasharray={tick === floor ? undefined : '2 4'}
                />
                {compact ? null : (
                  <text
                    x={left - 10}
                    y={y(tick)}
                    dy="0.32em"
                    textAnchor="end"
                    className="fill-muted-foreground font-mono text-[10px] tabular-nums"
                  >
                    {format(tick)}
                  </text>
                )}
              </g>
            ))}

            {bars
              ? days.map((day, i) => {
                  let stack = floor;
                  const dim = at !== null && at !== i;
                  const quiet = totals[i] === 0;
                  return (
                    <g
                      key={day}
                      opacity={dim ? 0.38 : 1}
                      className="transition-opacity duration-150"
                    >
                      {quiet ? (
                        <rect
                          x={x(i) - Math.max(band - gap, 1) / 2}
                          y={base - 1.5}
                          width={Math.max(band - gap, 1)}
                          height={1.5}
                          rx={0.75}
                          fill="var(--color-border-strong)"
                        />
                      ) : (
                        shown.map((line, position) => {
                          const value = line.values[i] ?? 0;
                          if (value <= 0) return null;
                          const y0 = y(stack);
                          stack += value;
                          // A pixel of card between stacked parts; the top part is rounded instead.
                          const isTop = shown
                            .slice(position + 1)
                            .every((next) => (next.values[i] ?? 0) <= 0);
                          const w = Math.max(band - gap, 1);
                          const h = Math.max(y0 - y(stack) - (isTop ? 0 : 1), 1.5);
                          const r = isTop ? Math.min(3, w / 2, h) : 0;
                          return (
                            <path
                              key={line.key}
                              className="grow-bar"
                              style={{ '--i': i } as CSSProperties}
                              fill={line.color}
                              d={`M${x(i) - w / 2},${y0}V${y0 - h + r}q0,-${r} ${r},-${r}h${w - 2 * r}q${r},0 ${r},${r}V${y0}Z`}
                            />
                          );
                        })
                      )}
                    </g>
                  );
                })
              : shown.map((line, position) => {
                  const points = line.values.map((value, i) => [x(i), y(value)] as const);
                  const d = monotonePath(points);
                  return (
                    <g key={line.key}>
                      {position === 0 ? (
                        <path
                          d={`${d}L${x(n - 1)},${base}L${x(0)},${base}Z`}
                          fill={`url(#${gradient})`}
                          className="animate-rise"
                        />
                      ) : null}
                      <path
                        d={d}
                        pathLength={1}
                        fill="none"
                        stroke={line.color}
                        strokeWidth={2}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="draw-line"
                      />
                    </g>
                  );
                })}

            {trend && average.length ? (
              <path
                d={monotonePath(average.map((value, i) => [x(i), y(value)] as const))}
                pathLength={1}
                fill="none"
                stroke="var(--color-foreground)"
                strokeOpacity={0.55}
                strokeWidth={1.5}
                strokeLinecap="round"
                className="draw-line"
              />
            ) : null}

            {/* The day under the pointer: a hairline for a line chart, and a mark on each line. */}
            {!bars && at !== null ? (
              <line
                x1={x(at)}
                x2={x(at)}
                y1={top}
                y2={base}
                stroke="var(--color-muted-foreground)"
                strokeOpacity={0.6}
              />
            ) : null}
            {!bars
              ? shown.map((line) => {
                  const i = at ?? n - 1;
                  return (
                    <circle
                      key={line.key}
                      cx={x(i)}
                      cy={y(line.values[i] ?? 0)}
                      r={at === null ? 3.5 : 4.5}
                      fill={line.color}
                      stroke="var(--color-card)"
                      strokeWidth={2.5}
                    />
                  );
                })
              : null}

            {compact
              ? null
              : labels.map(({ day, i }) => (
                  <text
                    key={day}
                    x={Math.min(Math.max(x(i), left + 14), left + plotWidth - 14)}
                    y={height - 6}
                    textAnchor="middle"
                    className={cn(
                      'font-mono text-[10px] uppercase tabular-nums',
                      at === i ? 'fill-foreground' : 'fill-muted-foreground',
                    )}
                  >
                    {day === today ? 'Today' : dayLabel(day)}
                  </text>
                ))}
          </svg>
        ) : null}

        {at !== null && n > 0 ? (
          // Beside the day, never over it: to its right, or its left past the middle.
          <div
            aria-hidden="true"
            className="pointer-events-none absolute z-10 min-w-36 rounded-xl bg-popover px-3 py-2.5 shadow-float"
            style={{
              top,
              ...(x(at) > width / 2
                ? { right: width - x(at) + (bars ? band / 2 : 0) + 10 }
                : { left: x(at) + (bars ? band / 2 : 0) + 10 }),
            }}
          >
            <p className="whitespace-nowrap text-xs font-semibold text-muted-foreground">
              {days[at] === today ? 'Today' : dayLabel(days[at]!, 'long')}
            </p>
            <ul className="mt-1.5 flex flex-col gap-1">
              {shown.map((line) => (
                <li key={line.key} className="flex items-center gap-2 text-xs">
                  <Swatch color={line.color} />
                  {shown.length > 1 ? (
                    <span className="flex-1 text-muted-foreground">{line.label}</span>
                  ) : null}
                  <span
                    className={cn(
                      'font-mono font-semibold tabular-nums text-foreground',
                      shown.length > 1 ? 'text-xs' : 'text-base',
                    )}
                  >
                    {formatExact(line.values[at] ?? 0)}
                  </span>
                </li>
              ))}
              {bars && shown.length > 1 ? (
                <li className="flex items-center justify-between gap-3 border-t border-border/60 pt-1 text-xs">
                  <span className="text-muted-foreground">Total</span>
                  <span className="font-mono font-semibold tabular-nums">
                    {formatExact(totals[at]!)}
                  </span>
                </li>
              ) : null}
              {trend ? (
                <li className="text-xs text-muted-foreground">
                  avg <span className="font-mono tabular-nums">{average[at]!.toFixed(1)}</span>/day
                </li>
              ) : null}
            </ul>
            {detail ? <div className="mt-1 text-xs text-muted-foreground">{detail(at)}</div> : null}
          </div>
        ) : null}
      </div>

      {compact && n > 0 ? (
        <div
          aria-hidden="true"
          className="-mt-1.5 flex justify-between font-mono text-[10px] uppercase text-muted-foreground"
        >
          <span>{dayLabel(days[0]!)}</span>
          <span>{days[n - 1] === today ? 'Today' : dayLabel(days[n - 1]!)}</span>
        </div>
      ) : null}

      {/* Wrapped: a table ignores `height` and `overflow`, so on its own it stretches the page. */}
      <div className="sr-only">
        <table>
          <caption>{caption}</caption>
          <thead>
            <tr>
              <th scope="col">Day</th>
              {series.map((line) => (
                <th key={line.key} scope="col">
                  {line.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {days.map((day, i) => (
              <tr key={day}>
                <th scope="row">{dayLabel(day, 'long')}</th>
                {series.map((line) => (
                  <td key={line.key}>{format(line.values[i] ?? 0)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** A level's shape over the window, small: the line of `TimeChart` without its figures. */
export function Spark({
  values,
  color,
  className,
}: {
  values: readonly number[] | undefined;
  color: string;
  className?: string;
}) {
  const gradient = useId();
  if (!values?.length) return <div aria-hidden="true" className={cn('h-9', className)} />;
  const low = Math.min(...values);
  const high = Math.max(...values);
  const span = high - low || 1;
  const n = values.length;
  const points = values.map(
    (value, i) => [n === 1 ? 50 : (i / (n - 1)) * 100, 30 - ((value - low) / span) * 26] as const,
  );
  const d = monotonePath(points);
  return (
    <svg
      viewBox="0 0 100 32"
      preserveAspectRatio="none"
      aria-hidden="true"
      className={cn('h-9 w-full overflow-visible', className)}
    >
      <defs>
        <linearGradient id={gradient} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.28" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${d}L100,32L0,32Z`} fill={`url(#${gradient})`} />
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={1.75}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/** Daily counts as a strip of hairline columns: the shape of a window, not its figures. */
export function Sparkbars({
  values,
  color,
  className,
}: {
  values: readonly number[] | undefined;
  color: string;
  className?: string;
}) {
  const max = Math.max(1, ...(values ?? []));
  return (
    <div aria-hidden="true" className={cn('flex h-9 items-end gap-px', className)}>
      {(values ?? Array.from({ length: 30 }, () => 0)).map((value, i) => (
        <div
          key={i}
          className="min-w-0 flex-1 rounded-t-[2px]"
          style={{
            height: value ? `${Math.max((value / max) * 100, 10)}%` : '6%',
            backgroundColor: value ? color : 'var(--color-border)',
          }}
        />
      ))}
    </div>
  );
}

const LEVELS = [
  'color-mix(in oklch, var(--color-muted) 80%, transparent)',
  'color-mix(in oklch, var(--color-primary) 24%, transparent)',
  'color-mix(in oklch, var(--color-primary) 46%, transparent)',
  'color-mix(in oklch, var(--color-primary) 72%, transparent)',
  'var(--color-primary)',
];
const WEEKDAYS = ['Mon', '', 'Wed', '', 'Fri', '', ''];

/**
 * A count per day as a calendar: weeks across, Monday to Sunday down, darker copper for busier
 * days. The scale is a square root of the busiest day, so one record-breaking day does not wash
 * every other day out to the faintest step.
 */
export function Heatmap({
  days,
  values,
  noun,
}: {
  days: readonly string[];
  values: readonly number[];
  /** What is counted, singular and plural: ["record", "records"]. */
  noun: readonly [string, string];
}) {
  const [active, setActive] = useState<number | null>(null);
  if (!days.length) return null;
  const max = Math.max(1, ...values);
  const level = (value: number) =>
    value <= 0 ? 0 : Math.max(1, Math.ceil(Math.sqrt(value / max) * 4));
  const first = new Date(`${days[0]}T12:00:00Z`);
  const lead = (first.getUTCDay() + 6) % 7; // Monday is 0
  const cells = [...Array.from({ length: lead }, () => null), ...days.map((_, i) => i)];
  const weeks = Math.ceil(cells.length / 7);
  // A month's name over the first week it starts; dropped when the next name would crowd it.
  let last = '';
  const months = Array.from({ length: weeks }, (_, week) => {
    const index = cells.slice(week * 7, week * 7 + 7).find((cell) => cell !== null);
    const month = index === undefined || index === null ? '' : dayLabel(days[index]!, 'month');
    if (!month || month === last) return '';
    last = month;
    return month;
  });
  months.forEach((month, week) => {
    if (month && months.slice(week + 1, week + 3).some(Boolean)) months[week] = '';
  });
  const say = (value: number) => `${formatExact(value)} ${value === 1 ? noun[0] : noun[1]}`;
  const shown = active === null ? null : active;

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2">
      {/*
       * The cells share the width: square, between a fingertip and a postage stamp. The weekday
       * names sit in the same grid row as the cells, so they stretch to the cells' height.
       */}
      <div
        aria-hidden="true"
        className="grid w-full grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-1"
        style={{ maxWidth: weeks * 27 + 36 }}
      >
        <span />
        <div
          className="grid text-[10px] text-muted-foreground"
          style={{ gridTemplateColumns: `repeat(${weeks}, minmax(0, 1fr))`, columnGap: 3 }}
        >
          {months.map((month, i) => (
            <span key={i} className="overflow-visible whitespace-nowrap">
              {month}
            </span>
          ))}
        </div>
        <div className="grid grid-rows-7 gap-[3px] text-[10px] leading-none text-muted-foreground">
          {WEEKDAYS.map((label, i) => (
            <span key={i} className="flex items-center">
              {label}
            </span>
          ))}
        </div>
        <div
          className="grid grid-flow-col grid-rows-7 gap-[3px]"
          style={{ gridTemplateColumns: `repeat(${weeks}, minmax(0, 1fr))` }}
          onPointerLeave={() => setActive(null)}
        >
          {cells.map((cell, i) =>
            cell === null ? (
              <span key={`lead-${i}`} className="aspect-square" />
            ) : (
              <span
                key={days[cell]}
                onPointerEnter={() => setActive(cell)}
                className={cn(
                  'aspect-square rounded-[5px] transition-[outline-color] duration-150',
                  shown === cell
                    ? 'outline-2 outline-offset-1 outline-foreground'
                    : 'outline-transparent',
                )}
                style={{ backgroundColor: LEVELS[level(values[cell] ?? 0)] }}
              />
            ),
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <p aria-live="polite" className="min-h-4">
          {shown === null ? (
            'Point at a day to read it'
          ) : (
            <>
              <span className="text-foreground">{dayLabel(days[shown]!, 'long')}</span> ·{' '}
              <span className="font-mono tabular-nums text-foreground">
                {say(values[shown] ?? 0)}
              </span>
            </>
          )}
        </p>
        <span aria-hidden="true" className="flex items-center gap-1">
          Less
          {LEVELS.map((color) => (
            <span
              key={color}
              className="size-2.5 rounded-[3px]"
              style={{ backgroundColor: color }}
            />
          ))}
          More
        </span>
      </div>
      <div className="sr-only">
        <table>
          <caption>
            {noun[1]} per day, {dayLabel(days[0]!, 'long')} to {dayLabel(days.at(-1)!, 'long')}
          </caption>
          <tbody>
            {days.map((day, i) => (
              <tr key={day}>
                <th scope="row">{dayLabel(day, 'long')}</th>
                <td>{say(values[i] ?? 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Steps a person takes, as bars shrinking down the page: each bar is a share of the first step,
 * and between two steps, the share of people who made it from one to the next.
 */
export function Funnel({
  steps,
}: {
  steps: readonly { key: string; label: string; value: number | undefined }[];
}) {
  const first = steps[0]?.value ?? 0;
  return (
    <ol className="flex flex-col">
      {steps.map((step, i) => {
        const previous = i > 0 ? steps[i - 1]!.value : undefined;
        return (
          <li key={step.key} className="flex flex-col">
            {i > 0 ? (
              <span className="ml-3 flex h-6 items-center gap-2 border-l border-dashed border-border-strong pl-3 font-mono text-[11px] tabular-nums text-muted-foreground">
                {step.value !== undefined && previous
                  ? `${percent(step.value, previous)}% made it`
                  : ' '}
              </span>
            ) : null}
            <div className="relative overflow-hidden rounded-xl bg-muted/50 px-3 py-2.5">
              <div
                aria-hidden="true"
                className="absolute inset-y-0 left-0 rounded-xl bg-primary-soft transition-[width] duration-700 ease-out"
                style={{
                  width:
                    step.value === undefined || !first
                      ? 0
                      : `${Math.max((step.value / first) * 100, 1.5)}%`,
                }}
              />
              <div className="relative flex items-baseline justify-between gap-3">
                <span className="truncate text-sm font-semibold">{step.label}</span>
                <span className="flex shrink-0 items-baseline gap-2">
                  <span className="font-mono text-sm font-semibold tabular-nums">
                    {step.value === undefined ? '—' : formatCount(step.value)}
                  </span>
                  <span className="w-9 text-right font-mono text-xs tabular-nums text-muted-foreground">
                    {step.value === undefined || !first ? '' : `${percent(step.value, first)}%`}
                  </span>
                </span>
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** A whole in a few parts, side by side, with a key that carries every figure. */
export function SplitBar({
  parts,
  format = formatCount,
  onSelect,
}: {
  parts: readonly { key: string; label: string; value: number; color: string }[];
  format?: (value: number) => string;
  /** Makes each key row the way into what it counts. */
  onSelect?: (key: string) => void;
}) {
  const total = parts.reduce((sum, part) => sum + part.value, 0);
  return (
    <div className="flex flex-col gap-3">
      <div
        className="flex h-2.5 gap-[2px] overflow-hidden rounded-full bg-muted"
        aria-hidden="true"
      >
        {parts
          .filter((part) => part.value > 0)
          .map((part) => (
            <span
              key={part.key}
              style={{ flexGrow: part.value, backgroundColor: part.color }}
              className="min-w-[3px] transition-[flex-grow] duration-700"
            />
          ))}
      </div>
      <ul className="flex flex-col gap-0.5">
        {parts.map((part) => {
          const body = (
            <>
              <Swatch color={part.color} />
              <span className="min-w-0 flex-1 truncate text-left text-muted-foreground">
                {part.label}
              </span>
              <span className="font-mono font-semibold tabular-nums text-foreground">
                {format(part.value)}
              </span>
              <span className="w-10 text-right font-mono text-xs tabular-nums text-muted-foreground">
                {total ? `${percent(part.value, total)}%` : '—'}
              </span>
            </>
          );
          const className = 'flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm';
          return (
            <li key={part.key}>
              {onSelect ? (
                <button
                  type="button"
                  onClick={() => onSelect(part.key)}
                  className={cn(className, 'transition-colors hover:bg-muted')}
                >
                  {body}
                </button>
              ) : (
                <div className={className}>{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Ranked rows as bars of their share of the top one: who or what, how much, how it compares. */
export function RankBars({
  rows,
  format = formatCount,
}: {
  rows: readonly {
    key: string;
    label: ReactNode;
    lead?: ReactNode;
    value: number;
    href?: string;
    aside?: string;
  }[];
  format?: (value: number) => string;
}) {
  const max = Math.max(1, ...rows.map((row) => row.value));
  return (
    <ul className="flex flex-col gap-1">
      {rows.map((row, index) => {
        const body = (
          <>
            {row.lead}
            <span className="relative z-10 min-w-0 flex-1 truncate text-sm">{row.label}</span>
            <span className="relative z-10 font-mono text-sm font-semibold tabular-nums">
              {format(row.value)}
            </span>
            {row.aside ? (
              <span className="relative z-10 w-14 text-right font-mono text-xs tabular-nums text-muted-foreground">
                {row.aside}
              </span>
            ) : null}
            <span
              aria-hidden="true"
              className="absolute inset-y-0 left-0 rounded-lg bg-primary-soft transition-[width,background-color] duration-500 group-hover:bg-primary/20"
              style={{ width: `${Math.max((row.value / max) * 100, 2)}%` }}
            />
          </>
        );
        const className =
          'group relative flex min-h-11 items-center gap-3 overflow-hidden rounded-lg px-2.5 py-2';
        return (
          <li
            key={row.key}
            className="stagger animate-rise"
            style={{ '--i': index } as CSSProperties}
          >
            {row.href ? (
              <a href={row.href} className={className}>
                {body}
              </a>
            ) : (
              <div className={className}>{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
