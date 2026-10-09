import { useQuery } from '@tanstack/react-query';
import { ArrowDownUp, Copy, Trash2, UserRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Icon, type IconName } from '@/components/icons';
import { Button, EmptyState } from '@/components/ui/primitives';
import { Readings } from '@/components/ui/overview';
import { ListSkeleton, Loading, Skeleton } from '@/components/ui/skeleton';
import { raise } from '@/components/ui/toaster';
import { formatDate, humanise } from '@/lib/format';
import { cn } from '@/lib/utils';
import { get, type GarageDetail, type GarageRow, type VehicleRow } from '../lib/api';
import { formatCount, formatExact, initials, shortDate } from '../lib/format';
import { useDeleteGarage } from '../lib/mutations';
import { madeOf, vehicleName, vehicleType } from '../lib/names';
import { useOverview } from '../lib/queries';
import { remember } from '../lib/recent';
import { closeDetail, href, setParams, useRoute } from '../lib/route';
import {
  DataTable,
  downloadCsv,
  ExportButton,
  fetchEvery,
  RowLink,
  rowClass,
  SearchField,
  Toolbar,
  useAdminList,
} from '../components/list';
import { SelectMenu } from '../components/menu';
import { Sheet, SheetHead, SheetSection } from '../components/sheet';
import { Chip, Confirm, CopyButton, Face, PageHeader, Plate, RowActions } from '../components/ui';

/** Garage · owner · members · vehicles · created · ⋯. */
const COLUMNS =
  'grid-cols-[minmax(0,1fr)_4rem_2rem] sm:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)_7rem_2rem] lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)_4.5rem_7rem_6rem_2rem]';

const SORTS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'vehicles', label: 'Most vehicles' },
  { value: 'members', label: 'Most members' },
  { value: 'name', label: 'Name, A to Z' },
] as const;

