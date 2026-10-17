'use client';

/**
 * A change GarajAI proposes, as the form that makes it.
 *
 * Every value the model filled is a field the person can see and change; nothing is written
 * until Approve, and then by the same authorised endpoint the rest of the app uses. The fields
 * follow the kind of change — a trip has its ends and its purpose, a fill-up its litres, a
 * vehicle its make and price — and the rare ones fold under "More".
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { uploadPhoto } from '@vehicle-os/api-client';
import { garagesQuery, queryKeys } from '@vehicle-os/api-client/react';
import type { AiAction, AiProposal, Garage, Vehicle } from '@vehicle-os/contracts';
import {
  EVENT_TYPES,
  TRIP_PURPOSES,
  VEHICLE_TYPES,
  type EventType,
  type TripPurpose,
  type VehicleType,
} from '@vehicle-os/domain';
import { currencyOfLine, stampForDay } from '@vehicle-os/ui';
import { Check } from 'lucide-react';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import {
  ActionCard,
  FieldGrid,
  FilesField,
  TitleInput,
  type FieldSpec,
  type Values,
} from '@/components/ai-form';
import { BrandLogo } from '@/components/brand-logo';
import { Emoji } from '@/components/emoji';
import { Icon } from '@/components/icons';
import { isImage, PHOTO_TYPES } from '@/components/onboard-uploads';
import { Select } from '@/components/ui/select';
import { scheduleEmoji } from '@/components/vehicle/schedule-row';
import { api } from '@/lib/api';
import { eventEmoji } from '@/lib/event-emoji';
import { formatDate, formatMoney, humanise, toMinorUnits } from '@/lib/format';
import { ATTACH_TYPES, attachFiles, saveDone, savePlanned } from '@/lib/save-entry';
import { useVehicleUnits } from '@/lib/vehicle-units';

export type ProposalStatus = 'open' | 'saved' | 'cancelled';
export interface Settled {
  outcome: string;
  href?: string;
}

/** Whatever the model sent for a field, as the text a field shows. */
const text = (value: unknown) =>
  value === undefined || value === null ? '' : String(value).trim();
const integer = (value: string) => {
  const number = Math.round(Number(value.replace(/,/g, '')));
  return value.trim() && Number.isFinite(number) ? number : undefined;
};
const decimal = (value: string) => {
  const number = Number(value.replace(/,/g, ''));
  return value.trim() && Number.isFinite(number) && number > 0 ? number : undefined;
};
const optional = (value: string | undefined) => value?.trim() || undefined;
const today = () => new Date().toLocaleDateString('en-CA');
const typeLabel = (type: string) => (type === 'ATV' || type === 'RV' ? type : humanise(type));

function useValues(initial: Record<string, unknown>) {
  const [values, setValues] = useState<Values>(() =>
    Object.fromEntries(Object.entries(initial).map(([key, value]) => [key, text(value)])),
  );
  const set = (key: string, value: string) =>
    setValues((current) => ({ ...current, [key]: value }));
  return [values, set] as const;
}

/** Everything a write here can touch: the vehicle lists, its subtree, tasks, due items, garages. */
function useRefresh() {
  const queryClient = useQueryClient();
  return () => {
    for (const queryKey of [
      ['vehicles'],
      ['garages'],
      ['tasks'],
      queryKeys.due(),
      queryKeys.dashboard(),
    ]) {
      void queryClient.invalidateQueries({ queryKey });
    }
  };
}

function useSave(run: () => Promise<Settled>, onSaved: (settled: Settled) => void) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: run,
    // The card says what happened, in place; a toast would say it twice.
    meta: { toast: false },
    onSuccess: (settled) => {
      refresh();
      onSaved(settled);
    },
  });
}

const VEHICLE_OPTIONS = VEHICLE_TYPES.map((type) => ({ value: type, label: typeLabel(type) }));
const KIND_OPTIONS = EVENT_TYPES.filter((kind) => kind !== 'PURCHASE').map((kind) => ({
  value: kind,
  label: humanise(kind),
  icon: <Emoji name={eventEmoji(kind)} size={16} />,
}));
const PURPOSE_OPTIONS = TRIP_PURPOSES.map((purpose) => ({
  value: purpose,
  label: humanise(purpose),
}));
const UNIT_OPTIONS = [
  { value: 'KM', label: 'Kilometres' },
  { value: 'MI', label: 'Miles' },
];

