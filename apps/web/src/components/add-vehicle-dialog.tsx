'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera, Check, ChevronDown, Globe, Plus, Sparkles, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import {
  DISTANCE_UNITS,
  VEHICLE_TYPES,
  isKnownCurrency,
  supports,
  validateSpecs,
  type DistanceUnit,
  type VehicleType,
} from '@vehicle-os/domain';
import type { LookUpVehicle, VehicleDraft, VinDecodeResult } from '@vehicle-os/contracts';
import { ApiError, uploadPhoto } from '@vehicle-os/api-client';
import { garagesQuery, queryKeys } from '@vehicle-os/api-client/react';
import {
  VEHICLE_MAKES,
  asVin,
  digitsOnly,
  domainForMake,
  dropExtra,
  extraChips,
  makeKindFor,
  makesForKind,
  paintSwatch,
  splitDraft,
  typeForMake,
  type VehicleAnswers,
  type VehicleExtras,
  type VehicleMake,
} from '@vehicle-os/ui';
import { api } from '@/lib/api';
import { toAttachment, useObjectUrl } from '@/lib/ai-files';
import { BrandLogo } from '@/components/brand-logo';
import { Icon } from '@/components/icons';
import { isImage, PHOTO_TYPES } from '@/components/onboard-uploads';
import { useProfile } from '@/components/settings-panel';
import { typeIcon } from '@/components/vehicle-hero';
import { FormError, Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/primitives';
import { Select } from '@/components/ui/select';
import { nextEnabled, placeList } from '@/components/ui/select-position';
import { raise } from '@/components/ui/toaster';
import { humanise, toMinorUnits } from '@/lib/format';
import { cn } from '@/lib/utils';

/** The contract's ceiling, checked here so a slipped digit is caught before the round trip. */
const MAX_ODOMETER = 100_000_000;
// Next year's models are on sale from the autumn; 1885 is the contract's floor.
const NEXT_YEAR = new Date().getFullYear() + 1;

/** `humanise` turns every enum into a word, which prints the acronyms as "Atv" and "Rv". */
const typeLabel = (type: VehicleType) => (type === 'ATV' || type === 'RV' ? type : humanise(type));

const TYPE_OPTIONS = VEHICLE_TYPES.map((type) => ({
  value: type,
  label: typeLabel(type),
  icon: <Icon name={typeIcon(type)} size={16} />,
}));

const EMPTY: VehicleAnswers = { name: '', make: '', model: '', year: '', plate: '', odometer: '' };

/** A `Select` worn as a chip, for the questions the card asks under the name. */
const CHIP_SELECT =
  'h-7 w-auto gap-1.5 rounded-full bg-muted px-2.5 text-xs font-semibold hover:bg-border [&_svg]:size-3.5';
/** Every control set into a cell: the cell draws the field, the control only the value. */
const CELL_INPUT =
  'relative z-10 h-8 w-full min-w-0 bg-transparent text-[0.9375rem] font-semibold text-foreground outline-none placeholder:font-normal placeholder:text-muted-foreground/60';

type Outcome =
  | { readonly from: 'vin'; readonly result: VinDecodeResult; readonly filled: number }
  | { readonly from: 'line'; readonly filled: number };

/** A file picker made on demand, so no hidden input sits in the dialog as its first field. */
function pickFiles(accept: string, onFiles: (files: File[]) => void) {
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.accept = accept;
  input.onchange = () => onFiles(Array.from(input.files ?? []));
  input.click();
}

/**
 * Adding a vehicle: five questions, or one sentence — the phone's screen, in a dialog.
 *
 * Top to bottom, as on the phone: the vehicle itself — its photo, its name, what it is and which
 * garage it goes into — then one line, then the five answers as one panel: make, model, year,
 * plate, odometer. The type follows the make (a Ducati is a motorcycle) until it is chosen.
 *
 * The line takes a description ("2019 911 Carrera S, white, 42k km, bought for $98k") and reads it
 * into the panel, or a VIN and decodes it. What either finds that the panel has no question for —
 * the VIN, the variant, the colour, the price paid, the factory specs looked up once the vehicle is
 * known — goes with the vehicle as chips that can be dropped. The form stays five questions long
 * and nothing read is lost; everything else is on the vehicle's own page. Nothing is written until
 * Add, and files wait here until the vehicle exists, since they are addressed by its id.
 */
export function AddVehicleDialog({
  onClose,
  defaultGarageId,
}: {
  onClose: () => void;
  /** Opened from inside a garage, the vehicle goes into that one. */
  defaultGarageId?: string;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const garages = useQuery(garagesQuery(api));
  const profile = useProfile();
  const id = useId();
  const lineRef = useRef<HTMLInputElement>(null);

  const [answers, setAnswers] = useState<VehicleAnswers>(EMPTY);
  const [chosenType, setChosenType] = useState<VehicleType | null>(null);
  const [chosenUnit, setChosenUnit] = useState<DistanceUnit | null>(null);
  const [extras, setExtras] = useState<VehicleExtras>({});
  // What the line or a VIN filled and no hand has touched since: marked ✦ until it is.
  const [marked, setMarked] = useState<ReadonlySet<string>>(new Set());
  const [line, setLine] = useState('');
  const [photos, setPhotos] = useState<File[]>([]);
  const [garageId, setGarageId] = useState(defaultGarageId ?? '');
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  // The modal puts the cursor in its first field, the name; the quickest way in is the line.
  useEffect(() => {
    const frame = requestAnimationFrame(() => lineRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);

  const vehicleType: VehicleType = chosenType ?? typeForMake(answers.make) ?? 'CAR';
  // The unit is the person's own until this vehicle is told otherwise.
  const unit: DistanceUnit = chosenUnit ?? profile.data?.distanceUnit ?? 'KM';

  const garageList = garages.data ?? [];
  /*
   * Only a lone garage chooses itself. With more, the vehicle goes where the person says: the
   * first in the list is an accident of sort order, and a car filed into the wrong garage is
   * shared with the wrong people.
   */
  const chosenGarage = garageId || (garageList.length === 1 ? garageList[0]!.id : '');
  const garage = garageList.find((candidate) => candidate.id === chosenGarage);
  const currency =
    extras.purchaseCurrency && isKnownCurrency(extras.purchaseCurrency)
      ? extras.purchaseCurrency
      : (garage?.defaultCurrency ?? 'USD');

  const unmark = (key: string) =>
    setMarked((now) => {
      if (!now.has(key)) return now;
      const next = new Set(now);
      next.delete(key);
      return next;
    });
  const set = (key: keyof VehicleAnswers, value: string) => {
    setAnswers((now) => ({ ...now, [key]: value }));
    unmark(key);
  };

  /*
   * The factory specs — the figures nobody types: oil, tank, tyres, gearbox — looked up once the
   * vehicle is identified. Into the extras, under anything already found.
   */
  const lookUp = useMutation({
    mutationFn: (vehicle: LookUpVehicle) => api.ai.lookUpVehicle(vehicle),
    meta: { toast: false },
    onSuccess: (result) => {
      if (Object.keys(result.specs).length === 0) return;
      setExtras((now) => ({ ...now, specs: { ...result.specs, ...now.specs } }));
    },
  });

  const vin = asVin(line);
  const read = useMutation({
    mutationFn: async (): Promise<
      { from: 'vin'; result: VinDecodeResult } | { from: 'line'; draft: VehicleDraft }
    > => {
      if (vin) return { from: 'vin', result: await api.vehicles.decodeVin(vin) };
      // A photo still names the make, the model and the colour.
      const attachments = (await Promise.all(photos.slice(0, 4).map(toAttachment))).filter(
        (attachment) => attachment !== null,
      );
      return {
        from: 'line',
        draft: await api.ai.draftVehicle({
          text: line.trim() || 'Read the attached photos.',
          ...(attachments.length ? { attachments } : {}),
        }),
      };
    },
    meta: { toast: false },
    onSuccess: (outcome) => {
      if (outcome.from === 'vin') return applyVin(outcome.result);
      const { answers: said, type, unit: saidUnit, extras: found } = splitDraft(outcome.draft);
      // The line is the person's own words, so what it says replaces what was there.
      const next = { ...answers, ...said };
      setAnswers(next);
      if (type) setChosenType(type as VehicleType);
      if (saidUnit) setChosenUnit(saidUnit as DistanceUnit);
      setExtras((now) => ({ ...now, ...found }));
      setMarked(new Set([...marked, ...Object.keys(said), ...(type ? ['type'] : [])]));
      setOutcome({ from: 'line', filled: Object.keys(said).length + (type ? 1 : 0) });
      const kind = (type as VehicleType | null) ?? vehicleType;
      if (next.make && next.model) {
        lookUp.mutate({
          vehicleType: kind,
          make: next.make,
          model: next.model,
          ...(found.variant ? { variant: found.variant } : {}),
          ...(next.year ? { year: Number(next.year) } : {}),
        });
      }
    },
  });

  /*
   * A decode fills only what is still empty: the person may have typed a model the VIN database
   * spells differently, and silently replacing what someone wrote is the one thing a suggestion
   * must never do.
   */
  function applyVin(result: VinDecodeResult) {
    const filled: string[] = [];
    const fill = (key: keyof VehicleAnswers, value: string | number | null) => {
      if (value === null || answers[key].trim()) return;
      filled.push(key);
      setAnswers((now) => ({ ...now, [key]: String(value) }));
    };
    if (result.decoded) {
      fill('make', result.make);
      fill('model', result.model);
      fill('year', result.year);
    }
    setExtras((now) => ({
      ...now,
      vin: result.vin,
      ...(result.variant && !now.variant ? { variant: result.variant } : {}),
      ...(Object.keys(result.specs).length ? { specs: { ...result.specs, ...now.specs } } : {}),
    }));
    setMarked(new Set([...marked, ...filled]));
    setOutcome({ from: 'vin', result, filled: filled.length });
    setLine('');
  }

  const reading = answers.odometer ? Number(answers.odometer) : null;
  const odometerTooHigh = reading !== null && reading > MAX_ODOMETER;
  const yearOff =
    answers.year.length === 4 && (Number(answers.year) < 1885 || Number(answers.year) > NEXT_YEAR);

  const create = useMutation({
    mutationFn: async () => {
      const text = (value: string | undefined) => value?.trim() || undefined;
      // Only what this type has fields for and inside their bounds: a figure a look-up got wrong
      // is left behind rather than refusing the whole vehicle.
      const specs = validateSpecs(vehicleType, extras.specs ?? {}).specs as Record<
        string,
        string | number
      >;
      const vehicle = await api.vehicles.create({
        garageId: chosenGarage,
        vehicleType,
        nickname: text(answers.name),
        make: text(answers.make),
        model: text(answers.model),
        year: answers.year.length === 4 ? Number(answers.year) : undefined,
        registrationIdentifier: text(answers.plate),
        ...(reading !== null ? { currentOdometer: reading, odometerUnit: unit } : {}),
        identificationNumber: extras.vin,
        variant: text(extras.variant),
        color: text(extras.color),
        purchaseDate: extras.purchaseDate,
        ...(extras.purchasePrice
          ? {
              purchasePriceAmountMinor: toMinorUnits(extras.purchasePrice, currency),
              purchasePriceCurrency: currency,
            }
          : {}),
        ...(extras.engineHours && supports(vehicleType, 'engineHours')
          ? { currentEngineHours: extras.engineHours }
          : {}),
        ...(Object.keys(specs).length ? { specs } : {}),
      });
      /*
       * One at a time, as the gallery does; the first is the cover. A photo that fails does not
       * fail the add: the vehicle exists by now, and pressing Add again would create it twice.
       */
      let failed = 0;
      for (const file of photos) {
        try {
          await uploadPhoto(api, vehicle.id, file);
        } catch {
          failed += 1;
        }
      }
      return { vehicle, failed };
    },
    meta: { toast: 'Vehicle added' },
    onSuccess: ({ vehicle, failed }) => {
      if (failed) {
        raise(
          'error',
          `${failed} ${failed === 1 ? 'photo' : 'photos'} did not upload. Add from the vehicle.`,
        );
      }
      void queryClient.invalidateQueries({ queryKey: ['vehicles'] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.garages() });
      onClose();
      router.push(`/vehicles/${vehicle.id}`);
    },
  });

  const fieldErrors = create.error instanceof ApiError ? create.error.fields : undefined;
  const formError = create.error
    ? fieldErrors
      ? (fieldErrors.garageId ?? Object.values(fieldErrors)[0])
      : create.error.message
    : undefined;

  const derived = [answers.year, answers.make.trim(), answers.model.trim()]
    .filter(Boolean)
    .join(' ');
  const ready = chosenGarage !== '' && !odometerTooHigh && !yearOff;
  const canRead = vin !== null || line.trim().length >= 3 || photos.length > 0;
  const chips = extraChips(extras);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (ready && !create.isPending) create.mutate();
  };

  const pickMake = (option: VehicleMake) => set('make', option.name);
  const takePhotos = (files: File[]) => {
    const images = files.filter(isImage);
    if (images.length) setPhotos((now) => [...now, ...images]);
  };

  return (
    <Modal
      title="Add a vehicle"
      onClose={onClose}
      header={(titleId) => (
        <div className="flex min-w-0 items-center gap-3.5">
          <PhotoBadge
            photos={photos}
            onPick={() => pickFiles(PHOTO_TYPES, takePhotos)}
            onDrop={takePhotos}
            onRemove={() => setPhotos([])}
            make={answers.make}
            vehicleType={vehicleType}
          />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <h2 id={titleId} className="sr-only">
              Add a vehicle
            </h2>
            {/*
             * Its name, typed onto the card. Left empty it goes by its year, make and model —
             * which is what the empty field shows, so the default is never a surprise.
             */}
            <input
              form={`${id}-form`}
              aria-label="Name"
              title="Name it, or it goes by its year, make and model"
              value={answers.name}
              onChange={(event) => set('name', event.target.value)}
              placeholder={derived || 'New vehicle'}
              maxLength={120}
              autoComplete="off"
              spellCheck={false}
              className={cn(
                '-ml-1.5 h-9 w-full min-w-0 truncate rounded-lg bg-transparent px-1.5 text-xl font-semibold tracking-tight text-foreground outline-none transition-colors hover:bg-muted/60 focus-visible:bg-muted/60',
                derived ? 'placeholder:text-foreground/55' : 'placeholder:text-muted-foreground',
              )}
            />
            <div className="flex flex-wrap items-center gap-1.5">
              <Select
                value={vehicleType}
                onValueChange={(next) => {
                  setChosenType(next as VehicleType);
                  unmark('type');
                }}
                options={TYPE_OPTIONS}
                ariaLabel={`Type${marked.has('type') ? ', read from the line' : ''}`}
                className="shrink-0"
                triggerClassName={CHIP_SELECT}
              />
              {garageList.length > 1 ? (
                <Select
                  value={chosenGarage}
                  onValueChange={setGarageId}
                  options={garageList.map((option) => ({
                    value: option.id,
                    label: option.name,
                    icon: <Icon name="garage" size={16} />,
                  }))}
                  ariaLabel="Garage"
                  placeholder="Which garage?"
                  className="min-w-0"
                  triggerClassName={cn(
                    CHIP_SELECT,
                    !chosenGarage &&
                      'bg-primary-soft text-foreground ring-1 ring-inset ring-primary',
                  )}
                />
              ) : null}
            </div>
          </div>
        </div>
      )}
    >
      <form id={`${id}-form`} onSubmit={submit} className="-mt-1 flex flex-col gap-4">
        {/*
         * The line: a description to read, or a VIN to decode — the button says which. Enter here
         * reads; Enter anywhere else adds.
         */}
        <div className="flex flex-col gap-2">
          <div
            aria-busy={read.isPending || undefined}
            className="flex h-12 items-center gap-3 rounded-2xl bg-muted/60 pl-4 pr-1.5 transition-colors hover:bg-muted focus-within:bg-muted has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
          >
            <Sparkles
              aria-hidden="true"
              className={cn(
                'size-4 shrink-0 transition-colors',
                line.trim() || read.isPending ? 'text-foreground' : 'text-muted-foreground',
                read.isPending && 'animate-pulse',
              )}
            />
            <input
              ref={lineRef}
              aria-label="Describe the vehicle, or paste its VIN"
              aria-describedby={`${id}-status`}
              value={line}
              onChange={(event) => {
                setLine(event.target.value);
                if (read.isError) read.reset();
              }}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                if (canRead && !read.isPending) read.mutate();
              }}
              placeholder="2019 911 Carrera S, white, 42k km — or the VIN"
              autoComplete="off"
              spellCheck={false}
              maxLength={1000}
              className="h-full min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
            />
            {canRead ? (
              <Button
                size="sm"
                variant="primary"
                className="shrink-0 animate-pop"
                loading={read.isPending}
                onClick={() => read.mutate()}
              >
                {vin ? 'Decode' : 'Fill'}
              </Button>
            ) : null}
          </div>

          <p
            id={`${id}-status`}
            role="status"
            // Empty, it gives back the gap above it, so the panel sits under the line at rest.
            className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-xs text-muted-foreground empty:-mt-2"
          >
            <LineStatus read={read} outcome={outcome} vin={vin !== null} />
            {lookUp.isPending ? (
              <span className="flex items-center gap-1">
                <Globe aria-hidden="true" className="size-3 animate-pulse" />
                <span className="text-shimmer">Looking up its specs…</span>
              </span>
            ) : null}
          </p>

          {chips.length ? (
            <ul aria-label="Found besides" className="flex flex-wrap gap-1.5">
              {chips.map((chip) => (
                <li key={chip.key} className="animate-pop">
                  <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-muted pl-2.5 pr-1 text-xs font-semibold text-foreground">
                    {chip.key === 'specs' ? (
                      <Globe aria-hidden="true" className="size-3 text-muted-foreground" />
                    ) : chip.key === 'color' && paintSwatch(extras.color ?? null) ? (
                      <span
                        aria-hidden="true"
                        className="size-2.5 rounded-full ring-1 ring-foreground/20"
                        style={{ backgroundColor: paintSwatch(extras.color ?? null)! }}
                      />
                    ) : (
                      <Sparkles aria-hidden="true" className="size-3 text-muted-foreground" />
                    )}
                    <span className={cn(chip.key === 'vin' && 'font-mono tracking-wide')}>
                      {chip.label}
                    </span>
                    <button
                      type="button"
                      aria-label={`Leave out ${chip.label}`}
                      onClick={() => setExtras((now) => dropExtra(now, chip.key))}
                      className="grid size-5 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-border hover:text-foreground"
                    >
                      <X className="size-3" aria-hidden="true" />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        {/* The five answers, as one panel: what it is, then the plate and the reading on it. */}
        <div className="grid grid-cols-6 gap-px overflow-hidden rounded-2xl bg-border ring-1 ring-border">
          <Cell
            label="Make"
            htmlFor={`${id}-make`}
            marked={marked.has('make')}
            error={fieldErrors?.make}
            className="col-span-6 sm:col-span-3"
          >
            <MakeCombo
              id={`${id}-make`}
              value={answers.make}
              onChange={(next) => set('make', next)}
              onPick={pickMake}
              narrowTo={chosenType}
            />
          </Cell>
          <Cell
            label="Model"
            htmlFor={`${id}-model`}
            marked={marked.has('model')}
            error={fieldErrors?.model}
            className="col-span-4 sm:col-span-2"
          >
            <input
              id={`${id}-model`}
              value={answers.model}
              onChange={(event) => set('model', event.target.value)}
              placeholder="MX-5"
              autoComplete="off"
              maxLength={120}
              className={CELL_INPUT}
            />
          </Cell>
          <Cell
            label="Year"
            htmlFor={`${id}-year`}
            marked={marked.has('year')}
            error={yearOff ? `1885 to ${NEXT_YEAR}` : fieldErrors?.year}
            className="col-span-2 sm:col-span-1"
          >
            <input
              id={`${id}-year`}
              size={1}
              inputMode="numeric"
              autoComplete="off"
              placeholder={String(NEXT_YEAR - 1)}
              value={answers.year}
              onChange={(event) => set('year', digitsOnly(event.target.value, 4))}
              aria-invalid={yearOff || undefined}
              className={cn(CELL_INPUT, 'font-mono tabular-nums')}
            />
          </Cell>

          {/* `registrationIdentifier`, asked for by the name people use and drawn as a plate. */}
          <Cell
            label="Plate"
            htmlFor={`${id}-plate`}
            marked={marked.has('plate')}
            error={fieldErrors?.registrationIdentifier}
            className="col-span-6 sm:col-span-3"
          >
            <span className="flex h-8 min-w-0 flex-1 items-stretch overflow-hidden rounded-md bg-card ring-1 ring-inset ring-foreground/20">
              <span aria-hidden="true" className="w-1.5 shrink-0 bg-primary" />
              <input
                id={`${id}-plate`}
                value={answers.plate}
                onChange={(event) => set('plate', event.target.value.toUpperCase())}
                placeholder="AB12 CDE"
                autoComplete="off"
                spellCheck={false}
                maxLength={32}
                className="relative z-10 min-w-0 flex-1 bg-transparent px-2 font-mono text-sm font-semibold uppercase tracking-[0.16em] text-foreground outline-none placeholder:text-muted-foreground/60"
              />
            </span>
          </Cell>
          <Cell
            label="Odometer"
            htmlFor={`${id}-odometer`}
            marked={marked.has('odometer')}
            error={
              odometerTooHigh
                ? `Past ${MAX_ODOMETER.toLocaleString()}`
                : (fieldErrors?.currentOdometer ?? fieldErrors?.odometerUnit)
            }
            className="col-span-6 sm:col-span-3"
          >
            {/*
             * Text with a numeric keyboard rather than `type="number"`, so the reading carries its
             * separators: 42150 is a number, 42,150 is a distance.
             */}
            <input
              id={`${id}-odometer`}
              size={1}
              inputMode="numeric"
              autoComplete="off"
              placeholder="Optional"
              value={reading !== null ? reading.toLocaleString() : ''}
              // ponytail: formatting moves the caret to the end on a mid-string edit.
              onChange={(event) => set('odometer', digitsOnly(event.target.value, 10))}
              aria-invalid={odometerTooHigh || undefined}
              className={cn(CELL_INPUT, 'font-mono tabular-nums')}
            />
            {/*
             * The unit is asked, not assumed: a vehicle recorded in the wrong one is wrong at the
             * one moment it cannot be recovered, and every figure after it is out by 1.6.
             */}
            <div
              role="group"
              aria-label="Unit"
              className="relative z-10 flex shrink-0 rounded-full bg-card p-0.5"
            >
              {DISTANCE_UNITS.map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={unit === option}
                  aria-label={option === 'MI' ? 'Miles' : 'Kilometres'}
                  onClick={() => setChosenUnit(option)}
                  className={cn(
                    'h-6 rounded-full px-2 text-xs font-semibold transition-colors duration-200',
                    unit === option
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {option === 'MI' ? 'mi' : 'km'}
                </button>
              ))}
            </div>
          </Cell>
        </div>

        {formError ? <FormError>{formError}</FormError> : null}

        {/* The button reads the type back: what the make or the line decided is the last look. */}
        <div className="flex items-center justify-end gap-2 pt-1">
          <Button
            variant="ghost"
            onClick={onClose}
            disabled={create.isPending}
            className="max-sm:hidden"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            loading={create.isPending}
            disabled={!ready}
            className="max-sm:w-full"
          >
            Add {vehicleType === 'OTHER' ? 'vehicle' : typeLabel(vehicleType).toLowerCase()}
            <kbd
              aria-hidden="true"
              className="hidden rounded-md bg-primary-foreground/15 px-1.5 font-mono text-xs sm:inline"
            >
              ↵
            </kbd>
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** What the line did, in words under it. */
function LineStatus({
  read,
  outcome,
  vin,
}: {
  read: { isPending: boolean; isError: boolean; error: Error | null };
  outcome: Outcome | null;
  vin: boolean;
}) {
  if (read.isPending) {
    return <span className="text-shimmer">{vin ? 'Decoding the VIN…' : 'Reading…'}</span>;
  }
  if (read.isError) {
    const unavailable = read.error instanceof ApiError && read.error.status === 503;
    return (
      <span className="text-destructive">
        {unavailable
          ? 'GarajAI is not on here. Paste a VIN, or fill it in below.'
          : (read.error?.message ?? 'That could not be read.')}
      </span>
    );
  }
  if (!outcome) return null;
  if (outcome.from === 'vin' && !outcome.result.decoded) {
    return <span>Not in the VIN database — usually a VIN from outside the US. Kept with it.</span>;
  }
  if (outcome.filled === 0) {
    return (
      <span>
        {outcome.from === 'vin'
          ? 'Decoded; the answers already there were kept.'
          : 'Nothing to fill from that. Try a make, model and year.'}
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1">
      <Sparkles aria-hidden="true" className="size-3 text-foreground" />
      <span className="font-mono tabular-nums text-foreground">{outcome.filled}</span>
      {outcome.from === 'vin' ? 'from the VIN' : 'read'} · check before adding
    </span>
  );
}

/**
 * One cell of the panel: an eyebrow over its control, the whole cell the target. The label's
 * overlay catches a press anywhere on the cell and hands it to the control; the controls sit above
 * that overlay (`relative z-10`), so a press on one is still its own.
 */
function Cell({
  label,
  htmlFor,
  marked,
  error,
  className,
  children,
}: {
  label: string;
  htmlFor: string;
  /** Filled by the line or a VIN, and untouched since. */
  marked: boolean;
  error?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        // Opaque in every state: the hairlines between cells are the panel showing through the gaps.
        'relative flex min-w-0 flex-col justify-center gap-0.5 bg-card px-3.5 py-2.5 transition-colors has-[:focus-visible]:bg-muted',
        error && 'ring-2 ring-inset ring-destructive/70',
        className,
      )}
    >
      <label
        htmlFor={htmlFor}
        className="flex min-w-0 items-center gap-1.5 text-label uppercase text-muted-foreground after:absolute after:inset-0"
      >
        <span className="truncate">{label}</span>
        {marked ? (
          <>
            <Sparkles aria-hidden="true" className="size-3 shrink-0 animate-pop text-foreground" />
            <span className="sr-only">, filled for you</span>
          </>
        ) : null}
      </label>
      <div className="flex min-w-0 items-center gap-2">{children}</div>
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The vehicle's portrait, top left: the cover photo once there is one, else the make's logo, else
 * the type. Press it or drop photos on it; the badge counts them.
 */
function PhotoBadge({
  photos,
  onPick,
  onDrop,
  onRemove,
  make,
  vehicleType,
}: {
  photos: File[];
  onPick: () => void;
  onDrop: (files: File[]) => void;
  onRemove: () => void;
  make: string;
  vehicleType: VehicleType;
}) {
  const [over, setOver] = useState(false);
  const cover = useObjectUrl(photos[0] ?? null);
  // Keyed by what is shown, so each change — type, logo, photo — pops in rather than swapping.
  const face =
    cover ?? (make.trim() ? (domainForMake(make) ?? make.trim()[0]!.toLowerCase()) : vehicleType);

  return (
    <div className="group/badge relative shrink-0">
      <button
        type="button"
        aria-label={photos.length ? `Add photos, ${photos.length} chosen` : 'Add photos'}
        onClick={onPick}
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setOver(false);
          onDrop(Array.from(event.dataTransfer.files));
        }}
        className={cn(
          // Children ignore the pointer, or crossing one fires `dragleave` mid-drag.
          'grid size-16 place-items-center rounded-2xl bg-muted text-muted-foreground transition-[background-color,scale] duration-200 hover:bg-border active:scale-[0.96] [&>*]:pointer-events-none',
          over && 'scale-105 bg-primary-soft ring-2 ring-inset ring-primary',
        )}
      >
        <span
          key={face}
          className="grid size-full animate-pop place-items-center overflow-hidden rounded-2xl"
        >
          {cover ? (
            <img src={cover} alt="" className="size-full object-cover" />
          ) : make.trim() ? (
            <BrandLogo make={make} size={34} />
          ) : (
            <Icon name={typeIcon(vehicleType)} size={28} />
          )}
        </span>
        <span
          aria-hidden="true"
          className="absolute -bottom-1.5 -right-1.5 grid h-6 min-w-6 place-items-center rounded-full bg-primary px-1 font-mono text-[0.6875rem] font-semibold tabular-nums text-primary-foreground ring-[3px] ring-card transition-transform duration-200 group-hover/badge:scale-110"
        >
          {photos.length > 1 ? (
            photos.length
          ) : photos.length ? (
            <Camera className="size-3" strokeWidth={2.5} />
          ) : (
            <Plus className="size-3.5" strokeWidth={3} />
          )}
        </span>
      </button>
      {photos.length ? (
        <button
          type="button"
          aria-label="Remove the photos"
          onClick={onRemove}
          className="absolute -left-1.5 -top-1.5 grid size-5 place-items-center rounded-full bg-popover text-foreground opacity-0 shadow-float transition-opacity focus-visible:opacity-100 group-hover/badge:opacity-100 [@media(hover:none)]:opacity-100"
        >
          <X className="size-3" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

/**
 * The make: type anything, or pick from the list. The list is a shortcut, not the set of valid
 * answers — a manufacturer it lacks is recorded as typed.
 *
 * A text input with a native popover listbox, for the same reasons as `Select`: the top layer sits
 * above the dialog, and light dismiss and Escape come free (Escape closes the list, not the
 * dialog). Focus stays in the input; `aria-activedescendant` names the active option.
 */
function MakeCombo({
  id,
  value,
  onChange,
  onPick,
  narrowTo,
}: {
  id: string;
  value: string;
  onChange: (make: string) => void;
  onPick: (make: VehicleMake) => void;
  /** A type chosen by hand; until then every make is offered, since the make answers the type. */
  narrowTo: VehicleType | null;
}) {
  const listId = `${id}-list`;
  const rowRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  // What has been typed since the list opened. Null while browsing, so reopening on a chosen make
  // shows every make rather than only that one.
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(-1);

  // Narrowed by a chosen type — a motorcycle owner should not scroll past the cars.
  const pool = narrowTo ? makesForKind(makeKindFor(narrowTo)) : VEHICLE_MAKES;
  const typed = (query ?? '').trim().toLowerCase();
  // Exact, then prefix, then anywhere in the name — so Enter on "mini" is MINI, not Dominion.
  const rank = (name: string) => {
    const lower = name.toLowerCase();
    return lower === typed ? 0 : lower.startsWith(typed) ? 1 : 2;
  };
  const options = typed
    ? pool
        .filter((option) => option.name.toLowerCase().includes(typed))
        .toSorted((a, b) => rank(a.name) - rank(b.name))
    : pool;
  const showing = open && options.length > 0;

  useLayoutEffect(() => {
    const list = listRef.current;
    const row = rowRef.current;
    if (!list || !row) return;
    if (!showing) {
      if (list.matches(':popover-open')) list.hidePopover();
      return;
    }
    if (!list.matches(':popover-open')) list.showPopover();

    const place = () => {
      const rect = row.getBoundingClientRect();
      list.style.minWidth = `${rect.width}px`;
      const spot = placeList(
        rect,
        { height: list.scrollHeight, width: list.offsetWidth },
        { width: window.innerWidth, height: window.innerHeight },
      );
      list.style.top = `${spot.top}px`;
      list.style.left = `${spot.left}px`;
      list.style.maxHeight = `${spot.maxHeight}px`;
      list.style.transformOrigin = spot.up ? 'bottom' : 'top';
    };
    const onScroll = (event: Event) => {
      if (!list.contains(event.target as Node)) place();
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [showing, options.length]);

  // A light dismiss closes the popover natively; this keeps `open` true to that.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const onToggle = (event: Event) => {
      if ((event as ToggleEvent).newState === 'closed') setOpen(false);
    };
    list.addEventListener('toggle', onToggle);
    return () => list.removeEventListener('toggle', onToggle);
  }, []);

  useLayoutEffect(() => {
    if (showing && active >= 0) {
      document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: 'nearest' });
    }
  }, [showing, active, listId]);

  const choose = (option: VehicleMake) => {
    onPick(option);
    setQuery(null);
    setOpen(false);
  };

  return (
    <div ref={rowRef} className="flex min-w-0 flex-1 items-center gap-2">
      <span className="grid size-6 shrink-0 place-items-center text-muted-foreground">
        {value.trim() ? <BrandLogo make={value} size={20} /> : <Icon name="search" size={16} />}
      </span>
      <input
        id={id}
        role="combobox"
        aria-expanded={showing}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showing && active >= 0 ? `${listId}-${active}` : undefined}
        value={value}
        placeholder="Search or type"
        autoComplete="off"
        spellCheck={false}
        maxLength={120}
        onChange={(event) => {
          onChange(event.target.value);
          setQuery(event.target.value);
          // Typing puts the best match under Enter.
          setActive(event.target.value.trim() ? 0 : -1);
          setOpen(true);
        }}
        onClick={() => {
          if (open) return;
          setActive(options.findIndex((option) => option.name === value));
          setOpen(true);
        }}
        onBlur={() => {
          setOpen(false);
          setQuery(null);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setOpen(true);
            setActive((current) =>
              nextEnabled(
                options.map(() => false),
                current,
                event.key === 'ArrowDown' ? 1 : -1,
              ),
            );
          } else if (event.key === 'Enter' && showing && options[active]) {
            // Picks the make; the next Enter adds the vehicle.
            event.preventDefault();
            choose(options[active]);
          }
        }}
        className={CELL_INPUT}
      />
      <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />

      {/* No display utility: the browser hides a closed popover with `display: none`. */}
      <div
        ref={listRef}
        id={listId}
        role="listbox"
        popover="auto"
        aria-label="Makes"
        // Keeps focus in the input while an option is pressed.
        onMouseDown={(event) => event.preventDefault()}
        className="scrollbar-slim m-0 max-w-[min(24rem,calc(100vw-1rem))] animate-pop overflow-y-auto overscroll-contain rounded-xl border-0 bg-popover p-1 text-foreground shadow-float [inset:auto]"
      >
        {/* Only while open: each option fetches its logo. */}
        {showing
          ? options.map((option, index) => {
              const selected = option.name === value;
              return (
                <div
                  key={option.name}
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={selected}
                  onPointerMove={() => {
                    if (index !== active) setActive(index);
                  }}
                  onClick={() => choose(option)}
                  className={cn(
                    'flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm transition-colors',
                    index === active ? 'bg-muted text-foreground' : 'text-muted-foreground',
                    selected && 'font-semibold text-foreground',
                  )}
                >
                  <span className="grid size-7 shrink-0 place-items-center overflow-hidden rounded-full bg-card">
                    <BrandLogo make={option.name} size={18} />
                  </span>
                  <span className="min-w-0 flex-1 truncate">{option.name}</span>
                  {selected ? <Check aria-hidden="true" className="size-4 shrink-0" /> : null}
                </div>
              );
            })
          : null}
      </div>
    </div>
  );
}
