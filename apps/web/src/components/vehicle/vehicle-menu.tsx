'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MoreHorizontal } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { Vehicle } from '@vehicle-os/contracts';
import { capabilitiesFor } from '@vehicle-os/domain';
import { garagesQuery, queryKeys } from '@vehicle-os/api-client/react';
import { Icon, type IconName } from '@/components/icons';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/motion/popover';
import { SharePanel } from '@/components/share-panel';
import { VehicleTransferPanel } from '@/components/transfer-panel';
import { buttonClass } from '@/components/ui/button-class';
import { FormError, Modal, ModalActions } from '@/components/ui/modal';
import { Button } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { VehicleDetailsModal } from './vehicle-details-modal';
import { ASSESS_DESCRIPTION, AssessmentForm, ValuationForm } from './value-panel';

type Sheet = 'details' | 'value' | 'condition' | 'share' | 'data' | 'archive';

const ITEMS: readonly { sheet: Sheet; label: string; icon: IconName }[] = [
  { sheet: 'details', label: 'Edit details', icon: 'edit' },
  { sheet: 'value', label: 'Record a value', icon: 'money' },
  { sheet: 'condition', label: 'Assess condition', icon: 'wheel' },
  { sheet: 'share', label: 'Share', icon: 'people' },
  { sheet: 'data', label: 'Export or import', icon: 'document' },
];

/**
 * Archiving, and said as archiving.
 *
 * The server keeps every record and only takes the vehicle out of the lists, so a button
 * labelled Delete would be describing something that does not happen — which is the kind of
 * wrong a user only discovers a year later, looking for what a car cost them.
 */
function ArchiveVehicle({ vehicle, onCancel }: { vehicle: Vehicle; onCancel: () => void }) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const archive = useMutation({
    mutationFn: () => api.vehicles.archive(vehicle.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.vehicles() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.garages() });
      // Off the page before it starts 404ing: this vehicle is no longer in any list behind it.
      router.push('/vehicles');
    },
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl bg-muted/60 p-4">
        <p className="text-sm text-foreground">
          Its history, costs, documents and photos are all kept — nothing is erased. An owner or an
          admin can bring it back.
        </p>
      </div>

      {archive.isError ? <FormError>{(archive.error as Error).message}</FormError> : null}

      <ModalActions>
        <Button variant="ghost" onClick={onCancel}>
          Keep it
        </Button>
        <Button variant="danger" loading={archive.isPending} onClick={() => archive.mutate()}>
          Archive vehicle
        </Button>
      </ModalActions>
    </div>
  );
}

/**
 * The things you do to a vehicle rarely, behind one ⋯ on its hero.
 *
 * Correcting its identity, recording a valuation, assessing its condition and sharing it were
 * each a reason to have a tab. None is something most visits do, and a tab strip of occasional
 * errands pushes the everyday record further away. Each opens as a dialog over whichever tab
 * you are on, and closing it returns you there.
 *
 * Plain buttons in the panel, not `role="menu"`: a menu role promises arrow-key roving focus,
 * and a role that promises behaviour the element lacks is worse for a screen reader than none.
 */
export function VehicleMenu({ vehicle }: { vehicle: Vehicle }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [sheet, setSheet] = useState<Sheet | null>(null);

  const close = () => setSheet(null);
  const saved = () => {
    close();
    void queryClient.invalidateQueries({ queryKey: queryKeys.vehicle(vehicle.id) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard() });
  };

  /*
   * Only for the role, and from a list the page has already fetched. An archive control shown
   * to a member the server will refuse is a button that always fails.
   */
  const garages = useQuery(garagesQuery(api));
  const role = garages.data?.find((garage) => garage.id === vehicle.garageId)?.role;
  const canArchive = role ? capabilitiesFor(role).includes('vehicle.delete') : false;

  return (
    <>
      <Popover open={open} onOpenChange={setOpen} side="bottom" align="end" sideOffset={10}>
        <PopoverTrigger>
          <button
            type="button"
            aria-label={`More for ${vehicle.displayName}`}
            className={buttonClass('ghost', 'icon', 'rounded-full')}
          >
            <MoreHorizontal className="size-5" aria-hidden="true" />
          </button>
        </PopoverTrigger>

        <PopoverContent className="w-56 p-1.5">
          {ITEMS.map((item) => (
            <button
              key={item.sheet}
              type="button"
              onClick={() => {
                setOpen(false);
                setSheet(item.sheet);
              }}
              className="flex h-10 w-full items-center gap-3 rounded-xl px-2.5 text-left text-sm font-semibold text-foreground transition-colors hover:bg-muted"
            >
              <Icon name={item.icon} size={16} className="shrink-0 text-muted-foreground" />
              {item.label}
            </button>
          ))}
          {canArchive ? (
            <>
              {/* Ruled off: the destructive item is never the one directly under the routine ones. */}
              <div role="separator" className="my-1.5 h-px bg-border" />
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setSheet('archive');
                }}
                className="flex h-10 w-full items-center gap-3 rounded-xl px-2.5 text-left text-sm font-semibold text-destructive transition-colors hover:bg-destructive-soft"
              >
                <Icon name="trash" size={16} className="shrink-0" />
                Archive vehicle
              </button>
            </>
          ) : null}
        </PopoverContent>
      </Popover>

      {sheet === 'details' ? <VehicleDetailsModal vehicle={vehicle} onClose={close} /> : null}

      {sheet === 'value' ? (
        <Modal
          title="Record a value"
          description="An estimate, a quote or a sale."
          icon="chart"
          onClose={close}
        >
          <ValuationForm vehicleId={vehicle.id} onDone={saved} onCancel={close} />
        </Modal>
      ) : null}

      {sheet === 'condition' ? (
        <Modal
          title="Assess the condition"
          description={ASSESS_DESCRIPTION}
          icon="inspection"
          size="lg"
          onClose={close}
        >
          <AssessmentForm vehicleId={vehicle.id} initial={null} onDone={saved} onCancel={close} />
        </Modal>
      ) : null}

      {sheet === 'archive' ? (
        <Modal
          title={`Archive ${vehicle.displayName}?`}
          description="It leaves your vehicles and the garage it is in."
          icon="archive"
          onClose={close}
        >
          <ArchiveVehicle vehicle={vehicle} onCancel={close} />
        </Modal>
      ) : null}

      {sheet === 'data' ? (
        <Modal
          title="Export or import"
          description="Download this vehicle's records, or bring in a log from another app."
          icon="document"
          size="lg"
          onClose={close}
        >
          <VehicleTransferPanel vehicleId={vehicle.id} />
        </Modal>
      ) : null}

      {sheet === 'share' ? (
        <Modal
          title="Share this vehicle"
          description="A link that shows its history to someone without an account."
          icon="share"
          size="lg"
          onClose={close}
        >
          <SharePanel vehicleId={vehicle.id} />
        </Modal>
      ) : null}
    </>
  );
}
