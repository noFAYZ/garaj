'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { useParams, useSearchParams } from 'next/navigation';
import { useEffect, useState, type CSSProperties } from 'react';
import type { GarageMember, Vehicle } from '@vehicle-os/contracts';
import {
  garageMembersQuery,
  garagesQuery,
  queryKeys,
  vehicleQuery,
} from '@vehicle-os/api-client/react';
import { capabilitiesFor } from '@vehicle-os/domain';
import { api } from '@/lib/api';
import { useSession } from '@/lib/auth-client';
import { humanise } from '@/lib/format';
import { afterFade, clearRequest } from '@/lib/open-add';
import { Icon } from '@/components/icons';
import { Face } from '@/components/member-face';
import { Modal, ModalActions } from '@/components/ui/modal';
import { SectionHeading } from '@/components/ui/overview';
import { Button, EmptyState } from '@/components/ui/primitives';
import { ListSkeleton, Loading } from '@/components/ui/skeleton';

const pad = (value: number) => String(value).padStart(2, '0');

/**
 * Who drives this vehicle: the garage's assignments read from the vehicle's side — the same rows
 * the garage's Drivers tab shows from each person's. Many to many, so a driver here may drive
 * others too, and says how many.
 *
 * Assigning is a dialog, from Assign at the end of the section strip (`?add=drivers`) or the empty
 * state, for those who may change the garage's people; everyone else reads.
 */
export default function VehicleDriversPage() {
  const { vehicleId } = useParams<{ vehicleId: string }>();
  const requested = useSearchParams().get('add');
  const me = useSession().data?.user.id;

  const vehicle = useQuery(vehicleQuery(api, vehicleId));
  const garageId = vehicle.data?.garageId;
  const members = useQuery({
    ...garageMembersQuery(api, garageId ?? ''),
    enabled: Boolean(garageId),
  });
  const garages = useQuery(garagesQuery(api));
  const role = garages.data?.find((garage) => garage.id === garageId)?.role;
  const canAssign = role ? capabilitiesFor(role).includes('garage.manage_members') : false;

  // Opened once any route cross-fade is over, as Documents' upload is.
  const [assigning, setAssigning] = useState(false);
  useEffect(() => {
    if (requested === 'drivers') return afterFade(() => setAssigning(true));
  }, [requested]);
  const close = () => {
    setAssigning(false);
    if (requested) clearRequest();
  };

  if (members.isError) {
    return <EmptyState title="Could not load the drivers" description={members.error.message} />;
  }

  const memberList = members.data ?? [];
  const drivers = memberList.filter((member) => member.vehicleIds.includes(vehicleId));
  const pending = !vehicle.data || members.isPending;

  return (
    <section aria-labelledby="vehicle-drivers" className="flex flex-col gap-4">
      <SectionHeading
        id="vehicle-drivers"
        title="Drivers"
        count={pending ? undefined : drivers.length}
      />

      {pending ? (
        <Loading label="Loading drivers">
          <ListSkeleton rows={2} />
        </Loading>
      ) : drivers.length === 0 ? (
        <EmptyState
          title="Nobody drives this yet"
          description="Say who does. A driver can have several vehicles, and a vehicle several drivers."
          action={
            canAssign ? (
              <Button variant="primary" onClick={() => setAssigning(true)}>
                Assign a driver
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {drivers.map((member, index) => {
            const others = member.vehicleIds.length - 1;
            return (
              <li
                key={member.id}
                style={{ '--i': index } as CSSProperties}
                className="stagger flex animate-rise items-center gap-4 rounded-2xl bg-card/50 p-3"
              >
                <span
                  aria-hidden="true"
                  className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-full bg-muted font-mono text-xs font-semibold text-foreground"
                >
                  <Face member={member} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate text-sm font-semibold text-foreground">
                      {member.name}
                    </span>
                    {member.userId === me ? (
                      <span className="shrink-0 rounded-full bg-muted px-1.5 py-px text-[0.625rem] font-semibold uppercase tracking-wider text-muted-foreground">
                        You
                      </span>
                    ) : null}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {humanise(member.role)}
                    {others > 0 ? (
                      <>
                        <span aria-hidden="true"> · </span>
                        also drives{' '}
                        <span className="font-mono font-semibold tabular-nums text-foreground">
                          {pad(others)}
                        </span>{' '}
                        {others === 1 ? 'other' : 'others'}
                      </>
                    ) : null}
                  </div>
                </div>
                {canAssign ? (
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Change who drives this"
                    onClick={() => setAssigning(true)}
                    className="shrink-0"
                  >
                    <Icon name="edit" size={16} />
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {assigning && vehicle.data && !members.isPending ? (
        <AssignDrivers vehicle={vehicle.data} members={memberList} onClose={close} />
      ) : null}
    </section>
  );
}

/**
 * Who drives this vehicle, as one question: the garage's people as tiles to tick, starting from
 * whoever drives it now. The save replaces the vehicle's whole set in one request — unticking is
 * how someone is taken off it — and leaves what else each person drives alone.
 */
function AssignDrivers({
  vehicle,
  members,
  onClose,
}: {
  vehicle: Vehicle;
  members: readonly GarageMember[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [picked, setPicked] = useState(
    () => new Set(members.filter((m) => m.vehicleIds.includes(vehicle.id)).map((m) => m.id)),
  );

  const save = useMutation({
    mutationFn: () => api.garages.assignDrivers(vehicle.garageId, vehicle.id, [...picked]),
    meta: { toast: 'Drivers updated' },
    onSuccess: (updated) => {
      // The answer is the garage's members as they now are: no second request for the list.
      queryClient.setQueryData(queryKeys.garageMembers(vehicle.garageId), updated);
      onClose();
    },
  });

  const toggle = (id: string) =>
    setPicked((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  return (
    <Modal
      title={`Who drives the ${vehicle.displayName}?`}
      description="Anyone in the garage can drive. A vehicle can have several drivers."
      icon="people"
      onClose={onClose}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        <fieldset className="min-w-0">
          <legend className="mb-2 text-sm font-medium text-foreground">Drivers</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {members.map((member) => (
              <label
                key={member.id}
                className="group/tile flex cursor-pointer items-center gap-3 rounded-xl bg-muted/60 p-2.5 transition-colors hover:bg-muted has-[:checked]:bg-primary-soft has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
              >
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={picked.has(member.id)}
                  onChange={() => toggle(member.id)}
                />
                <span
                  aria-hidden="true"
                  className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-full bg-card font-mono text-xs font-semibold text-foreground"
                >
                  <Face member={member} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-foreground">
                    {member.name}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {humanise(member.role)}
                  </span>
                </span>
                <span
                  aria-hidden="true"
                  className="grid size-5 shrink-0 place-items-center rounded-full text-transparent ring-1 ring-border-strong transition-colors group-has-[:checked]/tile:bg-primary group-has-[:checked]/tile:text-primary-foreground group-has-[:checked]/tile:ring-primary"
                >
                  <Check className="size-3.5" strokeWidth={3} />
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <ModalActions>
          <Button variant="ghost" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={save.isPending}>
            Save
          </Button>
        </ModalActions>
      </form>
    </Modal>
  );
}
