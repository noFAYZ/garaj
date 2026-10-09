'use client';

import Link from 'next/link';
import { Icon, type IconName } from '@/components/icons';
import { cn } from '@/lib/utils';

/**
 * The things you actually open a vehicle to do (PRD §26), on the dashboard.
 *
 * Three, not six. "Log entry", "Service", "Expense" and "Task" were four doors into one idea —
 * something about this vehicle, done or coming up — and they are one Add now, which asks that
 * question on the activity page. Photos and documents stay separate because they are files,
 * not activity.
 *
 * Square tiles rather than a list of links: they are peers, and a grid says that where a
 * stacked list implies a ranking nobody intended.
 */
const ACTIONS: readonly { path: string; label: string; icon: IconName }[] = [
  { path: '?add=done', label: 'Add', icon: 'add' },
  { path: '/photos', label: 'Photo', icon: 'camera' },
  { path: '/documents', label: 'Document', icon: 'document' },
];

const TILE = 'flex aspect-square flex-col items-center justify-center gap-2.5 rounded-2xl bg-card';
const BADGE =
  'grid size-10 shrink-0 place-items-center rounded-xl transition-[background-color,color,translate] duration-200';

export function QuickActions({
  vehicleId,
}: {
  /** Absent while the vehicle is still loading: the tiles draw, but do not link yet. */
  vehicleId?: string;
}) {
  return (
    <nav aria-label="Quick actions">
      <ul className="grid grid-cols-3 gap-2">
        {ACTIONS.map((action) => (
          <li key={action.path}>
            {vehicleId ? (
              <Link
                href={`/vehicles/${vehicleId}${action.path}`}
                className={cn(
                  TILE,
                  'group transition-[background-color,scale] duration-200 hover:bg-muted active:scale-[0.96]',
                )}
              >
                {/*
                 * The glyph's tile fills with the accent on hover: these are actions, and the
                 * accent is the colour that means "act here". Filling the tile rather than
                 * tinting the glyph keeps dark-on-yellow contrast in the light theme, where a
                 * yellow glyph on white all but disappears.
                 */}
                <span
                  className={cn(
                    BADGE,
                    'bg-muted text-muted-foreground group-hover:-translate-y-0.5 group-hover:bg-primary group-hover:text-primary-foreground',
                  )}
                >
                  <Icon name={action.icon} size={22} />
                </span>
                <span className="text-sm font-semibold text-foreground">{action.label}</span>
              </Link>
            ) : (
              /*
               * No vehicle yet (still loading): the same tile with its real label, inert. The
               * label and glyph are the same for every vehicle, so there is nothing to
               * placeholder — only the link has to wait for a vehicle to point at.
               */
              <span aria-disabled="true" className={TILE}>
                <span className={cn(BADGE, 'bg-muted text-muted-foreground/40')}>
                  <Icon name={action.icon} size={22} />
                </span>
                <span className="text-sm font-semibold text-muted-foreground">{action.label}</span>
              </span>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}
