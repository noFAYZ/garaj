'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type ReactNode } from 'react';
import { Download, Plus } from 'lucide-react';
import type { Expense } from '@vehicle-os/contracts';
import { INCOME_CATEGORIES, type ExpenseCategory, type IncomeCategory } from '@vehicle-os/domain';
import { ApiError, planWall } from '@vehicle-os/api-client';
import {
  costTrendsQuery,
  incomeLedgerQuery,
  mileageReportQuery,
  monthlySpendQuery,
  valuationsQuery,
} from '@vehicle-os/api-client/react';
import {
  REPORT_GROUPS,
  REPORT_PERIODS,
  TRIP_PURPOSES,
  bucketLabel,
  buildIncomeReport,
  buildRefuelReport,
  buildRoutesReport,
  depreciationPerYear,
  distancePerYear,
  efficiencyInWindow,
  groupDetail,
  localDay,
  monthlyPace,
  monthsSince,
  stampForDay,
  trueCostPerDistance,
  type ReportGroup,
  type ReportPeriod,
  type SpendReport,
} from '@vehicle-os/ui';
import { api } from '@/lib/api';
import { DateField } from '@/components/ui/date-picker';
import { CHART, ColumnChart, Donut, LineChart, RankBars, SplitBar } from '@/components/charts';
import { Icon } from '@/components/icons';
import { PrintButton } from '@/components/print-report';
import { save } from '@/components/transfer-panel';
import { LockedFeature } from '@/components/upgrade-dialog';
import { FormError, Modal, ModalActions } from '@/components/ui/modal';
import { Readings } from '@/components/ui/overview';
import { Button, EmptyState, Field, SectionCard, TileRow } from '@/components/ui/primitives';
import { SelectField } from '@/components/ui/select-field';
import { Skeleton } from '@/components/ui/skeleton';
import { HealthPanel } from '@/components/vehicle/health-panel';
import { ExpenseLedger } from '@/components/vehicle/spending-panel';
import { ValuePanel } from '@/components/vehicle/value-panel';
import { formatDate, formatMoney, formatRelative, humanise, toMinorUnits } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  TAB_OF_GROUP,
  UNIT_LABEL,
  cents,
  compact,
  distanceLabel,
  formatDistance,
  money,
  pad,
  perUnit,
  type ReportTab,
  type VehicleReport,
} from './report-data';

/* ——— Navigation ——— */

/**
 * The period, one row above the report. The part of the report is chosen beside the vehicle's
 * sections (`ReportPicker` in vehicle-tabs). Both live in the URL, so a report is a link — "the
 * services tab, last six months" — and the back button walks back through them.
 */
