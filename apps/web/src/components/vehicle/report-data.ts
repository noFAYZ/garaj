'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import {
  costQuery,
  expenseLedgerQuery,
  readingsQuery,
  vehicleQuery,
} from '@vehicle-os/api-client/react';
import { minorUnitExponent } from '@vehicle-os/domain';
import {
  buildSpendReport,
  distanceInWindow,
  periodOf,
  periodStart,
  type ReportGroup,
  type ReportPeriod,
} from '@vehicle-os/ui';
import { api } from '@/lib/api';
import type { IconName } from '@/components/icons';
import { windowStart } from '@/components/vehicle/spending-panel';
import { formatDistance, formatMoney, formatMoneyCompact, formatMoneyWhole } from '@/lib/format';

/** The report's tabs, in the order a person asks the questions: all of it, then each part. */
export const REPORT_TABS = [
  { value: 'overview', label: 'Overview', icon: 'pie' },
  { value: 'refueling', label: 'Refueling', icon: 'fuel' },
  { value: 'expenses', label: 'Expenses', icon: 'receipt' },
  { value: 'income', label: 'Income', icon: 'income' },
  { value: 'services', label: 'Services', icon: 'maintenance' },
  { value: 'routes', label: 'Routes', icon: 'route' },
] as const satisfies readonly { value: string; label: string; icon: IconName }[];
export type ReportTab = (typeof REPORT_TABS)[number]['value'];

export const isReportTab = (value: unknown): value is ReportTab =>
  REPORT_TABS.some((tab) => tab.value === value);

/** The tab each spend group opens, so a slice of the overview is a way into its detail. */
export const TAB_OF_GROUP: Record<ReportGroup, ReportTab> = {
  REFUELING: 'refueling',
  SERVICES: 'services',
  EXPENSES: 'expenses',
};

/**
 * Everything the tabs share: one ledger for the window, the readings that measure its distance,
 * and the lifetime summary that names the currency. Built once on the page and handed to the tab
 * shown, so switching tabs recomputes nothing and refetches nothing.
 *
 * Both window queries keep the previous window's rows while the next loads — a period switch is a
 * filter, and a filter that blanks what it is narrowing reads as a reload.
 */
export function useVehicleReport(vehicleId: string, period: ReportPeriod) {
  const from = periodStart(periodOf(period).months);
  const vehicle = useQuery(vehicleQuery(api, vehicleId));
  // The currency and the lifetime figures: the same entry the vehicle header reads.
  const cost = useQuery(costQuery(api, vehicleId, { from: windowStart(12) }));
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
    /** The vehicle's own unit, for every distance on every tab. */
    odometerUnit: vehicle.data?.odometerUnit ?? cost.data?.distanceUnit ?? 'KM',
    /** True while a new window loads over the last one's figures. */
    refreshing: ledger.isPlaceholderData || readings.isPlaceholderData,
    error: ledger.error ?? cost.error ?? null,
  };
}
export type VehicleReport = ReturnType<typeof useVehicleReport>;

/* ——— Figures, set the one way everywhere in the report ——— */

export const pad = (value: number) => String(value).padStart(2, '0');

/** Whole units, for a headline figure. */
export const money = (amountMinor: number, currency: string) =>
  formatMoneyWhole({ amountMinor: Math.round(amountMinor), currency });

/** With cents, for a rate — a cost per kilometre in whole euros is always €0. */
export const cents = (amountMinor: number, currency: string) =>
  formatMoney({ amountMinor: Math.round(amountMinor), currency });

export const compact = formatMoneyCompact;

/** "1.759" — a pump's three places; the currency is said once, beside it or in the label. */
export const perUnit = (amountMinor: number, currency: string) =>
  (amountMinor / 10 ** minorUnitExponent(currency)).toFixed(3);

export const UNIT_LABEL: Record<string, string> = {
  LITER: 'L',
  US_GALLON: 'gal',
  IMP_GALLON: 'gal',
  KWH: 'kWh',
  KG: 'kg',
};

export const distanceLabel = (unit: 'KM' | 'MI') => (unit === 'MI' ? 'mi' : 'km');

export { formatDistance };
