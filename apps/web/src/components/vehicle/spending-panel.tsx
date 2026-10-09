'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import type { Expense } from '@vehicle-os/contracts';
import {
  EXPENSE_CATEGORIES,
  FUEL_TYPES,
  type ExpenseCategory,
  type FuelType,
} from '@vehicle-os/domain';
import { ApiError } from '@vehicle-os/api-client';
import { localDay, stampForDay } from '@vehicle-os/ui';
import { api } from '@/lib/api';
import { DateField } from '@/components/ui/date-picker';
import { Icon } from '@/components/icons';
import { FormError, Modal, ModalActions } from '@/components/ui/modal';
import { ConfirmDelete, RowMenu } from '@/components/ui/row-actions';
import { Button, Field, SectionCard } from '@/components/ui/primitives';
import { SelectField } from '@/components/ui/select-field';
import { ListSkeleton, Loading } from '@/components/ui/skeleton';
import {
  formatDate,
  formatDistance,
  formatMoney,
  fromMinorUnits,
  humanise,
  toMinorUnits,
} from '@/lib/format';

/**
 * The start of a window, as midnight UTC on the day.
 *
 * Not this instant: the value is part of the query key, and a timestamp computed at render
 * changed every millisecond — every re-render was a new key, a new request, and a cache entry
 * nothing would ever read again. A day boundary keeps the key stable all day, which is also
 * what lets the at-a-glance figure and the report share one request.
 */
export function windowStart(months: number | null): string | undefined {
  if (months === null) return undefined;
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, now.getUTCDate()),
  ).toISOString();
}

/** Rows shown before "Show all": a report tab reads, it is not a spreadsheet. */
const FIRST = 6;

type Sheet =
  { kind: 'new' } | { kind: 'edit'; expense: Expense } | { kind: 'delete'; expense: Expense };

/**
 * A report tab's own entries, newest first — the one place on the web an amount is recorded or
 * corrected. Each tab passes its slice of the one ledger the report is built from, so a row here
 * is always a row in the figures above it. Recording and correcting open a dialog; deleting takes
 * a second press.
 */
export function ExpenseLedger({
  vehicleId,
  rows,
  currency,
  unitLabel,
  defaultCategory,
  title,
  description,
  pending,
}: {
  vehicleId: string;
  rows: readonly Expense[] | undefined;
  currency: string;
  unitLabel: string;
  /** What "Record" starts as on this tab: a fill on Refueling, a service on Services. */
  defaultCategory: ExpenseCategory;
  title: string;
  description: string;
  pending: boolean;
}) {
  const queryClient = useQueryClient();
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [all, setAll] = useState(false);
  const close = () => setSheet(null);

  // An expense moves the totals, the report, the activity and — with an odometer — the header.
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['vehicles', vehicleId] });

  const remove = useMutation({
    mutationFn: (expenseId: string) => api.expenses.remove(vehicleId, expenseId),
    onSuccess: () => {
      refresh();
      close();
    },
    meta: { toast: 'Expense deleted' },
  });

  const list = rows ?? [];
  const shown = all ? list : list.slice(0, FIRST);

  return (
    <SectionCard
      title={title}
      description={description}
      icon={<Icon name="timeline" size={20} />}
      action={
        <Button size="sm" onClick={() => setSheet({ kind: 'new' })}>
          <Plus className="size-4" aria-hidden="true" />
          Record
        </Button>
      }
    >
      {pending && !rows ? (
        <Loading label="Loading entries">
          <ListSkeleton rows={3} />
        </Loading>
      ) : list.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing recorded in this period.</p>
      ) : (
        <>
          <ol className="flex flex-col gap-2">
            {shown.map((item) => (
              <li key={item.id} className="flex items-center gap-3 rounded-xl bg-card p-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-foreground">
                    {item.description}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    <time dateTime={item.occurredAt} className="tabular-nums">
                      {formatDate(item.occurredAt)}
                    </time>
                    {` · ${humanise(item.category)}`}
                    {item.vendor ? ` · ${item.vendor}` : ''}
                    {item.quantity
                      ? ` · ${quantity(item.quantity)} ${quantityLabel(item.quantityUnit)}`
                      : ''}
                    {item.energyKwh ? ` · ${quantity(item.energyKwh)} kWh` : ''}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="font-mono text-sm font-semibold tabular-nums text-foreground">
                    {formatMoney(item.amount)}
                  </div>
                  {item.odometer !== null ? (
                    <div className="font-mono text-xs tabular-nums text-muted-foreground">
                      {formatDistance(item.odometer, item.odometerUnit)}
                    </div>
                  ) : null}
                </div>
                <RowMenu
                  label={`More for ${item.description}`}
                  items={[
                    {
                      label: 'Correct entry',
                      icon: 'edit',
                      onSelect: () => setSheet({ kind: 'edit', expense: item }),
                    },
                    {
                      label: 'Delete entry',
                      icon: 'trash',
                      destructive: true,
                      onSelect: () => setSheet({ kind: 'delete', expense: item }),
                    },
                  ]}
                />
              </li>
            ))}
          </ol>
          {list.length > FIRST ? (
            <Button
              variant="ghost"
              size="sm"
              className="mt-3"
              aria-expanded={all}
              onClick={() => setAll((open) => !open)}
            >
              {all ? 'Show fewer' : `Show all ${list.length}`}
            </Button>
          ) : null}
        </>
      )}

      {sheet?.kind === 'new' || sheet?.kind === 'edit' ? (
        <Modal
          title={sheet.kind === 'edit' ? 'Correct this entry' : 'Record an expense'}
          description={
            sheet.kind === 'edit'
              ? 'Every figure in the report moves with it.'
              : `Amounts in ${currency}.`
          }
          icon="money"
          onClose={close}
        >
          <ExpenseForm
            vehicleId={vehicleId}
            currency={currency}
            unitLabel={unitLabel}
            defaultCategory={defaultCategory}
            expense={sheet.kind === 'edit' ? sheet.expense : undefined}
            onDone={() => {
              refresh();
              close();
            }}
            onCancel={close}
          />
        </Modal>
      ) : null}

      {sheet?.kind === 'delete' ? (
        /* A hard delete server-side, and every total in the report moves with it. */
        <ConfirmDelete
          title={`Delete “${sheet.expense.description}”?`}
          description="It leaves every total and chart in this report. This cannot be undone."
          confirmLabel="Delete entry"
          pending={remove.isPending}
          error={remove.isError ? (remove.error as Error).message : null}
          onConfirm={() => remove.mutate(sheet.expense.id)}
          onClose={close}
        />
      ) : null}
    </SectionCard>
  );
}

