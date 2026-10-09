'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useId, useState, type CSSProperties } from 'react';
import type { Garage, GarageMember, Vehicle } from '@vehicle-os/contracts';
import { GARAGE_ROLES, capabilitiesFor, type GarageRole } from '@vehicle-os/domain';
import { ApiError } from '@vehicle-os/api-client';
import {
  dashboardQuery,
  garageMembersQuery,
  garagesQuery,
  queryKeys,
  vehiclesQuery,
} from '@vehicle-os/api-client/react';
import { api } from '@/lib/api';
import { AddVehicleButton } from '@/components/add-vehicle-button';
import { BrandLogo } from '@/components/brand-logo';
import { attentionByGarage } from '@/components/garage-card';
import { Ground } from '@/components/greeting';
import { Icon } from '@/components/icons';
import { Face } from '@/components/member-face';
import { Modal, ModalActions } from '@/components/ui/modal';
import { ConfirmDelete } from '@/components/ui/row-actions';
import { SettingsModal } from '@/components/ui/settings-modal';
import { buttonClass } from '@/components/ui/button-class';
import { Button, EmptyState, Field } from '@/components/ui/primitives';
import {
  PlusCoin,
  STRIP_ACTION,
  STRIP_ROW,
  STRIP_SCROLLER,
  StripPill,
  stripClass,
  stripTabClass,
  useStrip,
} from '@/components/ui/section-strip';
import { CardGridSkeleton, ListSkeleton, Loading, Skeleton } from '@/components/ui/skeleton';
import { VehicleCard, useSpent } from '@/components/vehicle-card';
import { VEHICLE_GRID } from '@/components/vehicle-grid';
import { typeIcon } from '@/components/vehicle-hero';
import { useSession } from '@/lib/auth-client';
import { formatMoneyWhole, humanise, toMinorUnits } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Select } from '@/components/ui/select';
import { SelectField } from '@/components/ui/select-field';

/** Owner is not offered: ownership is transferred, never assigned from a dropdown. */
const ROLE_OPTIONS = GARAGE_ROLES.filter((role) => role !== 'OWNER').map((role) => ({
  value: role,
  label: humanise(role),
}));

const pad = (value: number) => String(value).padStart(2, '0');