export function ReportNav({
  period,
  onPeriod,
  refreshing,
}: {
  period: ReportPeriod;
  onPeriod: (period: ReportPeriod) => void;
  refreshing: boolean;
}) {
  return (
    <div className="print:hidden">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          role="group"
          aria-label="Period"
          className="inline-flex gap-0.5 rounded-xl bg-muted p-1"
        >
          {REPORT_PERIODS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => onPeriod(option.value)}
              aria-pressed={period === option.value}
              aria-label={option.long}
              className={cn(
                'h-8 min-w-11 rounded-lg px-3 font-mono text-sm font-semibold transition-[background-color,color]',
                period === option.value
                  ? 'bg-card text-foreground shadow-float'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          {/* The previous window's figures stay up while the next loads; this says they will move. */}
          <span
            role="status"
            className={cn(
              'text-xs text-muted-foreground transition-opacity',
              refreshing ? 'opacity-100' : 'opacity-0',
            )}
          >
            {refreshing ? 'Updating…' : ''}
          </span>
          <PrintButton label="Save as PDF" />
        </div>
      </div>
    </div>
  );
}

/* ——— Pieces ——— */

const GROUP_SERIES = REPORT_GROUPS.map((group) => ({
  key: group.key,
  label: group.label,
  color: CHART[group.key],
}));

const columns = (buckets: readonly { key: string; values: Record<string, number> }[]) =>
  buckets.map((bucket) => ({
    key: bucket.key,
    label: bucketLabel(bucket.key, 'short'),
    long: bucketLabel(bucket.key, 'long'),
    values: bucket.values,
  }));

const STATUS_TONE = {
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  destructive: 'bg-destructive-soft text-destructive',
} as const;

interface TileProps {
  label: string;
  value: string;
  unit?: string;
  note?: string;
  status?: { tone: keyof typeof STATUS_TONE; text: string };
}

/** A secondary figure: label, figure with its unit, what it is of, and a status where it is news. */
function Tile({ label, value, unit, note, status }: TileProps) {
  return (
    <div className="min-w-0 rounded-xl bg-card p-4">
      <p className="truncate text-label uppercase text-muted-foreground">{label}</p>
      <p className="mt-1.5 flex min-w-0 items-baseline gap-1.5">
        <span className="truncate font-mono text-xl font-semibold tabular-nums tracking-tight text-foreground">
          {value}
        </span>
        {unit ? (
          <span className="shrink-0 font-mono text-xs font-semibold text-muted-foreground">
            {unit}
          </span>
        ) : null}
      </p>
      {note ? <p className="mt-0.5 truncate text-xs text-muted-foreground">{note}</p> : null}
      {status ? (
        <p
          className={cn(
            'mt-2 inline-flex max-w-full items-center gap-1.5 truncate rounded-full px-2 py-0.5 text-xs font-semibold',
            STATUS_TONE[status.tone],
          )}
        >
          {status.text}
        </p>
      ) : null}
    </div>
  );
}

/** Only the tiles the record supports: a tile of dashes is noise. */
function Tiles({ tiles }: { tiles: (TileProps | null | false | undefined)[] }) {
  const shown = tiles.filter((tile): tile is TileProps => Boolean(tile));
  if (shown.length === 0) return null;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {shown.map((tile) => (
        <Tile key={tile.label} {...tile} />
      ))}
    </div>
  );
}

function Quiet({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

function ChartSkeleton() {
  return <Skeleton className="h-56 w-full rounded-xl" />;
}

/** What the totals left out, named rather than converted at a guess. */
function Excluded({ rows }: { rows: readonly { currency: string; amountMinor: number }[] }) {
  if (rows.length === 0) return null;
  return (
    <p className="mt-4 flex items-start gap-2 text-xs text-muted-foreground">
      <Icon name="info" size={14} className="mt-0.5 shrink-0" />
      <span>
        Not included, in other currencies:{' '}
        {rows
          .map((row) => formatMoney({ amountMinor: row.amountMinor, currency: row.currency }))
          .join(', ')}
        .
      </span>
    </p>
  );
}

function Stack({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-6">{children}</div>;
}

/** The cost per distance of a sum, or a dash with the reason. */
const rate = (amountMinor: number, distance: number | null, currency: string) =>
  distance ? cents(amountMinor / distance, currency) : '—';

/* ——— Overview ——— */

export function OverviewTab({
  report,
  onTab,
}: {
  report: VehicleReport;
  onTab: (tab: ReportTab) => void;
}) {
  const { spend, distance, period, vehicleId } = report;
  const unit = distanceLabel(report.odometerUnit);
  const currency = spend?.currency ?? 'USD';
  const m = (amount: number) => money(amount, currency);

  return (
    <Stack>
      <Readings
        className="stagger animate-rise"
        readings={[
          {
            label: 'Running cost',
            value: spend ? m(spend.total) : undefined,
            caption: spend ? `${pad(spend.count)} entries` : period.long.toLowerCase(),
          },
          {
            label: 'Per day',
            value: spend ? cents(spend.total / spend.days, currency) : undefined,
            caption: spend ? `over ${spend.days.toLocaleString()} days` : 'every day in the period',
          },
          {
            label: `Per ${unit}`,
            value: spend ? rate(spend.total, distance, currency) : undefined,
            caption: distance
              ? `over ${formatDistance(distance, report.odometerUnit)}`
              : 'needs two odometer readings',
          },
          {
            label: 'Driven',
            value: spend ? formatDistance(distance, report.odometerUnit) : undefined,
            caption:
              spend && distance
                ? `${Math.round(distance / spend.days).toLocaleString()} ${unit} a day`
                : 'between readings in the period',
          },
        ]}
      />

      <SectionCard
        title="Where the money went"
        description={`${period.long}. Running costs — the purchase is left out.`}
        icon={<Icon name="pie" size={20} />}
      >
        {!spend ? (
          <ChartSkeleton />
        ) : spend.total === 0 ? (
          <Quiet>
            Nothing spent in this period. Fuel, services and bills appear here as you log them.
          </Quiet>
        ) : (
          <div className="flex flex-col gap-8">
            <ColumnChart
              buckets={columns(spend.buckets)}
              series={GROUP_SERIES}
              format={m}
              formatAxis={(amount) => compact(amount, currency)}
              caption={`${period.long} · running costs`}
            />
            <Donut
              centre="Running"
              total={m(spend.total)}
              onSelect={(key) => onTab(TAB_OF_GROUP[key as ReportGroup])}
              slices={REPORT_GROUPS.filter((group) => spend.groups[group.key].total > 0).map(
                (group) => ({
                  key: group.key,
                  label: `${group.label} · ${pad(spend.groups[group.key].count)}`,
                  value: spend.groups[group.key].total,
                  display: m(spend.groups[group.key].total),
                  color: CHART[group.key],
                }),
              )}
            />
          </div>
        )}
        <Excluded rows={spend?.excluded ?? []} />
      </SectionCard>

      <Insights report={report} />
      <CostAgainstWorth report={report} />
      <ValuePanel vehicleId={vehicleId} />
      <HealthPanel vehicleId={vehicleId} />
    </Stack>
  );
}

/**
 * The figures a logbook cannot give: what each kilometre really cost once the value lost is
 * counted, the monthly pace against the year before, the year ahead at that pace.
 */
function Insights({ report }: { report: VehicleReport }) {
  const { cost, spend, vehicle, vehicleId, period } = report;
  const value = useQuery(valuationsQuery(api, vehicleId));
  // Two years, once: the pace compares its two halves.
  const monthly = useQuery(monthlySpendQuery(api, vehicleId, 24));
  const trends = useQuery(costTrendsQuery(api, vehicleId));
  const unit = distanceLabel(report.odometerUnit);

  if (!cost || !spend) {
    return (
      <SectionCard title="Insights" icon={<Icon name="chart" size={20} />}>
        <ChartSkeleton />
      </SectionCard>
    );
  }

  const currency = cost.currency;
  const paid = cost.purchasePrice?.amountMinor ?? null;
  const worth =
    value.data?.currentValue?.currency === currency ? value.data.currentValue.amountMinor : null;
  const running = Math.max(0, cost.ownershipCost.amountMinor - (paid ?? 0));
  const purchaseDate = vehicle?.purchaseDate ?? null;
  const trueCost = trueCostPerDistance({
    runningMinor: running,
    paidMinor: paid,
    worthMinor: worth,
    distance: cost.distanceCovered,
  });
  const pace =
    monthly.data && monthly.data.currency === currency
      ? monthlyPace(monthly.data.points, purchaseDate ? monthsSince(purchaseDate) : null)
      : null;
  const lost = depreciationPerYear(paid, worth, purchaseDate);
  const yearly = distancePerYear(trends.data?.distancePerYear ?? []);
  const busiest = spend.buckets.reduce<(typeof spend.buckets)[number] | null>(
    (best, bucket) => (bucket.total > (best?.total ?? 0) ? bucket : best),
    null,
  );

  return (
    <SectionCard
      title="Insights"
      description="Worked out from the whole record, past what the entries add up to."
      icon={<Icon name="chart" size={20} />}
    >
      <Tiles
        tiles={[
          trueCost && {
            label: 'True cost',
            value: cents(trueCost.perDistanceMinor, currency),
            unit: `/${unit}`,
            note: trueCost.includesDepreciation ? 'running + value lost' : 'running costs only',
          },
          cost.costPerDistance && {
            label: 'Running',
            value: formatMoney(cost.costPerDistance),
            unit: `/${unit}`,
            note: 'fuel, service and bills',
          },
          pace &&
            pace.averageMinor > 0 && {
              label: 'Per month',
              value: money(pace.averageMinor, currency),
              note: 'last 12 months',
              status:
                pace.changePercent !== null
                  ? {
                      // Spending more is the thing to notice; less is the good news.
                      tone: pace.changePercent > 0 ? ('warning' as const) : ('success' as const),
                      text: `${pace.changePercent > 0 ? '▲' : '▼'} ${Math.abs(pace.changePercent)}% vs year before`,
                    }
                  : undefined,
            },
          pace &&
            pace.averageMinor > 0 && {
              label: 'Next 12 months',
              value: money(pace.averageMinor * 12, currency),
              note: 'at this year’s pace',
            },
          lost !== null &&
            lost > 0 && {
              label: 'Value lost',
              value: money(lost, currency),
              unit: '/yr',
              note: 'since bought',
            },
          yearly !== null && {
            label: 'Driven',
            value: yearly.toLocaleString(),
            unit: `${unit}/yr`,
            note: 'a whole year, on average',
          },
          busiest &&
            spend.buckets.length > 1 && {
              label: spend.unit === 'month' ? 'Dearest month' : 'Dearest year',
              value: money(busiest.total, currency),
              note: `${bucketLabel(busiest.key, 'long')} · ${period.long.toLowerCase()}`,
            },
          spend.total > 0 && {
            label: 'Energy share',
            value: `${Math.round((spend.groups.REFUELING.total / spend.total) * 100)}%`,
            note: 'of running costs went on fuel',
          },
        ]}
      />
    </SectionCard>
  );
}

/**
 * What it has cost against what it is worth, on one money axis. Both start from the price; one
 * climbs with every bill and the other falls with the market, and the gap between them is what
 * owning it has really cost. Ink for the cost — the figure this report is about — and the one hue
 * the overview does not use for the worth, so neither is mistaken for a spend group.
 */
function CostAgainstWorth({ report }: { report: VehicleReport }) {
  const { vehicleId, vehicle } = report;
  const value = useQuery(valuationsQuery(api, vehicleId));
  const trends = useQuery(costTrendsQuery(api, vehicleId));
  const currency = trends.data?.currency;
  const purchaseDate = vehicle?.purchaseDate ?? null;
  const paid = value.data?.purchasePrice ?? null;

  const series = [];
  const spent = (trends.data?.ownership ?? []).filter((row) => row.cumulativeMinor > 0);
  if (spent.length >= 2) {
    series.push({
      key: 'cost',
      label: 'Cost to own',
      color: 'var(--color-foreground)',
      points: spent.map((row) => {
        const [year, month] = row.month.split('-').map(Number) as [number, number];
        return { x: Date.UTC(year, month - 1, 15), y: row.cumulativeMinor };
      }),
    });
  }
  const worth = [
    ...(paid && purchaseDate && paid.currency === currency
      ? [{ x: Date.parse(`${purchaseDate}T00:00:00Z`), y: paid.amountMinor }]
      : []),
    ...[...(value.data?.history ?? [])]
      .filter((row) => row.estimatedValue.currency === currency)
      .sort((a, b) => a.valuationDate.localeCompare(b.valuationDate))
      .map((row) => ({
        x: Date.parse(`${row.valuationDate}T00:00:00Z`),
        y: row.estimatedValue.amountMinor,
      })),
  ];
  if (worth.length >= 2) {
    series.push({ key: 'worth', label: 'Worth', color: CHART.trip, points: worth });
  }
  if (!currency || series.length === 0) return null;

  const monthYear = new Intl.DateTimeFormat('en-US', { month: 'short', year: '2-digit' });
  return (
    <SectionCard
      title={series.length > 1 ? 'Cost against worth' : 'Cost to own over time'}
      description="Lifetime, the purchase included. Move along the lines to read any month."
      icon={<Icon name="money" size={20} />}
    >
      <LineChart
        series={series}
        formatY={(amount) => compact(amount, currency)}
        formatX={(x) => monthYear.format(new Date(x))}
        area={series.length === 1}
      />
    </SectionCard>
  );
}

/* ——— Refueling ——— */

export function RefuelingTab({ report }: { report: VehicleReport }) {
  const { spend, distance, vehicleId, period } = report;
  const trends = useQuery(costTrendsQuery(api, vehicleId));
  const fuel = useMemo(() => (spend ? buildRefuelReport(spend) : undefined), [spend]);
  const detail = useMemo(() => (spend ? groupDetail(spend, 'REFUELING') : undefined), [spend]);
  const unit = distanceLabel(report.odometerUnit);
  const perHundred = report.odometerUnit !== 'MI';
  const currency = spend?.currency ?? 'USD';

  const efficiency = spend
    ? (trends.data?.efficiency ?? []).flatMap((series) => {
        const result = efficiencyInWindow(
          series.points,
          report.from ? spend.fromMs : 0,
          perHundred,
        );
        return result ? [{ unit: series.unit, ...result }] : [];
      })
    : [];
  const primary = fuel?.units[0];
  const leading = efficiency.find((entry) => entry.unit === primary?.unit) ?? efficiency[0];
  const rateUnit = (fuelUnit: string) =>
    perHundred
      ? `${UNIT_LABEL[fuelUnit] ?? ''}/100 ${unit}`
      : `${unit}/${UNIT_LABEL[fuelUnit] ?? ''}`;
  const dateShort = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
  const units = [
    ...new Set([
      ...(fuel?.units ?? []).map((entry) => entry.unit),
      ...efficiency.map((entry) => entry.unit),
    ]),
  ];

  return (
    <Stack>
      <Readings
        className="stagger animate-rise"
        readings={[
          {
            label: 'Fuel spend',
            value: detail ? money(detail.total, currency) : undefined,
            caption: fuel ? `${pad(fuel.fills)} fills` : 'fills and charges',
          },
          {
            label: 'Consumption',
            value: spend ? (leading ? leading.average.toFixed(1) : '—') : undefined,
            caption: leading ? rateUnit(leading.unit) : 'needs two full tanks',
          },
          {
            label: `Price per ${primary ? UNIT_LABEL[primary.unit] : 'unit'}`,
            value: spend
              ? primary?.pricePerUnitMinor
                ? perUnit(primary.pricePerUnitMinor, currency)
                : '—'
              : undefined,
            caption: 'weighted by what went in',
          },
          {
            label: `Fuel per ${unit}`,
            value: detail ? rate(detail.total, distance, currency) : undefined,
            caption:
              spend && spend.total > 0 && detail
                ? `${Math.round((detail.total / spend.total) * 100)}% of running costs`
                : 'of running costs',
          },
        ]}
      />

      {!spend || !fuel || !detail ? (
        <SectionCard title="Consumption" icon={<Icon name="fuel" size={20} />}>
          <ChartSkeleton />
        </SectionCard>
      ) : fuel.fills === 0 ? (
        <EmptyState
          title="No fill-ups in this period"
          description="Record a fill with how much went in and the odometer, and this fills with consumption, prices and the cheapest places to fill up."
        />
      ) : (
        <>
          {units.map((fuelUnit) => {
            const use = efficiency.find((entry) => entry.unit === fuelUnit);
            const bought = fuel.units.find((entry) => entry.unit === fuelUnit);
            const label = UNIT_LABEL[fuelUnit] ?? fuelUnit;
            const cheapest = bought?.places[0];
            const dearest = bought?.places.at(-1);
            return (
              <div key={fuelUnit} className="flex flex-col gap-6">
                {use ? (
                  <SectionCard
                    title={fuelUnit === 'KWH' ? 'Energy use' : 'Consumption'}
                    description={`Per fill, full tank to full tank. Best ${use.best.toFixed(1)} · worst ${use.worst.toFixed(1)} ${rateUnit(fuelUnit)}.`}
                    icon={<Icon name={fuelUnit === 'KWH' ? 'battery' : 'fuel'} size={20} />}
                  >
                    {use.points.length >= 2 ? (
                      <LineChart
                        series={[
                          {
                            key: 'rate',
                            label: rateUnit(fuelUnit),
                            color: CHART.REFUELING,
                            points: use.points.slice(-24),
                          },
                        ]}
                        reference={{
                          value: use.average,
                          label: `average ${use.average.toFixed(1)}`,
                        }}
                        formatY={(value) => value.toFixed(1)}
                        formatX={(x) => dateShort.format(new Date(x))}
                      />
                    ) : (
                      <Quiet>
                        {use.average.toFixed(1)} {rateUnit(fuelUnit)} from one measured tank. A
                        second draws the trend.
                      </Quiet>
                    )}
                  </SectionCard>
                ) : null}

                {bought && bought.prices.length >= 2 && bought.pricePerUnitMinor ? (
                  <SectionCard
                    title={`Price per ${label}`}
                    description="What each fill cost per unit, against the period's average."
                    icon={<Icon name="money" size={20} />}
                  >
                    <LineChart
                      series={[
                        {
                          key: 'price',
                          label: `per ${label}`,
                          color: CHART.REFUELING,
                          points: bought.prices
                            .map((price) => ({ x: price.at, y: price.perUnitMinor }))
                            .slice(-24),
                        },
                      ]}
                      reference={{ value: bought.pricePerUnitMinor, label: 'average' }}
                      formatY={(value) => perUnit(value, currency)}
                      formatAxis={(value) => perUnit(value, currency).split(' ')[0]!}
                      formatX={(x) => dateShort.format(new Date(x))}
                    />
                  </SectionCard>
                ) : null}

                {bought && bought.places.length > 0 ? (
                  <SectionCard
                    title={fuelUnit === 'KWH' ? 'Where you charge' : 'Where you fill up'}
                    description={
                      cheapest && dearest && bought.places.length > 1
                        ? `${cheapest.vendor} was ${perUnit(dearest.perUnitMinor - cheapest.perUnitMinor, currency)} per ${label} under ${dearest.vendor}.`
                        : 'Cheapest first, per unit.'
                    }
                    icon={<Icon name="fuel" size={20} />}
                  >
                    <ul className="flex flex-col gap-2">
                      {bought.places.slice(0, 6).map((place) => (
                        <li key={place.vendor}>
                          <TileRow
                            accent={
                              place === cheapest && bought.places.length > 1 ? 'success' : 'default'
                            }
                            title={place.vendor}
                            meta={`${pad(place.fills)} ${place.fills === 1 ? 'fill' : 'fills'}`}
                            trailing={
                              <span className="font-mono text-sm tabular-nums text-foreground">
                                {perUnit(place.perUnitMinor, currency)}
                              </span>
                            }
                          />
                        </li>
                      ))}
                    </ul>
                  </SectionCard>
                ) : null}
              </div>
            );
          })}

          <SectionCard
            title="Fuel spend"
            description={period.long}
            icon={<Icon name="chart" size={20} />}
          >
            <ColumnChart
              buckets={columns(
                detail.buckets.map((bucket) => ({
                  key: bucket.key,
                  values: { REFUELING: bucket.value },
                })),
              )}
              series={[GROUP_SERIES[0]!]}
              format={(amount) => money(amount, currency)}
              formatAxis={(amount) => compact(amount, currency)}
              caption={`${period.long} · fuel and charging`}
            />
          </SectionCard>

          <SectionCard title="Habits" icon={<Icon name="stopwatch" size={20} />}>
            <Tiles
              tiles={[
                fuel.averageFillMinor !== null && {
                  label: 'Average fill',
                  value: money(fuel.averageFillMinor, currency),
                  note: 'per visit',
                },
                primary && {
                  label: 'Per fill',
                  value: (primary.quantity / primary.fills).toFixed(1),
                  unit: UNIT_LABEL[primary.unit],
                  note: 'on average',
                },
                fuel.daysBetween !== null && {
                  label: 'Every',
                  value: fuel.daysBetween.toFixed(fuel.daysBetween < 10 ? 1 : 0),
                  unit: 'days',
                  note: 'between fills',
                },
                fuel.distanceBetween !== null && {
                  label: 'Range used',
                  value: Math.round(fuel.distanceBetween).toLocaleString(),
                  unit,
                  note: 'between fills',
                },
                primary && {
                  label: 'Bought',
                  value: Math.round(primary.quantity).toLocaleString(),
                  unit: UNIT_LABEL[primary.unit],
                  note: period.long.toLowerCase(),
                },
                fuel.latest && {
                  label: 'Last fill',
                  value: formatRelative(fuel.latest.occurredAt),
                  note: fuel.latest.vendor ?? formatDate(fuel.latest.occurredAt),
                },
              ]}
            />
          </SectionCard>
        </>
      )}

      <GroupLedger report={report} rows={detail?.rows} category="FUEL" title="Fill-ups" />
    </Stack>
  );
}

function GroupLedger({
  report,
  rows,
  category,
  title,
}: {
  report: VehicleReport;
  rows: Expense[] | undefined;
  category: ExpenseCategory;
  title: string;
}) {
  return (
    <ExpenseLedger
      vehicleId={report.vehicleId}
      rows={rows}
      currency={report.spend?.currency ?? report.cost?.currency ?? 'USD'}
      unitLabel={distanceLabel(report.odometerUnit)}
      defaultCategory={category}
      title={title}
      description={`${report.period.long}, newest first.`}
      pending={!report.spend}
    />
  );
}

/* ——— Services and Expenses: one shape, two slices ——— */

const GROUP_TAB = {
  SERVICES: {
    noun: 'visit',
    last: 'Last service',
    byVendor: 'By workshop',
    icon: 'maintenance',
    category: 'MAINTENANCE',
    ledger: 'Service log',
    empty: 'No services in this period',
    emptyText:
      'Maintenance, repairs, parts and cleaning appear here with what they cost and where they were done.',
  },
  EXPENSES: {
    noun: 'bill',
    last: 'Latest',
    byVendor: 'Paid to',
    icon: 'receipt',
    category: 'INSURANCE',
    ledger: 'Bills and extras',
    empty: 'No other expenses in this period',
    emptyText:
      'Insurance, tax, registration, parking, tolls and upgrades appear here — everything that is not fuel or a service.',
  },
} as const satisfies Record<
  Exclude<ReportGroup, 'REFUELING'>,
  { icon: 'maintenance' | 'receipt'; category: ExpenseCategory } & Record<string, string>
>;

export function GroupTab({
  report,
  group,
}: {
  report: VehicleReport;
  group: Exclude<ReportGroup, 'REFUELING'>;
}) {
  const { spend, distance, period } = report;
  const copy = GROUP_TAB[group];
  const detail = useMemo(() => (spend ? groupDetail(spend, group) : undefined), [spend, group]);
  const currency = spend?.currency ?? 'USD';
  const unit = distanceLabel(report.odometerUnit);
  const label = REPORT_GROUPS.find((entry) => entry.key === group)!.label;

  return (
    <Stack>
      <Readings
        className="stagger animate-rise"
        readings={[
          {
            label: `${label} spend`,
            value: detail ? money(detail.total, currency) : undefined,
            caption: detail ? `${pad(detail.count)} ${copy.noun}s` : period.long.toLowerCase(),
          },
          {
            label: `Per ${copy.noun}`,
            value: detail
              ? detail.averageMinor === null
                ? '—'
                : money(detail.averageMinor, currency)
              : undefined,
            caption: 'on average',
          },
          {
            label: 'Per month',
            value: detail ? money(detail.perMonthMinor, currency) : undefined,
            caption: detail
              ? `${rate(detail.total, distance, currency)} per ${unit}`
              : 'over the period',
          },
          {
            label: copy.last,
            value: detail
              ? detail.latest
                ? formatRelative(detail.latest.occurredAt)
                : '—'
              : undefined,
            caption: detail?.latest?.description ?? 'nothing yet',
          },
        ]}
      />

      {!spend || !detail ? (
        <SectionCard title="By month" icon={<Icon name="chart" size={20} />}>
          <ChartSkeleton />
        </SectionCard>
      ) : detail.count === 0 ? (
        <EmptyState title={copy.empty} description={copy.emptyText} />
      ) : (
        <>
          <SectionCard
            title="By month"
            description={
              spend.total > 0
                ? `${Math.round((detail.total / spend.total) * 100)}% of running costs in this period.`
                : undefined
            }
            icon={<Icon name="chart" size={20} />}
          >
            <ColumnChart
              buckets={columns(
                detail.buckets.map((bucket) => ({
                  key: bucket.key,
                  values: { [group]: bucket.value },
                })),
              )}
              series={GROUP_SERIES.filter((series) => series.key === group)}
              format={(amount) => money(amount, currency)}
              formatAxis={(amount) => compact(amount, currency)}
              caption={`${period.long} · ${label.toLowerCase()}`}
            />
          </SectionCard>

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <SectionCard title="By kind" icon={<Icon name="pie" size={20} />}>
              <RankBars
                color={CHART[group]}
                rows={detail.byCategory.map((row) => ({
                  key: row.key,
                  label: humanise(row.key),
                  note: `${pad(row.count)} ${row.count === 1 ? 'entry' : 'entries'}`,
                  value: row.amountMinor,
                  display: money(row.amountMinor, currency),
                }))}
              />
            </SectionCard>
            <SectionCard title={copy.byVendor} icon={<Icon name="garage" size={20} />}>
              {detail.byVendor.length > 0 ? (
                <RankBars
                  color={CHART[group]}
                  rows={detail.byVendor.slice(0, 6).map((row) => ({
                    key: row.key,
                    label: row.key,
                    note: `${pad(row.count)} ${row.count === 1 ? copy.noun : `${copy.noun}s`}`,
                    value: row.amountMinor,
                    display: money(row.amountMinor, currency),
                  }))}
                />
              ) : (
                <Quiet>Name who was paid on an entry and this ranks them by what they cost.</Quiet>
              )}
            </SectionCard>
          </div>

          {detail.count >= 4 ? (
            <SectionCard title="Biggest" icon={<Icon name="money" size={20} />}>
              <ul className="flex flex-col gap-2">
                {detail.largest.slice(0, 3).map((row) => (
                  <li key={row.id}>
                    <TileRow
                      title={row.description}
                      meta={`${formatDate(row.occurredAt)} · ${humanise(row.category)}${row.vendor ? ` · ${row.vendor}` : ''}`}
                      trailing={
                        <span className="font-mono text-sm font-semibold tabular-nums text-foreground">
                          {formatMoney(row.amount)}
                        </span>
                      }
                    />
                  </li>
                ))}
              </ul>
            </SectionCard>
          ) : null}
        </>
      )}

      <GroupLedger
        report={report}
        rows={detail?.rows}
        category={copy.category}
        title={copy.ledger}
      />
    </Stack>
  );
}

/* ——— Income ——— */

export function IncomeTab({ report }: { report: VehicleReport }) {
  const { spend, distance, vehicleId, from, period } = report;
  const income = useQuery({
    ...incomeLedgerQuery(api, vehicleId, from),
    placeholderData: keepPreviousData,
  });
  const data = useMemo(
    () => (spend && income.data ? buildIncomeReport(income.data, spend as SpendReport) : undefined),
    [spend, income.data],
  );
  const [recording, setRecording] = useState(false);
  const currency = spend?.currency ?? 'USD';
  const unit = distanceLabel(report.odometerUnit);

  /*
   * Walled from the server's own answer rather than a guess about the plan: whose plan governs
   * is the garage owner's, and a 4xx is not retried, so the wall shows as fast as figures would.
   */
  const wall = planWall(income.error);
  if (wall) {
    return (
      <Stack>
        <LockedFeature wall={wall} />
        <EmptyState
          title="What it earns, against what it costs"
          description="Fares, deliveries, rentals and reimbursements, netted against the same period's running costs — month by month, by payer, and per kilometre."
        />
      </Stack>
    );
  }
  if (income.isError) {
    return (
      <EmptyState title="Could not load income" description={(income.error as Error).message} />
    );
  }

  return (
    <Stack>
      <Readings
        className="stagger animate-rise"
        readings={[
          {
            label: 'Earned',
            value: data ? money(data.total, currency) : undefined,
            caption: data ? `${pad(data.count)} entries` : period.long.toLowerCase(),
          },
          {
            label: 'Net',
            value: data ? money(data.net, currency) : undefined,
            tone: data && data.count > 0 ? (data.net >= 0 ? 'success' : 'destructive') : undefined,
            caption: 'earned less running costs',
          },
          {
            label: `Per ${unit}`,
            value: data ? rate(data.total, distance, currency) : undefined,
            caption: 'earned per distance driven',
          },
          {
            label: 'Margin',
            value: data
              ? data.total > 0
                ? `${Math.round((data.net / data.total) * 100)}%`
                : '—'
              : undefined,
            caption: 'of what came in, kept',
          },
        ]}
      />

      <SectionCard
        title="Earned against spent"
        description={`${period.long}. Spent is running costs, the purchase left out.`}
        icon={<Icon name="income" size={20} />}
        action={
          <Button size="sm" onClick={() => setRecording(true)}>
            <Plus className="size-4" aria-hidden="true" />
            Record income
          </Button>
        }
      >
        {!data ? (
          <ChartSkeleton />
        ) : data.count === 0 ? (
          <Quiet>
            Nothing earned in this period. Record a fare, a delivery or a rental and it is netted
            against the costs here.
          </Quiet>
        ) : (
          <ColumnChart
            mode="group"
            buckets={columns(
              data.buckets.map((bucket) => ({
                key: bucket.key,
                values: { earned: bucket.earned, spent: bucket.spent },
              })),
            )}
            series={[
              { key: 'earned', label: 'Earned', color: CHART.income },
              // Ink-grey, not a spend group's hue: this is every group at once.
              { key: 'spent', label: 'Spent', color: 'var(--color-muted-foreground)' },
            ]}
            format={(amount) => money(amount, currency)}
            formatAxis={(amount) => compact(amount, currency)}
            caption={`${period.long} · earned`}
          />
        )}
        <Excluded rows={data?.excluded ?? []} />
      </SectionCard>

      {data && data.count > 0 ? (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <SectionCard title="By kind" icon={<Icon name="pie" size={20} />}>
            <RankBars
              color={CHART.income}
              rows={data.byCategory.map((row) => ({
                key: row.key,
                label: humanise(row.key),
                note: `${pad(row.count)} entries`,
                value: row.amountMinor,
                display: money(row.amountMinor, currency),
              }))}
            />
          </SectionCard>
          <SectionCard title="By payer" icon={<Icon name="people" size={20} />}>
            {data.byPayer.length > 0 ? (
              <RankBars
                color={CHART.income}
                rows={data.byPayer.slice(0, 6).map((row) => ({
                  key: row.key,
                  label: row.key,
                  note: `${pad(row.count)} entries`,
                  value: row.amountMinor,
                  display: money(row.amountMinor, currency),
                }))}
              />
            ) : (
              <Quiet>Name who paid on an entry and this ranks them.</Quiet>
            )}
          </SectionCard>
        </div>
      ) : null}

      {recording ? (
        <Modal
          title="Record income"
          description={`What this vehicle earned. Amounts in ${currency}.`}
          icon="income"
          onClose={() => setRecording(false)}
        >
          <IncomeForm
            vehicleId={vehicleId}
            currency={currency}
            unit={report.odometerUnit}
            onDone={() => setRecording(false)}
          />
        </Modal>
      ) : null}
    </Stack>
  );
}

function IncomeForm({
  vehicleId,
  currency,
  unit,
  onDone,
}: {
  vehicleId: string;
  currency: string;
  unit: 'KM' | 'MI';
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const [category, setCategory] = useState<IncomeCategory>('FARE');
  const [description, setDescription] = useState('');
  const [payer, setPayer] = useState('');
  const [amount, setAmount] = useState('');
  const [day, setDay] = useState(() => localDay());
  const [odometer, setOdometer] = useState('');

  const mutation = useMutation({
    mutationFn: () =>
      api.income.create(vehicleId, {
        category,
        description,
        amountMinor: toMinorUnits(Number(amount), currency),
        currency,
        occurredAt: stampForDay(day),
        ...(payer ? { payer } : {}),
        ...(odometer ? { odometer: Number(odometer), odometerUnit: unit } : {}),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['vehicles', vehicleId, 'income'] });
      onDone();
    },
    meta: { toast: 'Income recorded' },
  });
  const fieldErrors = mutation.error instanceof ApiError ? mutation.error.fields : undefined;

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        mutation.mutate();
      }}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <SelectField
          label="Kind"
          value={category}
          onChange={(next) => setCategory(next as IncomeCategory)}
          options={INCOME_CATEGORIES.map((value) => ({ value, label: humanise(value) }))}
        />
        <DateField label="Date" value={day} onChange={setDay} required />
      </div>
      <Field
        label="What it was"
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        placeholder="Week of fares, airport run, van hire"
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
          suffix={currency}
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          error={fieldErrors?.amountMinor}
          required
        />
        <Field label="Who paid" value={payer} onChange={(event) => setPayer(event.target.value)} />
        <Field
          label="Odometer"
          type="number"
          inputMode="numeric"
          min={0}
          suffix={distanceLabel(unit)}
          value={odometer}
          onChange={(event) => setOdometer(event.target.value)}
        />
      </div>
      {mutation.isError && !fieldErrors ? (
        <FormError>{(mutation.error as Error).message}</FormError>
      ) : null}
      <ModalActions>
        <Button variant="ghost" onClick={onDone} disabled={mutation.isPending}>
          Cancel
        </Button>
        <Button
          type="submit"
          variant="primary"
          loading={mutation.isPending}
          disabled={!description || !amount}
        >
          Record income
        </Button>
      </ModalActions>
    </form>
  );
}

/* ——— Routes ——— */

const PURPOSE_COLOR = {
  BUSINESS: CHART.trip,
  COMMUTE: CHART.EXPENSES,
  PERSONAL: CHART.neutral,
} as const;

/** The end of today in UTC: stable all day, so it keys the report without a new request per render. */
function endOfToday() {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59),
  ).toISOString();
}

