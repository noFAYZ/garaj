'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, Plus, RefreshCw, ShieldCheck, Sparkles, X } from 'lucide-react';
import { Fragment, useMemo, useState, type ReactNode } from 'react';
import type { PartProduct, UpdatePart, VehiclePart } from '@vehicle-os/contracts';
import {
  convertDistance,
  currentParts,
  draftAsPart,
  draftFor,
  draftFromPart,
  PART_GROUPS,
  partName,
  partPosition,
  partPositionsFor,
  partProductKey,
  partSummary,
  partUnitWord,
  productsFor,
  toPartLine,
  type PartDraft,
  type PartPosition,
  type VehicleType,
} from '@vehicle-os/domain';
import { partsQuery, queryKeys, vehicleQuery } from '@vehicle-os/api-client/react';
import { amountOnly, digitsOnly, localDay, spanOfDays, stampForDay } from '@vehicle-os/ui';
import { api } from '@/lib/api';
import { Emoji, scheduleEmoji } from '@/components/emoji';
import { DateField } from '@/components/ui/date-picker';
import { FormError, Modal, ModalActions } from '@/components/ui/modal';
import { Button, Field } from '@/components/ui/primitives';
import { ConfirmDelete, RowMenu } from '@/components/ui/row-actions';
import { ListSkeleton, Loading } from '@/components/ui/skeleton';
import { formatDate, formatDistance, humanise } from '@/lib/format';
import { cn } from '@/lib/utils';

/*
 * Parts and fluids on the web (PRD §17) — the phone's `parts-kit`, drawn in the web's own parts.
 * The rules — what a line starts as, what a reminder or a photo brings, what is fitted now — are
 * the domain's, so both apps say the same thing about the same oil.
 */

const NO_PARTS: readonly VehiclePart[] = [];
const NO_PRODUCTS: readonly PartProduct[] = [];

export const positionLabel = (position: string) =>
  partPosition(position)?.label ?? humanise(position);
export const positionEmoji = (position: string) => scheduleEmoji(positionLabel(position));

/** A line id the API accepts, made here so a retried save lands on the same line. */
export const newLineId = () => crypto.randomUUID();

/** One cached read for every parts view: the lines, what is fitted now, the garage's products. */
export function useVehicleParts(vehicleId: string) {
  const vehicle = useQuery(vehicleQuery(api, vehicleId)).data;
  const query = useQuery(partsQuery(api, vehicleId));
  const history = query.data?.data ?? NO_PARTS;
  const current = useMemo(() => currentParts(history), [history]);
  const type = vehicle?.vehicleType;
  const specs = vehicle?.specs;
  const positions = useMemo(
    () => (type ? partPositionsFor(type as VehicleType, specs) : []),
    [type, specs],
  );
  return {
    vehicle,
    query,
    history,
    current,
    products: query.data?.products ?? NO_PRODUCTS,
    positions,
  };
}

const CHIP =
  'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-semibold transition-[background-color,color,scale] active:scale-[0.97]';
const TAG = 'inline-flex h-5 items-center gap-1 rounded-full px-2 text-[0.6875rem] font-semibold';

/** "Same as last time", "From the photo" or "Top-up", where the line is one. */
function LineTag({ draft }: { draft: PartDraft }) {
  if (draft.same) {
    return (
      <span className={cn(TAG, 'bg-success-soft text-success')}>
        <RefreshCw aria-hidden="true" className="size-3" />
        Same as last time
      </span>
    );
  }
  if (draft.read) {
    return (
      <span className={cn(TAG, 'bg-primary/10 text-primary')}>
        <Sparkles aria-hidden="true" className="size-3" />
        From the photo
      </span>
    );
  }
  return draft.action === 'TOPPED_UP' ? (
    <span className={cn(TAG, 'bg-muted text-muted-foreground')}>Top-up</span>
  ) : null;
}

/**
 * One line's fields: the products this garage used here before as one-press chips, then brand
 * and product, grade and part number, how much — and, for a fluid, whether it was changed or
 * topped up; for a part, until when it is covered.
 */
