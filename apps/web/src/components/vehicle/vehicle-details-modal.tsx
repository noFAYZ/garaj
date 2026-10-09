'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import {
  CAPABILITY_SPEC_FIELDS,
  DISTANCE_UNITS,
  VEHICLE_CAPABILITIES,
  VEHICLE_STATUSES,
  specFieldsFor,
  type SpecField,
  type VehicleCapability,
  type VehicleType,
} from '@vehicle-os/domain';
import type { UpdateVehicle, Vehicle } from '@vehicle-os/contracts';
import { ApiError } from '@vehicle-os/api-client';
import { queryKeys } from '@vehicle-os/api-client/react';
import { api } from '@/lib/api';
import { DateField } from '@/components/ui/date-picker';
import { Icon, type IconName } from '@/components/icons';
import { Button, Field } from '@/components/ui/primitives';
import { SelectField } from '@/components/ui/select-field';
import { SettingsModal, type SettingsSection } from '@/components/ui/settings-modal';
import { fromMinorUnits, humanise, toMinorUnits } from '@/lib/format';

/**
 * Everything on record about a vehicle, in one editor.
 *
 * Two problems with the panel this replaces. Its specs — tyre sizes, fuel type, oil capacity,
 * hull length — were printed as a read-only `<dl>` and could only ever be set while adding the
 * vehicle, so a number plate could be corrected but a tyre size could not. And the identity
 * fields sat in one flat grid of fifteen inputs, which is a form to fill in rather than a record
 * to consult.
 *
 * So: sections down the side, each a part of the vehicle, and the spec sections are generated
 * from the type's own field descriptors rather than transcribed. `CAPABILITY_SPEC_FIELDS`
 * already declares every field's label, kind, unit, options and bound, and the API validates
 * writes against exactly that list — so a form built from it cannot offer a field the server
 * will reject, and a field added to the domain appears here with no edit to this file. A boat
 * gets hull and mooring, a motorcycle gets its chain, and neither is written down twice.
 */
