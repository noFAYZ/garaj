'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera, Check, ChevronDown, FileText, Globe, Plus, Sparkles, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import {
  DISTANCE_UNITS,
  DOCUMENT_TYPES,
  VEHICLE_TYPES,
  specFieldsFor,
  supports,
  type DistanceUnit,
  type DocumentType,
  type SpecField,
  type VehicleType,
} from '@vehicle-os/domain';
import type { LookUpVehicle, VehicleDraft } from '@vehicle-os/contracts';
import { ApiError, uploadDocument, uploadPhoto } from '@vehicle-os/api-client';
import { garagesQuery, queryKeys } from '@vehicle-os/api-client/react';
import {
  VEHICLE_MAKES,
  domainForMake,
  makesForKind,
  type MakeKind,
  type VehicleMake,
} from '@vehicle-os/ui';
import { api } from '@/lib/api';
import { DatePicker } from '@/components/ui/date-picker';
import { toAttachment, useObjectUrl } from '@/lib/ai-files';
import { BrandLogo } from '@/components/brand-logo';
import { Icon } from '@/components/icons';
import { DropTile, isImage, PHOTO_TYPES } from '@/components/onboard-uploads';
import { typeIcon } from '@/components/vehicle-hero';
import { FormError, Modal, MODAL_BAR } from '@/components/ui/modal';
import { Button } from '@/components/ui/primitives';
import { Select } from '@/components/ui/select';
import { nextEnabled, placeList } from '@/components/ui/select-position';
import { raise } from '@/components/ui/toaster';
import { humanise, toMinorUnits } from '@/lib/format';
import { cn } from '@/lib/utils';

/** The contract's ceiling, checked here so a slipped digit is caught before the round trip. */
const MAX_ODOMETER = 100_000_000;

/** `humanise` turns every enum into a word, which prints the acronyms as "Atv" and "Rv". */
const typeLabel = (type: VehicleType) => (type === 'ATV' || type === 'RV' ? type : humanise(type));
/** The same for spec options: FWD, DCT and LPG stay capitals. */
const optionLabel = (option: string) => (option.length <= 3 ? option : humanise(option));
const pad = (count: number) => String(count).padStart(2, '0');

const TYPE_OPTIONS = VEHICLE_TYPES.map((type) => ({
  value: type,
  label: typeLabel(type),
  icon: <Icon name={typeIcon(type)} size={18} />,
}));

// Next year's models are on sale from the autumn; 1885 is the contract's floor.
const NEXT_YEAR = new Date().getFullYear() + 1;
const YEAR_OPTIONS = Array.from({ length: NEXT_YEAR - 1885 + 1 }, (_, index) => {
  const year = String(NEXT_YEAR - index);
  return { value: year, label: year };
});

const DOCUMENT_OPTIONS = DOCUMENT_TYPES.map((type) => ({ value: type, label: humanise(type) }));

/** A make that builds only one kind of thing answers the type as well. */
const TYPE_FOR_KIND: Partial<Record<MakeKind, VehicleType>> = { car: 'CAR', moto: 'MOTORCYCLE' };

// Shared by every control set into a tile: the tile draws the field, the control only the value.
const CELL_INPUT =
  'relative z-10 h-7 w-full min-w-0 bg-transparent text-sm font-semibold text-foreground outline-none placeholder:font-normal placeholder:text-muted-foreground';
const CELL_TRIGGER =
  'h-7 bg-transparent px-0 text-sm font-semibold hover:bg-transparent aria-expanded:bg-transparent focus-visible:outline-none';
const GRID = 'grid grid-cols-6 gap-1.5';

/** Every field is a string in the form, specs under `spec:` so they cannot shadow one. */
type Form = Record<string, string>;
const spec = (key: string) => `spec:${key}`;

/** Where a value came from when no hand put it there: the line, or a look-up. */
type Mark = { by: 'line' | 'web'; wave: number };

const digits = (value: string, max = 10) =>
  value
    .replace(/\D/g, '')
    .replace(/^0+(?=\d)/, '')
    .slice(0, max);
/** Digits and one point, two decimals at most — what an amount can be typed as. */
const decimal = (value: string) => {
  const [whole = '', ...rest] = value.replace(/[^\d.]/g, '').split('.');
  const cleaned = whole.replace(/^0+(?=\d)/, '').slice(0, 12);
  return rest.length ? `${cleaned}.${rest.join('').slice(0, 2)}` : cleaned;
};
const grouped = (value: string | undefined) => (value ? Number(value).toLocaleString() : '');

/** A draft's fields under the form's own keys. */
function draftToForm(draft: VehicleDraft): Form {
  const form: Form = {};
  const put = (key: string, value: string | number | undefined) => {
    if (value !== undefined && value !== '') form[key] = String(value);
  };
  put('make', draft.make);
  put('model', draft.model);
  put('variant', draft.variant);
  put('year', draft.year);
  put('nickname', draft.nickname);
  put('color', draft.color);
  put('vin', draft.identificationNumber);
  put('plate', draft.registrationIdentifier);
  put('purchaseDate', draft.purchaseDate);
  put('purchasePrice', draft.purchasePrice);
  put('purchaseCurrency', draft.purchaseCurrency);
  put('odometer', draft.currentOdometer);
  put('odometerUnit', draft.odometerUnit);
  put('engineHours', draft.currentEngineHours);
  for (const [key, value] of Object.entries(draft.specs)) put(spec(key), value);
  return form;
}

/** Enough to look the specs up: what it is, who built it and which model. */
function identity(form: Form, type: VehicleType | null): LookUpVehicle | null {
  const make = form.make?.trim();
  const model = form.model?.trim();
  if (!type || !make || !model) return null;
  return {
    vehicleType: type,
    make,
    model,
    ...(form.variant?.trim() ? { variant: form.variant.trim() } : {}),
    ...(form.year ? { year: Number(form.year) } : {}),
  };
}