export function GaragesPage() {
  const { id, params } = useRoute();
  const filters = { q: params.get('q') ?? '', sort: params.get('sort') ?? undefined };
  const { list, rows, searching } = useAdminList<GarageRow>('garages', filters);
  const overview = useOverview().data;
  const counts = overview?.counts;
  const [doomed, setDoomed] = useState<Pick<
    GarageRow,
    'id' | 'name' | 'vehicles' | 'members'
  > | null>(null);
  const busiest = Math.max(1, ...(rows ?? []).map((garage) => garage.vehicles));

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Manage"
        title="Garages"
        description={
          counts
            ? `${formatExact(counts.garages)} garages hold ${formatExact(counts.vehicles)} vehicles`
            : 'Every garage, and who keeps it.'
        }
        actions={
          <ExportButton
            onExport={async () => {
              const all = await fetchEvery<GarageRow>('garages', filters);
              downloadCsv(
                'garaj-garages',
                ['id', 'name', 'owner', 'members', 'vehicles', 'currency', 'created'],
                all.map((g) => [
                  g.id,
                  g.name,
                  g.ownerEmail,
                  g.members,
                  g.vehicles,
                  g.defaultCurrency,
                  g.createdAt,
                ]),
              );
            }}
          />
        }
      />

      <Readings
        className="stagger animate-rise [--i:1]"
        readings={[
          {
            label: 'Garages',
            value: counts ? formatExact(counts.garages) : undefined,
            caption: 'all time',
          },
          {
            label: 'Vehicles',
            value: counts ? formatExact(counts.vehicles) : undefined,
            caption: 'parked in them',
            href: href('vehicles'),
          },
          {
            label: 'Per garage',
            value: counts ? (counts.vehicles / Math.max(counts.garages, 1)).toFixed(1) : undefined,
            caption: 'vehicles, on average',
          },
          {
            label: 'People in one',
            value: overview ? formatCount(overview.funnel.garage) : undefined,
            caption: counts ? `of ${formatCount(counts.users)} accounts` : undefined,
          },
        ]}
      />

      <Toolbar className="stagger [--i:2]">
        <SearchField
          label="Search by garage name or owner email"
          value={filters.q}
          onChange={(q) => setParams({ q })}
          className="min-w-56 flex-1"
        />
        <SelectMenu
          label="Sort"
          icon={ArrowDownUp}
          value={filters.sort ?? 'newest'}
          onChange={(sort) => setParams({ sort: sort === 'newest' ? null : sort })}
          options={SORTS}
        />
      </Toolbar>

      <DataTable
        label="garages"
        list={list}
        rows={rows}
        rowKey={(garage) => garage.id}
        columns={COLUMNS}
        head={
          <>
            <span>Garage</span>
            <span className="max-sm:hidden">Owner</span>
            <span className="text-right max-lg:hidden">Members</span>
            <span>Vehicles</span>
            <span className="text-right max-lg:hidden">Created</span>
            <span />
          </>
        }
        empty={{
          title: searching ? 'No garage matches' : 'No garages yet',
          description: searching
            ? 'Try another name, or an owner’s email.'
            : 'A garage appears here when someone creates one.',
        }}
      >
        {(garage) => (
          <>
            <RowLink href={href('garages', garage.id, params)} label={`Open ${garage.name}`} />
            <div className={cn(rowClass, COLUMNS)}>
              <span className="flex min-w-0 items-center gap-3">
                <Monogram name={garage.name} />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">{garage.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    <span className="font-mono">{garage.defaultCurrency}</span>
                    {garage.description ? ` · ${garage.description}` : ''}
                    <span className="sm:hidden"> · {garage.ownerEmail}</span>
                  </span>
                </span>
              </span>
              <span className="flex min-w-0 items-center gap-2.5 max-sm:hidden">
                <Face id={garage.ownerId} image={garage.ownerImage} size={26} />
                <span className="min-w-0">
                  <span className="block truncate text-sm">
                    {garage.ownerName || garage.ownerEmail}
                  </span>
                  {garage.ownerName ? (
                    <span className="block truncate text-xs text-muted-foreground">
                      {garage.ownerEmail}
                    </span>
                  ) : null}
                </span>
              </span>
              <span className="text-right font-mono text-sm tabular-nums max-lg:hidden">
                {garage.members}
              </span>
              <span className="flex items-center gap-2.5">
                <span
                  className={cn(
                    'w-6 text-right font-mono text-sm tabular-nums',
                    garage.vehicles === 0 && 'text-muted-foreground',
                  )}
                >
                  {garage.vehicles}
                </span>
                <span
                  aria-hidden="true"
                  className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted max-sm:hidden"
                >
                  <span
                    className="block h-full rounded-full bg-primary/70"
                    style={{ width: `${(garage.vehicles / busiest) * 100}%` }}
                  />
                </span>
              </span>
              <span className="text-right font-mono text-xs tabular-nums text-muted-foreground max-lg:hidden">
                {shortDate(garage.createdAt)}
              </span>
              <RowActions
                label={`Actions for ${garage.name}`}
                actions={[
                  {
                    label: 'Open the owner',
                    icon: UserRound,
                    onSelect: () => {
                      window.location.hash = href('users', garage.ownerId);
                    },
                  },
                  {
                    label: 'Copy id',
                    icon: Copy,
                    onSelect: () =>
                      void navigator.clipboard
                        .writeText(garage.id)
                        .then(() => raise('success', 'Id copied')),
                  },
                  {
                    label: 'Delete garage…',
                    icon: Trash2,
                    destructive: true,
                    onSelect: () => setDoomed(garage),
                  },
                ]}
              />
            </div>
          </>
        )}
      </DataTable>

      {id ? <GarageSheet id={id} rows={rows} onDelete={setDoomed} /> : null}
      {doomed ? <DeleteGarage garage={doomed} onDone={() => setDoomed(null)} /> : null}
    </div>
  );
}

