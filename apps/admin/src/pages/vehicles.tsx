import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, CircleDot, Copy, Fingerprint, Warehouse } from 'lucide-react';
import { useEffect, type CSSProperties, type ReactNode } from 'react';
import { Emoji } from '@/components/emoji';
import { Icon } from '@/components/icons';
import { Readings } from '@/components/ui/overview';
import { Button, EmptyState } from '@/components/ui/primitives';
import { ListSkeleton, Loading, Skeleton } from '@/components/ui/skeleton';
import { raise } from '@/components/ui/toaster';
import { eventEmoji } from '@/lib/event-emoji';
import { formatDate, formatMoneyWhole, humanise } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { EventType } from '@vehicle-os/domain';
import { get, type VehicleDetail, type VehicleRow } from '../lib/api';
import { ago, formatExact, shortDate } from '../lib/format';
import { madeOf, vehicleName, vehicleType } from '../lib/names';
import { useOverview } from '../lib/queries';
import { remember } from '../lib/recent';
import { closeDetail, href, setParams, useRoute } from '../lib/route';
import { SplitBar } from '../components/chart';
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
import {
  Aside,
  Chip,
  CopyButton,
  Dot,
  Face,
  PageHeader,
  Panel,
  Plate,
  Segmented,
} from '../components/ui';
import { TYPE_ICONS, TypeTile } from './garages';

/** Vehicle · garage · odometer · status · added. */
const COLUMNS =
  'grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,1.3fr)_minmax(0,0.8fr)_7.5rem] lg:grid-cols-[minmax(0,1.3fr)_minmax(0,0.8fr)_7.5rem_5.5rem_6rem]';

const STATUSES = [
  { value: 'any', label: 'Any' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'STORED', label: 'Stored' },
  { value: 'SOLD', label: 'Sold' },
  { value: 'ARCHIVED', label: 'Archived' },
] as const;

/** The fleet's hues: the chart tokens, in order, so a type keeps its colour on every visit. */
const TYPE_COLORS = [
  'var(--color-primary)',
  'var(--color-chart-service)',
  'var(--color-chart-trip)',
  'var(--color-chart-income)',
  'var(--color-chart-expense)',
  'var(--color-chart-neutral)',
];