/**
 * What a paper probably is, from its name, so a registration card is not filed as "Other".
 * ponytail: keywords on the filename; the AI read of the paper is the upgrade if this misfiles.
 */
const PAPER_HINTS: [RegExp, DocumentType][] = [
  [/regist|logbook|v5|title/i, 'REGISTRATION'],
  [/insur|policy/i, 'INSURANCE'],
  [/purchase|sale|bill.of/i, 'PURCHASE_AGREEMENT'],
  [/service/i, 'SERVICE_INVOICE'],
  [/repair/i, 'REPAIR_INVOICE'],
  [/inspect|mot\b/i, 'INSPECTION_REPORT'],
  [/warrant/i, 'WARRANTY'],
  [/manual/i, 'MANUAL'],
  [/receipt|invoice/i, 'RECEIPT'],
];
const paperType = (name: string) =>
  PAPER_HINTS.find(([pattern]) => pattern.test(name))?.[1] ?? 'OTHER';

/** A file picker made on demand, so no hidden input sits in the dialog as its first field. */
function pickFiles(accept: string | undefined, onFiles: (files: File[]) => void) {
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  if (accept) input.accept = accept;
  input.onchange = () => onFiles(Array.from(input.files ?? []));
  input.click();
}

/**
 * Adding a vehicle, on one sheet — or in one sentence.
 *
 * The line at the top is read into the sheet ("2019 911 Carrera S, white, 42k km, bought for
 * $98k"), and once the vehicle is identified its factory specs are looked up — the figures
 * nobody types: oil grade and capacity, tank, tyre sizes, gearbox. What the line read carries ✦,
 * what was looked up 🌐, until a hand touches it; a look-up never overwrites a value already
 * there. Nothing is written until Add: the sheet is the review.
 *
 * The header assembles the vehicle as it is described. Files wait here and go up once the
 * vehicle exists, since they are addressed by its id.
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
  const id = useId();

  const [vehicleType, setVehicleType] = useState<VehicleType | null>(null);
  const [form, setForm] = useState<Form>({ odometerUnit: 'KM' });
  const [marks, setMarks] = useState<Record<string, Mark>>({});
  const [wave, setWave] = useState(0);
  const [line, setLine] = useState('');
  const [photos, setPhotos] = useState<File[]>([]);
  const [papers, setPapers] = useState<{ file: File; type: DocumentType }[]>([]);
  const [garageId, setGarageId] = useState(defaultGarageId ?? '');
  // Specs collapse to the filled ones; these stay out once shown, so clearing one never hides it.
  const [allSpecs, setAllSpecs] = useState(false);
  const [pinned, setPinned] = useState<ReadonlySet<string>>(new Set());

  const value = (key: string) => form[key] ?? '';
  // A hand on a field takes it back from the AI: its mark goes.
  const unmark = (key: string) =>
    setMarks((current) => {
      if (!(key in current)) return current;
      const rest = { ...current };
      delete rest[key];
      return rest;
    });
  const set = (key: string, next: string) => {
    setForm((current) => ({ ...current, [key]: next }));
    unmark(key);
    if (key.startsWith('spec:') && !pinned.has(key)) setPinned(new Set([...pinned, key]));
  };
  const mark = (keys: string[], by: Mark['by']) => {
    const next = wave + 1;
    setWave(next);
    setMarks((current) => ({
      ...current,
      ...Object.fromEntries(keys.map((key) => [key, { by, wave: next }])),
    }));
  };

  const garageList = garages.data ?? [];
  /*
   * Only a lone garage chooses itself. With more, the vehicle goes where the person says: the
   * first in the list is an accident of sort order, and a car filed into the wrong garage is
   * shared with the wrong people.
   */
  const chosenGarage = garageId || (garageList.length === 1 ? garageList[0]!.id : '');
  const garage = garageList.find((candidate) => candidate.id === chosenGarage);
  const currency = value('purchaseCurrency') || garage?.defaultCurrency || 'USD';

  /*
   * The specs, looked up for the vehicle as identified. Only into fields still empty when the
   * answer lands — a figure typed while it ran, or read from the line, is the person's.
   */
  const lookUp = useMutation({
    mutationFn: (vehicle: LookUpVehicle) => api.ai.lookUpVehicle(vehicle),
    meta: { toast: false },
    onSuccess: (result) => {
      const found = Object.fromEntries(
        Object.entries(result.specs)
          .map(([key, figure]) => [spec(key), String(figure)] as const)
          .filter(([key]) => !form[key]?.trim()),
      );
      setForm((current) => ({
        ...current,
        ...Object.fromEntries(Object.entries(found).filter(([key]) => !current[key]?.trim())),
      }));
      mark(Object.keys(found), 'web');
    },
  });

  /*
   * The line, read. Papers first, then photos, up to the contract's four: a registration card
   * says more than a photo, and a photo still names the make, model and colour. Once it names
   * the vehicle, the look-up follows on its own.
   */
  const read = useMutation({
    mutationFn: async () => {
      const files = [...papers.map((paper) => paper.file), ...photos].slice(0, 4);
      const attachments = (await Promise.all(files.map(toAttachment))).filter(
        (attachment) => attachment !== null,
      );
      return api.ai.draftVehicle({
        text: line.trim() || 'Read the attached papers and photos.',
        ...(attachments.length ? { attachments } : {}),
      });
    },
    meta: { toast: false },
    onSuccess: (draft) => {
      const next = draftToForm(draft);
      const type = draft.vehicleType ?? vehicleType;
      setForm((current) => ({ ...current, ...next }));
      if (draft.vehicleType) setVehicleType(draft.vehicleType);
      mark([...Object.keys(next), ...(draft.vehicleType ? ['type'] : [])], 'line');
      const vehicle = identity({ ...form, ...next }, type);
      if (vehicle) lookUp.mutate(vehicle);
    },
  });

  /*
   * A decode fills only what is still empty: the person may have typed a model the VIN
   * database spells differently, and silently replacing what someone wrote is the one thing a
   * suggestion must never do.
   */
  const decode = useMutation({
    mutationFn: () => api.vehicles.decodeVin(value('vin')),
    meta: { toast: false },
    onSuccess: (result) => {
      if (!result.decoded) return;
      setForm((current) => {
        const next = { ...current };
        const fill = (key: string, decoded: string | number | null | undefined) => {
          if (!next[key]?.trim() && decoded !== null && decoded !== undefined && decoded !== '')
            next[key] = String(decoded);
        };
        fill('make', result.make);
        fill('model', result.model);
        fill('year', result.year);
        for (const [key, decoded] of Object.entries(result.specs)) fill(spec(key), decoded);
        return next;
      });
    },
  });

  const specFields = vehicleType ? specFieldsFor(vehicleType) : [];
  const hasEngineHours = vehicleType ? supports(vehicleType, 'engineHours') : false;

  const create = useMutation({
    mutationFn: async () => {
      const text = (key: string) => value(key).trim() || undefined;
      const price = Number(value('purchasePrice'));
      const specs = Object.fromEntries(
        specFields.flatMap((field) => {
          const raw = value(spec(field.key)).trim();
          if (!raw) return [];
          return [
            [field.key, field.kind === 'text' || field.kind === 'select' ? raw : Number(raw)],
          ];
        }),
      );
      const vehicle = await api.vehicles.create({
        garageId: chosenGarage,
        vehicleType: vehicleType!,
        make: text('make'),
        model: text('model'),
        variant: text('variant'),
        year: value('year') ? Number(value('year')) : undefined,
        nickname: text('nickname'),
        color: text('color'),
        registrationIdentifier: text('plate'),
        identificationNumber: text('vin'),
        purchaseDate: text('purchaseDate'),
        ...(price > 0
          ? {
              purchasePriceAmountMinor: toMinorUnits(price, currency),
              purchasePriceCurrency: currency,
            }
          : {}),
        ...(value('odometer')
          ? {
              currentOdometer: Number(value('odometer')),
              odometerUnit: value('odometerUnit') as DistanceUnit,
            }
          : {}),
        ...(hasEngineHours && value('engineHours')
          ? { currentEngineHours: Number(value('engineHours')) }
          : {}),
        ...(Object.keys(specs).length ? { specs } : {}),
      });
      /*
       * One at a time, as the gallery does. A file that fails does not fail the add: the vehicle
       * exists by now, and pressing Add again would create it twice.
       */
      let failed = 0;
      for (const file of photos) {
        try {
          await uploadPhoto(api, vehicle.id, file);
        } catch {
          failed += 1;
        }
      }
      for (const paper of papers) {
        try {
          await uploadDocument(api, vehicle.id, paper.file, {
            documentType: paper.type,
            // The filename, minus its extension: a title is required, and a question per file is not.
            title: paper.file.name.replace(/\.[^.]+$/, '').slice(0, 200) || humanise(paper.type),
          });
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
          `${failed} ${failed === 1 ? 'file' : 'files'} did not upload. Add from the vehicle.`,
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
      ? fieldErrors.garageId
      : create.error.message
    : undefined;

  const odometerTooHigh = value('odometer') !== '' && Number(value('odometer')) > MAX_ODOMETER;
  const odometerError =
    fieldErrors?.currentOdometer ??
    fieldErrors?.odometerUnit ??
    (odometerTooHigh ? `Past ${MAX_ODOMETER.toLocaleString()}` : undefined);

  // The field's own bound, the one the API enforces, checked before the round trip.
  const specError = (field: SpecField) => {
    const server = fieldErrors?.[field.key] ?? fieldErrors?.[`specs.${field.key}`];
    if (server) return server;
    const raw = value(spec(field.key));
    if (!raw || field.max === undefined || Number(raw) <= field.max) return undefined;
    return `Max ${field.max.toLocaleString()}`;
  };
  const specsValid = specFields.every((field) => !specError(field));

  const vinError =
    fieldErrors?.identificationNumber ??
    (decode.error instanceof ApiError
      ? (decode.error.fields?.vin ?? decode.error.message)
      : undefined);
  const vinHint = decode.data
    ? decode.data.decoded
      ? (decode.data.warning ?? undefined)
      : 'Not in the VIN database'
    : undefined;

  const ready = vehicleType !== null && chosenGarage !== '' && !odometerTooHigh && specsValid;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (ready && !create.isPending) create.mutate();
  };

  const pickMake = (option: VehicleMake) => {
    set('make', option.name);
    const inferred = option.kinds.length === 1 ? TYPE_FOR_KIND[option.kinds[0]!] : undefined;
    if (!vehicleType && inferred) setVehicleType(inferred);
  };

  const takePhotos = (files: File[]) => {
    const images = files.filter(isImage);
    if (images.length) setPhotos((current) => [...current, ...images]);
  };
  const takePapers = (files: File[]) =>
    setPapers((current) => [
      ...current,
      ...files.map((file) => ({ file, type: paperType(file.name) })),
    ]);

  // A tile's provenance props for a form key: its mark, and the wave that set it (the flash).
  const cell = (key: string) => ({ mark: marks[key] });

  const name =
    value('nickname').trim() ||
    [value('year'), value('make').trim(), value('model').trim()].filter(Boolean).join(' ');
  const vehicle = identity(form, vehicleType);
  const canRead = line.trim().length >= 3 || photos.length + papers.length > 0;
  const fromLine = Object.values(marks).filter((entry) => entry.by === 'line').length;
  const fromWeb = Object.values(marks).filter((entry) => entry.by === 'web').length;

  const visibleSpecs = specFields.filter(
    (field) => allSpecs || pinned.has(spec(field.key)) || value(spec(field.key)),
  );
  const hiddenSpecs = specFields.length - visibleSpecs.length;
  const filledSpecs = specFields.filter((field) => value(spec(field.key))).length;
  const sources = lookUp.data?.sources ?? [];

  return (
    <Modal
      title="Add a vehicle"
      size="lg"
      fill
      onClose={onClose}
      header={(titleId) => (
        <div className="flex min-w-0 items-center gap-3.5">
          <PhotoTile
            photos={photos}
            onPick={() => pickFiles(PHOTO_TYPES, takePhotos)}
            onDrop={takePhotos}
            make={value('make')}
            vehicleType={vehicleType}
          />
          <div className="min-w-0">
            <p className="text-label uppercase text-muted-foreground">
              {vehicleType
                ? `New ${vehicleType === 'OTHER' ? 'vehicle' : typeLabel(vehicleType)}`
                : 'New vehicle'}
            </p>
            <h2
              id={titleId}
              className={cn(
                'truncate text-lg font-semibold tracking-tight',
                !name && 'text-muted-foreground',
              )}
            >
              {name || 'Describe it, or fill it in'}
            </h2>
          </div>
        </div>
      )}
    >
      <form onSubmit={submit} className="-mt-1 flex min-h-0 flex-1 flex-col gap-3">
        {/*
         * The line. First in the dialog, so it is where the cursor starts: the quickest way to
         * fill twenty fields is one sentence. Enter here reads; Enter anywhere else adds.
         */}
        <div className="flex flex-col gap-1.5">
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
            <label htmlFor={`${id}-line`} className="sr-only">
              Describe the vehicle
            </label>
            <input
              id={`${id}-line`}
              value={line}
              onChange={(event) => setLine(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                if (canRead && !read.isPending) read.mutate();
              }}
              placeholder="2019 911 Carrera S, white, 42k km, bought for $98k"
              autoComplete="off"
              maxLength={1000}
              aria-describedby={`${id}-line-status`}
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
                Fill
              </Button>
            ) : null}
          </div>

          {/* What the AI did, in figures: read from the line, then looked up. */}
          <p
            id={`${id}-line-status`}
            role="status"
            className="flex min-h-4 flex-wrap items-center gap-x-3 gap-y-1 px-1 text-xs text-muted-foreground"
          >
            {read.isPending ? (
              <span className="text-shimmer">Reading…</span>
            ) : read.isError ? (
              <span className="text-destructive">{(read.error as Error).message}</span>
            ) : read.data && !fromLine && !lookUp.isPending && !fromWeb ? (
              'Nothing to fill from that. Try a make, model and year.'
            ) : null}
            {fromLine ? (
              <span className="flex items-center gap-1">
                <Sparkles aria-hidden="true" className="size-3 text-foreground" />
                <span className="font-mono tabular-nums text-foreground">{pad(fromLine)}</span>
                read
              </span>
            ) : null}
            {lookUp.isPending ? (
              <span className="flex items-center gap-1">
                <Globe aria-hidden="true" className="size-3 animate-pulse" />
                <span className="text-shimmer">Looking up specs…</span>
              </span>
            ) : fromWeb ? (
              <span className="flex items-center gap-1">
                <Globe aria-hidden="true" className="size-3 text-foreground" />
                <span className="font-mono tabular-nums text-foreground">{pad(fromWeb)}</span>
                looked up
              </span>
            ) : lookUp.isError ? (
              <span className="text-destructive">Specs look-up failed</span>
            ) : null}
            {fromLine || fromWeb ? (
              <span className="max-sm:hidden">· check before adding</span>
            ) : null}
          </p>
        </div>

        <div className="scrollbar-slim -mx-6 flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 pb-3 pt-2 [mask-image:linear-gradient(to_bottom,transparent,#000_8px,#000_calc(100%-12px),transparent)] [&>*]:shrink-0">
          {/*
           * The sheet: rounded tiles in a tight grid, each an eyebrow over a borderless control.
           * Three across on a desktop, two on a phone; every focus ring follows its own tile.
           */}
          <div className={GRID}>
            <Cell
              label="Make"
              htmlFor={`${id}-make`}
              error={fieldErrors?.make}
              className="sm:col-span-3"
              {...cell('make')}
            >
              <MakeCombo
                id={`${id}-make`}
                value={value('make')}
                onChange={(next) => set('make', next)}
                onPick={pickMake}
                vehicleType={vehicleType}
                invalid={Boolean(fieldErrors?.make)}
              />
            </Cell>
            <Cell
              label="Type"
              htmlFor={`${id}-type`}
              error={fieldErrors?.vehicleType}
              className="col-span-4 sm:col-span-2"
              {...cell('type')}
            >
              <Select
                id={`${id}-type`}
                value={vehicleType ?? ''}
                onValueChange={(next) => {
                  setVehicleType(next as VehicleType);
                  unmark('type');
                }}
                options={TYPE_OPTIONS}
                ariaLabel="Type"
                placeholder="Choose"
                className="z-10 flex-1"
                triggerClassName={CELL_TRIGGER}
              />
            </Cell>
            <Cell
              label="Year"
              htmlFor={`${id}-year`}
              error={fieldErrors?.year}
              className="col-span-2 sm:col-span-1"
              {...cell('year')}
            >
              <Select
                id={`${id}-year`}
                value={value('year')}
                onValueChange={(next) => set('year', next)}
                options={YEAR_OPTIONS}
                ariaLabel="Year"
                placeholder="—"
                className="z-10 flex-1"
                triggerClassName={cn(CELL_TRIGGER, 'font-mono tabular-nums')}
              />
            </Cell>

            <TextCell
              id={id}
              name="model"
              label="Model"
              form={form}
              set={set}
              error={fieldErrors?.model}
              {...cell('model')}
            />
            <TextCell
              id={id}
              name="variant"
              label="Variant"
              form={form}
              set={set}
              error={fieldErrors?.variant}
              placeholder="Carrera S"
              {...cell('variant')}
            />
            <TextCell
              id={id}
              name="color"
              label="Colour"
              form={form}
              set={set}
              error={fieldErrors?.color}
              maxLength={60}
              {...cell('color')}
            />
            <TextCell
              id={id}
              name="nickname"
              label="Nickname"
              form={form}
              set={set}
              error={fieldErrors?.nickname}
              placeholder="The daily"
              {...cell('nickname')}
            />

            {/*
             * `registrationIdentifier` is the number plate — asked for by the name people use,
             * and drawn as one so it reads as one.
             */}
            <Cell
              label="Plate"
              htmlFor={`${id}-plate`}
              error={fieldErrors?.registrationIdentifier}
              className="sm:col-span-2"
              {...cell('plate')}
            >
              <span className="flex h-7 min-w-0 flex-1 items-stretch overflow-hidden rounded-md bg-card ring-1 ring-inset ring-foreground/20">
                <span aria-hidden="true" className="w-1.5 shrink-0 bg-foreground" />
                <input
                  id={`${id}-plate`}
                  value={value('plate')}
                  onChange={(event) => set('plate', event.target.value.toUpperCase())}
                  placeholder="AB12 CDE"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={32}
                  aria-invalid={fieldErrors?.registrationIdentifier ? true : undefined}
                  className="relative z-10 min-w-0 flex-1 bg-transparent px-2 font-mono text-sm font-semibold uppercase tracking-[0.16em] text-foreground outline-none placeholder:text-muted-foreground"
                />
              </span>
            </Cell>
            <Cell
              label="Odometer"
              htmlFor={`${id}-odometer`}
              error={odometerError}
              className="sm:col-span-2"
              {...cell('odometer')}
            >
              {/*
               * Text with a numeric keyboard rather than `type="number"`, so the reading carries
               * its thousands separators: 42150 is a number, 42,150 is a distance.
               */}
              <input
                id={`${id}-odometer`}
                // `size` defaults to 20 characters, wider than the tile on a phone.
                size={1}
                inputMode="numeric"
                autoComplete="off"
                placeholder="0"
                value={grouped(value('odometer'))}
                // ponytail: formatting moves the caret to the end on a mid-string edit; a
                // selection-preserving input is the upgrade if people edit in the middle.
                onChange={(event) => set('odometer', digits(event.target.value))}
                aria-invalid={odometerError ? true : undefined}
                className={cn(CELL_INPUT, 'font-mono tabular-nums')}
              />
              <div
                role="group"
                aria-label="Unit"
                className="relative z-10 flex shrink-0 rounded-full bg-card p-0.5"
              >
                {DISTANCE_UNITS.map((unit) => (
                  <button
                    key={unit}
                    type="button"
                    aria-pressed={value('odometerUnit') === unit}
                    aria-label={unit === 'MI' ? 'Miles' : 'Kilometres'}
                    onClick={() => set('odometerUnit', unit)}
                    className={cn(
                      'h-6 rounded-full px-2 text-xs font-semibold transition-colors duration-200',
                      value('odometerUnit') === unit
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {unit === 'MI' ? 'mi' : 'km'}
                  </button>
                ))}
              </div>
            </Cell>

            <Cell
              label="Bought"
              htmlFor={`${id}-purchaseDate`}
              error={fieldErrors?.purchaseDate}
              className={hasEngineHours ? 'col-span-3 sm:col-span-2' : 'col-span-3'}
              {...cell('purchaseDate')}
            >
              <DatePicker
                id={`${id}-purchaseDate`}
                label="Bought"
                value={value('purchaseDate')}
                max={new Date().toLocaleDateString('en-CA')}
                onChange={(next) => set('purchaseDate', next)}
                placeholder="—"
                hideIcon
                triggerClassName={cn(CELL_TRIGGER, 'w-full')}
              />
            </Cell>
            <Cell
              label="Price"
              htmlFor={`${id}-purchasePrice`}
              error={fieldErrors?.purchasePriceAmountMinor ?? fieldErrors?.purchasePriceCurrency}
              className={hasEngineHours ? 'col-span-3 sm:col-span-2' : 'col-span-3'}
              {...cell('purchasePrice')}
            >
              <input
                id={`${id}-purchasePrice`}
                size={1}
                inputMode="decimal"
                autoComplete="off"
                placeholder="0"
                value={value('purchasePrice')}
                onChange={(event) => set('purchasePrice', decimal(event.target.value))}
                className={cn(CELL_INPUT, 'font-mono tabular-nums')}
              />
              <input
                aria-label="Currency"
                value={currency}
                onChange={(event) =>
                  set(
                    'purchaseCurrency',
                    event.target.value
                      .replace(/[^a-z]/gi, '')
                      .toUpperCase()
                      .slice(0, 3),
                  )
                }
                onBlur={() => {
                  if (value('purchaseCurrency').length !== 3) set('purchaseCurrency', '');
                }}
                size={3}
                autoComplete="off"
                spellCheck={false}
                className="relative z-10 h-6 w-12 shrink-0 rounded-full bg-card text-center font-mono text-xs font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </Cell>
            {hasEngineHours ? (
              <Cell
                label="Engine hours"
                htmlFor={`${id}-engineHours`}
                error={fieldErrors?.currentEngineHours}
                className="sm:col-span-2"
                {...cell('engineHours')}
              >
                <input
                  id={`${id}-engineHours`}
                  size={1}
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="0"
                  value={grouped(value('engineHours'))}
                  onChange={(event) => set('engineHours', digits(event.target.value, 7))}
                  className={cn(CELL_INPUT, 'font-mono tabular-nums')}
                />
                <span className="shrink-0 text-xs text-muted-foreground">h</span>
              </Cell>
            ) : null}

            <Cell
              label="VIN"
              htmlFor={`${id}-vin`}
              error={vinError}
              hint={vinHint}
              {...cell('vin')}
            >
              <input
                id={`${id}-vin`}
                value={value('vin')}
                onChange={(event) => {
                  set('vin', event.target.value.toUpperCase());
                  decode.reset();
                }}
                // Enter here decodes rather than adds: that is what the VIN was just typed for.
                onKeyDown={(event) => {
                  if (event.key !== 'Enter') return;
                  event.preventDefault();
                  if (value('vin').trim()) decode.mutate();
                }}
                placeholder="17 characters — decodes the rest"
                autoComplete="off"
                spellCheck={false}
                maxLength={24}
                aria-invalid={vinError ? true : undefined}
                className={cn(
                  CELL_INPUT,
                  'font-mono uppercase tracking-wider placeholder:font-sans placeholder:normal-case placeholder:tracking-normal',
                )}
              />
              {decode.data?.decoded ? (
                <span className="flex shrink-0 animate-pop items-center gap-1 text-xs font-semibold text-success">
                  <Icon name="check" size={14} />
                  Decoded
                </span>
              ) : value('vin').trim() ? (
                <Button
                  size="sm"
                  className="z-10 h-7 shrink-0 animate-pop"
                  loading={decode.isPending}
                  onClick={() => decode.mutate()}
                >
                  Decode
                </Button>
              ) : null}
            </Cell>
          </div>

          {specFields.length > 0 ? (
            <Section
              title="Specs"
              aside={`${pad(filledSpecs)} / ${pad(specFields.length)}`}
              action={
                <Button
                  size="sm"
                  variant="ghost"
                  className="-my-1 h-7 rounded-full px-2.5 text-xs"
                  disabled={!vehicle}
                  loading={lookUp.isPending}
                  onClick={() => vehicle && lookUp.mutate(vehicle)}
                  title={vehicle ? undefined : 'Needs a type, make and model'}
                >
                  <Globe className="size-3.5" />
                  Look up
                </Button>
              }
            >
              {visibleSpecs.length ? (
                <div className={GRID}>
                  {visibleSpecs.map((field) => (
                    <SpecCell
                      key={field.key}
                      id={`${id}-spec-${field.key}`}
                      field={field}
                      value={value(spec(field.key))}
                      onChange={(next) => set(spec(field.key), next)}
                      error={specError(field)}
                      {...cell(spec(field.key))}
                    />
                  ))}
                </div>
              ) : null}
              {hiddenSpecs ? (
                <button
                  type="button"
                  onClick={() => setAllSpecs(true)}
                  className="flex h-9 w-full items-center justify-center gap-1.5 rounded-xl text-xs font-semibold text-muted-foreground ring-1 ring-inset ring-border transition-colors hover:bg-muted/60 hover:text-foreground"
                >
                  <Plus aria-hidden="true" className="size-3.5" />
                  {visibleSpecs.length ? `${hiddenSpecs} more` : `All ${specFields.length} fields`}
                </button>
              ) : null}
              {sources.length ? (
                <p className="flex flex-wrap items-center gap-1.5 px-1 text-xs text-muted-foreground">
                  via
                  {sources.map((source) => (
                    <a
                      key={source.url}
                      href={source.url}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-full bg-muted px-2 py-0.5 font-medium text-foreground hover:bg-border"
                    >
                      {source.title}
                    </a>
                  ))}
                </p>
              ) : null}
            </Section>
          ) : null}

          <Section
            title="Photos & papers"
            aside={photos.length + papers.length ? pad(photos.length + papers.length) : undefined}
          >
            <ul className="flex flex-wrap gap-1.5">
              {photos.map((file, index) => (
                <PhotoThumb
                  key={`${file.name}-${file.lastModified}-${index}`}
                  file={file}
                  cover={index === 0}
                  onRemove={() => setPhotos((current) => current.filter((_, at) => at !== index))}
                />
              ))}
              <li>
                <DropTile
                  icon="camera"
                  label="Photo"
                  busy={false}
                  blocked={false}
                  onPick={() => pickFiles(PHOTO_TYPES, takePhotos)}
                  onFiles={takePhotos}
                  className="size-16 rounded-xl p-0 [&>span]:mt-0 [&>span]:text-xs"
                />
              </li>
              <li>
                <DropTile
                  icon="document"
                  label="Paper"
                  busy={false}
                  blocked={false}
                  onPick={() => pickFiles(undefined, takePapers)}
                  onFiles={takePapers}
                  className="size-16 rounded-xl p-0 [&>span]:mt-0 [&>span]:text-xs"
                />
              </li>
            </ul>

            {papers.length ? (
              <ul className="flex flex-col gap-1.5">
                {papers.map((paper, index) => (
                  <li
                    key={`${paper.file.name}-${index}`}
                    className="flex animate-pop items-center gap-2.5 rounded-xl bg-muted/60 py-1 pl-3 pr-1"
                  >
                    <FileText
                      aria-hidden="true"
                      className="size-4 shrink-0 text-muted-foreground"
                    />
                    <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                      {paper.file.name}
                    </span>
                    <Select
                      value={paper.type}
                      onValueChange={(next) =>
                        setPapers((current) =>
                          current.map((item, at) =>
                            at === index ? { ...item, type: next as DocumentType } : item,
                          ),
                        )
                      }
                      options={DOCUMENT_OPTIONS}
                      ariaLabel={`Kind of paper: ${paper.file.name}`}
                      className="w-40 shrink-0 max-sm:w-32"
                      triggerClassName="h-8 rounded-lg bg-card"
                    />
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove ${paper.file.name}`}
                      onClick={() =>
                        setPapers((current) => current.filter((_, at) => at !== index))
                      }
                    >
                      <X className="size-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}
          </Section>
        </div>

        {formError ? <FormError>{formError}</FormError> : null}

        {/* The same pinned foot as every fill modal; where it goes, beside what sends it there. */}
        <div className={cn(MODAL_BAR, '-mx-6 -mb-6 flex-wrap')}>
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
              className="w-full sm:w-56"
            />
          ) : garage ? (
            <p className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
              <Icon name="garage" size={16} />
              <span className="truncate">{garage.name}</span>
            </p>
          ) : null}

          {/* On a phone the header's close stands in: the bar is the select and the action. */}
          <Button
            variant="ghost"
            onClick={onClose}
            disabled={create.isPending}
            className="ml-auto max-sm:hidden"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            loading={create.isPending}
            disabled={!ready}
            className="max-sm:ml-auto max-sm:w-full"
          >
            Add vehicle
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

/** A section of the sheet: an eyebrow, a mono aside, an action at its end, then its body. */
function Section({
  title,
  aside,
  action,
  children,
}: {
  title: string;
  aside?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex min-h-7 items-center gap-2 px-1">
        <h3 className="text-label uppercase text-muted-foreground">{title}</h3>
        {aside ? (
          <span className="font-mono text-xs tabular-nums text-muted-foreground">{aside}</span>
        ) : null}
        {action ? <div className="ml-auto">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

/**
 * One tile of the sheet: an eyebrow over its control, the whole tile the target. The label's
 * overlay catches a press anywhere on the tile and hands it to the control; the controls sit
 * above that overlay (`relative z-10`), so a press on one is still its own. Focus is the tile's
 * own inset ring, so it follows the tile's corners.
 */
function Cell({
  label,
  htmlFor,
  error,
  hint,
  mark,
  className,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  hint?: string;
  /** Filled by the AI and untouched since: marked with where from, and flashed once. */
  mark?: Mark;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        'relative col-span-6 flex min-w-0 flex-col justify-center gap-0.5 rounded-xl bg-muted/60 px-3.5 py-2 transition-colors hover:bg-muted has-[:focus-visible]:bg-muted has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-inset has-[:focus-visible]:ring-ring',
        error && 'bg-destructive-soft hover:bg-destructive-soft',
        className,
      )}
    >
      {mark ? (
        <span
          key={mark.wave}
          aria-hidden="true"
          className="row-flash pointer-events-none absolute inset-0 rounded-xl"
        />
      ) : null}
      <label
        htmlFor={htmlFor}
        className="flex min-w-0 items-center gap-1.5 text-label uppercase text-muted-foreground after:absolute after:inset-0"
      >
        <span className="truncate">{label}</span>
        {mark ? (
          <>
            {mark.by === 'web' ? (
              <Globe aria-hidden="true" className="size-3 shrink-0 animate-pop text-foreground" />
            ) : (
              <Sparkles
                aria-hidden="true"
                className="size-3 shrink-0 animate-pop text-foreground"
              />
            )}
            <span className="sr-only">
              {mark.by === 'web' ? ', looked up by GarajAI' : ', read by GarajAI'}
            </span>
          </>
        ) : null}
      </label>
      <div className="flex min-w-0 items-center gap-2">{children}</div>
      {error || hint ? (
        <p
          role={error ? 'alert' : undefined}
          className={cn('text-xs', error ? 'text-destructive' : 'text-muted-foreground')}
        >
          {error ?? hint}
        </p>
      ) : null}
    </div>
  );
}

/** A plain text tile over one form key: half a row on a phone, a third on a desktop. */
function TextCell({
  id,
  name,
  label,
  form,
  set,
  error,
  placeholder,
  maxLength = 120,
  mark,
}: {
  id: string;
  name: string;
  label: string;
  form: Form;
  set: (key: string, value: string) => void;
  error?: string;
  placeholder?: string;
  maxLength?: number;
  mark?: Mark;
}) {
  return (
    <Cell
      label={label}
      htmlFor={`${id}-${name}`}
      error={error}
      className="col-span-3 sm:col-span-2"
      mark={mark}
    >
      <input
        id={`${id}-${name}`}
        value={form[name] ?? ''}
        onChange={(event) => set(name, event.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        maxLength={maxLength}
        aria-invalid={error ? true : undefined}
        className={CELL_INPUT}
      />
    </Cell>
  );
}

/**
 * A spec, drawn from the domain's own descriptor: `kind` picks the control, `unit` is the suffix,
 * `max` the bound — the numbers the API validates against, so what this accepts it accepts.
 */
function SpecCell({
  id,
  field,
  value,
  onChange,
  error,
  mark,
}: {
  id: string;
  field: SpecField;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  mark?: Mark;
}) {
  return (
    <Cell
      label={field.label}
      htmlFor={id}
      error={error}
      className="col-span-3 animate-pop sm:col-span-2"
      mark={mark}
    >
      {field.kind === 'select' ? (
        <Select
          id={id}
          value={value}
          onValueChange={onChange}
          // An empty first option: "not recorded" is a real answer, and a select without one
          // silently asserts whichever option happens to be first.
          options={[
            { value: '', label: '—' },
            ...(field.options ?? []).map((option) => ({
              value: option,
              label: optionLabel(option),
            })),
          ]}
          ariaLabel={field.label}
          placeholder="—"
          className="z-10 flex-1"
          triggerClassName={CELL_TRIGGER}
        />
      ) : (
        <>
          <input
            id={id}
            size={1}
            value={value}
            onChange={(event) =>
              onChange(
                field.kind === 'integer'
                  ? digits(event.target.value, 7)
                  : field.kind === 'number'
                    ? decimal(event.target.value)
                    : event.target.value,
              )
            }
            inputMode={
              field.kind === 'integer' ? 'numeric' : field.kind === 'number' ? 'decimal' : undefined
            }
            maxLength={field.kind === 'text' ? 200 : undefined}
            autoComplete="off"
            aria-invalid={error ? true : undefined}
            className={cn(CELL_INPUT, field.kind !== 'text' && 'font-mono tabular-nums')}
          />
          {field.unit ? (
            <span className="shrink-0 text-xs text-muted-foreground">{field.unit}</span>
          ) : null}
        </>
      )}
    </Cell>
  );
}

/** A chosen photo, from the local file: nothing is uploaded until the vehicle exists. */
function PhotoThumb({
  file,
  cover,
  onRemove,
}: {
  file: File;
  cover: boolean;
  onRemove: () => void;
}) {
  const url = useObjectUrl(file);
  return (
    <li className="relative size-16 animate-pop overflow-hidden rounded-xl bg-muted">
      {url ? <img src={url} alt="" className="size-full object-cover" /> : null}
      {cover ? (
        <span className="absolute inset-x-1 bottom-1 rounded-md bg-primary py-px text-center text-[0.625rem] font-semibold text-primary-foreground">
          Cover
        </span>
      ) : null}
      <button
        type="button"
        aria-label={`Remove ${file.name}`}
        onClick={onRemove}
        className="absolute right-1 top-1 grid size-5 place-items-center rounded-full bg-popover text-foreground shadow-float transition-transform hover:scale-110"
      >
        <X className="size-3" />
      </button>
    </li>
  );
}

/**
 * The vehicle's portrait, top left: the cover photo once there is one, else the make's logo,
 * else the type. Press it or drop photos on it.
 */
function PhotoTile({
  photos,
  onPick,
  onDrop,
  make,
  vehicleType,
}: {
  photos: File[];
  onPick: () => void;
  onDrop: (files: File[]) => void;
  make: string;
  vehicleType: VehicleType | null;
}) {
  const [over, setOver] = useState(false);
  const cover = useObjectUrl(photos[0] ?? null);

  // Keyed by what is shown, so each change — type, logo, photo — pops in rather than swapping.
  const face = cover
    ? cover
    : make.trim()
      ? (domainForMake(make) ?? make.trim()[0]!.toLowerCase())
      : (vehicleType ?? 'none');

  return (
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
        'group relative grid size-14 shrink-0 place-items-center rounded-2xl bg-muted text-muted-foreground transition-[background-color,scale] duration-200 hover:bg-border active:scale-[0.96] [&>*]:pointer-events-none',
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
          <BrandLogo make={make} size={30} />
        ) : (
          <Icon name={vehicleType ? typeIcon(vehicleType) : 'camera'} size={26} />
        )}
      </span>
      <span
        aria-hidden="true"
        className="absolute -bottom-1.5 -right-1.5 grid h-6 min-w-6 place-items-center rounded-full bg-primary px-1 font-mono text-[0.6875rem] font-semibold tabular-nums text-primary-foreground ring-[3px] ring-card transition-transform duration-200 group-hover:scale-110"
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
  );
}

/**
 * The make: type anything, or pick from the list. The list is a shortcut, not the set of valid
 * answers — a manufacturer it lacks is recorded as typed.
 *
 * A text input with a native popover listbox, for the same reasons as `Select`: the top layer
 * sits above the dialog, and light dismiss and Escape come free (Escape closes the list, not the
 * dialog). Focus stays in the input; `aria-activedescendant` names the active option.
 */
function MakeCombo({
  id,
  value,
  onChange,
  onPick,
  vehicleType,
  invalid,
}: {
  id: string;
  value: string;
  onChange: (make: string) => void;
  onPick: (make: VehicleMake) => void;
  vehicleType: VehicleType | null;
  invalid: boolean;
}) {
  const listId = `${id}-list`;
  const rowRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  // What has been typed since the list opened. Null while browsing, so reopening on a chosen
  // make shows every make rather than only that one.
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(-1);

  // Narrowed by the type once there is one — a motorcycle owner should not scroll the car half.
  const pool = vehicleType ? makesForKind(kindFor(vehicleType)) : VEHICLE_MAKES;
  const typed = (query ?? '').trim().toLowerCase();
  // Exact, then prefix, then anywhere in the name — so Enter on "mini" is MINI, not Dominion.
  const rank = (name: string) => {
    const lower = name.toLowerCase();
    return lower === typed ? 0 : lower.startsWith(typed) ? 1 : 2;
  };
  const options = typed
    ? pool
        .filter((option) => option.name.toLowerCase().includes(typed))
        .sort((a, b) => rank(a.name) - rank(b.name))
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
        aria-invalid={invalid || undefined}
        value={value}
        placeholder="Search or type"
        autoComplete="off"
        spellCheck={false}
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

/**
 * Which slice of the make list a vehicle type draws from.
 *
 * Vans and RVs are built by car makers, ATVs by motorcycle makers — so they borrow those
 * lists rather than each having one of their own that would go stale separately.
 */
function kindFor(type: VehicleType): MakeKind {
  switch (type) {
    case 'MOTORCYCLE':
    case 'SCOOTER':
    case 'ATV':
      return 'moto';
    case 'BICYCLE':
    case 'BOAT':
    case 'TRAILER':
      return 'other';
    default:
      return 'car';
  }
}