export function RoutesTab({ report }: { report: VehicleReport }) {
  const { distance, vehicleId, from, period } = report;
  const range = { from: from ?? '2000-01-01T00:00:00.000Z', to: endOfToday() };
  const mileage = useQuery({
    ...mileageReportQuery(api, vehicleId, range),
    placeholderData: keepPreviousData,
  });
  const routes = useMemo(
    () => (mileage.data ? buildRoutesReport(mileage.data.trips, { from }) : undefined),
    [mileage.data, from],
  );
  const download = useMutation({
    mutationFn: async () => save(await api.events.mileageReportCsv(vehicleId, range)),
    meta: { toast: false },
  });
  const unit = report.odometerUnit;
  const km = (value: number) => formatDistance(Math.round(value), unit);

  const wall = planWall(mileage.error);
  if (wall) {
    return (
      <Stack>
        <LockedFeature wall={wall} />
        <EmptyState
          title="Every trip, by purpose"
          description="Business, commute and personal distance for any period, with the deduction at each trip's own rate — ready for a tax return or an expense claim."
        />
      </Stack>
    );
  }
  if (mileage.isError) {
    return (
      <EmptyState title="Could not load trips" description={(mileage.error as Error).message} />
    );
  }

  const deductions = mileage.data?.deductions ?? [];

  return (
    <Stack>
      <Readings
        className="stagger animate-rise"
        readings={[
          {
            label: 'Logged',
            value: routes ? km(routes.distance) : undefined,
            caption: routes ? `${pad(routes.trips)} trips` : period.long.toLowerCase(),
          },
          {
            label: 'Average trip',
            value: routes
              ? routes.averageDistance === null
                ? '—'
                : km(routes.averageDistance)
              : undefined,
            caption: routes?.longest[0]
              ? `longest ${km(routes.longest[0].trip.distance)}`
              : 'per trip',
          },
          {
            label: 'Business',
            value: routes
              ? routes.businessShare === null
                ? '—'
                : `${Math.round(routes.businessShare * 100)}%`
              : undefined,
            caption: routes
              ? `${km(routes.byPurpose.BUSINESS.distance)} claimable`
              : 'of distance logged',
          },
          {
            label: 'Deductible',
            value: mileage.data
              ? deductions.length > 0
                ? deductions.map((amount) => formatMoney(amount)).join(' + ')
                : '—'
              : undefined,
            caption:
              mileage.data && mileage.data.unratedBusinessTrips > 0
                ? `${mileage.data.unratedBusinessTrips} trips without a rate`
                : 'at each trip’s own rate',
          },
        ]}
      />

      {!routes ? (
        <SectionCard title="Distance by month" icon={<Icon name="route" size={20} />}>
          <ChartSkeleton />
        </SectionCard>
      ) : routes.trips === 0 ? (
        <EmptyState
          title="No trips in this period"
          description="Log a trip with its purpose and distance and this splits your driving into business, commute and personal — with what it is worth to claim."
        />
      ) : (
        <>
          <SectionCard
            title={routes.unit === 'month' ? 'Distance by month' : 'Distance by year'}
            description={
              distance
                ? `Trips cover ${Math.min(100, Math.round((routes.distance / distance) * 100))}% of the ${km(distance)} the odometer moved.`
                : period.long
            }
            icon={<Icon name="route" size={20} />}
            action={
              <Button size="sm" loading={download.isPending} onClick={() => download.mutate()}>
                <Download className="size-4" aria-hidden="true" />
                CSV
              </Button>
            }
          >
            <ColumnChart
              buckets={columns(routes.buckets)}
              series={TRIP_PURPOSES.map((purpose) => ({
                key: purpose.key,
                label: purpose.label,
                color: PURPOSE_COLOR[purpose.key],
              }))}
              format={km}
              caption={`${period.long} · logged trips`}
            />
          </SectionCard>

          <SectionCard title="By purpose" icon={<Icon name="pie" size={20} />}>
            <SplitBar
              parts={TRIP_PURPOSES.map((purpose) => ({
                key: purpose.key,
                label: `${purpose.label} · ${pad(routes.byPurpose[purpose.key].trips)} trips`,
                value: routes.byPurpose[purpose.key].distance,
                display: km(routes.byPurpose[purpose.key].distance),
                color: PURPOSE_COLOR[purpose.key],
              }))}
            />
          </SectionCard>

          <SectionCard title="Longest trips" icon={<Icon name="odometer" size={20} />}>
            <ul className="flex flex-col gap-2">
              {routes.longest.map((row) => (
                <li key={row.eventId}>
                  <TileRow
                    accent={row.trip.purpose === 'BUSINESS' ? 'primary' : 'default'}
                    title={row.title}
                    meta={`${formatDate(row.occurredAt)} · ${humanise(row.trip.purpose)}${row.trip.deduction ? ` · ${formatMoney(row.trip.deduction)}` : ''}`}
                    trailing={
                      <span className="font-mono text-sm font-semibold tabular-nums text-foreground">
                        {km(row.trip.distance)}
                      </span>
                    }
                  />
                </li>
              ))}
            </ul>
          </SectionCard>
        </>
      )}
    </Stack>
  );
}