export function VehiclesPage() {
  const { id, params } = useRoute();
  const filters = {
    q: params.get('q') ?? '',
    type: params.get('type') ?? undefined,
    status: params.get('status') ?? undefined,
  };
  const { list, rows, searching } = useAdminList<VehicleRow>('vehicles', filters);
  const overview = useOverview().data;
  const fleet = overview?.vehicleTypes;
  const filtered = Boolean(filters.type || filters.status || searching);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Manage"
        title="Vehicles"
        description={
          overview
            ? `${formatExact(overview.counts.vehicles)} vehicles in ${formatExact(overview.counts.garages)} garages`
            : 'Everything people keep in Garaj.'
        }
        actions={
          <ExportButton
            onExport={async () => {
              const all = await fetchEvery<VehicleRow>('vehicles', filters);
              downloadCsv(
                'garaj-vehicles',
                [
                  'id',
                  'name',
                  'type',
                  'make',
                  'model',
                  'year',
                  'plate',
                  'status',
                  'odometer',
                  'unit',
                  'garage',
                  'added',
                ],
                all.map((v) => [
                  v.id,
                  vehicleName(v),
                  v.vehicleType,
                  v.make,
                  v.model,
                  v.year,
                  v.registrationIdentifier,
                  v.status,
                  v.currentOdometer,
                  v.odometerUnit,
                  v.garageName ?? '',
                  v.createdAt,
                ]),
              );
            }}
          />
        }
      />

      <Panel
        title="Fleet mix"
        className="stagger animate-rise [--i:1]"
        aside={<Aside>{fleet ? `${fleet.length} kinds` : ''}</Aside>}
      >
        {fleet ? (
          fleet.length ? (
            <SplitBar
              onSelect={(type) => setParams({ type: filters.type === type ? null : type })}
              parts={fleet.map((row, i) => ({
                key: row.type,
                label: vehicleType(row.type),
                value: row.count,
                color: TYPE_COLORS[i % TYPE_COLORS.length]!,
              }))}
            />
          ) : (
            <p className="text-sm text-muted-foreground">No vehicles yet.</p>
          )
        ) : (
          <Skeleton className="h-24 w-full rounded-xl" />
        )}
      </Panel>

      <Toolbar className="stagger [--i:2]">
        <SearchField
          label="Search make, model, plate, VIN or garage"
          value={filters.q}
          onChange={(q) => setParams({ q })}
          className="min-w-56 flex-1"
        />
        {fleet && fleet.length > 1 ? (
          <Segmented
            label="Kind"
            value={filters.type ?? 'all'}
            onChange={(type) => setParams({ type: type === 'all' ? null : type })}
            options={[
              { value: 'all', label: 'All' },
              ...fleet.map((row) => ({
                value: row.type,
                label: vehicleType(row.type),
                count: row.count,
              })),
            ]}
          />
        ) : null}
        <SelectMenu
          label="Status"
          icon={CircleDot}
          value={filters.status ?? 'any'}
          onChange={(status) => setParams({ status: status === 'any' ? null : status })}
          options={STATUSES}
        />
      </Toolbar>

      <DataTable
        label="vehicles"
        list={list}
        rows={rows}
        rowKey={(vehicle) => vehicle.id}
        columns={COLUMNS}
        head={
          <>
            <span>Vehicle</span>
            <span className="max-sm:hidden">Garage</span>
            <span className="text-right">Odometer</span>
            <span className="max-lg:hidden">Status</span>
            <span className="text-right max-lg:hidden">Added</span>
          </>
        }
        empty={{
          title: filtered ? 'No vehicle matches' : 'No vehicles yet',
          description: filtered
            ? 'Try another search, or clear the filters.'
            : 'Vehicles appear here as people add them.',
        }}
      >
        {(vehicle) => {
          const made = madeOf(vehicle);
          return (
            <>
              <RowLink
                href={href('vehicles', vehicle.id, params)}
                label={`Open ${vehicleName(vehicle)}`}
              />
              <div className={cn(rowClass, COLUMNS)}>
                <span className="flex min-w-0 items-center gap-3">
                  <TypeTile type={vehicle.vehicleType} />
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold">{vehicleName(vehicle)}</span>
                      <Plate value={vehicle.registrationIdentifier} />
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {[made !== vehicleName(vehicle) && made, vehicleType(vehicle.vehicleType)]
                        .filter(Boolean)
                        .join(' · ')}
                      <span className="sm:hidden"> · {vehicle.garageName}</span>
                    </span>
                  </span>
                </span>
                <span className="truncate text-sm text-muted-foreground max-sm:hidden">
                  {vehicle.garageName}
                </span>
                <span className="text-right font-mono text-sm tabular-nums">
                  {vehicle.currentOdometer === null ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <>
                      {formatExact(vehicle.currentOdometer)}
                      <span className="ml-1 text-xs text-muted-foreground">
                        {vehicle.odometerUnit.toLowerCase()}
                      </span>
                    </>
                  )}
                </span>
                {/* Active is the usual case, so it is quiet; only the exceptions wear a chip. */}
                <span className="max-lg:hidden">
                  <StatusLabel status={vehicle.status} />
                </span>
                <span className="text-right font-mono text-xs tabular-nums text-muted-foreground max-lg:hidden">
                  {shortDate(vehicle.createdAt)}
                </span>
              </div>
            </>
          );
        }}
      </DataTable>

      {id ? <VehicleSheet id={id} rows={rows} /> : null}
    </div>
  );
}

function StatusLabel({ status }: { status: string }) {
  return status === 'ACTIVE' ? (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Dot tone="success" className="size-1.5" />
      Active
    </span>
  ) : (
    <Chip tone={status === 'SOLD' ? 'info' : 'warning'}>{humanise(status)}</Chip>
  );
}

// --- Detail ------------------------------------------------------------------------------

/** Each cost category in a chart hue, so fuel is always the same orange as in the product. */
const CATEGORY_COLORS: Record<string, string> = {
  FUEL: 'var(--color-chart-refuel)',
  CHARGING: 'var(--color-chart-refuel)',
  MAINTENANCE: 'var(--color-chart-service)',
  REPAIR: 'var(--color-chart-service)',
  PART: 'var(--color-chart-service)',
  INSURANCE: 'var(--color-chart-expense)',
  REGISTRATION: 'var(--color-chart-expense)',
  TAX: 'var(--color-chart-expense)',
  PURCHASE: 'var(--color-primary)',
  MODIFICATION: 'var(--color-chart-trip)',
  ACCESSORY: 'var(--color-chart-trip)',
};

const DAY = 86_400_000;

