import type { CSSProperties } from 'react';
import { healthBand } from '@vehicle-os/ui';
import { cn } from '@/lib/utils';

/** The colour a health score reads in: good, keep an eye on it, or act. */
export function healthTone(score: number | null): string {
  // Written out, not `text-${band}`: Tailwind generates the classes it can see in the source,
  // and an interpolated one is not there to see.
  const band = healthBand(score);
  return band === 'success'
    ? 'text-success'
    : band === 'warning'
      ? 'text-warning'
      : band === 'destructive'
        ? 'text-destructive'
        : 'text-muted-foreground';
}

/**
 * A health score as a ring.
 *
 * SVG rather than a conic gradient: the arc has to be readable at 20px on a phone and print
 * cleanly, and a `stroke-dasharray` arc is the same shape at every size. The number is in the
 * middle as text, so the score is never only a colour — the ring is the decoration.
 */
export function HealthDial({
  score,
  size = 80,
  className,
}: {
  score: number | null;
  size?: number;
  className?: string;
}) {
  const stroke = Math.max(4, Math.round(size / 10));
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const filled = score === null ? 0 : (score / 100) * circumference;

  const tone = healthTone(score);

  return (
    <div
      className={cn('relative shrink-0', className)}
      style={{ width: size, height: size }}
      // The score is announced as a sentence; the ring itself is decoration.
      role="img"
      aria-label={score === null ? 'Health not yet assessed' : `Health ${score} out of 100`}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          className="stroke-muted"
        />
        {score === null ? null : (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            strokeWidth={stroke}
            strokeLinecap="round"
            // One dash the length of the circle, pushed back by the unfilled part. Offset
            // rather than dasharray, so the mount animation can run it from empty.
            strokeDasharray={circumference}
            strokeDashoffset={circumference - filled}
            style={{ '--dial-empty': circumference } as CSSProperties}
            // Starts at twelve o'clock rather than three, which is where a gauge reads from.
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            className={cn(
              'animate-dial stroke-current transition-[stroke-dashoffset] duration-500',
              tone,
            )}
          />
        )}
      </svg>

      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={cn('text-lg font-medium tabular-nums', tone)}>
          {score === null ? '—' : score}
        </span>
      </div>
    </div>
  );
}
