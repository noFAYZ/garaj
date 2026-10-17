'use client';

import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import type { ConditionAssessment, VehiclePhoto } from '@vehicle-os/contracts';
import {
  CONDITION_CATEGORIES,
  VALUATION_SOURCES,
  type ConditionCategory,
} from '@vehicle-os/domain';
import { ApiError, uploadPhoto } from '@vehicle-os/api-client';
import { api } from '@/lib/api';
import { DateField } from '@/components/ui/date-picker';
import { Icon } from '@/components/icons';
import { buttonClass } from '@/components/ui/button-class';
import { FormError, ModalActions } from '@/components/ui/modal';
import { Button, Field } from '@/components/ui/primitives';
import { SelectField } from '@/components/ui/select-field';
import { formatDate, humanise, toMinorUnits } from '@/lib/format';
import { useVehicleUnits } from '@/lib/vehicle-units';

export const ASSESS_DESCRIPTION =
  'Score what you actually looked at. Leave the rest blank — a blank is not a zero.';

/** One condition check: when, its score, what was scored, its photos — and correcting or deleting it. */
export function AssessmentRow({
  vehicleId,
  assessment,
  photos,
  onEdit,
  onDeleted,
}: {
  vehicleId: string;
  assessment: ConditionAssessment;
  photos: readonly VehiclePhoto[];
  onEdit: () => void;
  onDeleted: () => void;
}) {
  const remove = useMutation({
    mutationFn: () => api.condition.remove(vehicleId, assessment.id),
    onSuccess: onDeleted,
  });

  const scored = assessment.items.filter((item) => item.score !== null).length;
  const when = formatDate(assessment.assessedAt);

  return (
    <li className="flex flex-col gap-3 rounded-xl bg-card p-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-foreground">
            {when}
            {assessment.overallScore !== null ? (
              <span className="tabular-nums"> · {assessment.overallScore} out of 100</span>
            ) : null}
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {scored} of {assessment.items.length}{' '}
            {assessment.items.length === 1 ? 'category' : 'categories'} scored
            {assessment.notes ? ` · ${assessment.notes}` : ''}
          </div>
        </div>
        <button
          type="button"
          onClick={onEdit}
          aria-label={`Edit the assessment of ${when}`}
          className={buttonClass('ghost', 'icon-sm')}
        >
          <Icon name="edit" size={16} />
        </button>
        <button
          type="button"
          disabled={remove.isPending}
          aria-label={`Delete the assessment of ${when}`}
          onClick={() => {
            // It was deleted on one click; it carries scores the health score is built from.
            if (window.confirm(`Delete the assessment of ${when}?`)) remove.mutate();
          }}
          className={buttonClass(
            'ghost',
            'icon-sm',
            'hover:bg-destructive-soft hover:text-destructive',
          )}
        >
          <Icon name="trash" size={16} />
        </button>
      </div>

      {photos.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {photos.map((photo) => (
            <li key={photo.id}>
              <a href={photo.url ?? undefined} target="_blank" rel="noopener noreferrer">
                <img
                  src={photo.thumbnailUrl ?? undefined}
                  alt={photo.caption ?? `Photo from the assessment of ${when}`}
                  loading="lazy"
                  className="size-16 rounded-lg object-cover"
                />
              </a>
            </li>
          ))}
        </ul>
      ) : null}

      {remove.isError ? (
        <p role="alert" className="text-xs text-destructive">
          {(remove.error as Error).message}
        </p>
      ) : null}
    </li>
  );
}

export function ValuationForm({
  vehicleId,
  onDone,
  onCancel,
}: {
  vehicleId: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  // The vehicle's own currency, not a guess: a euro car valued in dollars is a wrong number.
  const { currency } = useVehicleUnits(vehicleId);
  const [amount, setAmount] = useState('');
  const [valuationDate, setValuationDate] = useState(new Date().toISOString().slice(0, 10));
  const [source, setSource] = useState<(typeof VALUATION_SOURCES)[number]>('USER_ESTIMATE');
  const [notes, setNotes] = useState('');

  const mutation = useMutation({
    mutationFn: () =>
      api.valuations.create(vehicleId, {
        // Minor units per unit depend on the currency — 25 JPY is 25, 25 USD is 2500.
        amountMinor: toMinorUnits(Number(amount), currency),
        currency,
        valuationDate,
        source,
        ...(notes ? { notes } : {}),
      }),
    onSuccess: onDone,
  });

  const fieldErrors = mutation.error instanceof ApiError ? mutation.error.fields : undefined;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        mutation.mutate();
      }}
      className="flex flex-col gap-4"
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field
          label="Worth"
          type="number"
          inputMode="decimal"
          min={0}
          step="0.01"
          suffix={currency}
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          error={fieldErrors?.amountMinor ?? fieldErrors?.currency}
          required
          autoFocus
        />
        <DateField
          label="As at"
          value={valuationDate}
          onChange={setValuationDate}
          error={fieldErrors?.valuationDate}
          required
        />
      </div>

      <SelectField
        label="Where from"
        value={source}
        onChange={(next) => setSource(next as (typeof VALUATION_SOURCES)[number])}
        options={VALUATION_SOURCES.map((value) => ({ value, label: humanise(value) }))}
      />

      <Field
        label="Notes"
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
        placeholder="Trade-in quote from the dealer"
      />

      {mutation.isError && !fieldErrors ? (
        <FormError>{(mutation.error as Error).message}</FormError>
      ) : null}

      <ModalActions>
        <Button variant="ghost" onClick={onCancel} disabled={mutation.isPending}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={mutation.isPending} disabled={!amount}>
          Save value
        </Button>
      </ModalActions>
    </form>
  );
}

