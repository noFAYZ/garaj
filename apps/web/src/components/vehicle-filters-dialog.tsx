'use client';

import type { VehicleStatus } from '@vehicle-os/domain';
import { VEHICLE_STATUSES } from '@vehicle-os/domain';
import type { Garage } from '@vehicle-os/contracts';
import { Modal, ModalActions } from '@/components/ui/modal';
import { Button } from '@/components/ui/primitives';
import { ANY_VALUE, SelectField } from '@/components/ui/select-field';
import { humanise } from '@/lib/format';

/**
 * The vehicle filters, in a dialog.
 *
 * They were two rows of controls above the grid, permanently occupying the space between the
 * page heading and the thing the page is about. Filtering is occasional; the vehicles are
 * not. Behind a button they cost nothing until used, and the button says when they are on.
 *
 * A `Modal` like every other dialog (it was a hand-made `<dialog>` a size of its own), mounted
 * only while open. The filters apply as they change; the button only closes.
 */
export function VehicleFiltersDialog({
  open,
  onClose,
  garages,
  garageId,
  status,
  onGarageChange,
  onStatusChange,
}: {
  open: boolean;
  onClose: () => void;
  garages: readonly Garage[];
  garageId: string | null;
  status: VehicleStatus | null;
  onGarageChange: (value: string | null) => void;
  onStatusChange: (value: VehicleStatus | null) => void;
}) {
  if (!open) return null;

  const clear = () => {
    onGarageChange(null);
    onStatusChange(null);
  };

  return (
    <Modal title="Filter" icon="filter" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <SelectField
          label="Garage"
          value={garageId ?? ANY_VALUE}
          onChange={(value) => onGarageChange(value === ANY_VALUE ? null : value)}
          options={[
            { value: ANY_VALUE, label: 'All garages' },
            ...garages.map((garage) => ({ value: garage.id, label: garage.name })),
          ]}
        />

        <SelectField
          label="Status"
          value={status ?? ANY_VALUE}
          onChange={(value) =>
            onStatusChange(value === ANY_VALUE ? null : (value as VehicleStatus))
          }
          options={[
            { value: ANY_VALUE, label: 'Any status' },
            ...VEHICLE_STATUSES.map((value) => ({ value, label: humanise(value) })),
          ]}
        />

        <ModalActions>
          <Button variant="ghost" onClick={clear} disabled={!garageId && !status}>
            Clear
          </Button>
          <Button variant="primary" onClick={onClose}>
            Show results
          </Button>
        </ModalActions>
      </div>
    </Modal>
  );
}