function DeleteGarage({
  garage,
  onDone,
}: {
  garage: Pick<GarageRow, 'id' | 'name' | 'vehicles' | 'members'>;
  onDone: () => void;
}) {
  const remove = useDeleteGarage();
  return (
    <Confirm
      title={`Delete ${garage.name}?`}
      description={`${garage.vehicles} vehicle${garage.vehicles === 1 ? '' : 's'} and their history, costs and documents go, for all ${garage.members} member${garage.members === 1 ? '' : 's'}. This cannot be undone.`}
      confirmLabel="Delete for everyone"
      pending={remove.isPending}
      error={remove.error?.message}
      onClose={onDone}
      onConfirm={() =>
        remove.mutate(
          { garage },
          {
            onSuccess: () => {
              onDone();
              if (window.location.hash.includes(garage.id)) closeDetail();
            },
          },
        )
      }
    />
  );
}

/** A garage's initials on a tile: the garage glyph would say the same thing in every row. */
function Monogram({ name, size = 'md' }: { name: string; size?: 'md' | 'lg' }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'grid shrink-0 place-items-center rounded-xl bg-muted font-bold tracking-tight text-foreground',
        size === 'lg' ? 'size-14 text-lg' : 'size-9 text-xs',
      )}
    >
      {initials(name)}
    </span>
  );
}

// --- Detail ------------------------------------------------------------------------------

function GarageSheet({
  id,
  rows,
  onDelete,
}: {
  id: string;
  rows: GarageRow[] | undefined;
  onDelete: (garage: Pick<GarageRow, 'id' | 'name' | 'vehicles' | 'members'>) => void;
}) {
  const { params } = useRoute();
  const garage = useQuery({
    queryKey: ['admin', 'garage', id],
    queryFn: () => get<GarageDetail>(`/garages/${id}`),
  });
  const data = garage.data;
  const index = rows?.findIndex((row) => row.id === id) ?? -1;
  const neighbour = (offset: number) => {
    const row = index === -1 ? undefined : rows?.[index + offset];
    return row ? href('garages', row.id, params) : undefined;
  };
  const owner = data?.members.find((member) => member.userId === data.ownerId);

  useEffect(() => {
    if (data) {
      remember({
        kind: 'garage',
        id: data.id,
        label: data.name,
        sub: `${data.vehicles.length} vehicle${data.vehicles.length === 1 ? '' : 's'}`,
      });
    }
  }, [data]);

  return (
    <Sheet
      id={id}
      label={data?.name ?? 'Garage'}
      onClose={closeDetail}
      prev={index === -1 ? undefined : neighbour(-1)}
      next={index === -1 ? undefined : neighbour(1)}
    >
      {!data ? (
        garage.isError ? (
          <div className="p-6">
            <EmptyState title="Couldn't load this garage" description={garage.error.message} />
          </div>
        ) : (
          <Loading label="Loading garage">
            <div className="flex flex-col gap-4 p-6">
              <div className="flex items-center gap-4">
                <Skeleton className="size-14 rounded-xl" />
                <div className="flex flex-1 flex-col gap-2">
                  <Skeleton className="h-6 w-1/2" />
                  <Skeleton className="h-4 w-1/3" />
                </div>
              </div>
              <ListSkeleton rows={3} />
            </div>
          </Loading>
        )
      ) : (
        <>
          <SheetHead
            lead={<Monogram name={data.name} size="lg" />}
            title={data.name}
            subtitle={data.description ?? 'No description'}
            badges={
              <>
                <Chip>
                  <span className="font-mono">{data.defaultCurrency}</span>
                </Chip>
                <Chip>{humanise(data.costReporting)} costs</Chip>
                <span className="text-xs text-muted-foreground">
                  Since {formatDate(data.createdAt)}
                </span>
              </>
            }
            actions={
              <>
                {owner ? (
                  <Button
                    size="sm"
                    onClick={() => {
                      window.location.hash = href('users', owner.userId);
                    }}
                  >
                    <UserRound className="size-4" aria-hidden="true" />
                    Open the owner
                  </Button>
                ) : null}
                <span className="flex items-center gap-1 rounded-lg bg-muted/60 pl-3 text-xs text-muted-foreground">
                  <span className="font-mono">{data.id.slice(0, 8)}…</span>
                  <CopyButton value={data.id} label="Copy garage id" />
                </span>
              </>
            }
          />
          <SheetSection
            title="Vehicles"
            aside={
              <span className="font-mono text-xs tabular-nums text-muted-foreground">
                {data.vehicles.length}
              </span>
            }
          >
            {data.vehicles.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing parked here yet.</p>
            ) : (
              <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {data.vehicles.map((vehicle) => (
                  <li key={vehicle.id}>
                    <VehicleCard vehicle={vehicle} />
                  </li>
                ))}
              </ul>
            )}
          </SheetSection>
          <SheetSection
            title="Members"
            aside={
              <span className="font-mono text-xs tabular-nums text-muted-foreground">
                {data.members.length}
              </span>
            }
          >
            <ul className="flex flex-col gap-1.5">
              {data.members.map((member) => (
                <li key={member.userId}>
                  <a
                    href={href('users', member.userId)}
                    className="flex items-center gap-3 rounded-xl bg-muted/50 p-2.5 transition-colors hover:bg-muted"
                  >
                    <Face id={member.userId} image={member.image} size={34} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{member.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {member.email}
                      </span>
                    </span>
                    <Chip tone={member.role === 'OWNER' ? 'ink' : 'muted'}>
                      {humanise(member.role)}
                    </Chip>
                  </a>
                </li>
              ))}
            </ul>
          </SheetSection>
          <SheetSection title="Danger zone">
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl bg-destructive-soft p-4">
              <div className="min-w-0 flex-1 basis-60">
                <p className="text-sm font-semibold">Delete {data.name}</p>
                <p className="text-xs text-muted-foreground">
                  For every member, with every vehicle, record, cost and document in it.
                </p>
              </div>
              <Button
                variant="danger"
                size="sm"
                onClick={() =>
                  onDelete({
                    id: data.id,
                    name: data.name,
                    vehicles: data.vehicles.length,
                    members: data.members.length,
                  })
                }
              >
                <Trash2 className="size-4" aria-hidden="true" />
                Delete garage
              </Button>
            </div>
          </SheetSection>
        </>
      )}
    </Sheet>
  );
}