function PartEditor({
  draft,
  products,
  onChange,
}: {
  draft: PartDraft;
  products: readonly PartProduct[];
  onChange: (draft: PartDraft) => void;
}) {
  const spec = partPosition(draft.position)!;
  const offered = productsFor(products, draft.position).slice(0, 8);
  const chosen = partProductKey(draft);
  // Any change by hand is no longer "same as last time", nor the photo's word.
  const set = (patch: Partial<PartDraft>) =>
    onChange({ ...draft, ...patch, same: false, read: false });

  return (
    <div className="flex flex-col gap-3">
      {offered.length > 0 ? (
        <div className="scroll-fade-x -mr-3 flex gap-1.5 overflow-x-auto pr-3 [scrollbar-width:none]">
          {offered.map((product) => {
            const selected = partProductKey(product) === chosen;
            return (
              <button
                key={partProductKey(product)}
                type="button"
                aria-pressed={selected}
                onClick={() =>
                  set({
                    brand: product.brand ?? '',
                    name: product.name ?? '',
                    spec: product.spec ?? '',
                    partNumber: product.partNumber ?? '',
                    ...(product.quantity !== null
                      ? { quantity: String(product.quantity), unit: product.unit ?? draft.unit }
                      : {}),
                  })
                }
                className={cn(
                  CHIP,
                  selected
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-foreground hover:bg-border',
                )}
              >
                <RefreshCw aria-hidden="true" className="size-3.5" />
                {partName(product)}
              </button>
            );
          })}
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-3">
        <Field
          label="Brand"
          value={draft.brand}
          maxLength={80}
          onChange={(event) => set({ brand: event.target.value })}
        />
        <Field
          label="Product"
          value={draft.name}
          maxLength={120}
          onChange={(event) => set({ name: event.target.value })}
        />
        <Field
          label={spec.liquid ? 'Grade' : 'Size or type'}
          value={draft.spec}
          placeholder={spec.specHint}
          maxLength={80}
          onChange={(event) => set({ spec: event.target.value })}
        />
        <Field
          label="Part no."
          value={draft.partNumber}
          maxLength={80}
          onChange={(event) => set({ partNumber: event.target.value })}
        />
        <Field
          label="Quantity"
          inputMode="decimal"
          value={draft.quantity}
          placeholder={spec.liquid ? '0.0' : '1'}
          suffix={partUnitWord(draft.unit === 'PIECE' ? null : draft.unit)}
          onChange={(event) => set({ quantity: amountOnly(event.target.value) })}
        />
        {spec.liquid ? (
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">This time</span>
            <div
              role="group"
              aria-label="Changed or topped up"
              className="inline-flex h-10 gap-0.5 self-start rounded-full bg-muted p-1"
            >
              {(
                [
                  ['REPLACED', 'Changed'],
                  ['TOPPED_UP', 'Topped up'],
                ] as const
              ).map(([action, label]) => (
                <button
                  key={action}
                  type="button"
                  aria-pressed={draft.action === action}
                  onClick={() => set({ action })}
                  className={cn(
                    'inline-flex items-center rounded-full px-3.5 text-sm font-semibold transition-[background-color,color]',
                    draft.action === action
                      ? 'bg-card text-foreground shadow-[0_1px_2px_var(--color-shadow)]'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <DateField
            label="Warranty until"
            hint="Reminded before it ends"
            value={draft.warrantyUntil}
            onChange={(warrantyUntil) => set({ warrantyUntil })}
            placeholder="None"
          />
        )}
      </div>
    </div>
  );
}

/**
 * The add forms' "What went in": the lines on a card, one open at a time, and the vehicle's
 * positions to add another. Completing a reminder arrives with its lines already here, each the
 * product fitted last time; a read photo brings what it printed.
 */
export function PartLinesField({
  vehicleId,
  lines,
  onChange,
}: {
  vehicleId: string;
  lines: readonly PartDraft[];
  onChange: (lines: PartDraft[]) => void;
}) {
  const { vehicle, current, products, positions } = useVehicleParts(vehicleId);
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const taken = new Set<string>(lines.map((line) => line.position));
  const left = positions.filter((position) => position === 'OTHER' || !taken.has(position));

  const add = (position: PartPosition) => {
    if (!vehicle) return;
    const draft = draftFor(newLineId(), position, vehicle, current.get(position));
    onChange([...lines, draft]);
    setAdding(false);
    // A line with nothing in it yet opens to be filled; one filled from last time stays shut.
    setOpen(draft.same ? null : draft.id);
  };

  return (
    <section aria-label="What went in" className="flex flex-col gap-2">
      <h3 className="px-1 text-label uppercase text-muted-foreground">What went in</h3>
      {lines.length > 0 ? (
        <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-2xl bg-muted/40">
          {lines.map((draft) => {
            const label = positionLabel(draft.position);
            const shown = open === draft.id;
            return (
              <li key={draft.id}>
                <div className="flex items-center gap-3 px-3 py-2.5">
                  <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-card">
                    <Emoji name={positionEmoji(draft.position)} size={20} />
                  </span>
                  <button
                    type="button"
                    aria-expanded={shown}
                    onClick={() => setOpen(shown ? null : draft.id)}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-semibold text-muted-foreground">{label}</span>
                        <LineTag draft={draft} />
                      </span>
                      <span className="block truncate text-sm font-semibold text-foreground">
                        {partSummary(draftAsPart(draft))}
                      </span>
                    </span>
                    <ChevronDown
                      aria-hidden="true"
                      className={cn(
                        'size-4 shrink-0 text-muted-foreground transition-transform',
                        shown && 'rotate-180',
                      )}
                    />
                  </button>
                  <button
                    type="button"
                    aria-label={`Leave out ${label}`}
                    onClick={() => onChange(lines.filter((line) => line.id !== draft.id))}
                    className="grid size-7 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-border hover:text-foreground"
                  >
                    <X aria-hidden="true" className="size-3.5" />
                  </button>
                </div>
                {shown ? (
                  <div className="px-3 pb-3">
                    <PartEditor
                      draft={draft}
                      products={products}
                      onChange={(next) =>
                        onChange(lines.map((line) => (line.id === next.id ? next : line)))
                      }
                    />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      {adding ? (
        <div className="flex flex-wrap gap-1.5">
          {left.map((position) => (
            <button
              key={position}
              type="button"
              onClick={() => add(position)}
              className={cn(CHIP, 'bg-muted text-foreground hover:bg-border')}
            >
              <Emoji name={positionEmoji(position)} size={16} />
              {positionLabel(position)}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setAdding(false)}
            className={cn(CHIP, 'text-muted-foreground hover:text-foreground')}
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          disabled={!vehicle}
          className={cn(CHIP, 'self-start bg-muted text-foreground hover:bg-border')}
        >
          <Plus aria-hidden="true" className="size-3.5" />
          {lines.length ? 'Another part or fluid' : 'Add a part or fluid'}
        </button>
      )}
    </section>
  );
}

// --- The vehicle's parts ------------------------------------------------------

/** "Since 18 Apr 2026 · 4,210 km": when it went in and how far it has gone since. */
function fittedText(
  part: VehiclePart,
  vehicle: { currentOdometer: number | null; odometerUnit: 'KM' | 'MI' } | undefined,
): string {
  if (!part.fittedAt) return 'Date not recorded';
  const since = `Since ${formatDate(part.fittedAt)}`;
  if (part.odometer !== null && part.odometerUnit && vehicle?.currentOdometer != null) {
    const at = convertDistance(part.odometer, part.odometerUnit, vehicle.odometerUnit);
    const driven = Math.round(vehicle.currentOdometer - at);
    if (driven > 0) return `${since} · ${formatDistance(driven, vehicle.odometerUnit)}`;
  }
  const days = Math.floor((Date.now() - Date.parse(part.fittedAt)) / 86_400_000);
  return days >= 1 ? `${since} · ${spanOfDays(days)}` : since;
}

function Warranty({ until }: { until: string | null }) {
  if (!until) return null;
  const end = new Date(`${until}T00:00:00`);
  const days = Math.round((end.getTime() - Date.now()) / 86_400_000);
  const ended = days < 0;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-xs',
        ended ? 'text-muted-foreground' : days <= 60 ? 'text-warning' : 'text-muted-foreground',
      )}
    >
      <ShieldCheck
        aria-hidden="true"
        className={cn('size-3.5', !ended && days > 60 && 'text-success')}
      />
      {ended ? 'Warranty ended' : 'Warranty until'} {formatDate(`${until}T12:00:00Z`)}
    </span>
  );
}

/** The local calendar day of an instant, as the date field holds it. */
const dayOf = (iso: string) => {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

/**
 * Recording what is fitted now without an entry, or correcting a line: the line's fields and, for
 * a line of its own, when it went in and at what reading; a line on an entry keeps the entry's.
 */
function PartForm({
  vehicleId,
  position,
  part,
  onDone,
  onCancel,
}: {
  vehicleId: string;
  position: PartPosition;
  part?: VehiclePart;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { vehicle, products } = useVehicleParts(vehicleId);
  const [draft, setDraft] = useState<PartDraft>(() =>
    part
      ? draftFromPart(part)
      : draftFor(newLineId(), position, {
          specs: vehicle?.specs ?? {},
          odometerUnit: vehicle?.odometerUnit ?? 'KM',
        }),
  );
  const onEntry = Boolean(part?.eventId);
  const [day, setDay] = useState(() => (part?.fittedAt && !onEntry ? dayOf(part.fittedAt) : ''));
  const [odometer, setOdometer] = useState(() =>
    part?.odometer != null && !onEntry ? String(part.odometer) : '',
  );
  const unit = vehicle?.odometerUnit ?? 'KM';

  const save = useMutation({
    mutationFn: async () => {
      const { id: _id, position: _position, ...line } = toPartLine(draft);
      const dated = onEntry
        ? {}
        : {
            ...(day ? { fittedAt: stampForDay(day) } : {}),
            ...(odometer ? { odometer: Number(odometer), odometerUnit: unit } : {}),
          };
      if (!part) {
        await api.parts.record(vehicleId, { parts: [{ ...toPartLine(draft), ...dated }] });
        return;
      }
      // The whole line as it should read: its cost and note, which this form does not show, kept.
      const body: UpdatePart = {
        ...line,
        ...dated,
        ...(part.cost
          ? { costAmountMinor: part.cost.amountMinor, costCurrency: part.cost.currency }
          : {}),
        ...(part.notes ? { notes: part.notes } : {}),
      };
      await api.parts.update(vehicleId, part.id, body);
    },
    meta: { toast: part ? 'Part updated' : 'Part recorded' },
    onSuccess: onDone,
  });

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
      className="flex flex-col gap-4"
    >
      <PartEditor draft={draft} products={products} onChange={setDraft} />
      {onEntry ? (
        <p className="text-sm text-muted-foreground">
          Fitted with its entry on {formatDate(part!.fittedAt!)} — the entry’s date is the line’s.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <DateField
            label="Fitted"
            hint="If you know"
            value={day}
            max={localDay()}
            onChange={setDay}
            placeholder="Not sure"
          />
          <Field
            label="At"
            hint="Optional"
            inputMode="numeric"
            suffix={unit === 'MI' ? 'mi' : 'km'}
            value={odometer ? Number(odometer).toLocaleString() : ''}
            onChange={(event) => setOdometer(digitsOnly(event.target.value, 9))}
          />
        </div>
      )}
      {save.isError ? <FormError>{(save.error as Error).message}</FormError> : null}
      <ModalActions>
        <Button variant="ghost" onClick={onCancel} disabled={save.isPending}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={save.isPending}>
          {part ? 'Save the change' : 'Save what’s fitted'}
        </Button>
      </ModalActions>
    </form>
  );
}

const GROUP_LABEL: Record<(typeof PART_GROUPS)[number], string> = {
  ENGINE: 'Engine',
  DRIVETRAIN: 'Drivetrain',
  BRAKES: 'Brakes',
  TYRES: 'Tyres',
  ELECTRICAL: 'Electrical',
  BODY: 'Body',
  HULL: 'Hull',
  OTHER: 'Other parts',
};

/**
 * A position with something fitted: what is there and since when, its warranty, and — opened —
 * every line it has had, newest first. Edit and remove are the row's menu.
 */
function FittedItem({
  part,
  history,
  vehicle,
  onEdit,
  onRemove,
}: {
  part: VehiclePart;
  history: readonly VehiclePart[];
  vehicle: { currentOdometer: number | null; odometerUnit: 'KM' | 'MI' } | undefined;
  onEdit: (part: VehiclePart) => void;
  onRemove: (part: VehiclePart) => void;
}) {
  const [open, setOpen] = useState(false);
  const label = positionLabel(part.position);
  const earlier = history.length - 1;
  const menu = (line: VehiclePart) => (
    <RowMenu
      label={`More for ${positionLabel(line.position)}, ${partSummary(line)}`}
      items={[
        { label: 'Edit', icon: 'edit', onSelect: () => onEdit(line) },
        { label: 'Remove', icon: 'trash', destructive: true, onSelect: () => onRemove(line) },
      ]}
    />
  );
  return (
    <li>
      <div className="flex items-center gap-3 p-3.5">
        <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-muted">
          <Emoji name={positionEmoji(part.position)} size={24} />
        </span>
        <button
          type="button"
          aria-expanded={open}
          disabled={history.length < 2}
          onClick={() => setOpen(!open)}
          className="flex min-w-0 flex-1 items-center gap-3 text-left disabled:cursor-default"
        >
          <span className="min-w-0 flex-1">
            <span className="block text-xs font-semibold text-muted-foreground">{label}</span>
            <span className="block truncate text-base font-semibold tracking-tight text-foreground">
              {partSummary(part)}
            </span>
            <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5">
              <span className="text-xs text-muted-foreground">{fittedText(part, vehicle)}</span>
              <Warranty until={part.warrantyUntil} />
            </span>
          </span>
          {earlier > 0 ? (
            <span className="inline-flex h-6 shrink-0 items-center gap-1 rounded-full bg-muted px-2 text-xs font-semibold text-muted-foreground">
              {earlier} earlier
              <ChevronDown
                aria-hidden="true"
                className={cn('size-3.5 transition-transform', open && 'rotate-180')}
              />
            </span>
          ) : null}
        </button>
        {menu(part)}
      </div>
      {open ? (
        <ol aria-label={`${label} history`} className="flex flex-col pb-2 pl-[4.25rem] pr-3.5">
          {history.map((line) => (
            <li key={line.id} className="flex items-center gap-3 py-1">
              <span
                aria-hidden="true"
                className={cn(
                  'size-1.5 shrink-0 rounded-full',
                  line.id === part.id ? 'bg-primary' : 'bg-border',
                )}
              />
              <span className="w-28 shrink-0 text-xs tabular-nums text-muted-foreground">
                {line.fittedAt ? formatDate(line.fittedAt) : '—'}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                {partSummary(line)}
                {line.action === 'TOPPED_UP' ? (
                  <span className="text-muted-foreground"> · top-up</span>
                ) : null}
              </span>
              {menu(line)}
            </li>
          ))}
        </ol>
      ) : null}
    </li>
  );
}

/**
 * The vehicle's parts: what is fitted at each position, grouped as a workshop would — engine,
 * brakes, tyres — each with its history a press away; then the positions with nothing recorded,
 * a press to record what is there now.
 */
export function PartsPanel({ vehicleId }: { vehicleId: string }) {
  const queryClient = useQueryClient();
  const { vehicle, query, history, current, positions } = useVehicleParts(vehicleId);
  const [form, setForm] = useState<{ position: PartPosition; part?: VehiclePart } | null>(null);
  const [removing, setRemoving] = useState<VehiclePart | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.parts(vehicleId) });

  const remove = useMutation({
    mutationFn: (part: VehiclePart) => api.parts.remove(vehicleId, part.id),
    meta: { toast: 'Removed from the history' },
    onSuccess: () => {
      setRemoving(null);
      void refresh();
    },
  });

  if (query.isPending) {
    return (
      <Loading label="Loading parts">
        <ListSkeleton rows={3} />
      </Loading>
    );
  }
  if (query.isError && !query.data) {
    return <FormError>{(query.error as Error).message}</FormError>;
  }

  const others = history.filter((part) => part.position === 'OTHER');
  const groups = PART_GROUPS.map((group) => ({
    group,
    fitted: [...current.keys()].filter(
      (position) => (partPosition(position)?.group ?? 'OTHER') === group,
    ),
  })).filter((entry) => entry.fitted.length > 0);
  const unrecorded = positions.filter((position) => position !== 'OTHER' && !current.has(position));
  const edit = (part: VehiclePart) => setForm({ position: part.position as PartPosition, part });

  const card = (children: ReactNode) => (
    <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-2xl bg-card/50">
      {children}
    </ul>
  );

  return (
    <div className="flex flex-col gap-8">
      {form ? (
        <Modal
          title={`${form.part ? 'Edit' : 'Record'} ${positionLabel(form.position).toLowerCase()}`}
          description={
            form.part
              ? 'The whole line as it should read.'
              : 'What is fitted now. Every service you log fills it in from here.'
          }
          onClose={() => setForm(null)}
        >
          <PartForm
            vehicleId={vehicleId}
            position={form.position}
            part={form.part}
            onDone={() => {
              setForm(null);
              void refresh();
            }}
            onCancel={() => setForm(null)}
          />
        </Modal>
      ) : null}
      {removing ? (
        <ConfirmDelete
          title={`Remove ${positionLabel(removing.position).toLowerCase()}?`}
          description={`${partSummary(removing)} leaves the history. The entry it came with stays.`}
          confirmLabel="Remove"
          pending={remove.isPending}
          error={remove.isError ? (remove.error as Error).message : null}
          onConfirm={() => remove.mutate(removing)}
          onClose={() => setRemoving(null)}
        />
      ) : null}

      {groups.length === 0 && others.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl bg-card/50 px-6 py-10 text-center">
          <Emoji name="maintenance" size={32} />
          <p className="text-base font-semibold text-foreground">What’s in it, and since when</p>
          <p className="max-w-md text-sm text-muted-foreground">
            Record the oil, tyres and battery fitted now. Every service you log from here fills it
            in, and next time is one press: same as last time.
          </p>
        </div>
      ) : null}

      {groups.map(({ group, fitted }) => (
        <section
          key={group}
          aria-label={GROUP_LABEL[group]}
          className="flex animate-rise flex-col gap-2"
        >
          <h3 className="px-1 text-label uppercase text-muted-foreground">{GROUP_LABEL[group]}</h3>
          {card(
            fitted.map((position) => (
              <FittedItem
                key={position}
                part={current.get(position)!}
                history={history.filter((part) => part.position === position)}
                vehicle={vehicle}
                onEdit={edit}
                onRemove={setRemoving}
              />
            )),
          )}
        </section>
      ))}

      {others.length > 0 ? (
        <section aria-label={GROUP_LABEL.OTHER} className="flex flex-col gap-2">
          <h3 className="px-1 text-label uppercase text-muted-foreground">{GROUP_LABEL.OTHER}</h3>
          {card(
            others.map((part) => (
              <Fragment key={part.id}>
                <FittedItem
                  part={part}
                  history={[part]}
                  vehicle={vehicle}
                  onEdit={edit}
                  onRemove={setRemoving}
                />
              </Fragment>
            )),
          )}
        </section>
      ) : null}

      {unrecorded.length > 0 ? (
        <section aria-label="Not recorded yet" className="flex flex-col gap-2">
          <h3 className="px-1 text-label uppercase text-muted-foreground">
            {groups.length ? 'Not recorded yet' : 'Record what’s fitted'}
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {unrecorded.map((position) => (
              <button
                key={position}
                type="button"
                aria-haspopup="dialog"
                onClick={() => setForm({ position })}
                className={cn(CHIP, 'bg-muted text-foreground hover:bg-border')}
              >
                <Emoji name={positionEmoji(position)} size={16} />
                {positionLabel(position)}
              </button>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

/** An entry's own lines, for its details: what went in with it. Nothing when it has none. */
export function EntryParts({ vehicleId, eventId }: { vehicleId: string; eventId: string }) {
  const parts = useQuery(partsQuery(api, vehicleId));
  const lines = (parts.data?.data ?? NO_PARTS).filter((part) => part.eventId === eventId);
  if (lines.length === 0) return null;
  return (
    <section aria-label="Parts and fluids" className="flex flex-col gap-2">
      <h3 className="text-label uppercase text-muted-foreground">Parts &amp; fluids</h3>
      <ul className="flex flex-col gap-1.5">
        {lines.map((part) => (
          <li
            key={part.id}
            className="flex min-w-0 items-center gap-3 rounded-xl bg-muted/60 px-3.5 py-2.5"
          >
            <Emoji name={positionEmoji(part.position)} size={22} />
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-semibold text-muted-foreground">
                {positionLabel(part.position)}
                {part.action === 'TOPPED_UP' ? ' · top-up' : ''}
              </span>
              <span className="block truncate text-sm font-semibold text-foreground">
                {partSummary(part)}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
