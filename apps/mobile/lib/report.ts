import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import {
  costQuery,
  expenseLedgerQuery,
  readingsQuery,
  vehicleQuery,
} from '@vehicle-os/api-client/react';
import {
  buildSpendReport,
  distanceInWindow,
  periodOf,
  periodStart,
  type ReportPeriod,
} from '@vehicle-os/ui';
import { api } from './api';

/** The report's tabs, as the web names them — one report on both. */
export const REPORT_TABS = [
  { value: 'overview', label: 'Overview', glyph: '📊' },
  { value: 'refueling', label: 'Refueling', glyph: '⛽' },
  { value: 'expenses', label: 'Expenses', glyph: '🧾' },
  { value: 'income', label: 'Income', glyph: '💵' },
  { value: 'services', label: 'Services', glyph: '🧰' },
  { value: 'routes', label: 'Routes', glyph: '🛣️' },
] as const;
export type ReportTab = (typeof REPORT_TABS)[number]['value'];

/**
 * Everything the tabs share, built once: the window's ledger, the readings that measure its
 * distance, and the lifetime summary that names the currency. The same inputs and the same
 * `@vehicle-os/ui` maths as the web's report, so a figure reads the same on both.
 *
 * The window queries keep the last window's rows while the next loads: a period switch is a
 * filter, and a filter that blanks what it narrows reads as a reload.
 */
export function useVehicleReport(vehicleId: string, period: ReportPeriod) {
  const from = periodStart(periodOf(period).months);
  const vehicle = useQuery(vehicleQuery(api, vehicleId));
  // Lifetime: the same entry the vehicle's pass reads, so opening Stats fetches nothing new.
  const cost = useQuery(costQuery(api, vehicleId));
  const ledger = useQuery({
    ...expenseLedgerQuery(api, vehicleId, from),
    placeholderData: keepPreviousData,
  });
  const readings = useQuery({
    ...readingsQuery(api, vehicleId, from),
    placeholderData: keepPreviousData,
  });

  const currency = cost.data?.currency;
  const spend = useMemo(
    () => (currency && ledger.data ? buildSpendReport(ledger.data, { currency, from }) : undefined),
    [currency, ledger.data, from],
  );
  const distance =
    spend && readings.data
      ? distanceInWindow(readings.data, from ? spend.fromMs : 0, spend.toMs)
      : null;

  return {
    vehicleId,
    period: periodOf(period),
    from,
    vehicle: vehicle.data,
    cost: cost.data,
    spend,
    distance,
    odometerUnit: vehicle.data?.odometerUnit ?? cost.data?.distanceUnit ?? 'KM',
    refreshing: ledger.isPlaceholderData || readings.isPlaceholderData,
    error: ledger.error ?? cost.error ?? null,
    refetch: () => void Promise.all([ledger.refetch(), readings.refetch(), cost.refetch()]),
  };
}
export type VehicleReport = ReturnType<typeof useVehicleReport>;
