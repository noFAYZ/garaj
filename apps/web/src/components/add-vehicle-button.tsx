'use client';

import dynamic from 'next/dynamic';
import { useState, type ReactNode } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/primitives';
import { openUpgrade, useOwnPlanGoverns, usePlan } from '@/lib/upgrade';

/**
 * The button, and the dialog it opens — loaded only once it is opened.
 *
 * The dialog inlines 39 manufacturer logos, which is about 42 kB gzipped. That is a lot to
 * put in the bundle every visitor downloads for a dialog most of them open once, so the
 * import is dynamic and the logos arrive with the first click. `ssr: false` because there is
 * nothing to render server-side: a closed dialog.
 */
const AddVehicleDialog = dynamic(
  () => import('@/components/add-vehicle-dialog').then((module) => module.AddVehicleDialog),
  { ssr: false },
);

export function AddVehicleButton({
  label = 'Add vehicle',
  variant = 'primary',
  size = 'md',
  className,
  garageId,
  children,
}: {
  label?: string;
  variant?: 'primary' | 'secondary';
  /** `lg` as the action at the end of a section strip. */
  size?: 'md' | 'lg';
  /** What the button shows, where the plus and label are not it (the strip's coin and label). */
  children?: ReactNode;
  /** For joining it to a neighbour in a combo button, which flattens the shared edge. */
  className?: string;
  /** Preselects the garage the vehicle goes into, when opened from inside one. */
  garageId?: string;
}) {
  const [open, setOpen] = useState(false);
  const { limitWall } = usePlan();
  const governs = useOwnPlanGoverns(garageId);

  /*
   * At the ceiling the button opens the plans instead of the dialog. A sheet filled in and
   * then refused is the worst place to learn about a limit; the server still refuses
   * regardless, so a stale count here costs one refusal, never a vehicle past the plan.
   */
  const start = () => {
    const wall = governs ? limitWall('vehicles') : null;
    if (wall) openUpgrade(wall);
    else setOpen(true);
  };

  return (
    <>
      <Button variant={variant} size={size} onClick={start} className={className}>
        {children ?? (
          <>
            <Plus className="size-4" aria-hidden="true" />
            {label}
          </>
        )}
      </Button>

      {/*
       * Mounted only once opened, and unmounted on close — which is also what resets the
       * sheet. Keeping it mounted would reopen it with the last vehicle's make still filled in.
       */}
      {open ? <AddVehicleDialog onClose={() => setOpen(false)} defaultGarageId={garageId} /> : null}
    </>
  );
}
