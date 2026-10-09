'use client';

import { useId } from 'react';
import { raise } from '@/components/ui/toaster';
import {
  setToastPosition,
  TOAST_POSITIONS,
  useToastPosition,
  type ToastPosition,
} from '@/lib/settings/toast';
import { cn } from '@/lib/utils';

/** Where each spot sits on the miniature screen. */
const SPOT: Record<ToastPosition, string> = {
  'top-center': 'top-3 left-1/2 -translate-x-1/2',
  'top-right': 'top-3 right-1',
  'bottom-left': 'bottom-1 left-1',
  'bottom-center': 'bottom-1 left-1/2 -translate-x-1/2',
  'bottom-right': 'bottom-1 right-1',
};

const label = (position: ToastPosition) =>
  position.replace('-', ' ').replace(/^./, (letter) => letter.toUpperCase());

/**
 * A small screen with a spot for each place a toast can appear — you point at where you want
 * it rather than read five names. Native radios underneath: one tab stop, arrows move and
 * choose. Each choice sends a sample toast, which glides to the new spot while it is up.
 */
export function ToastPositionPicker({ labelledBy }: { labelledBy?: string }) {
  const current = useToastPosition();
  const name = useId();

  return (
    <div
      role="radiogroup"
      aria-labelledby={labelledBy}
      aria-label={labelledBy ? undefined : 'Toast position'}
      className="relative h-24 w-36 rounded-xl bg-muted"
    >
      {/* The header, so the top spots read as sitting under it. */}
      <span aria-hidden="true" className="absolute inset-x-2 top-1.5 h-1 rounded-full bg-border" />
      {TOAST_POSITIONS.map((position) => (
        <label
          key={position}
          className={cn('absolute grid h-7 w-11 cursor-pointer place-items-center', SPOT[position])}
        >
          <input
            type="radio"
            name={name}
            value={position}
            checked={current === position}
            onChange={() => {
              setToastPosition(position);
              raise('success', 'Toasts appear here');
            }}
            aria-label={label(position)}
            className="peer sr-only"
          />
          <span
            aria-hidden="true"
            className="h-2 w-7 rounded-full bg-border-strong transition-[background-color,width] duration-200 hover:bg-muted-foreground peer-checked:w-9 peer-checked:bg-primary peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring"
          />
        </label>
      ))}
    </div>
  );
}