export const TYPE_ICONS: Record<string, IconName> = {
  CAR: 'car',
  VAN: 'car',
  MOTORCYCLE: 'motorcycle',
  SCOOTER: 'motorcycle',
  BICYCLE: 'bicycle',
  BOAT: 'boat',
};

export function TypeTile({ type, className }: { type: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn('grid size-9 shrink-0 place-items-center rounded-xl bg-muted', className)}
    >
      <Icon name={TYPE_ICONS[type] ?? 'vehicles'} size={18} />
    </span>
  );
}

/** One vehicle as a card: its type, its name and plate, what it is and how far it has gone. */
function VehicleCard({ vehicle }: { vehicle: VehicleRow }) {
  const made = madeOf(vehicle);
  return (
    <a
      href={href('vehicles', vehicle.id)}
      className="group flex h-full flex-col gap-3 rounded-xl bg-muted/50 p-3 transition-[background-color,scale] duration-150 hover:bg-muted active:scale-[0.985]"
    >
      <div className="flex items-start gap-3">
        <TypeTile type={vehicle.vehicleType} className="bg-card" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{vehicleName(vehicle)}</p>
          <p className="truncate text-xs text-muted-foreground">
            {[vehicle.nickname && made, vehicleType(vehicle.vehicleType)]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        {vehicle.status === 'ACTIVE' ? null : <Chip>{humanise(vehicle.status)}</Chip>}
      </div>
      <div className="mt-auto flex items-center justify-between gap-2">
        <Plate value={vehicle.registrationIdentifier} />
        <span className="ml-auto font-mono text-xs tabular-nums text-muted-foreground">
          {vehicle.currentOdometer === null
            ? 'No reading'
            : `${formatExact(vehicle.currentOdometer)} ${vehicle.odometerUnit.toLowerCase()}`}
        </span>
      </div>
    </a>
  );
}