function VehicleChip({ vehicle }: { vehicle: Pick<Vehicle, 'make' | 'displayName'> }) {
  return (
    <>
      <BrandLogo make={vehicle.make} size={14} className="shrink-0 rounded-[3px]" />
      <span className="truncate">{vehicle.displayName}</span>
    </>
  );
}

export function ProposalCard({
  proposal,
  files,
  vehicles,
  status,
  outcome,
  href,
  onSettle,
}: {
  proposal: AiProposal;
  files: readonly File[];
  vehicles: readonly Vehicle[];
  status: ProposalStatus;
  outcome?: string;
  href?: string;
  onSettle: (status: Exclude<ProposalStatus, 'open'>, settled?: Settled) => void;
}) {
  if (status === 'cancelled') {
    return <p className="text-sm text-muted-foreground">Cancelled — nothing was changed.</p>;
  }
  if (status === 'saved') {
    return (
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-foreground">
        <span
          aria-hidden="true"
          className="grid size-5 place-items-center rounded-full bg-success-soft text-success"
        >
          <Check className="size-3" strokeWidth={3} />
        </span>
        {outcome}
        {href ? (
          <Link
            href={href}
            className="font-semibold text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            View
          </Link>
        ) : null}
      </p>
    );
  }

  const props: CardProps = {
    fields: proposal.fields,
    files,
    vehicles,
    onSaved: (settled) => onSettle('saved', settled),
    onCancel: () => onSettle('cancelled'),
  };
  const Card = CARDS[proposal.action];
  return <Card {...props} />;
}

interface CardProps {
  fields: Record<string, unknown>;
  files: readonly File[];
  vehicles: readonly Vehicle[];
  onSaved: (settled: Settled) => void;
  onCancel: () => void;
}

const CARDS: Record<AiAction, (props: CardProps) => ReactNode> = {
  add_vehicle: AddVehicle,
  edit_vehicle: EditVehicle,
  archive_vehicle: ArchiveVehicle,
  add_garage: AddGarage,
  edit_garage: EditGarage,
  delete_garage: DeleteGarage,
  log_entry: (props) => (
    <WithVehicle
      {...props}
      render={(vehicle, switcher) => <LogEntry {...props} vehicle={vehicle} switcher={switcher} />}
    />
  ),
  edit_entry: (props) => (
    <WithVehicle {...props} render={(vehicle) => <EditEntry {...props} vehicle={vehicle} />} />
  ),
  delete_entry: (props) => (
    <WithVehicle {...props} render={(vehicle) => <DeleteEntry {...props} vehicle={vehicle} />} />
  ),
  plan: (props) => (
    <WithVehicle
      {...props}
      render={(vehicle, switcher) => <Plan {...props} vehicle={vehicle} switcher={switcher} />}
    />
  ),
};