export function VehicleDetailsModal({
  vehicle,
  onClose,
}: {
  vehicle: Vehicle;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const initial = useMemo(() => initialForm(vehicle), [vehicle]);
  const [form, setForm] = useState(initial);

  const set = (key: string) => (value: string) =>
    setForm((current) => ({ ...current, [key]: value }));
  const setInput = (key: string) => (event: { target: { value: string } }) =>
    set(key)(event.target.value);

  const changed = Object.keys(form).filter((key) => form[key] !== initial[key]);

  const save = useMutation({
    mutationFn: () => api.vehicles.update(vehicle.id, buildPatch(vehicle, form, initial)),
    meta: { toast: 'Vehicle updated' },
    onSuccess: () => {
      // The whole subtree: the hero, the name in every list and the spec sheet all read from it.
      void queryClient.invalidateQueries({ queryKey: queryKeys.vehicle(vehicle.id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.vehicles() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard() });
      onClose();
    },
  });

  const errors = save.error instanceof ApiError ? save.error.fields : undefined;

  const specFields = specFieldsFor(vehicle.vehicleType as VehicleType);
  const specsIn = (capabilities: readonly VehicleCapability[]) =>
    specFields.filter((field) => capabilities.some((c) => CAPABILITY_OF[field.key] === c));

  /** A section is worth a place in the sidebar only if this type actually has its fields. */
  const specSection = (
    value: string,
    label: string,
    description: string,
    icon: IconName,
    capabilities: readonly VehicleCapability[],
  ): SettingsSection[] => {
    const fields = specsIn(capabilities);
    if (fields.length === 0) return [];
    return [
      {
        value,
        label,
        description,
        icon: <Icon name={icon} size={16} />,
        badge: fields.filter((field) => form[specKey(field.key)] !== '').length,
        content: <SpecGrid fields={fields} form={form} onChange={set} errors={errors} />,
      },
    ];
  };

  const sections: SettingsSection[] = [
    {
      value: 'identity',
      label: 'Identity',
      description: 'What it is. The name every list and heading shows comes from these.',
      icon: <Icon name="edit" size={16} />,
      badge: countFilled(form, IDENTITY_KEYS),
      content: (
        <Grid>
          <Field
            label="Nickname"
            value={form.nickname}
            onChange={setInput('nickname')}
            placeholder="The daily"
            hint="Used instead of the make and model wherever it fits."
            error={errors?.nickname}
            className="sm:col-span-2"
          />
          <Field label="Make" value={form.make} onChange={setInput('make')} error={errors?.make} />
          <Field
            label="Model"
            value={form.model}
            onChange={setInput('model')}
            error={errors?.model}
          />
          <Field
            label="Variant"
            value={form.variant}
            onChange={setInput('variant')}
            placeholder="GTI, Touring, 4x4"
            error={errors?.variant}
          />
          <Field
            label="Year"
            type="number"
            inputMode="numeric"
            min={1885}
            max={2100}
            value={form.year}
            onChange={setInput('year')}
            error={errors?.year}
          />
          <Field
            label="Colour"
            value={form.color}
            onChange={setInput('color')}
            error={errors?.color}
          />
          <SelectField
            label="Status"
            value={form.status ?? 'ACTIVE'}
            onChange={set('status')}
            options={VEHICLE_STATUSES.map((status) => ({
              value: status,
              label: humanise(status),
            }))}
          />
        </Grid>
      ),
    },
    {
      value: 'readings',
      label: 'Readings',
      description: 'What its meters say now. Logging a service or a fill-up moves them too.',
      icon: <Icon name="odometer" size={16} />,
      badge: countFilled(form, ['currentOdometer', 'currentEngineHours']),
      content: (
        <div className="flex flex-col gap-5">
          {/*
           * The odometer set as a reading rather than a text box: it is the one number on this
           * screen the owner knows by heart, and a 15px input among fourteen others is not where
           * the eye goes. The unit sits in the frame because a figure without one is not a
           * reading.
           */}
          <div className="flex flex-col gap-2 rounded-2xl bg-muted/60 p-4">
            <label
              htmlFor="vehicle-odometer"
              className="text-label uppercase text-muted-foreground"
            >
              Odometer
            </label>
            <div className="flex items-center gap-3">
              {/*
               * Grouped in threes, which `type="number"` cannot do — 48,250 is read at a glance
               * and 48250 is counted. Digits only in state; the separators are presentation.
               * Nine of them is past the contract's ceiling of 100,000,000, so the bound is felt
               * here rather than as a 400 from the server.
               */}
              <input
                id="vehicle-odometer"
                type="text"
                inputMode="numeric"
                size={1}
                value={
                  form.currentOdometer === ''
                    ? ''
                    : Number(form.currentOdometer).toLocaleString('en-US')
                }
                onChange={(event) =>
                  set('currentOdometer')(event.target.value.replace(/\D/g, '').slice(0, 9))
                }
                placeholder="0"
                className="h-12 min-w-0 flex-1 rounded-xl bg-input px-3 font-mono text-2xl tabular-nums text-foreground transition-colors hover:bg-border focus:bg-border"
              />
              <div className="flex shrink-0 gap-1 rounded-xl bg-card p-1">
                {DISTANCE_UNITS.map((unit) => (
                  <button
                    key={unit}
                    type="button"
                    onClick={() => set('odometerUnit')(unit)}
                    aria-pressed={form.odometerUnit === unit}
                    className={
                      form.odometerUnit === unit
                        ? 'h-9 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground'
                        : 'h-9 rounded-lg px-3 text-sm font-semibold text-muted-foreground transition-colors hover:bg-muted'
                    }
                  >
                    {unit === 'MI' ? 'mi' : 'km'}
                  </button>
                ))}
              </div>
            </div>
            {errors?.currentOdometer ? (
              <p role="alert" className="text-xs text-destructive">
                {errors.currentOdometer}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                A reading only ever moves forward. Emptying this leaves the stored one alone.
              </p>
            )}
          </div>

          {/* Only for a type with the meter, so a car never shows a blank hours box. */}
          {vehicle.capabilities.includes('engineHours') ? (
            <Field
              label="Engine hours"
              type="number"
              inputMode="numeric"
              min={0}
              value={form.currentEngineHours}
              onChange={setInput('currentEngineHours')}
              error={errors?.currentEngineHours}
            />
          ) : null}
        </div>
      ),
    },
    {
      value: 'registration',
      label: 'Registration',
      description: 'The numbers it is known by, and the paperwork behind them.',
      icon: <Icon name="document" size={16} />,
      badge:
        countFilled(form, ['identificationNumber', 'registrationIdentifier']) +
        specsIn(['registration', 'insurance']).filter((f) => form[specKey(f.key)] !== '').length,
      content: (
        <div className="flex flex-col gap-5">
          {/*
           * Set like the plate it is: a reverse band and wide mono, as the add-vehicle stepper
           * does. A plate is read back letter by letter over a phone, and normal prose spacing
           * is what makes an 8 and a B the same shape.
           */}
          <div className="flex flex-col gap-2">
            <label htmlFor="vehicle-plate" className="text-sm font-medium text-foreground">
              Number plate
            </label>
            <div className="flex items-stretch overflow-hidden rounded-xl bg-input focus-within:bg-border">
              <span
                aria-hidden="true"
                className="grid w-10 shrink-0 place-items-center bg-foreground font-mono text-[0.6rem] font-bold uppercase tracking-widest text-background"
              >
                Reg
              </span>
              <input
                id="vehicle-plate"
                size={1}
                value={form.registrationIdentifier}
                onChange={(event) =>
                  set('registrationIdentifier')(event.target.value.toUpperCase())
                }
                maxLength={32}
                className="h-11 min-w-0 flex-1 bg-transparent px-3 font-mono text-lg font-bold uppercase tracking-[0.2em] text-foreground"
              />
            </div>
            {errors?.registrationIdentifier ? (
              <p role="alert" className="text-xs text-destructive">
                {errors.registrationIdentifier}
              </p>
            ) : null}
          </div>

          <Field
            label="VIN / frame number"
            value={form.identificationNumber}
            onChange={(event) => set('identificationNumber')(event.target.value.toUpperCase())}
            maxLength={64}
            hint="17 characters on most road vehicles."
            error={errors?.identificationNumber}
            className="[&_input]:font-mono [&_input]:tracking-wider"
          />

          <SpecGrid
            fields={specsIn(['registration', 'insurance'])}
            form={form}
            onChange={set}
            errors={errors}
          />
        </div>
      ),
    },
    {
      value: 'ownership',
      label: 'Ownership',
      description: 'When it became yours and what it cost. Both feed the cost summary.',
      icon: <Icon name="money" size={16} />,
      badge: countFilled(form, ['purchaseDate', 'purchasePrice']),
      content: (
        <Grid>
          <DateField
            label="Purchased"
            value={form.purchaseDate ?? ''}
            onChange={set('purchaseDate')}
            max={new Date().toLocaleDateString('en-CA')}
            hint="Cost per year is measured from here."
            error={errors?.purchaseDate}
          />
          <Field
            label="Purchase price"
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            suffix={form.purchaseCurrency}
            value={form.purchasePrice}
            onChange={setInput('purchasePrice')}
            error={errors?.purchasePriceAmountMinor}
          />
          <Field
            label="Currency"
            value={form.purchaseCurrency}
            onChange={(event) =>
              set('purchaseCurrency')(event.target.value.toUpperCase().slice(0, 3))
            }
            maxLength={3}
            hint="The summary is quoted in this."
            error={errors?.purchasePriceCurrency}
          />
        </Grid>
      ),
    },
    ...specSection(
      'drivetrain',
      'Drivetrain',
      'What moves it, what it drinks, and how that reaches the wheels.',
      'fuel',
      ['engine', 'fuelSystem', 'electricSystem', 'battery', 'transmission'],
    ),
    ...specSection(
      'wheels',
      'Wheels & tyres',
      'Sizes and pressures, for what wears out.',
      'wheel',
      ['tires', 'chain'],
    ),
    ...specSection('hull', 'Hull & mooring', 'The boat itself, and where it lives.', 'boat', [
      'hull',
      'mooring',
    ]),
    ...specSection('towing', 'Towing', 'What it pulls.', 'car', ['trailer']),
  ];

  return (
    <SettingsModal
      title={vehicle.displayName}
      description="Everything on record. Only what you change is saved."
      icon="car"
      onClose={onClose}
      sections={sections}
      footer={
        // Reversed on a phone: the buttons keep their place and the count sits under them,
        // rather than the count truncating to "No changes y…" beside them.
        <div className="mt-5 flex flex-col-reverse gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
          {save.isError && !errors ? (
            <p role="alert" className="min-w-0 truncate text-sm text-destructive">
              {(save.error as Error).message}
            </p>
          ) : errors ? (
            <p role="alert" className="min-w-0 truncate text-sm text-destructive">
              Some fields need a look.
            </p>
          ) : (
            /*
             * The count is the point: sections scroll and only one is on screen, so without it
             * a save is a leap of faith about what is in the other six.
             */
            <p className="min-w-0 truncate text-sm text-muted-foreground">
              {changed.length === 0 ? (
                'No changes yet.'
              ) : (
                <>
                  <span className="font-mono tabular-nums text-foreground">
                    {String(changed.length).padStart(2, '0')}
                  </span>{' '}
                  {changed.length === 1 ? 'change' : 'changes'} to save.
                </>
              )}
            </p>
          )}

          <div className="flex shrink-0 justify-end gap-2">
            <Button
              onClick={() => (changed.length > 0 ? setForm(initial) : onClose())}
              disabled={save.isPending}
            >
              {changed.length > 0 ? 'Discard' : 'Close'}
            </Button>
            <Button
              variant="primary"
              loading={save.isPending}
              disabled={changed.length === 0}
              onClick={() => save.mutate()}
            >
              Save changes
            </Button>
          </div>
        </div>
      }
    />
  );
}

/** Two columns at the shell's width; three squeezes a label like "Purchase price" onto two lines. */
function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{children}</div>;
}

/**
 * A spec section, rendered from the domain's own descriptors.
 *
 * `kind` decides the control, `unit` becomes the suffix, `max` becomes the input's bound — the
 * same numbers `validateSpecs` enforces server-side, so a value this form accepts is one the
 * API accepts.
 */
function SpecGrid({
  fields,
  form,
  onChange,
  errors,
}: {
  fields: readonly SpecField[];
  form: Record<string, string>;
  onChange: (key: string) => (value: string) => void;
  errors: Record<string, string> | undefined;
}) {
  if (fields.length === 0) return null;

  return (
    <Grid>
      {fields.map((field) => {
        const key = specKey(field.key);
        const error = errors?.[field.key] ?? errors?.[key];

        if (field.kind === 'select') {
          return (
            <SelectField
              key={field.key}
              label={field.label}
              value={form[key] ?? ''}
              onChange={onChange(key)}
              // An empty first option, because "not recorded" is a real answer and a select
              // without one silently asserts whichever option happens to be first.
              options={[
                { value: '', label: 'Not recorded' },
                ...(field.options ?? []).map((option) => ({
                  value: option,
                  label: humanise(option),
                })),
              ]}
            />
          );
        }

        const numeric = field.kind === 'number' || field.kind === 'integer';
        return (
          <Field
            key={field.key}
            label={field.label}
            value={form[key] ?? ''}
            onChange={(event) => onChange(key)(event.target.value)}
            type={numeric ? 'number' : 'text'}
            inputMode={field.kind === 'integer' ? 'numeric' : numeric ? 'decimal' : undefined}
            min={numeric ? 0 : undefined}
            max={field.max}
            step={field.kind === 'number' ? 'any' : undefined}
            maxLength={numeric ? undefined : 200}
            suffix={field.unit}
            error={error}
          />
        );
      })}
    </Grid>
  );
}

/** Specs share a namespace with the identity fields, so they are kept apart in form state. */
const specKey = (key: string) => `spec:${key}`;

const IDENTITY_KEYS = ['nickname', 'make', 'model', 'variant', 'year', 'color'] as const;

function countFilled(form: Record<string, string>, keys: readonly string[]): number {
  return keys.filter((key) => (form[key] ?? '') !== '').length;
}

/**
 * Which capability owns each spec key, so a section can ask for "everything about the engine"
 * without repeating the field list that `CAPABILITY_SPEC_FIELDS` already holds.
 */
const CAPABILITY_OF: Record<string, VehicleCapability> = Object.fromEntries(
  VEHICLE_CAPABILITIES.flatMap((capability) =>
    CAPABILITY_SPEC_FIELDS[capability].map((field) => [field.key, capability] as const),
  ),
);

function initialForm(vehicle: Vehicle): Record<string, string> {
  const currency = vehicle.purchasePrice?.currency ?? 'USD';
  const form: Record<string, string> = {
    nickname: vehicle.nickname ?? '',
    make: vehicle.make ?? '',
    model: vehicle.model ?? '',
    variant: vehicle.variant ?? '',
    year: vehicle.year?.toString() ?? '',
    color: vehicle.color ?? '',
    identificationNumber: vehicle.identificationNumber ?? '',
    registrationIdentifier: vehicle.registrationIdentifier ?? '',
    purchaseDate: vehicle.purchaseDate ?? '',
    purchasePrice: vehicle.purchasePrice
      ? String(fromMinorUnits(vehicle.purchasePrice.amountMinor, currency))
      : '',
    purchaseCurrency: currency,
    currentOdometer: vehicle.currentOdometer?.toString() ?? '',
    odometerUnit: vehicle.odometerUnit,
    currentEngineHours: vehicle.currentEngineHours?.toString() ?? '',
    status: vehicle.status,
  };

  for (const field of specFieldsFor(vehicle.vehicleType as VehicleType)) {
    const value = vehicle.specs[field.key];
    form[specKey(field.key)] = value === null || value === undefined ? '' : String(value);
  }
  return form;
}

/**
 * Only what actually changed.
 *
 * A PATCH echoing the whole form back would overwrite anything edited elsewhere between this
 * modal opening and the save — silently: someone corrects a colour and clobbers an odometer a
 * colleague had just fixed.
 */
function buildPatch(
  vehicle: Vehicle,
  form: Record<string, string>,
  initial: Record<string, string>,
): UpdateVehicle {
  const patch: Record<string, unknown> = {};
  const moved = (key: string) => (form[key] ?? '') !== (initial[key] ?? '');

  // An emptied text box means "clear this", so nullable fields send null rather than being omitted.
  for (const key of [
    'nickname',
    'make',
    'model',
    'variant',
    'color',
    'identificationNumber',
    'registrationIdentifier',
    'purchaseDate',
  ]) {
    if (moved(key)) patch[key] = form[key]!.trim() === '' ? null : form[key]!.trim();
  }

  if (moved('year')) patch.year = form.year!.trim() === '' ? null : Number(form.year);
  if (moved('status')) patch.status = form.status;
  if (moved('odometerUnit')) patch.odometerUnit = form.odometerUnit;

  /*
   * The odometer has no null in the contract, so an emptied box leaves the stored reading alone
   * rather than erasing it — a vehicle without one has not been read, not zeroed.
   */
  if (moved('currentOdometer') && form.currentOdometer!.trim() !== '') {
    patch.currentOdometer = Number(form.currentOdometer);
  }
  if (moved('currentEngineHours') && form.currentEngineHours!.trim() !== '') {
    patch.currentEngineHours = Number(form.currentEngineHours);
  }

  /*
   * Price and currency move together. An amount sent without the currency it was typed in would
   * be reinterpreted in whatever the row already held — the same number, a different amount of
   * money, and nothing on screen to show it changed.
   */
  if (moved('purchasePrice') || (form.purchasePrice!.trim() !== '' && moved('purchaseCurrency'))) {
    const price = form.purchasePrice!.trim();
    if (price === '') {
      patch.purchasePriceAmountMinor = null;
    } else {
      const currency = form.purchaseCurrency!.trim().toUpperCase();
      patch.purchasePriceAmountMinor = toMinorUnits(Number(price), currency);
      patch.purchasePriceCurrency = currency;
    }
  }

  // Specs are merged server-side, so only the touched keys travel; an emptied one clears itself.
  const specs: Record<string, string | number | null> = {};
  for (const field of specFieldsFor(vehicle.vehicleType as VehicleType)) {
    const key = specKey(field.key);
    if (!moved(key)) continue;

    const value = (form[key] ?? '').trim();
    if (value === '') {
      specs[field.key] = null;
    } else if (field.kind === 'number' || field.kind === 'integer') {
      specs[field.key] = Number(value);
    } else {
      specs[field.key] = value;
    }
  }
  if (Object.keys(specs).length > 0) patch.specs = specs;

  return patch as UpdateVehicle;
}
