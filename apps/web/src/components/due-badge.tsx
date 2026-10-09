'use client';

import type { MaintenancePlan } from '@vehicle-os/contracts';
import { Icon, type IconName } from '@/components/icons';
import { cn } from '@/lib/utils';

/**
 * How a due status looks and reads.
 *
 * The status itself is computed server-side on every read (§23) — this maps it to colour and
 * words, and nothing here recomputes whether a plan is late.
 */
const TONES: Record<
  MaintenancePlan['status'],
  { label: string; icon: IconName; className: string }
> = {
  OVERDUE: { label: 'Overdue', icon: 'overdue', className: 'bg-destructive-soft text-destructive' },
  DUE_SOON: { label: 'Due soon', icon: 'dueSoon', className: 'bg-warning-soft text-warning' },
  OK: { label: 'On schedule', icon: 'ok', className: 'bg-success-soft text-success' },
  UNSCHEDULED: {
    label: 'Not scheduled',
    icon: 'info',
    className: 'bg-muted text-muted-foreground',
  },
};

export function DueBadge({
  status,
  className,
}: {
  status: MaintenancePlan['status'];
  className?: string;
}) {
  const tone = TONES[status];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium',
        tone.className,
        className,
      )}
    >
      <Icon name={tone.icon} size={14} />
      {tone.label}
    </span>
  );
}