/** The vehicle a change is about — and when the line named none of several, the question. */
function WithVehicle({
  fields,
  vehicles,
  onCancel,
  render,
}: CardProps & { render: (vehicle: Vehicle, switcher: ReactNode) => ReactNode }) {
  const [chosen, setChosen] = useState(text(fields.vehicle_id));
  const vehicle = vehicles.find((candidate) => candidate.id === chosen);
  /*
   * A vehicle picked for the person — from the page in view, or the only one — is a default, not
   * a decision: the card names it as a switch, so a different one is one tap away.
   */
  if (vehicle) {
    return render(
      vehicle,
      vehicles.length > 1 ? (
        <Select
          value={vehicle.id}
          onValueChange={setChosen}
          ariaLabel="Vehicle"
          options={vehicles.map((candidate) => ({
            value: candidate.id,
            label: candidate.displayName,
            icon: <BrandLogo make={candidate.make} size={16} className="rounded-[3px]" />,
          }))}
          className="min-w-0 [&>button]:!h-6 [&>button]:!gap-1 [&>button]:!rounded-full [&>button]:!bg-muted [&>button]:!px-2 [&>button]:!text-xs"
        />
      ) : (
        <VehicleChip vehicle={vehicle} />
      ),
    );
  }
  return (
    <div className="flex flex-col gap-2.5">
      <p className="text-sm text-foreground">Which vehicle is this for?</p>
      <div className="flex flex-wrap gap-2">
        {vehicles.map((candidate) => (
          <button
            key={candidate.id}
            type="button"
            onClick={() => setChosen(candidate.id)}
            className="inline-flex h-9 items-center gap-2 rounded-full bg-muted pl-2 pr-3.5 text-sm font-semibold text-foreground transition-colors hover:bg-border"
          >
            <BrandLogo make={candidate.make} size={18} className="rounded" />
            {candidate.displayName}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={onCancel}
        className="self-start text-xs font-semibold text-muted-foreground hover:text-foreground"
      >
        Cancel
      </button>
    </div>
  );
}

/* ---------------------------------------------------------------- vehicles */

const VEHICLE_SPECS = (unit: string, garages: readonly Garage[]): FieldSpec[] => [
  {
    key: 'garage_id',
    label: 'Garage',
    type: 'select',
    options: garages.map((garage) => ({ value: garage.id, label: garage.name })),
  },
  { key: 'vehicle_type', label: 'Type', type: 'select', options: VEHICLE_OPTIONS },
  { key: 'make', label: 'Make', type: 'text' },
  { key: 'model', label: 'Model', type: 'text' },
  { key: 'year', label: 'Year', type: 'number' },
  { key: 'variant', label: 'Variant', type: 'text' },
  { key: 'purchase_price', label: 'Price', type: 'money', currencyKey: 'purchase_currency' },
  { key: 'purchase_date', label: 'Bought', type: 'date' },
  { key: 'odometer', label: 'Odometer', type: 'number', suffix: unit, more: true },
  { key: 'odometer_unit', label: 'Unit', type: 'select', options: UNIT_OPTIONS, more: true },
  { key: 'registration', label: 'Plate', type: 'text', more: true },
  { key: 'nickname', label: 'Nickname', type: 'text', more: true },
  { key: 'color', label: 'Colour', type: 'text', more: true },
];

/** The API's names for the fields the model and the form share. */
function vehicleBody(values: Values) {
  const price = decimal(values.purchase_price ?? '');
  const currency = values.purchase_currency || 'USD';
  return {
    make: optional(values.make),
    model: optional(values.model),
    variant: optional(values.variant),
    year: integer(values.year ?? ''),
    nickname: optional(values.nickname),
    color: optional(values.color),
    registrationIdentifier: optional(values.registration),
    purchaseDate: optional(values.purchase_date),
    ...(price !== undefined
      ? { purchasePriceAmountMinor: toMinorUnits(price, currency), purchasePriceCurrency: currency }
      : {}),
    currentOdometer: integer(values.odometer ?? ''),
    odometerUnit: values.odometer_unit === 'MI' ? ('MI' as const) : ('KM' as const),
  };
}

function nameOf(values: Values) {
  return (
    [values.year, values.make, values.model].filter(Boolean).join(' ') ||
    values.nickname ||
    'New vehicle'
  );
}

function AddVehicle({ fields, files, onSaved, onCancel }: CardProps) {
  const garages = useQuery(garagesQuery(api)).data ?? [];
  const [values, set] = useValues({ vehicle_type: 'CAR', ...fields });
  const [photos, setPhotos] = useState<File[]>(() => files.filter(isImage));
  // With one garage there is nothing to choose; with several, the person picks — never a guess.
  const garageId = values.garage_id || (garages.length === 1 ? garages[0]!.id : '');
  const garage = garages.find((candidate) => candidate.id === garageId);
  const shown: Values = {
    ...values,
    garage_id: garageId,
    purchase_currency: values.purchase_currency || garage?.defaultCurrency || 'USD',
  };

  const save = useSave(async () => {
    const vehicle = await api.vehicles.create({
      garageId,
      vehicleType: (shown.vehicle_type || 'CAR') as VehicleType,
      ...vehicleBody(shown),
    });
    const failed: string[] = [];
    for (const photo of photos) {
      await uploadPhoto(api, vehicle.id, photo).catch((error: Error) =>
        failed.push(`${photo.name} was not added: ${error.message}`),
      );
    }
    return {
      outcome: [
        `Added the ${vehicle.displayName} to ${garage?.name ?? 'your garage'}.`,
        ...failed,
      ].join(' '),
      href: `/vehicles/${vehicle.id}`,
    };
  }, onSaved);

  return (
    <ActionCard
      tone="create"
      badge="New vehicle"
      context={garage ? <span className="truncate">{garage.name}</span> : null}
      heading={
        <>
          <BrandLogo make={shown.make} size={28} className="shrink-0 rounded-md" />
          <span className="min-w-0 truncate text-base font-semibold text-foreground">
            {nameOf(shown)}
          </span>
        </>
      }
      pending={save.isPending}
      canApprove={Boolean(garageId && (shown.make || shown.model || shown.nickname))}
      error={save.error?.message}
      onApprove={() => save.mutate()}
      onCancel={onCancel}
    >
      <FieldGrid
        specs={VEHICLE_SPECS(shown.odometer_unit === 'MI' ? 'mi' : 'km', garages)}
        values={shown}
        onChange={set}
      />
      <FilesField label="Photos" files={photos} accept={PHOTO_TYPES} onChange={setPhotos} />
    </ActionCard>
  );
}

function EditVehicle({ fields, vehicles, onSaved, onCancel }: CardProps) {
  const vehicle = vehicles.find((candidate) => candidate.id === text(fields.vehicle_id));
  const [values, set] = useValues(fields);
  // Only what changes, each with what it was.
  const specs = VEHICLE_SPECS(vehicle?.odometerUnit === 'MI' ? 'mi' : 'km', []).filter(
    (spec) => spec.key in fields && spec.key !== 'garage_id' && spec.key !== 'vehicle_type',
  );
  const shown: Values = {
    ...values,
    purchase_currency: values.purchase_currency || vehicle?.purchasePrice?.currency || 'USD',
  };
  const save = useSave(async () => {
    const body = vehicleBody(shown);
    const changed: Record<string, unknown> = Object.fromEntries(
      Object.entries(body).filter(([key]) => specs.some((spec) => API_KEY[spec.key] === key)),
    );
    if ('purchasePriceAmountMinor' in changed)
      changed.purchasePriceCurrency = body.purchasePriceCurrency;
    if ('currentOdometer' in changed) changed.odometerUnit = vehicle!.odometerUnit;
    const updated = await api.vehicles.update(vehicle!.id, changed);
    return { outcome: `Updated the ${updated.displayName}.`, href: `/vehicles/${vehicle!.id}` };
  }, onSaved);
  if (!vehicle) return <Missing what="vehicle" onCancel={onCancel} />;
  const current: Values = {
    vehicle_type: typeLabel(vehicle.vehicleType),
    make: vehicle.make ?? '',
    model: vehicle.model ?? '',
    variant: vehicle.variant ?? '',
    year: vehicle.year ? String(vehicle.year) : '',
    nickname: vehicle.nickname ?? '',
    color: vehicle.color ?? '',
    registration: vehicle.registrationIdentifier ?? '',
    purchase_date: vehicle.purchaseDate ? formatDate(`${vehicle.purchaseDate}T00:00:00`) : '',
    purchase_price: vehicle.purchasePrice ? formatMoney(vehicle.purchasePrice) : '',
    odometer: vehicle.currentOdometer ? vehicle.currentOdometer.toLocaleString() : '',
  };

  return (
    <ActionCard
      tone="edit"
      badge="Edit vehicle"
      heading={
        <>
          <BrandLogo make={vehicle.make} size={28} className="shrink-0 rounded-md" />
          <span className="min-w-0 truncate text-base font-semibold text-foreground">
            {vehicle.displayName}
          </span>
        </>
      }
      pending={save.isPending}
      canApprove={specs.length > 0}
      error={save.error?.message}
      onApprove={() => save.mutate()}
      onCancel={onCancel}
    >
      <FieldGrid specs={specs} values={shown} onChange={set} was={current} />
    </ActionCard>
  );
}

/** The form's key for each API field, so an edit sends only what it shows. */
const API_KEY: Record<string, string> = {
  make: 'make',
  model: 'model',
  variant: 'variant',
  year: 'year',
  nickname: 'nickname',
  color: 'color',
  registration: 'registrationIdentifier',
  purchase_date: 'purchaseDate',
  purchase_price: 'purchasePriceAmountMinor',
  odometer: 'currentOdometer',
  odometer_unit: 'odometerUnit',
};

function ArchiveVehicle({ fields, vehicles, onSaved, onCancel }: CardProps) {
  const vehicle = vehicles.find((candidate) => candidate.id === text(fields.vehicle_id));
  const save = useSave(async () => {
    await api.vehicles.archive(vehicle!.id);
    return { outcome: `Removed the ${vehicle!.displayName} from your garage.` };
  }, onSaved);
  if (!vehicle) return <Missing what="vehicle" onCancel={onCancel} />;
  return (
    <ActionCard
      tone="delete"
      badge="Remove vehicle"
      heading={
        <>
          <BrandLogo make={vehicle.make} size={28} className="shrink-0 rounded-md" />
          <span className="min-w-0">
            <span className="block truncate text-base font-semibold text-foreground">
              {vehicle.displayName}
            </span>
            <span className="block text-xs text-muted-foreground">
              It leaves your garage; its history is kept.
            </span>
          </span>
        </>
      }
      confirmLabel="Remove for good"
      pending={save.isPending}
      error={save.error?.message}
      onApprove={() => save.mutate()}
      onCancel={onCancel}
    />
  );
}

/* ----------------------------------------------------------------- garages */

const GARAGE_SPECS: FieldSpec[] = [
  { key: 'currency', label: 'Currency', type: 'text', placeholder: 'USD' },
  { key: 'description', label: 'About', type: 'notes', placeholder: 'What it holds' },
];

function AddGarage({ fields, onSaved, onCancel }: CardProps) {
  const [values, set] = useValues(fields);
  const save = useSave(async () => {
    const garage = await api.garages.create({
      name: values.name!.trim(),
      ...(optional(values.description) ? { description: values.description!.trim() } : {}),
      ...(values.currency?.length === 3 ? { defaultCurrency: values.currency.toUpperCase() } : {}),
    });
    return { outcome: `Created the ${garage.name} garage.`, href: `/garages/${garage.id}` };
  }, onSaved);

  return (
    <ActionCard
      tone="create"
      badge="New garage"
      heading={
        <>
          <Icon name="garage" size={26} className="shrink-0" />
          <TitleInput
            value={values.name ?? ''}
            placeholder="Garage name"
            onChange={(value) => set('name', value)}
          />
        </>
      }
      pending={save.isPending}
      canApprove={Boolean(values.name?.trim())}
      error={save.error?.message}
      onApprove={() => save.mutate()}
      onCancel={onCancel}
    >
      <FieldGrid specs={GARAGE_SPECS} values={values} onChange={set} />
    </ActionCard>
  );
}

function EditGarage({ fields, onSaved, onCancel }: CardProps) {
  const garages = useQuery(garagesQuery(api)).data;
  const garage = garages?.find((candidate) => candidate.id === text(fields.garage_id));
  const [values, set] = useValues(fields);
  const save = useSave(async () => {
    const updated = await api.garages.update(garage!.id, {
      ...(optional(values.name) ? { name: values.name!.trim() } : {}),
      ...('description' in fields ? { description: optional(values.description) ?? null } : {}),
      ...(values.currency?.length === 3 ? { defaultCurrency: values.currency.toUpperCase() } : {}),
    });
    return { outcome: `Updated the ${updated.name} garage.`, href: `/garages/${updated.id}` };
  }, onSaved);
  if (!garages) return null;
  if (!garage) return <Missing what="garage" onCancel={onCancel} />;
  const specs = [{ key: 'name', label: 'Name', type: 'text' } as const, ...GARAGE_SPECS].filter(
    (spec) => spec.key in fields,
  );

  return (
    <ActionCard
      tone="edit"
      badge="Edit garage"
      heading={
        <>
          <Icon name="garage" size={26} className="shrink-0" />
          <span className="min-w-0 truncate text-base font-semibold text-foreground">
            {garage.name}
          </span>
        </>
      }
      pending={save.isPending}
      canApprove={specs.length > 0}
      error={save.error?.message}
      onApprove={() => save.mutate()}
      onCancel={onCancel}
    >
      <FieldGrid
        specs={specs}
        values={values}
        onChange={set}
        was={{
          name: garage.name,
          currency: garage.defaultCurrency,
          description: garage.description ?? '',
        }}
      />
    </ActionCard>
  );
}

function DeleteGarage({ fields, onSaved, onCancel }: CardProps) {
  const garages = useQuery(garagesQuery(api)).data;
  const garage = garages?.find((candidate) => candidate.id === text(fields.garage_id));
  const save = useSave(async () => {
    await api.garages.remove(garage!.id);
    return { outcome: `Deleted the ${garage!.name} garage.` };
  }, onSaved);
  if (!garages) return null;
  if (!garage) return <Missing what="garage" onCancel={onCancel} />;
  return (
    <ActionCard
      tone="delete"
      badge="Delete garage"
      heading={
        <>
          <Icon name="garage" size={26} className="shrink-0" />
          <span className="min-w-0">
            <span className="block truncate text-base font-semibold text-foreground">
              {garage.name}
            </span>
            <span className="block text-xs text-muted-foreground">
              It goes for every member, with its vehicles.
            </span>
          </span>
        </>
      }
      confirmLabel="Delete for everyone"
      pending={save.isPending}
      error={save.error?.message}
      onApprove={() => save.mutate()}
      onCancel={onCancel}
    />
  );
}

/* ----------------------------------------------------------------- entries */

/** The fields an entry shows, by its kind: a trip's ends and purpose, a fill-up's litres. */
function entrySpecs(kind: EventType, unit: string, quantityUnit: string): FieldSpec[] {
  const base: FieldSpec[] = [
    { key: 'kind', label: 'Kind', type: 'select', options: KIND_OPTIONS },
    { key: 'date', label: 'Date', type: 'date' },
  ];
  const odometer: FieldSpec = { key: 'odometer', label: 'Odometer', type: 'number', suffix: unit };
  const amount: FieldSpec = {
    key: 'amount',
    label: 'Amount',
    type: 'money',
    currencyKey: 'currency',
  };
  const place: FieldSpec = { key: 'place', label: 'Where', type: 'text', placeholder: 'Optional' };
  const notes: FieldSpec = { key: 'notes', label: 'Notes', type: 'notes' };

  if (kind === 'TRIP') {
    return [
      { key: 'trip_from', label: 'From', type: 'text', placeholder: 'Start' },
      { key: 'trip_to', label: 'To', type: 'text', placeholder: 'End' },
      ...base,
      { key: 'trip_purpose', label: 'Purpose', type: 'select', options: PURPOSE_OPTIONS },
      { key: 'trip_distance', label: 'Distance', type: 'number', suffix: unit },
      { ...odometer, label: 'End odometer', more: true },
      { key: 'start_odometer', label: 'Start odometer', type: 'number', suffix: unit, more: true },
      {
        key: 'rate',
        label: `Rate per ${unit}`,
        type: 'money',
        currencyKey: 'currency',
        more: true,
      },
      { ...amount, label: 'Costs', more: true },
      notes,
    ];
  }
  if (kind === 'FUEL' || kind === 'CHARGE') {
    return [
      ...base,
      amount,
      {
        key: 'quantity',
        label: kind === 'CHARGE' ? 'Charged' : 'Filled',
        type: 'number',
        suffix: quantityUnit,
      },
      odometer,
      place,
      notes,
    ];
  }
  return [...base, amount, odometer, { ...place, wide: true }, notes];
}

const QUANTITY_UNIT: Record<string, string> = { L: 'L', GAL: 'gal', KWH: 'kWh' };

function LogEntry({
  fields,
  files,
  onSaved,
  onCancel,
  vehicle,
  switcher,
}: CardProps & { vehicle: Vehicle; switcher: ReactNode }) {
  const { currency, odometerUnit } = useVehicleUnits(vehicle.id);
  const [values, set] = useValues({ ...fields, date: text(fields.date) || today() });
  const [attached, setAttached] = useState<File[]>(() => [...files]);
  const kind = (values.kind || 'MAINTENANCE') as EventType;
  const unit = odometerUnit === 'MI' ? 'mi' : 'km';
  const quantityUnit =
    QUANTITY_UNIT[values.quantity_unit ?? ''] ?? (kind === 'CHARGE' ? 'kWh' : 'L');
  const shown: Values = {
    ...values,
    kind,
    // A bare "$" read from a line is the vehicle's own dollar, or the US dollar.
    currency: currencyOfLine(values.currency || null, currency) ?? currency,
    // A trip is logged for a reason; personal until said otherwise, and shown so it can be.
    trip_purpose: values.trip_purpose || (kind === 'TRIP' ? 'PERSONAL' : ''),
  };
  const route = shown.trip_from && shown.trip_to ? `${shown.trip_from} → ${shown.trip_to}` : '';

  const save = useSave(async () => {
    const amount = decimal(shown.amount ?? '');
    const rate = decimal(shown.rate ?? '');
    const distance = integer(shown.trip_distance ?? '');
    const start = integer(shown.start_odometer ?? '');
    const odometer = integer(shown.odometer ?? '');
    // Where a trip went and what was bought ride in the note: the record has no field for them.
    const note = [
      kind === 'TRIP' && (shown.trip_from || shown.trip_to)
        ? `From ${shown.trip_from || '—'} to ${shown.trip_to || '—'}`
        : null,
      shown.quantity ? `${shown.quantity} ${quantityUnit}` : null,
      optional(shown.notes),
    ]
      .filter(Boolean)
      .join('\n');
    const saved = await saveDone({
      vehicleId: vehicle.id,
      kind,
      title: optional(shown.title) ?? (kind === 'TRIP' ? route : ''),
      when: stampForDay(shown.date || today()),
      ...(odometer !== undefined ? { odometer } : {}),
      odometerUnit,
      ...(amount !== undefined ? { amountMinor: toMinorUnits(amount, shown.currency!) } : {}),
      currency: shown.currency!,
      place: shown.place ?? '',
      note,
      ...(kind === 'TRIP' && shown.trip_purpose
        ? {
            trip: {
              purpose: shown.trip_purpose as TripPurpose,
              ...(distance ? { distance } : {}),
              ...(start !== undefined ? { startOdometer: start } : {}),
              ...(rate !== undefined
                ? { rateMinor: toMinorUnits(rate, shown.currency!), rateCurrency: shown.currency }
                : {}),
            },
          }
        : {}),
    });
    const failed = await attachFiles(vehicle.id, saved.eventId, attached, kind);
    return {
      outcome: [
        `Added to the ${vehicle.displayName}’s activity.`,
        ...saved.warnings,
        ...failed,
      ].join(' '),
      href: `/vehicles/${vehicle.id}`,
    };
  }, onSaved);

  return (
    <ActionCard
      tone="create"
      badge="New entry"
      context={switcher}
      heading={
        <>
          <Emoji name={eventEmoji(kind)} size={26} className="shrink-0" />
          <TitleInput
            value={shown.title ?? ''}
            placeholder={kind === 'TRIP' ? route || 'Trip' : humanise(kind)}
            onChange={(value) => set('title', value)}
          />
        </>
      }
      pending={save.isPending}
      error={save.error?.message}
      onApprove={() => save.mutate()}
      onCancel={onCancel}
    >
      <FieldGrid specs={entrySpecs(kind, unit, quantityUnit)} values={shown} onChange={set} />
      <FilesField
        label="Attachments"
        files={attached}
        accept={ATTACH_TYPES}
        onChange={setAttached}
      />
    </ActionCard>
  );
}

function useEntry(vehicleId: string, entryId: string) {
  return useQuery({
    queryKey: [...queryKeys.vehicle(vehicleId), 'events', entryId],
    queryFn: () => api.events.get(vehicleId, entryId),
  });
}

function EditEntry({ fields, onSaved, onCancel, vehicle }: CardProps & { vehicle: Vehicle }) {
  const entry = useEntry(vehicle.id, text(fields.entry_id)).data;
  const [values, set] = useValues(fields);
  const save = useSave(async () => {
    const amount = decimal(values.amount ?? '');
    const odometer = integer(values.odometer ?? '');
    const currency = values.currency || entry?.cost?.currency || 'USD';
    await api.events.update(vehicle.id, entry!.id, {
      ...('kind' in fields ? { eventType: values.kind as EventType } : {}),
      ...('title' in fields && optional(values.title) ? { title: values.title!.trim() } : {}),
      ...('date' in fields && values.date ? { occurredAt: stampForDay(values.date) } : {}),
      ...('amount' in fields
        ? {
            costAmountMinor: amount !== undefined ? toMinorUnits(amount, currency) : null,
            costCurrency: currency,
          }
        : {}),
      ...('odometer' in fields ? { odometer: odometer ?? null } : {}),
      ...('place' in fields ? { provider: optional(values.place) ?? null } : {}),
      ...('notes' in fields ? { description: optional(values.notes) ?? null } : {}),
    });
    return {
      outcome: `Updated the entry on the ${vehicle.displayName}.`,
      href: `/vehicles/${vehicle.id}`,
    };
  }, onSaved);
  if (!entry) return null;

  const unit = vehicle.odometerUnit === 'MI' ? 'mi' : 'km';
  const specs = entrySpecs(entry.eventType, unit, 'L').filter(
    (spec) => spec.key in fields && !spec.key.startsWith('trip_'),
  );
  const shown = { ...values, currency: values.currency || entry.cost?.currency || 'USD' };

  return (
    <ActionCard
      tone="edit"
      badge="Edit entry"
      context={<VehicleChip vehicle={vehicle} />}
      heading={
        <>
          <Emoji name={eventEmoji(entry.eventType)} size={26} className="shrink-0" />
          <span className="min-w-0 truncate text-base font-semibold text-foreground">
            {entry.title}
          </span>
        </>
      }
      pending={save.isPending}
      canApprove={specs.length > 0}
      error={save.error?.message}
      onApprove={() => save.mutate()}
      onCancel={onCancel}
    >
      <FieldGrid
        specs={specs}
        values={shown}
        onChange={set}
        was={{
          kind: humanise(entry.eventType),
          title: entry.title,
          date: formatDate(entry.occurredAt),
          amount: entry.cost ? formatMoney(entry.cost) : '',
          odometer: entry.odometer !== null ? entry.odometer.toLocaleString() : '',
          place: entry.provider ?? '',
          notes: entry.description ?? '',
        }}
      />
    </ActionCard>
  );
}

function DeleteEntry({ fields, onSaved, onCancel, vehicle }: CardProps & { vehicle: Vehicle }) {
  const entry = useEntry(vehicle.id, text(fields.entry_id)).data;
  const save = useSave(async () => {
    await api.events.remove(vehicle.id, entry!.id);
    return { outcome: `Deleted “${entry!.title}”.`, href: `/vehicles/${vehicle.id}` };
  }, onSaved);
  if (!entry) return null;
  return (
    <ActionCard
      tone="delete"
      badge="Delete entry"
      context={<VehicleChip vehicle={vehicle} />}
      heading={
        <>
          <Emoji name={eventEmoji(entry.eventType)} size={26} className="shrink-0" />
          <span className="min-w-0">
            <span className="block truncate text-base font-semibold text-foreground">
              {entry.title}
            </span>
            <span className="block font-mono text-xs tabular-nums text-muted-foreground">
              {[formatDate(entry.occurredAt), entry.cost ? formatMoney(entry.cost) : null]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </span>
        </>
      }
      pending={save.isPending}
      error={save.error?.message}
      onApprove={() => save.mutate()}
      onCancel={onCancel}
    />
  );
}

/* ------------------------------------------------------------------- plans */

function Plan({
  fields,
  onSaved,
  onCancel,
  vehicle,
  switcher,
}: CardProps & { vehicle: Vehicle; switcher: ReactNode }) {
  const { odometerUnit } = useVehicleUnits(vehicle.id);
  const [values, set] = useValues(fields);
  // Read from the proposal once: a repeat said is a schedule, anything else a one-off reminder.
  const [repeats] = useState(Boolean(fields.every_months || fields.every_distance));
  const unit = odometerUnit === 'MI' ? 'mi' : 'km';
  const save = useSave(async () => {
    await savePlanned({
      vehicleId: vehicle.id,
      garageId: vehicle.garageId,
      title: values.title!.trim(),
      repeats,
      everyMonths: integer(values.every_months ?? ''),
      everyDistance: integer(values.every_distance ?? ''),
      odometerUnit,
      due: optional(values.due_date),
    });
    return {
      outcome: repeats
        ? `Scheduled for the ${vehicle.displayName}.`
        : `Reminder added for the ${vehicle.displayName}.`,
      href: `/vehicles/${vehicle.id}`,
    };
  }, onSaved);
  const specs: FieldSpec[] = repeats
    ? [
        { key: 'every_months', label: 'Every', type: 'number', suffix: 'mo' },
        { key: 'every_distance', label: 'Or every', type: 'number', suffix: unit },
      ]
    : [{ key: 'due_date', label: 'Due', type: 'date', wide: true }];

  return (
    <ActionCard
      tone="create"
      badge={repeats ? 'New schedule' : 'New reminder'}
      context={switcher}
      heading={
        <>
          <Emoji
            name={values.title ? scheduleEmoji(values.title) : 'maintenance'}
            size={26}
            className="shrink-0"
          />
          <TitleInput
            value={values.title ?? ''}
            placeholder="What needs doing"
            onChange={(value) => set('title', value)}
          />
        </>
      }
      pending={save.isPending}
      // A repeat with no interval can never come due; the server refuses it, so the card does first.
      canApprove={
        Boolean(values.title?.trim()) &&
        (!repeats || Boolean(values.every_months || values.every_distance))
      }
      error={save.error?.message}
      onApprove={() => save.mutate()}
      onCancel={onCancel}
    >
      <FieldGrid specs={specs} values={values} onChange={set} />
    </ActionCard>
  );
}

function Missing({ what, onCancel }: { what: string; onCancel: () => void }) {
  return (
    <p className="text-sm text-muted-foreground">
      That {what} is no longer in your garage.{' '}
      <button
        type="button"
        onClick={onCancel}
        className="font-semibold text-foreground underline-offset-2 hover:underline"
      >
        Dismiss
      </button>
    </p>
  );
}