function VehicleSheet({ id, rows }: { id: string; rows: VehicleRow[] | undefined }) {
  const { params } = useRoute();
  const vehicle = useQuery({
    queryKey: ['admin', 'vehicle', id],
    queryFn: () => get<VehicleDetail>(`/vehicles/${id}`),
  });
  const data = vehicle.data;
  const index = rows?.findIndex((row) => row.id === id) ?? -1;
  const neighbour = (offset: number) => {
    const row = index === -1 ? undefined : rows?.[index + offset];
    return row ? href('vehicles', row.id, params) : undefined;
  };

  useEffect(() => {
    if (data)
      remember({ kind: 'vehicle', id: data.id, label: vehicleName(data), sub: data.garage.name });
  }, [data]);

  return (
    <Sheet
      id={id}
      label={data ? vehicleName(data) : 'Vehicle'}
      onClose={closeDetail}
      prev={index === -1 ? undefined : neighbour(-1)}
      next={index === -1 ? undefined : neighbour(1)}
    >
      {!data ? (
        vehicle.isError ? (
          <div className="p-6">
            <EmptyState title="Couldn't load this vehicle" description={vehicle.error.message} />
          </div>
        ) : (
          <Loading label="Loading vehicle">
            <div className="flex flex-col gap-4 p-6">
              <Skeleton className="h-44 w-full rounded-2xl" />
              <Skeleton className="h-7 w-1/2" />
              <ListSkeleton rows={3} />
            </div>
          </Loading>
        )
      ) : (
        <VehicleBody vehicle={data} />
      )}
    </Sheet>
  );
}