export function AssessmentForm({
  vehicleId,
  initial,
  onDone,
  onCancel,
}: {
  vehicleId: string;
  initial: ConditionAssessment | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { odometerUnit } = useVehicleUnits(vehicleId);
  const initialDate = initial?.assessedAt.slice(0, 10) ?? new Date().toISOString().slice(0, 10);
  const [assessedAt, setAssessedAt] = useState(initialDate);
  const [odometer, setOdometer] = useState(initial?.odometer?.toString() ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  // Only the categories actually scored are sent — a category left blank means "did not look",
  // which is different from scoring it zero.
  const [scores, setScores] = useState<Partial<Record<ConditionCategory, string>>>(() =>
    Object.fromEntries(
      (initial?.items ?? [])
        .filter((item) => item.score !== null)
        .map((item) => [item.category, String(item.score)]),
    ),
  );
  /*
   * An edit resends the scores only once one is touched. An item scored "could not judge" has
   * no slider position, so resending untouched scores would silently drop it.
   */
  const [scoresTouched, setScoresTouched] = useState(false);
  const [files, setFiles] = useState<File[]>([]);

  const touchScores: typeof setScores = (next) => {
    setScoresTouched(true);
    setScores(next);
  };

  const items = CONDITION_CATEGORIES.filter((category) => scores[category] !== undefined).map(
    (category) => ({ category, score: Number(scores[category]) }),
  );
  const sendItems = !initial || scoresTouched;

  const mutation = useMutation({
    mutationFn: async () => {
      const reading = odometer ? { odometer: Number(odometer), odometerUnit } : {};

      const saved = initial
        ? await api.condition.update(vehicleId, initial.id, {
            // An unchanged date keeps the time it was recorded with.
            ...(assessedAt === initialDate
              ? {}
              : { assessedAt: new Date(`${assessedAt}T12:00:00Z`).toISOString() }),
            ...reading,
            notes,
            ...(sendItems ? { items } : {}),
          })
        : await api.condition.create(vehicleId, {
            assessedAt: new Date(`${assessedAt}T12:00:00Z`).toISOString(),
            ...reading,
            ...(notes ? { notes } : {}),
            items,
          });

      // ponytail: one at a time. A handful of close-ups does not need a parallel queue.
      for (const file of files) {
        await uploadPhoto(api, vehicleId, file, { conditionAssessmentId: saved.id });
      }
    },
    onSuccess: onDone,
  });

  const fieldErrors = mutation.error instanceof ApiError ? mutation.error.fields : undefined;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        mutation.mutate();
      }}
      className="flex flex-col gap-4"
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <DateField
          label="Assessed on"
          value={assessedAt}
          onChange={setAssessedAt}
          error={fieldErrors?.assessedAt}
          required
        />
        <Field
          label="Odometer"
          type="number"
          inputMode="numeric"
          min={0}
          suffix={odometerUnit === 'MI' ? 'mi' : 'km'}
          value={odometer}
          onChange={(event) => setOdometer(event.target.value)}
          error={fieldErrors?.odometer}
        />
      </div>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-sm font-medium text-foreground">Categories</legend>
        {CONDITION_CATEGORIES.map((category) => {
          const value = scores[category];
          return (
            <div key={category} className="flex items-center gap-3">
              <label
                htmlFor={`score-${category}`}
                className="w-24 shrink-0 truncate text-sm text-foreground sm:w-28"
              >
                {humanise(category)}
              </label>
              <input
                id={`score-${category}`}
                type="range"
                min={0}
                max={100}
                step={5}
                value={value ?? 80}
                disabled={value === undefined}
                onChange={(event) =>
                  touchScores((current) => ({ ...current, [category]: event.target.value }))
                }
                className="min-w-0 flex-1 accent-primary disabled:opacity-40"
              />
              <span className="w-8 shrink-0 text-right text-sm tabular-nums text-foreground">
                {value ?? '—'}
              </span>
              <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={value !== undefined}
                  onChange={(event) =>
                    touchScores((current) => {
                      const next = { ...current };
                      if (event.target.checked) next[category] = '80';
                      else delete next[category];
                      return next;
                    })
                  }
                  className="accent-primary"
                />
                Checked
              </label>
            </div>
          );
        })}
      </fieldset>

      <Field
        label="Notes"
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
        placeholder="Nearside rear tyre close to the wear bars"
      />

      <div className="flex flex-col gap-1.5">
        <label htmlFor="assessment-photos" className="text-sm font-medium text-foreground">
          {initial ? 'Add photos' : 'Photos'}
        </label>
        <input
          id="assessment-photos"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          onChange={(event) => setFiles([...(event.target.files ?? [])])}
          className="text-sm text-muted-foreground file:mr-3 file:rounded-lg file:border-0 file:bg-muted file:px-3 file:py-2 file:text-sm file:text-foreground"
        />
        <p className="text-xs text-muted-foreground">
          The scratch, the tyre wear: what the scores are based on.
        </p>
      </div>

      {mutation.isError && !fieldErrors ? (
        <FormError>{(mutation.error as Error).message}</FormError>
      ) : null}

      <ModalActions>
        <Button variant="ghost" onClick={onCancel} disabled={mutation.isPending}>
          Cancel
        </Button>
        <Button
          type="submit"
          variant="primary"
          loading={mutation.isPending}
          disabled={sendItems && items.length === 0}
        >
          {!sendItems
            ? 'Save'
            : `Save ${items.length || 'no'} ${items.length === 1 ? 'score' : 'scores'}`}
        </Button>
      </ModalActions>
    </form>
  );
}