/** `46.0000` → `46`, `38.25` → `38.25`: the column keeps four places, a person reads two. */
const quantity = (value: string) =>
  Number(value).toLocaleString('en-US', { maximumFractionDigits: 2 });

function quantityLabel(unit: string | null): string {
  if (unit === 'LITER') return 'L';
  if (unit === 'US_GALLON') return 'US gal';
  if (unit === 'IMP_GALLON') return 'imp gal';
  if (unit === 'KG') return 'kg';
  return '';
}

/**
 * One form for recording and for correcting, bare — the dialog owns the heading.
 *
 * The fields are identical, and a second copy of them would drift from this one the first time
 * a field is added — the correction form would quietly stop offering something the entry form
 * asks for.
 */
function ExpenseForm({
  vehicleId,
  currency,
  unitLabel,
  defaultCategory,
  expense,
  onDone,
  onCancel,
}: {
  vehicleId: string;
  currency: string;
  unitLabel: string;
  defaultCategory: ExpenseCategory;
  /** Present when correcting an existing row; absent when recording a new one. */
  expense?: Expense;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [category, setCategory] = useState<ExpenseCategory>(expense?.category ?? defaultCategory);
  const [description, setDescription] = useState(expense?.description ?? '');
  const [vendor, setVendor] = useState(expense?.vendor ?? '');
  const [amount, setAmount] = useState(
    expense ? String(fromMinorUnits(expense.amount.amountMinor, expense.amount.currency)) : '',
  );
  // The local day: an expense logged just after midnight belongs to today, not UTC's yesterday.
  const originalDay = expense ? localDay({}, new Date(expense.occurredAt)) : null;
  const [occurredAt, setOccurredAt] = useState(() => originalDay ?? localDay());
  const [odometer, setOdometer] = useState(expense?.odometer?.toString() ?? '');
  const [quantity, setQuantity] = useState(expense?.quantity ?? expense?.energyKwh ?? '');
  const [fuelType, setFuelType] = useState<FuelType | ''>(expense?.fuelType ?? '');
  const [entryCurrency, setEntryCurrency] = useState(expense?.amount.currency ?? currency);

  const isFuel = category === 'FUEL' || category === 'CHARGING';

  const mutation = useMutation({
    mutationFn: () => {
      const body = {
        category,
        description,
        // How many minor units per unit depends on the currency — 25 JPY is 25, 25 USD is
        // 2500. Rounding here also keeps the float out of the request entirely.
        amountMinor: toMinorUnits(Number(amount), entryCurrency),
        currency: entryCurrency,
        // The real time it was logged, so it sorts among the day's other entries (`stampForDay`).
        // An edit that keeps the day keeps the moment, so saving it does not reshuffle the record.
        occurredAt:
          expense && occurredAt === originalDay ? expense.occurredAt : stampForDay(occurredAt),
        ...(vendor ? { vendor } : {}),
        ...(odometer
          ? {
              odometer: Number(odometer),
              odometerUnit: unitLabel === 'mi' ? ('MI' as const) : ('KM' as const),
            }
          : {}),
        // Sent as text, not a number: the column is `numeric` so litres and kWh stay exact.
        ...(fuelType && isFuel ? { fuelType } : {}),
        ...(quantity && category === 'FUEL'
          ? { quantity, quantityUnit: 'LITER' as const }
          : quantity && category === 'CHARGING'
            ? { energyKwh: quantity }
            : {}),
      };

      return expense
        ? api.expenses.update(vehicleId, expense.id, body)
        : api.expenses.create(vehicleId, body);
    },
    onSuccess: onDone,
    meta: { toast: expense ? 'Entry corrected' : 'Expense recorded' },
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
        <SelectField
          label="Category"
          value={category}
          onChange={(next) => setCategory(next as ExpenseCategory)}
          options={EXPENSE_CATEGORIES.map((value) => ({ value, label: humanise(value) }))}
        />
        <DateField
          label="Date"
          value={occurredAt}
          onChange={setOccurredAt}
          error={fieldErrors?.occurredAt}
          required
        />
      </div>

      <Field
        label="What it was"
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        placeholder="Fill-up, annual insurance, new tyres"
        error={fieldErrors?.description}
        required
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field
          label="Amount"
          type="number"
          inputMode="decimal"
          min={0}
          step="0.01"
          suffix={entryCurrency}
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          error={fieldErrors?.amountMinor ?? fieldErrors?.currency}
          required
        />
        {/*
         * Overridable per entry, because one tank of fuel abroad is a real thing and the report
         * says what it could not add up rather than converting it at a guess.
         */}
        <Field
          label="Currency"
          value={entryCurrency}
          onChange={(event) => setEntryCurrency(event.target.value.toUpperCase().slice(0, 3))}
          maxLength={3}
          error={fieldErrors?.currency}
          required
        />
        <Field
          label="Odometer"
          type="number"
          inputMode="numeric"
          min={0}
          suffix={unitLabel}
          value={odometer}
          onChange={(event) => setOdometer(event.target.value)}
          error={fieldErrors?.odometer}
        />
        {isFuel ? (
          /*
           * Unset is a real answer: a receipt that does not say, and every fill-up recorded
           * before this field existed, are both "not stated" rather than a guess at gasoline.
           */
          <SelectField
            label="What went in"
            value={fuelType}
            onChange={(next) => setFuelType(next as FuelType | '')}
            options={[
              { value: '', label: 'Not stated' },
              ...FUEL_TYPES.map((value) => ({ value, label: humanise(value) })),
            ]}
          />
        ) : null}
        {isFuel ? (
          <Field
            label={category === 'FUEL' ? 'Litres' : 'kWh'}
            inputMode="decimal"
            suffix={category === 'FUEL' ? 'L' : 'kWh'}
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            error={fieldErrors?.quantity ?? fieldErrors?.energyKwh}
          />
        ) : null}
        <Field
          label={isFuel ? 'Station' : 'Who from'}
          value={vendor}
          onChange={(event) => setVendor(event.target.value)}
          error={fieldErrors?.vendor}
        />
      </div>

      {mutation.isError && !fieldErrors ? (
        <FormError>{(mutation.error as Error).message}</FormError>
      ) : null}

      <ModalActions>
        <Button variant="ghost" onClick={onCancel} disabled={mutation.isPending}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={mutation.isPending}>
          {expense ? 'Save changes' : 'Record expense'}
        </Button>
      </ModalActions>
    </form>
  );
}