export default function GarageOverviewPage() {
  const { garageId } = useParams<{ garageId: string }>();

  /*
   * The garage comes from the list rather than a `get` of its own: the list is already in
   * cache from the dashboard and the garages page, so arriving here usually renders without
   * a request at all. It carries `role`, which is what gates every control below.
   */
  const garages = useQuery(garagesQuery(api));
  const garage = garages.data?.find((row) => row.id === garageId);

  const vehicles = useQuery(vehiclesQuery(api, { garageId }));
  // The faces in the header and the drivers below; the same cache entry the settings list reads.
  const members = useQuery(garageMembersQuery(api, garageId));
  const spent = useSpent(vehicles.data?.data ?? []);
  // Usually in cache from home; what in here is overdue or due soon is sorted out of it.
  const dashboard = useQuery(dashboardQuery(api));

  /*
   * The page is what is in the garage; how the garage is run — its name, who is in it — sits one
   * button away. Both are occasional jobs, and laid out on the page every visit scrolled past them
   * to reach the vehicles.
   */
  // Open at a section when the press says which (the faces open the members).
  const [settingsOpen, setSettingsOpen] = useState<{ section?: string } | null>(null);
  // Who drives what: a member to start from, or `null` to ask which.
  const [assigning, setAssigning] = useState<{ memberId: string | null } | null>(null);
  // The section is in the address, as a vehicle's is: back from a vehicle lands on the same one.
  const tab = useSearchParams().get('tab') === 'drivers' ? 'drivers' : 'vehicles';
  const { sentinelRef, stuck, markSwitch } = useStrip(tab);

  if (garages.isError) {
    return <EmptyState title="Could not load this garage" description={garages.error.message} />;
  }
  if (!garages.isPending && !garage) {
    return (
      <EmptyState
        title="Garage not found"
        description="It may have been deleted, or you may no longer be a member of it."
      />
    );
  }

  const vehicleList = vehicles.data?.data ?? [];
  const memberList = members.data ?? [];

  /*
   * The figures on the plate. Not the counts (the tabs carry them), nor the currency and role
   * (words, not figures — they ride in the eyebrow): what is waiting on you, and what running the
   * place has cost.
   */
  // `undefined` while unknown; a garage missing from the map has nothing due.
  const due = attentionByGarage(dashboard.data?.attention, vehicles.data?.data);
  const waiting = due ? (due.get(garageId) ?? null) : undefined;
  const waitingCount = waiting ? waiting.late + waiting.soon + waiting.papers : 0;
  const cost =
    vehicles.isPending || !garage ? undefined : runningCost(spent, garage.defaultCurrency);
  const shared = garage && garage.role !== 'OWNER';
  const canManageMembers = garage
    ? capabilitiesFor(garage.role).includes('garage.manage_members')
    : false;
  const drivers = memberList.filter((member) => member.vehicleIds.length > 0);
  const driven = new Set(drivers.flatMap((member) => member.vehicleIds));
  const undriven = vehicleList.filter((vehicle) => !driven.has(vehicle.id));
  const loading = members.isPending || vehicles.isPending;

  const base = `/garages/${garageId}`;
  const sections = [
    {
      value: 'vehicles',
      href: base,
      label: 'Vehicles',
      icon: 'vehicles',
      count: vehicles.isPending ? undefined : vehicleList.length,
    },
    {
      value: 'drivers',
      href: `${base}?tab=drivers`,
      label: 'Drivers',
      icon: 'people',
      count: loading ? undefined : drivers.length,
    },
  ] as const;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <Link
          href="/garages"
          className="flex w-fit items-center gap-1.5 rounded font-mono text-xs font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
        >
          <Icon name="chevronRight" size={14} className="rotate-180" />
          Garages
        </Link>

        {/*
         * The garage as a plate, in two lines: what it is and what you can do to it, then who is in
         * it and its two figures. Compact on purpose — the vehicles are what you came for.
         */}
        <section
          aria-labelledby="garage-title"
          className="relative isolate animate-rise rounded-3xl bg-card/60 p-4 sm:p-5"
        >
          <Ground />

          <div className="relative flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
            <div className="min-w-0 flex-1 basis-60">
              <p className="font-mono text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Garage
                {garage ? (
                  <>
                    <span aria-hidden="true"> · </span>
                    {garage.defaultCurrency}
                    {/* Only when it is not yours: every garage you made would say Owner. */}
                    {shared ? (
                      <>
                        <span aria-hidden="true"> · </span>
                        Shared as {humanise(garage.role)}
                      </>
                    ) : null}
                  </>
                ) : null}
              </p>
              {garage ? (
                <>
                  <h1
                    id="garage-title"
                    className="mt-1 truncate text-2xl font-bold tracking-tight text-foreground sm:text-[1.75rem] sm:leading-tight"
                  >
                    {garage.name}
                  </h1>
                  {garage.description ? (
                    <p className="mt-0.5 truncate text-sm text-muted-foreground">
                      {garage.description}
                    </p>
                  ) : null}
                </>
              ) : (
                <div className="mt-1.5 flex flex-col gap-1.5">
                  <Skeleton className="h-8 w-56 max-w-full" />
                  <Skeleton className="h-4 w-40" />
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              {garage ? (
                // Named for what it opens: the account menu has a Settings too, for the app itself.
                <Button
                  size="icon"
                  aria-label="Garage settings"
                  onClick={() => setSettingsOpen({})}
                >
                  <Icon name="settings" size={18} />
                </Button>
              ) : null}
            </div>
          </div>

          <div className="relative mt-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
            {/* For every member: those who cannot change anything still see who else is here. */}
            {garage && !members.isPending ? (
              <Crew members={memberList} onOpen={() => setSettingsOpen({ section: 'members' })} />
            ) : (
              <Skeleton className="h-10 w-36 rounded-full" />
            )}

            <dl className="flex min-w-0 items-center">
              <Stat
                label="Needs you"
                value={waiting === undefined ? undefined : pad(waitingCount)}
                tone={
                  !waitingCount
                    ? 'success'
                    : [...waiting!.vehicles.values()].includes('late')
                      ? 'destructive'
                      : 'warning'
                }
                // Said only once known: "All clear" over a figure still loading would be a guess.
                note={
                  !waiting
                    ? waiting === null
                      ? 'All clear'
                      : undefined
                    : [
                        waiting.late ? `${waiting.late} overdue` : null,
                        waiting.soon ? `${waiting.soon} soon` : null,
                        waiting.papers ? `${waiting.papers} papers` : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')
                }
              />
              <Stat
                label="Running cost"
                value={cost === undefined ? undefined : formatMoneyWhole(cost)}
                note={cost === null ? 'Mixed currencies' : 'Excl. purchase'}
              />
            </dl>
          </div>
        </section>
      </div>

      {/*
       * What is in the garage and who drives it, as two views of one place — in the same strip a
       * vehicle's sections use, so going from a garage into one of its vehicles reads as one app.
       * Each section carries its count; its one action sits at the end, where a vehicle's Add does.
       */}
      {/* Its negative margin cancels the column's gap, so the marker takes no space. */}
      <div ref={sentinelRef} aria-hidden="true" className="-mb-6 h-0" />
      <div className={STRIP_ROW}>
        <div className={STRIP_SCROLLER}>
          <nav aria-label="Garage sections" className={stripClass(stuck)}>
            {sections.map((section) => {
              const active = tab === section.value;
              return (
                <Link
                  key={section.value}
                  href={section.href}
                  scroll={false}
                  aria-current={active ? 'page' : undefined}
                  onClick={(event) => {
                    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                    markSwitch();
                  }}
                  className={stripTabClass(active)}
                >
                  {active ? <StripPill layoutId="garage-tab-active" /> : null}
                  <Icon name={section.icon} size={16} />
                  {/* On a phone the action at the end needs the room: the others keep their icon. */}
                  <span className={cn(!active && 'max-sm:sr-only')}>{section.label}</span>
                  {section.count !== undefined ? (
                    <span className="font-mono text-xs tabular-nums text-muted-foreground">
                      {pad(section.count)}
                    </span>
                  ) : null}
                </Link>
              );
            })}
          </nav>
        </div>
        {tab === 'vehicles' ? (
          <AddVehicleButton garageId={garageId} className={STRIP_ACTION}>
            <PlusCoin />
            <span className="max-sm:sr-only">Add vehicle</span>
          </AddVehicleButton>
        ) : canManageMembers && vehicleList.length > 0 ? (
          <button
            type="button"
            onClick={() => setAssigning({ memberId: null })}
            className={buttonClass('primary', 'md', STRIP_ACTION)}
          >
            <PlusCoin />
            <span className="max-sm:sr-only">Assign driver</span>
          </button>
        ) : null}
      </div>

      {/* Keyed by section, so each arrives with the same rise as the rest of the page. */}
      <div key={tab} className="animate-rise">
        {tab === 'vehicles' ? (
          <>
            {vehicles.isPending ? (
              <Loading label="Loading vehicles">
                <CardGridSkeleton cards={2} />
              </Loading>
            ) : vehicleList.length === 0 ? (
              <EmptyState
                title="Nothing in this garage yet"
                description="Add a vehicle and its history starts here."
                action={<AddVehicleButton label="Add a vehicle" garageId={garageId} />}
              />
            ) : (
              <div className={VEHICLE_GRID}>
                {vehicleList.map((vehicle, index) => (
                  <div
                    key={vehicle.id}
                    className="stagger animate-rise"
                    style={{ '--i': index } as CSSProperties}
                  >
                    <VehicleCard vehicle={vehicle} spent={spent.get(vehicle.id)} />
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            {/*
             * Who drives what, read from the people's side: each driver with the vehicles they have.
             * Many to many — a vehicle shows under every driver it has, and the ones nobody drives
             * close the list as an empty seat. Anyone in the garage can drive; the role is what they
             * may change, not whether they are behind the wheel.
             */}
            {loading ? (
              <Loading label="Loading drivers">
                <ListSkeleton rows={2} />
              </Loading>
            ) : drivers.length === 0 ? (
              <EmptyState
                title="Nobody is behind the wheel yet"
                description={
                  vehicleList.length === 0
                    ? 'Once a vehicle is in, say who drives it.'
                    : 'Say who drives what. A driver can have several vehicles, and a vehicle several drivers.'
                }
                action={
                  canManageMembers && vehicleList.length > 0 ? (
                    <Button variant="primary" onClick={() => setAssigning({ memberId: null })}>
                      Assign a driver
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <ul className="flex flex-col gap-2">
                {drivers.map((member, index) => (
                  <DriverRow
                    key={member.id}
                    member={member}
                    index={index}
                    vehicles={vehicleList.filter((vehicle) =>
                      member.vehicleIds.includes(vehicle.id),
                    )}
                    onEdit={
                      canManageMembers ? () => setAssigning({ memberId: member.id }) : undefined
                    }
                  />
                ))}
                {undriven.length > 0 ? (
                  <li
                    style={{ '--i': drivers.length } as CSSProperties}
                    className="stagger flex animate-rise flex-wrap items-center gap-x-4 gap-y-3 rounded-2xl border border-dashed border-border-strong p-3 sm:flex-nowrap"
                  >
                    {/* An empty seat. */}
                    <span
                      aria-hidden="true"
                      className="size-10 shrink-0 rounded-full border border-dashed border-border-strong"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-foreground">
                        No driver
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        <span className="font-mono font-semibold tabular-nums text-foreground">
                          {pad(undriven.length)}
                        </span>{' '}
                        {undriven.length === 1 ? 'vehicle' : 'vehicles'}
                      </div>
                    </div>
                    <VehicleChips label="Vehicles nobody drives" vehicles={undriven} />
                  </li>
                ) : null}
              </ul>
            )}
          </>
        )}
      </div>

      {assigning ? (
        <AssignDriver
          garageId={garageId}
          members={memberList}
          vehicles={vehicleList}
          memberId={assigning.memberId}
          onClose={() => setAssigning(null)}
        />
      ) : null}

      {/* Mounted only while open, so each opening starts from the garage as it is now. */}
      {settingsOpen && garage ? (
        <GarageSettingsModal
          garage={garage}
          section={settingsOpen.section}
          onClose={() => setSettingsOpen(null)}
        />
      ) : null}
    </div>
  );
}

/** Everything spent running the garage, in its currency; `null` when its vehicles keep others. */
function runningCost(
  spent: ReadonlyMap<string, { amountMinor: number; currency: string } | null | undefined>,
  currency: string,
) {
  const values = [...spent.values()];
  if (values.includes(undefined)) return undefined;
  const known = values.filter((money) => money != null);
  if (known.some((money) => money.currency !== currency)) return null;
  return { currency, amountMinor: known.reduce((sum, money) => sum + money.amountMinor, 0) };
}

/** A vehicle's badge in a round slot: the make's logo, else the kind of vehicle. */
function Badge({ vehicle, className }: { vehicle: Vehicle; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'grid shrink-0 place-items-center overflow-hidden rounded-full bg-card text-muted-foreground',
        className,
      )}
    >
      {vehicle.make ? (
        <BrandLogo make={vehicle.make} size={36} fill className="rounded-full text-foreground" />
      ) : (
        <Icon name={typeIcon(vehicle.vehicleType)} size={14} />
      )}
    </span>
  );
}

/** Vehicles as chips that go to them: a row's last word, under it on a phone. */
function VehicleChips({ label, vehicles }: { label: string; vehicles: readonly Vehicle[] }) {
  return (
    <ul
      aria-label={label}
      className="flex min-w-0 basis-full flex-wrap gap-1.5 max-sm:order-last sm:basis-auto sm:justify-end"
    >
      {vehicles.map((vehicle) => (
        <li key={vehicle.id} className="min-w-0">
          <Link
            href={`/vehicles/${vehicle.id}`}
            className="flex h-8 max-w-48 items-center gap-2 rounded-full bg-muted pl-1 pr-3 text-xs font-semibold text-foreground transition-colors hover:bg-border"
          >
            <Badge vehicle={vehicle} className="size-6" />
            <span className="truncate">{vehicle.displayName}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

const TONES = {
  success: 'text-success',
  warning: 'text-warning',
  destructive: 'text-destructive',
} as const;

/**
 * A figure on the plate: label over a mono value with its note beside it, one line tall. The
 * compact cousin of `Readings`, for a header that has two figures and no room for a cluster.
 */
function Stat({
  label,
  value,
  tone,
  note,
}: {
  label: string;
  /** `undefined` while it loads: the label is drawn at once, only the figure waits. */
  value: string | undefined;
  tone?: keyof typeof TONES;
  note?: string;
}) {
  return (
    <div className="min-w-0 border-l border-border/60 px-4 first:border-l-0 first:pl-0 last:pr-0">
      <dt className="text-label uppercase text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          'mt-0.5 flex h-7 gap-1.5 whitespace-nowrap',
          // A placeholder has no baseline to share, so the note centres on it until the figure lands.
          value === undefined ? 'items-center' : 'items-baseline',
        )}
      >
        {value === undefined ? (
          <Skeleton className="h-6 w-12 self-center" />
        ) : (
          <span
            className={cn(
              'font-mono text-lg font-semibold tabular-nums',
              tone ? TONES[tone] : 'text-foreground',
            )}
          >
            {value}
          </span>
        )}
        {note ? <span className="truncate text-xs text-muted-foreground">{note}</span> : null}
      </dd>
    </div>
  );
}

/**
 * One driver and what they drive: their face and role, then each vehicle as a chip that goes to it.
 * The pencil reopens the assignment at this person, for those allowed to change it.
 */
function DriverRow({
  member,
  vehicles,
  index,
  onEdit,
}: {
  member: GarageMember;
  vehicles: readonly Vehicle[];
  index: number;
  onEdit?: () => void;
}) {
  return (
    <li
      style={{ '--i': index } as CSSProperties}
      className="stagger flex animate-rise flex-wrap items-center gap-x-4 gap-y-3 rounded-2xl bg-card/50 p-3 sm:flex-nowrap"
    >
      <span
        aria-hidden="true"
        className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-full bg-muted font-mono text-xs font-semibold text-foreground"
      >
        <Face member={member} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-foreground">{member.name}</div>
        <div className="truncate text-xs text-muted-foreground">
          {humanise(member.role)}
          <span aria-hidden="true"> · </span>
          <span className="font-mono font-semibold tabular-nums text-foreground">
            {pad(vehicles.length)}
          </span>{' '}
          {vehicles.length === 1 ? 'vehicle' : 'vehicles'}
        </div>
      </div>
      <VehicleChips label={`What ${member.name} drives`} vehicles={vehicles} />
      {onEdit ? (
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={`Change what ${member.name} drives`}
          onClick={onEdit}
          className="shrink-0"
        >
          <Icon name="edit" size={16} />
        </Button>
      ) : null}
    </li>
  );
}

/**
 * Who drives what, as one question. From a driver's row it opens on that person; from Assign it
 * asks who first and picks nobody — unless the garage has one member, who is then the only answer.
 * The vehicles are tiles to tick, starting from what the chosen person already drives, and the
 * save replaces their whole set: unticking is how a driver is taken off a vehicle.
 */
function AssignDriver({
  garageId,
  members,
  vehicles,
  memberId,
  onClose,
}: {
  garageId: string;
  members: readonly GarageMember[];
  vehicles: readonly Vehicle[];
  memberId: string | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const only = members.length === 1 ? members[0]!.id : '';
  const [who, setWho] = useState(memberId ?? only);
  const driverOf = (id: string) => new Set(members.find((m) => m.id === id)?.vehicleIds ?? []);
  const [picked, setPicked] = useState(() => driverOf(memberId ?? only));
  const person = members.find((m) => m.id === who);

  const save = useMutation({
    mutationFn: () => api.garages.assignVehicles(garageId, who, [...picked]),
    meta: { toast: 'Drivers updated' },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.garageMembers(garageId) });
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
      title={
        memberId && person ? `What does ${person.name.split(' ')[0]} drive?` : 'Who drives what?'
      }
      description="A driver can have several vehicles, and a vehicle several drivers."
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
        {memberId ? null : (
          <SelectField
            label="Driver"
            value={who}
            placeholder="Choose someone in this garage"
            onChange={(id) => {
              setWho(id);
              setPicked(driverOf(id));
            }}
            options={members.map((m) => ({
              value: m.id,
              label: `${m.name} · ${humanise(m.role)}`,
            }))}
          />
        )}

        <fieldset disabled={!who} className="flex min-w-0 flex-col gap-1.5">
          <legend className="mb-1.5 text-sm font-medium text-foreground">Drives</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {vehicles.map((vehicle) => (
              <label
                key={vehicle.id}
                className="group/tile flex cursor-pointer items-center gap-3 rounded-xl bg-muted/60 p-2.5 transition-colors hover:bg-muted has-[:checked]:bg-primary-soft has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50"
              >
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={picked.has(vehicle.id)}
                  onChange={() => toggle(vehicle.id)}
                />
                <Badge vehicle={vehicle} className="size-9" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-foreground">
                    {vehicle.displayName}
                  </span>
                  <span className="block truncate font-mono text-xs uppercase text-muted-foreground">
                    {vehicle.registrationIdentifier ?? humanise(vehicle.vehicleType)}
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
          <Button type="submit" variant="primary" loading={save.isPending} disabled={!who}>
            Save
          </Button>
        </ModalActions>
      </form>
    </Modal>
  );
}

/** How many faces the stack shows before it counts the rest. */
const FACES = 4;

/**
 * Who is in here, as faces rather than a count: overlapped, rising one after another under the
 * pointer — a lift, not a spread, so the row beside it never reflows — and the way into the members.
 */
function Crew({ members, onOpen }: { members: readonly GarageMember[]; onOpen: () => void }) {
  const rest = members.length - FACES;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${members.length} ${members.length === 1 ? 'member' : 'members'}: ${members.map((m) => m.name).join(', ')}`}
      className="group/crew flex h-10 items-center gap-2.5 rounded-full bg-background/60 py-1 pl-1 pr-3.5 backdrop-blur-sm transition-colors hover:bg-background"
    >
      <span aria-hidden="true" className="flex">
        {members.slice(0, FACES).map((member, index) => (
          <span
            key={member.id}
            style={{ zIndex: FACES - index, '--i': index } as CSSProperties}
            className="relative grid size-8 shrink-0 place-items-center overflow-hidden rounded-full bg-muted font-mono text-[0.625rem] font-semibold text-foreground ring-2 ring-card transition-transform duration-300 ease-out [transition-delay:calc(var(--i)*50ms)] group-hover/crew:-translate-y-1 [&:not(:first-child)]:-ml-2.5"
          >
            <Face member={member} />
          </span>
        ))}
        {rest > 0 ? (
          <span className="relative -ml-2.5 grid size-8 place-items-center rounded-full bg-primary-soft font-mono text-[0.625rem] font-semibold tabular-nums text-foreground ring-2 ring-card transition-transform duration-300 ease-out [transition-delay:200ms] group-hover/crew:-translate-y-1">
            +{rest}
          </span>
        ) : null}
      </span>
      <span aria-hidden="true" className="text-xs text-muted-foreground">
        <span className="font-mono font-semibold tabular-nums text-foreground">
          {pad(members.length)}
        </span>{' '}
        {members.length === 1 ? 'member' : 'members'}
      </span>
    </button>
  );
}

/**
 * What each role may do, in a line a person would say — read off `ROLE_CAPABILITIES`, so a change
 * there is a change here.
 */
const ROLE_POWERS: Record<GarageRole, string> = {
  OWNER: 'Everything, including billing and deleting the garage.',
  ADMIN: 'Everything else: its settings, its people and every record.',
  MEMBER: 'Adds and edits vehicles and all that is recorded on them.',
  DRIVER: 'Logs trips, fuel, services and photos. Edits and deletes nothing.',
  VIEWER: 'Sees everything, changes nothing.',
};

/**
 * Everything about running the garage, in one place: what it is called, and who is in it.
 *
 * Tabs rather than one long form, because the two are different jobs done at different times —
 * and the General tab only exists for someone allowed to change it. Everyone else opens straight
 * onto the members, which they can see but not edit.
 */
function GarageSettingsModal({
  garage,
  section,
  onClose,
}: {
  garage: Garage;
  section?: string;
  onClose: () => void;
}) {
  const capabilities = capabilitiesFor(garage.role);
  const canManageSettings = capabilities.includes('garage.manage_settings');
  const canManageMembers = capabilities.includes('garage.manage_members');
  const members = useQuery(garageMembersQuery(api, garage.id));
  const memberList = members.data ?? [];
  const me = useSession().data?.user.id;

  return (
    <SettingsModal
      title="Garage settings"
      description={garage.name}
      icon="settings"
      defaultValue={section}
      onClose={onClose}
      sections={[
        ...(canManageSettings
          ? [
              {
                value: 'general',
                label: 'General',
                description: 'What it is called, and how its money adds up. Every member sees it.',
                icon: <Icon name="settings" size={16} />,
                content: <GeneralSettings garage={garage} onDeleted={onClose} />,
              },
            ]
          : []),
        {
          value: 'members',
          label: 'Members',
          description: 'Who can see and change what is in this garage.',
          icon: <Icon name="people" size={16} />,
          badge: members.isPending ? undefined : memberList.length,
          content: (
            <div className="flex flex-col gap-5">
              {canManageMembers ? <AddMember garageId={garage.id} /> : null}
              {members.isPending ? (
                <Loading label="Loading members">
                  <ListSkeleton rows={2} />
                </Loading>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {memberList.map((member) => (
                    <MemberRow
                      key={member.id}
                      garage={garage}
                      member={member}
                      isYou={member.userId === me}
                      canManage={canManageMembers}
                    />
                  ))}
                </ul>
              )}

              {/* Native disclosure: the key is there for whoever wonders, and folded for the rest. */}
              <details className="group rounded-xl bg-muted/40 px-3.5 py-3">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded text-sm font-medium text-foreground [&::-webkit-details-marker]:hidden">
                  What each role can do
                  <Icon
                    name="chevronDown"
                    size={16}
                    className="text-muted-foreground transition-transform duration-200 group-open:rotate-180"
                  />
                </summary>
                <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-[5.5rem_minmax(0,1fr)] sm:gap-y-2">
                  {GARAGE_ROLES.map((role) => (
                    <div key={role} className="contents">
                      <dt className="text-label uppercase text-muted-foreground max-sm:mt-1.5">
                        {humanise(role)}
                      </dt>
                      <dd className="text-xs text-foreground">{ROLE_POWERS[role]}</dd>
                    </div>
                  ))}
                </dl>
              </details>
            </div>
          ),
        },
      ]}
    />
  );
}

/**
 * The garage's own settings. Saving is a bar that appears once something differs from what is
 * saved — Discard and Save, stuck to the bottom of the panel so it never scrolls away mid-edit —
 * rather than a grey button that sat there disabled on every visit.
 */
function GeneralSettings({ garage, onDeleted }: { garage: Garage; onDeleted: () => void }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [name, setName] = useState(garage.name);
  const [description, setDescription] = useState(garage.description ?? '');
  const [costReporting, setCostReporting] = useState(garage.costReporting);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // The home screen's cluster and rail count and name garages too, from its own request.
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.garages() });
    void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard() });
  };

  // Stays open on save: this is a settings panel with a second tab, not a one-shot form.
  const save = useMutation({
    mutationFn: () =>
      api.garages.update(garage.id, {
        name: name.trim(),
        description: description.trim() || null,
        costReporting,
      }),
    onSuccess: refresh,
  });

  const remove = useMutation({
    mutationFn: () => api.garages.remove(garage.id),
    onSuccess: () => {
      refresh();
      onDeleted();
      router.push('/garages');
    },
  });

  const canDelete = capabilitiesFor(garage.role).includes('garage.delete');
  const dirty =
    name.trim() !== garage.name ||
    description.trim() !== (garage.description ?? '') ||
    costReporting !== garage.costReporting;
  const valid = name.trim().length > 0;
  const discard = () => {
    setName(garage.name);
    setDescription(garage.description ?? '');
    setCostReporting(garage.costReporting);
  };

  /*
   * The two ways other currencies can add up, each shown as the total it would print. Illustrative
   * figures, marked "e.g.": the choice is easier to make from the result than from a sentence.
   */
  const home = garage.defaultCurrency;
  const away = home === 'EUR' ? 'GBP' : 'EUR';
  const money = (amount: number, currency: string) =>
    formatMoneyWhole({ amountMinor: toMinorUnits(amount, currency), currency });
  const modes = [
    {
      value: 'STRICT',
      title: 'Listed beside the total',
      note: 'Exact. Nothing is converted.',
      total: money(1240, home),
      aside: `+ ${money(85, away)}`,
    },
    {
      value: 'CONVERTED',
      title: `Converted into ${home}`,
      note: 'At the latest rate, named on every total.',
      total: money(1332, home),
      aside: 'at today’s rate',
    },
  ] as const;

  return (
    <div className="flex flex-col gap-8">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (dirty && valid && !save.isPending) save.mutate();
        }}
        className="flex flex-col gap-6"
      >
        {/* One column: beside the sidebar the panel is too narrow for two fields side by side. */}
        <div className="flex flex-col gap-4">
          <Field
            label="Name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            maxLength={120}
          />
          <Field
            label="Description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="What lives here"
            maxLength={2000}
          />
        </div>

        {/* Spacing by margins: a legend sits outside the flex flow, so a gap never reaches it. */}
        <fieldset className="min-w-0">
          <legend className="mb-0.5 text-sm font-medium text-foreground">
            Spend in another currency
          </legend>
          <p className="text-xs text-muted-foreground">
            Totals are in <span className="font-mono font-semibold text-foreground">{home}</span>,
            fixed once costs are recorded.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {modes.map((mode) => (
              <label
                key={mode.value}
                className="group/tile flex cursor-pointer flex-col gap-3 rounded-xl bg-muted/60 p-3 transition-colors hover:bg-muted has-[:checked]:bg-primary-soft has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
              >
                <input
                  type="radio"
                  name="cost-reporting"
                  value={mode.value}
                  checked={costReporting === mode.value}
                  onChange={() => setCostReporting(mode.value)}
                  className="sr-only"
                />
                <span className="flex items-start justify-between gap-3">
                  <span className="text-sm font-semibold text-foreground">{mode.title}</span>
                  {/* A radio drawn as a ring that closes to a dot when chosen. */}
                  <span
                    aria-hidden="true"
                    className="mt-0.5 size-4 shrink-0 rounded-full border border-border-strong transition-[border-width,border-color] group-has-[:checked]/tile:border-[5px] group-has-[:checked]/tile:border-primary"
                  />
                </span>
                <span
                  aria-hidden="true"
                  className="flex items-baseline gap-1.5 rounded-lg bg-card px-3 py-2 font-mono tabular-nums"
                >
                  <span className="font-sans text-[0.625rem] font-semibold uppercase tracking-wider text-muted-foreground">
                    e.g.
                  </span>
                  <span className="text-sm font-semibold text-foreground">{mode.total}</span>
                  <span className="truncate text-xs text-muted-foreground">{mode.aside}</span>
                </span>
                <span className="text-xs text-muted-foreground">{mode.note}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {dirty ? (
          <div className="sticky bottom-0 z-10 flex animate-rise flex-wrap items-center justify-between gap-2 rounded-2xl bg-popover p-2 pl-4 shadow-float">
            <span className="text-sm font-medium text-foreground">
              {valid ? 'Unsaved changes' : 'It needs a name'}
            </span>
            <div className="ml-auto flex gap-1.5">
              <Button size="sm" variant="ghost" onClick={discard} disabled={save.isPending}>
                Discard
              </Button>
              <Button
                size="sm"
                type="submit"
                variant="primary"
                loading={save.isPending}
                disabled={!valid}
              >
                Save changes
              </Button>
            </div>
          </div>
        ) : save.isSuccess ? (
          // Said once the list has caught up, so "Saved" never sits beside unsaved edits.
          <p role="status" className="flex items-center gap-1.5 self-end text-sm text-success">
            <Icon name="check" size={16} />
            Saved
          </p>
        ) : null}
      </form>

      {canDelete ? (
        // Kept apart from Save: the destructive control is never the one beside the routine one.
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl bg-destructive-soft p-4">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">Delete this garage</p>
            <p className="text-xs text-muted-foreground">
              It goes for every member, along with what is recorded in it.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {confirmingDelete ? (
              <>
                <Button onClick={() => setConfirmingDelete(false)}>Keep it</Button>
                <Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate()}>
                  Delete for everyone
                </Button>
              </>
            ) : (
              // Two presses, not a browser confirm: the second button says what it will do,
              // and a native confirm is the one thing a user clicks through without reading.
              <Button variant="danger" onClick={() => setConfirmingDelete(true)}>
                Delete garage
              </Button>
            )}
          </div>
          {remove.isError ? (
            <p role="alert" className="w-full text-sm text-destructive">
              {(remove.error as Error).message}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * A person in the garage: face, name (and "You" on your own row), address and how much they drive;
 * then their role — a choice for those who may change it, a label for everyone else. Removing
 * someone is the second press of a dialog that says what they lose and what stays.
 */
function MemberRow({
  garage,
  member,
  isYou,
  canManage,
}: {
  garage: Garage;
  member: GarageMember;
  isYou: boolean;
  canManage: boolean;
}) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.garageMembers(garage.id) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.garages() });
  };

  const changeRole = useMutation({
    mutationFn: (role: GarageRole) => api.garages.updateMember(garage.id, member.id, role),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: () => api.garages.removeMember(garage.id, member.id),
    onSuccess: invalidate,
  });

  /*
   * The owner's own row is fixed. The server refuses to demote or remove them — a garage
   * with no owner has nobody who can delete it — so offering the control would be offering
   * a button that always fails.
   */
  const isOwner = member.userId === garage.ownerId;
  const editable = canManage && !isOwner;
  const drives = member.vehicleIds.length;

  return (
    // `bg-muted`, not `bg-card`: the modal is already card-coloured, and a card row on it vanished.
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-muted/60 p-2.5 pr-3">
      <span
        aria-hidden="true"
        className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-full bg-card font-mono text-xs font-semibold text-foreground"
      >
        <Face member={member} />
      </span>
      <div className="min-w-0 flex-1 basis-40">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-sm font-semibold text-foreground">{member.name}</span>
          {isYou ? (
            <span className="shrink-0 rounded-full bg-card px-1.5 py-px text-[0.625rem] font-semibold uppercase tracking-wider text-muted-foreground">
              You
            </span>
          ) : null}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {member.email}
          {drives ? (
            <>
              <span aria-hidden="true"> · </span>
              drives{' '}
              <span className="font-mono font-semibold tabular-nums text-foreground">
                {pad(drives)}
              </span>
            </>
          ) : null}
        </div>
      </div>

      {editable ? (
        <div className="flex shrink-0 items-center gap-1 max-sm:ml-[3.25rem]">
          {/* The name was a literal "{member.name}" in a plain string, so every row announced it. */}
          <Select
            value={member.role}
            onValueChange={(next) => changeRole.mutate(next as GarageRole)}
            disabled={changeRole.isPending}
            ariaLabel={`Role for ${member.name}`}
            options={ROLE_OPTIONS}
          />
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={`Remove ${member.name}`}
            onClick={() => setConfirming(true)}
          >
            <Icon name="trash" size={16} />
          </Button>
        </div>
      ) : (
        <span className="shrink-0 rounded-full bg-card px-2.5 py-1 text-label uppercase text-muted-foreground">
          {humanise(member.role)}
        </span>
      )}

      {changeRole.isError ? (
        <p role="alert" className="w-full text-xs text-destructive">
          {(changeRole.error as Error).message}
        </p>
      ) : null}

      {confirming ? (
        <ConfirmDelete
          title={`Remove ${member.name}?`}
          description={`They lose access to ${garage.name} and stop driving its vehicles. What they recorded stays.`}
          confirmLabel="Remove from garage"
          pending={remove.isPending}
          error={remove.isError ? (remove.error as Error).message : null}
          onConfirm={() => remove.mutate()}
          onClose={() => setConfirming(false)}
        />
      ) : null}
    </li>
  );
}

/**
 * Adding someone, as one line: their address, the role they get, Add — in a single field that
 * lights as a whole on focus, the way the home screen's add line does. The hint under it turns
 * into the error when there is one, so the line never jumps.
 */
function AddMember({ garageId }: { garageId: string }) {
  const queryClient = useQueryClient();
  const id = useId();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<GarageRole>('MEMBER');

  const add = useMutation({
    mutationFn: () => api.garages.addMember(garageId, { email: email.trim(), role }),
    onSuccess: () => {
      setEmail('');
      void queryClient.invalidateQueries({ queryKey: queryKeys.garageMembers(garageId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.garages() });
    },
  });

  const fieldErrors = add.error instanceof ApiError ? add.error.fields : undefined;
  const error = fieldErrors?.email ?? (add.isError ? (add.error as Error).message : undefined);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (email.trim() && !add.isPending) add.mutate();
      }}
      className="flex flex-col gap-1.5"
    >
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        Add someone
      </label>
      <div className="flex flex-wrap items-center gap-1.5 rounded-xl bg-muted/60 p-1.5 transition-shadow has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-ring">
        <input
          id={id}
          type="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="them@example.com"
          autoComplete="off"
          aria-invalid={error ? true : undefined}
          aria-describedby={`${id}-hint`}
          className="h-9 min-w-0 flex-1 basis-44 bg-transparent px-2.5 text-sm text-foreground outline-none placeholder:text-muted-foreground"
        />
        <div className="flex flex-1 items-center justify-end gap-1.5 sm:flex-none">
          <Select
            value={role}
            onValueChange={(next) => setRole(next as GarageRole)}
            ariaLabel="Role for the person added"
            options={ROLE_OPTIONS}
          />
          <Button
            type="submit"
            size="sm"
            variant="primary"
            loading={add.isPending}
            disabled={!email.trim()}
          >
            Add
          </Button>
        </div>
      </div>
      {/* Membership is granted to an account that already exists; inviting a stranger by email
          is the sharing work in Phase 7, with its own problems. */}
      <p
        id={`${id}-hint`}
        role={error ? 'alert' : undefined}
        className={cn('text-xs', error ? 'text-destructive' : 'text-muted-foreground')}
      >
        {error ?? 'They need a Garaj account already.'}
      </p>
    </form>
  );
}