function VehicleBody({ vehicle }: { vehicle: VehicleDetail }) {
  const name = vehicleName(vehicle);
  const made = madeOf(vehicle);
  const unit = vehicle.odometerUnit.toLowerCase();
  // The bill in the currency most of it was paid in; anything else is said, not summed in.
  const byCurrency = new Map<string, number>();
  for (const row of vehicle.spending)
    byCurrency.set(row.currency, (byCurrency.get(row.currency) ?? 0) + row.amountMinor);
  const [currency, total] = [...byCurrency.entries()].sort((a, b) => b[1] - a[1])[0] ?? [
    vehicle.garage.defaultCurrency,
    0,
  ];
  const others = byCurrency.size - (vehicle.spending.length ? 1 : 0);
  const categories = vehicle.spending
    .filter((row) => row.currency === currency)
    .sort((a, b) => b.amountMinor - a.amountMinor);

  return (
    <>
      <Stage vehicle={vehicle} />
      <SheetHead
        lead={<TypeTile type={vehicle.vehicleType} className="size-12 rounded-2xl" />}
        title={name}
        subtitle={[made !== name && made, vehicleType(vehicle.vehicleType), vehicle.color]
          .filter(Boolean)
          .join(' · ')}
        badges={
          <>
            <Plate value={vehicle.registrationIdentifier} />
            <StatusLabel status={vehicle.status} />
            <span className="text-xs text-muted-foreground">
              Added {formatDate(vehicle.createdAt)}
            </span>
          </>
        }
        actions={
          <>
            <Button
              size="sm"
              onClick={() => {
                window.location.hash = href('garages', vehicle.garage.id);
              }}
            >
              <Warehouse className="size-4" aria-hidden="true" />
              Open {vehicle.garage.name}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                void navigator.clipboard
                  .writeText(vehicle.id)
                  .then(() => raise('success', 'Id copied'))
              }
            >
              <Fingerprint className="size-4" aria-hidden="true" />
              Copy id
            </Button>
            {vehicle.identificationNumber ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  void navigator.clipboard
                    .writeText(vehicle.identificationNumber!)
                    .then(() => raise('success', 'VIN copied'))
                }
              >
                <Copy className="size-4" aria-hidden="true" />
                Copy VIN
              </Button>
            ) : null}
          </>
        }
      />

      <SheetSection title="At a glance">
        <Readings
          readings={[
            {
              label: 'Odometer',
              value: vehicle.currentOdometer === null ? '—' : formatExact(vehicle.currentOdometer),
              caption: vehicle.currentEngineHours
                ? `${unit} · ${formatExact(vehicle.currentEngineHours)} engine hours`
                : `${unit}, last reading`,
            },
            {
              label: 'Spent',
              value: formatMoneyWhole({ amountMinor: total, currency }),
              caption:
                others > 0 ? `+ ${others} other currenc${others === 1 ? 'y' : 'ies'}` : 'all time',
            },
            {
              label: 'Records',
              value: formatExact(vehicle.counts.events),
              caption: 'in the logbook',
            },
            {
              label: 'Open tasks',
              value: formatExact(vehicle.counts.openTasks),
              tone: vehicle.counts.openTasks ? 'warning' : undefined,
              caption: `${vehicle.counts.documents} documents · ${vehicle.counts.photos} photos`,
            },
          ]}
        />
      </SheetSection>

      <SheetSection title="Kept in">
        <a
          href={href('garages', vehicle.garage.id)}
          className="group flex items-center gap-3 rounded-xl bg-muted/50 p-3 transition-colors duration-150 hover:bg-muted"
        >
          <span
            aria-hidden="true"
            className="grid size-10 shrink-0 place-items-center rounded-xl bg-card"
          >
            <Warehouse className="size-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold">{vehicle.garage.name}</span>
            <span className="block truncate text-xs text-muted-foreground">
              {vehicle.owner
                ? `Owned by ${vehicle.owner.name || vehicle.owner.email}`
                : 'No owner on record'}{' '}
              · <span className="font-mono">{vehicle.garage.defaultCurrency}</span>
            </span>
          </span>
          <ArrowUpRight
            className="size-4 text-muted-foreground transition-transform duration-150 group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
            aria-hidden="true"
          />
        </a>
        {vehicle.addedBy ? (
          <a
            href={href('users', vehicle.addedBy.id)}
            className="flex items-center gap-3 rounded-xl px-1 py-1 text-sm transition-colors duration-150 hover:bg-muted/50"
          >
            <Face id={vehicle.addedBy.id} image={vehicle.addedBy.image} size={28} />
            <span className="min-w-0 flex-1 truncate text-muted-foreground">
              Added by{' '}
              <span className="font-semibold text-foreground">
                {vehicle.addedBy.name || vehicle.addedBy.email}
              </span>{' '}
              {ago(vehicle.createdAt)}
            </span>
          </a>
        ) : null}
      </SheetSection>

      <SheetSection
        title="Where the money went"
        aside={
          <span className="font-mono text-xs tabular-nums text-muted-foreground">{currency}</span>
        }
      >
        {categories.length ? (
          <SplitBar
            format={(amount) => formatMoneyWhole({ amountMinor: amount, currency })}
            parts={categories.map((row) => ({
              key: row.category,
              label: humanise(row.category),
              value: row.amountMinor,
              color: CATEGORY_COLORS[row.category] ?? 'var(--color-chart-neutral)',
            }))}
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            Nothing spent on it yet — or nothing written down.
          </p>
        )}
      </SheetSection>

      <SheetSection
        title="Logbook"
        aside={
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {vehicle.counts.events}
          </span>
        }
      >
        {vehicle.recentEvents.length ? (
          <ol className="relative flex flex-col">
            {/* The rail the entries hang off, as in the product's own timeline. */}
            <span
              aria-hidden="true"
              className="absolute bottom-3 left-[17px] top-3 w-px bg-border"
            />
            {vehicle.recentEvents.map((event, i) => (
              <li
                key={event.id}
                className="stagger relative flex animate-rise items-center gap-3 py-1.5"
                style={{ '--i': i } as CSSProperties}
              >
                <span className="relative grid size-9 shrink-0 place-items-center rounded-full bg-card ring-1 ring-border">
                  <Emoji name={eventEmoji(event.eventType as EventType)} size={18} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{event.title}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {[
                      humanise(event.eventType),
                      formatDate(event.occurredAt),
                      event.odometer !== null && `${formatExact(event.odometer)} ${unit}`,
                      event.provider,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
                {event.costAmountMinor !== null && event.costCurrency ? (
                  <span className="shrink-0 font-mono text-sm font-semibold tabular-nums">
                    {formatMoneyWhole({
                      amountMinor: event.costAmountMinor,
                      currency: event.costCurrency,
                    })}
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-muted-foreground">Nothing written in its logbook yet.</p>
        )}
      </SheetSection>

      <SheetSection
        title="Maintenance"
        aside={
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {vehicle.counts.plans}
          </span>
        }
      >
        {vehicle.maintenance.length ? (
          <ul className="flex flex-col gap-1.5">
            {vehicle.maintenance.map((plan) => {
              const days = plan.nextDueDate
                ? Math.round((Date.parse(plan.nextDueDate) - Date.now()) / DAY)
                : null;
              const byDistance =
                plan.nextDueOdometer !== null && vehicle.currentOdometer !== null
                  ? plan.nextDueOdometer - vehicle.currentOdometer
                  : null;
              const overdue =
                (days !== null && days < 0) || (byDistance !== null && byDistance < 0);
              const soon =
                !overdue &&
                ((days !== null && days <= 30) || (byDistance !== null && byDistance <= 500));
              return (
                <li key={plan.id} className="flex items-center gap-3 rounded-xl bg-muted/50 p-3">
                  <Dot tone={overdue ? 'destructive' : soon ? 'warning' : 'muted'} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{plan.title}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {plan.lastPerformedAt
                        ? `Last done ${formatDate(plan.lastPerformedAt)}`
                        : 'Never done here'}
                    </span>
                  </span>
                  <span
                    className={cn(
                      'shrink-0 text-right text-xs font-semibold',
                      overdue
                        ? 'text-destructive'
                        : soon
                          ? 'text-warning'
                          : 'text-muted-foreground',
                    )}
                  >
                    {days !== null
                      ? days < 0
                        ? `${-days} days overdue`
                        : days === 0
                          ? 'Due today'
                          : `Due in ${days} days`
                      : byDistance !== null
                        ? byDistance < 0
                          ? `${formatExact(-byDistance)} ${unit} over`
                          : `In ${formatExact(byDistance)} ${unit}`
                        : 'No due date'}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No maintenance plans.</p>
        )}
      </SheetSection>

      <SheetSection title="Specifications">
        <dl className="grid grid-cols-1 gap-px overflow-hidden rounded-xl bg-border/60 text-sm sm:grid-cols-2">
          <Spec label="Make">{vehicle.make}</Spec>
          <Spec label="Model">
            {[vehicle.model, vehicle.variant].filter(Boolean).join(' ') || null}
          </Spec>
          <Spec label="Year">{vehicle.year}</Spec>
          <Spec label="Colour">{vehicle.color}</Spec>
          <Spec label="VIN" mono copy={vehicle.identificationNumber}>
            {vehicle.identificationNumber}
          </Spec>
          <Spec label="Registration" mono>
            {vehicle.registrationIdentifier}
          </Spec>
          <Spec label="Bought">
            {vehicle.purchaseDate ? formatDate(vehicle.purchaseDate) : null}
          </Spec>
          <Spec label="Paid">
            {vehicle.purchasePriceAmountMinor !== null && vehicle.purchasePriceCurrency
              ? formatMoneyWhole({
                  amountMinor: vehicle.purchasePriceAmountMinor,
                  currency: vehicle.purchasePriceCurrency,
                })
              : null}
          </Spec>
        </dl>
      </SheetSection>
    </>
  );
}

function Spec({
  label,
  mono = false,
  copy,
  children,
}: {
  label: string;
  mono?: boolean;
  copy?: string | null;
  children: ReactNode;
}) {
  const empty = children === null || children === undefined || children === '';
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 bg-card px-3.5 py-2.5">
      <dt className="shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          'flex min-w-0 items-center gap-1 truncate text-right font-semibold',
          mono && 'font-mono text-xs',
        )}
      >
        <span className={cn('truncate', empty && 'font-normal text-muted-foreground')}>
          {empty ? '—' : children}
        </span>
        {copy ? <CopyButton value={copy} label={`Copy the ${label}`} className="size-6" /> : null}
      </dd>
    </div>
  );
}

/**
 * The vehicle on a stage: its cutout lit from above when the background has been taken out, the
 * photo edge to edge when it has not, and its type drawn large when there is no picture at all.
 */
function Stage({ vehicle }: { vehicle: VehicleDetail }) {
  return (
    <div className="px-6 pt-5">
      <div
        className={cn(
          'relative grid h-44 place-items-center overflow-hidden rounded-2xl',
          'bg-[radial-gradient(ellipse_at_50%_115%,color-mix(in_oklch,var(--color-primary)_22%,transparent),transparent_62%),linear-gradient(to_bottom,var(--color-muted),color-mix(in_oklch,var(--color-muted)_40%,transparent))]',
        )}
      >
        {vehicle.photoUrl ? (
          <img
            src={vehicle.photoUrl}
            alt={vehicleName(vehicle)}
            className={cn(
              'animate-rise',
              vehicle.isCutout
                ? 'h-[86%] w-auto object-contain drop-shadow-[0_18px_18px_rgb(0_0_0/0.35)]'
                : 'absolute inset-0 size-full object-cover',
            )}
          />
        ) : (
          <span className="flex flex-col items-center gap-2 text-muted-foreground">
            <Icon name={TYPE_ICONS[vehicle.vehicleType] ?? 'vehicles'} size={56} />
            <span className="text-xs">No photo yet</span>
          </span>
        )}
        {vehicle.currentOdometer !== null ? (
          <span className="absolute bottom-3 right-3 rounded-lg bg-background/80 px-2 py-1 font-mono text-xs font-semibold tabular-nums backdrop-blur">
            {formatExact(vehicle.currentOdometer)} {vehicle.odometerUnit.toLowerCase()}
          </span>
        ) : null}
      </div>
    </div>
  );
}
