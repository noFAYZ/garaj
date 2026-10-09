import { Fragment, type CSSProperties, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/*
 * Instruments: a 270° gauge and an odometer of drums. The vehicle page's cockpit and the landing
 * page's hero are the same components, so what the site shows is what the product looks like.
 *
 * Motion lives in globals.css (`.gauge-*`, `.odo-digit`): a new reading moves the needle and turns
 * the drums by transition, and a wrapper chooses how the first reading arrives — `gauge-rise`
 * climbs from zero, `gauge-ignite` sweeps to the stop and back the way a cluster checks itself.
 * Both are off for anyone who asked for less motion.
 */

export type InstrumentTone = 'ink' | 'success' | 'warning' | 'destructive' | 'muted';

/** Zero at the bottom left, full at the bottom right; the open quarter at the bottom holds the readout. */
const START = 135;
const SWEEP = 270;

// Two decimals: the same string on the server and in every browser, so hydration never disagrees.
const polar = (r: number, deg: number) => {
  const rad = (deg * Math.PI) / 180;
  return [(100 + r * Math.cos(rad)).toFixed(2), (100 + r * Math.sin(rad)).toFixed(2)] as const;
};

const arc = (r: number, from: number, to: number) => {
  const [x0, y0] = polar(r, from);
  const [x1, y1] = polar(r, to);
  return `M ${x0} ${y0} A ${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x1} ${y1}`;
};

const TRACK = arc(84, START, START + SWEEP);
const TICKS = Array.from({ length: 41 }, (_, i) => {
  const deg = START + (SWEEP * i) / 40;
  const major = i % 10 === 0;
  const [x1, y1] = polar(major ? 64 : 69, deg);
  const [x2, y2] = polar(74, deg);
  return { x1, y1, x2, y2, major };
});

const STROKE: Record<InstrumentTone, string> = {
  ink: 'stroke-foreground',
  success: 'stroke-success',
  warning: 'stroke-warning',
  destructive: 'stroke-destructive',
  muted: 'stroke-border-strong',
};

export const TONE_TEXT: Record<InstrumentTone, string> = {
  ink: 'text-foreground',
  success: 'text-success',
  warning: 'text-warning',
  destructive: 'text-destructive',
  muted: 'text-muted-foreground',
};

/**
 * A needle gauge. `fraction` is 0–1 of the dial; past the end it pins at the stop. `redlineFrom`
 * paints the last stretch of the track, for a scale where "past due" has somewhere to go.
 *
 * The drawing is decoration: `label` is what a screen reader hears, and `children` — the readout
 * in the gauge's open quarter — is real text for everyone else.
 */
export function Gauge({
  fraction,
  tone,
  label,
  redlineFrom,
  className,
  children,
}: {
  fraction: number;
  tone: InstrumentTone;
  label: string;
  redlineFrom?: number;
  className?: string;
  children?: ReactNode;
}) {
  const clamped = Math.min(Math.max(Number.isFinite(fraction) ? fraction : 0, 0), 1);
  return (
    <div role="img" aria-label={label} className={cn('relative aspect-square w-full', className)}>
      <svg viewBox="0 0 200 200" className="absolute inset-0 size-full" aria-hidden="true">
        {TICKS.map((tick, i) => (
          <line
            key={i}
            x1={tick.x1}
            y1={tick.y1}
            x2={tick.x2}
            y2={tick.y2}
            strokeWidth={tick.major ? 1.75 : 1}
            strokeLinecap="round"
            className={tick.major ? 'stroke-muted-foreground' : 'stroke-border-strong'}
          />
        ))}
        <path
          d={TRACK}
          fill="none"
          strokeWidth={5}
          strokeLinecap="round"
          className="stroke-muted"
        />
        {redlineFrom !== undefined ? (
          <path
            d={arc(84, START + SWEEP * redlineFrom, START + SWEEP)}
            fill="none"
            strokeWidth={5}
            strokeLinecap="round"
            className="stroke-destructive-soft"
          />
        ) : null}
        <path
          d={TRACK}
          fill="none"
          pathLength={100}
          strokeWidth={5}
          strokeLinecap="round"
          className={cn('gauge-arc', STROKE[tone])}
          style={{ '--offset': 100 - clamped * 100 } as CSSProperties}
        />
        <g
          className="gauge-needle"
          style={{ '--angle': `${START + SWEEP * clamped}deg` } as CSSProperties}
        >
          <line
            x1="100"
            y1="100"
            x2="158"
            y2="100"
            strokeWidth={2.5}
            strokeLinecap="round"
            className="stroke-foreground"
          />
        </g>
        <circle
          cx="100"
          cy="100"
          r="7"
          strokeWidth={2}
          className="fill-background stroke-foreground"
        />
      </svg>
      {children ? (
        <div className="absolute inset-x-0 bottom-[3%] flex flex-col items-center text-center">
          {children}
        </div>
      ) : null}
    </div>
  );
}

/**
 * An odometer: a drum per digit, leading zeros and all, turning to the reading. `null` is a reading
 * nobody has taken — dashes, not zeros, because zero is a reading.
 */
export function Odometer({ value, digits = 6 }: { value: number | null; digits?: number }) {
  if (value === null) {
    return (
      <span aria-hidden="true" className="font-mono tabular-nums text-muted-foreground">
        {'—'.repeat(3)}
      </span>
    );
  }
  const text = String(Math.max(0, Math.round(value))).padStart(digits, '0');
  const firstSignificant = [...text].findIndex((digit) => digit !== '0');
  return (
    <span aria-hidden="true" className="font-mono tabular-nums">
      {[...text].map((digit, i) => (
        <Fragment key={i}>
          {/* Thousands separators counted from the right, so seven digits still group correctly. */}
          {i > 0 && (text.length - i) % 3 === 0 ? (
            <span className="text-muted-foreground">,</span>
          ) : null}
          <span
            className={cn(
              'odo-digit',
              (firstSignificant === -1 || i < firstSignificant) && 'text-muted-foreground',
            )}
            style={{ '--d': Number(digit), '--i': i } as CSSProperties}
          >
            <span>
              {Array.from({ length: 10 }, (_, n) => (
                <span key={n}>{n}</span>
              ))}
            </span>
          </span>
        </Fragment>
      ))}
    </span>
  );
}
