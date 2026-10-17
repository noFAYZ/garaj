'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type ReactNode } from 'react';
import { Download, Plus } from 'lucide-react';
import type { ConditionAssessment, CostTrends, ValuationSummary } from '@vehicle-os/contracts';
import { INCOME_CATEGORIES, type IncomeCategory } from '@vehicle-os/domain';
import { ApiError, planWall, type PlanWall } from '@vehicle-os/api-client';
import {
  conditionQuery,
  conditionSummaryQuery,
  costTrendsQuery,
  healthQuery,
  incomeLedgerQuery,
  mileageReportQuery,
  monthlySpendQuery,
  photosQuery,
  queryKeys,
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
  healthBand,
  localDay,
  monthlyPace,
  monthsSince,
  ownedFor,
  stampForDay,
  trueCostPerDistance,
  type ReportGroup,
  type ReportPeriod,
  type SpendReport,
} from '@vehicle-os/ui';
import { api } from '@/lib/api';
import { DateField } from '@/components/ui/date-picker';
import {
  CHART,
  ColumnChart,
  Ladder,
  LineChart,
  RankBars,
  Spark,
  SplitBar,
  type LineSeries,
} from '@/components/charts';
import { Icon, type IconName } from '@/components/icons';
import { PrintButton } from '@/components/print-report';
import { save } from '@/components/transfer-panel';
import { LockedFeature } from '@/components/upgrade-dialog';
import { buttonClass } from '@/components/ui/button-class';
import { Gauge, Odometer } from '@/components/ui/instruments';
import { FormError, Modal, ModalActions } from '@/components/ui/modal';
import { Button, Field } from '@/components/ui/primitives';
import { SelectField } from '@/components/ui/select-field';
import { Skeleton } from '@/components/ui/skeleton';
import { ExpenseLedger } from '@/components/vehicle/spending-panel';
import {
  ASSESS_DESCRIPTION,
  AssessmentForm,
  AssessmentRow,
  ValuationForm,
} from '@/components/vehicle/value-panel';
import { formatDate, formatMoney, humanise, toMinorUnits } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  TAB_OF_GROUP,
  UNIT_LABEL,
  cents,
  compact,
  distanceLabel,
  formatDistance,
  money,
  perUnit,
  type VehicleReport,
  type ReportTab,
} from './report-data';

/*
 * The vehicle's report, drawn the way the phone draws it (`apps/mobile/components/
 * vehicle-statistics.tsx`): each part a set of cards that are mostly picture. A card leads with
 * its chart and the one figure the chart is about; a strip of key figures sits under it;
 * everything else is a chart, a bar or a dial. Words are only what names a mark. The same cards
 * in the same order on both — side by side here where the screen is wide.
 *
 * The web keeps what the phone records elsewhere: recording and correcting an entry (the folded
 * Entries card), a value, a condition check, income.
 */

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
    <div className="flex items-center justify-between gap-3 print:hidden">
      <div role="group" aria-label="Period" className="inline-flex gap-0.5 rounded-xl bg-muted p-1">
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
      {/* The figures dim while the next window loads over them; this says so to a reader. */}
      <span role="status" className="sr-only">
        {refreshing ? 'Updating' : ''}
      </span>
      <PrintButton label="PDF" />
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

/** The cost per distance of a sum, or a dash where there is no distance to divide by. */
const rate = (amountMinor: number, distance: number | null, currency: string) =>
  distance ? cents(amountMinor / distance, currency) : '—';
const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;
/** `12k`, `8.4k`, `640` — a distance for an axis. */
const short = (value: number) =>
  value >= 1000 ? `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}k` : String(Math.round(value));
const DAY_MONTH = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
const MONTH_YEAR = new Intl.DateTimeFormat('en-US', { month: 'short', year: '2-digit' });

/** One column on a phone, two where there is room; `wide` cards take both. */
function Bento({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">{children}</div>;
}

function Card({
  label,
  trailing,
  children,
  className,
}: {
  label?: string;
  trailing?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('flex min-w-0 flex-col gap-4 rounded-2xl bg-card/50 p-5', className)}>
      {label ? (
        <header className="flex min-h-7 items-center gap-2">
          <h2 className="min-w-0 flex-1 truncate text-label uppercase text-muted-foreground">
            {label}
          </h2>
          {trailing}
        </header>
      ) : null}
      {children}
    </section>
  );
}

interface Kpi {
  label: string;
  value: string;
  unit?: string;
  tone?: 'success' | 'destructive';
}

/**
 * The figures under a chart, as one strip of cells with hairlines between them. Only those the
 * record supports: a cell of dashes is noise. The cells are the resting card made opaque, so the
 * hairlines are the ground showing between them.
 */
function Kpis({
  items,
  className,
}: {
  items: (Kpi | null | false | undefined)[];
  className?: string;
}) {
  const shown = items.filter((item): item is Kpi => Boolean(item));
  if (shown.length === 0) return null;
  return (
    <dl
      className={cn(
        'grid gap-px overflow-hidden rounded-2xl bg-border/60',
        shown.length === 4
          ? 'grid-cols-2 sm:grid-cols-4'
          : shown.length === 2
            ? 'grid-cols-2'
            : 'grid-cols-3',
        className,
      )}
    >
      {shown.map((item) => (
        <div
          key={item.label}
          className="min-w-0 bg-[color-mix(in_oklab,var(--color-card)_50%,var(--color-background))] px-4 py-3.5 sm:px-5"
        >
          <dt className="truncate text-label uppercase text-muted-foreground">{item.label}</dt>
          <dd className="mt-1 flex min-w-0 items-baseline gap-1">
            <span
              className={cn(
                'truncate font-mono text-lg font-semibold tabular-nums tracking-tight sm:text-xl',
                item.tone === 'success'
                  ? 'text-success'
                  : item.tone === 'destructive'
                    ? 'text-destructive'
                    : 'text-foreground',
              )}
            >
              {item.value}
            </span>
            {item.unit ? (
              <span className="shrink-0 font-mono text-xs font-semibold text-muted-foreground">
                {item.unit}
              </span>
            ) : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** A card's own figure, large in mono, its unit small beside it. */
function Figure({ value, unit, large = false }: { value: string; unit?: string; large?: boolean }) {
  return (
    <p className="flex min-w-0 items-baseline gap-1.5">
      <span
        className={cn(
          'truncate font-mono font-semibold tabular-nums tracking-tight text-foreground',
          large ? 'text-[2rem] leading-10' : 'text-2xl',
        )}
      >
        {value}
      </span>
      {unit ? (
        <span className="shrink-0 font-mono text-xs font-semibold text-muted-foreground">
          {unit}
        </span>
      ) : null}
    </p>
  );
}

/** Small figures at a card's foot, side by side: label over value. */
function Facts({
  items,
}: {
  items: (false | null | undefined | { label: string; value: string })[];
}) {
  const shown = items.filter((item): item is { label: string; value: string } => Boolean(item));
  if (shown.length === 0) return null;
  return (
    <dl className="flex gap-4 border-t border-border/70 pt-4">
      {shown.map((item) => (
        <div key={item.label} className="min-w-0 flex-1">
          <dt className="truncate text-label uppercase text-muted-foreground">{item.label}</dt>
          <dd className="mt-0.5 truncate font-mono text-sm font-semibold tabular-nums text-foreground">
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** A change, as an arrow and a percentage in good-news or worth-a-look colours. */
function Delta({ change, good, said }: { change: number; good: 'up' | 'down'; said: string }) {
  const up = change > 0;
  const fine = change === 0 || up === (good === 'up');
  return (
    <span
      title={said}
      className={cn(
        'rounded-full px-2 py-0.5 font-mono text-xs font-semibold tabular-nums',
        fine ? 'bg-success-soft text-success' : 'bg-warning-soft text-warning',
      )}
    >
      {up ? '▲' : change < 0 ? '▼' : '='} {Math.abs(change)}%
      <span className="sr-only"> {said}</span>
    </span>
  );
}

function Tag({ children }: { children: ReactNode }) {
  return (
    <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 font-mono text-xs tabular-nums text-muted-foreground">
      {children}
    </span>
  );
}

/** A small round key at a card's head: record, export. */
function Action({
  label,
  onClick,
  loading,
  children,
}: {
  label: string;
  onClick: () => void;
  loading?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      aria-label={label}
      title={label}
      className={buttonClass('secondary', 'icon-sm', 'size-7 shrink-0 rounded-full print:hidden')}
    >
      {children}
    </button>
  );
}

/** Nothing in this period: the part's icon and a few words, not a paragraph. */
function Empty({ icon, text, className }: { icon: IconName; text: string; className?: string }) {
  return (
    <Card className={className}>
      <p className="flex items-center gap-3 text-sm font-medium text-muted-foreground">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-muted">
          <Icon name={icon} size={18} />
        </span>
        {text}
      </p>
    </Card>
  );
}

function Loading({ className }: { className?: string }) {
  return (
    <Card className={className}>
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-36 w-full rounded-xl" />
    </Card>
  );
}

function Locked({ wall }: { wall: PlanWall }) {
  return (
    <div className="lg:col-span-2">
      <LockedFeature wall={wall} />
    </div>
  );
}

/** What the totals left out, named rather than converted at a guess. */
function Excluded({ rows }: { rows: readonly { currency: string; amountMinor: number }[] }) {
  if (rows.length === 0) return null;
  return (
    <p className="text-xs text-muted-foreground">
      + {rows.map((row) => money(row.amountMinor, row.currency)).join(' + ')} not counted
    </p>
  );
}

/* ——— Overview ——— */

export function OverviewTab({
  report,
  onTab,
}: {
  report: VehicleReport;
  onTab: (tab: ReportTab) => void;
}) {
  const { spend, distance, vehicleId, vehicle } = report;
  const unit = distanceLabel(report.odometerUnit);
  const value = useQuery(valuationsQuery(api, vehicleId));
  const trends = useQuery(costTrendsQuery(api, vehicleId));

  if (!spend) {
    return (
      <Bento>
        <Loading className="lg:col-span-2" />
      </Bento>
    );
  }
  const currency = spend.currency;

  return (
    <Bento>
      <Card className="lg:col-span-2">
        <ColumnChart
          label="Running cost"
          legend={false}
          buckets={columns(spend.buckets)}
          series={GROUP_SERIES}
          format={(amount) => money(amount, currency)}
          formatAxis={(amount) => compact(amount, currency)}
        />
        {spend.total > 0 ? (
          <SplitBar
            onSelect={(key) => onTab(TAB_OF_GROUP[key as ReportGroup])}
            parts={REPORT_GROUPS.map((group) => ({
              key: group.key,
              label: group.label,
              value: spend.groups[group.key].total,
              display: money(spend.groups[group.key].total, currency),
              color: CHART[group.key],
            }))}
          />
        ) : null}
        <Excluded rows={spend.excluded} />
      </Card>

      <Kpis
        className="lg:col-span-2"
        items={[
          { label: 'Per day', value: cents(spend.total / spend.days, currency) },
          { label: `Per ${unit}`, value: rate(spend.total, distance, currency) },
          {
            label: 'Driven',
            value: distance ? Math.round(distance).toLocaleString() : '—',
            unit: distance ? unit : undefined,
          },
        ]}
      />

      <Insights report={report} value={value.data} />

      <ValueCard
        vehicleId={vehicleId}
        summary={value.data}
        pending={value.isPending}
        trends={trends.data}
        purchaseDate={vehicle?.purchaseDate ?? null}
      />
      <HealthCard vehicleId={vehicleId} />
      <ConditionCard vehicleId={vehicleId} />
      <DistanceCard
        odometer={vehicle?.currentOdometer ?? null}
        unit={report.odometerUnit}
        engineHours={vehicle?.currentEngineHours ?? null}
        years={trends.data?.distancePerYear ?? []}
      />
    </Bento>
  );
}

/**
 * What the record adds up to past its sums, side by side: what each kilometre really cost once
 * the value lost is counted — running and value lost as one bar — and the monthly pace against
 * the year before, over its year. Each only when the record supports it.
 */
function Insights({
  report,
  value,
}: {
  report: VehicleReport;
  value: ValuationSummary | undefined;
}) {
  const { cost, vehicle, vehicleId } = report;
  // Two years, once: the pace compares its two halves.
  const monthly = useQuery(monthlySpendQuery(api, vehicleId, 24));
  if (!cost) return null;

  const currency = cost.currency;
  const unit = distanceLabel(cost.distanceUnit);
  const paid = cost.purchasePrice?.amountMinor ?? null;
  const worth = value?.currentValue?.currency === currency ? value.currentValue.amountMinor : null;
  const running = Math.max(0, cost.ownershipCost.amountMinor - (paid ?? 0));
  const purchaseDate = vehicle?.purchaseDate ?? null;
  const trueCost = trueCostPerDistance({
    runningMinor: running,
    paidMinor: paid,
    worthMinor: worth,
    distance: cost.distanceCovered,
  });
  const points = monthly.data?.currency === currency ? monthly.data.points : null;
  const pace = points ? monthlyPace(points, purchaseDate ? monthsSince(purchaseDate) : null) : null;
  // Only once the value lost is known: without it, it is the running cost the strip shows.
  const lostShare =
    trueCost?.includesDepreciation && trueCost.perDistanceMinor > 0 && cost.distanceCovered
      ? Math.min(1, Math.max(0, 1 - running / cost.distanceCovered / trueCost.perDistanceMinor))
      : null;

  const showCost = Boolean(trueCost && lostShare !== null);
  const showPace = Boolean(pace && pace.averageMinor > 0 && points);
  if (!showCost && !showPace) return null;
  const both = showCost && showPace;
  return (
    // Side by side at every width, as on the phone; on a wide screen they join the grid around.
    <div className="grid grid-cols-[repeat(auto-fit,minmax(0,1fr))] gap-4 lg:col-span-2 lg:contents">
      {trueCost && lostShare !== null ? (
        <Card label="True cost" className={both ? undefined : 'lg:col-span-2'}>
          <Figure value={cents(trueCost.perDistanceMinor, currency)} unit={`/${unit}`} />
          <div className="flex flex-col gap-2">
            <div
              role="img"
              aria-label={`${Math.round((1 - lostShare) * 100)}% running costs, ${Math.round(lostShare * 100)}% value lost`}
              className="flex h-2 gap-[2px]"
            >
              <span className="rounded-[3px] bg-foreground" style={{ flexGrow: 1 - lostShare }} />
              <span
                className="rounded-[3px]"
                style={{ flexGrow: lostShare, backgroundColor: CHART.trip }}
              />
            </div>
            <p
              className="flex flex-wrap gap-x-3 gap-y-1 whitespace-nowrap text-xs text-muted-foreground"
              aria-hidden="true"
            >
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-[2.5px] bg-foreground" />
                Running
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-[2.5px]" style={{ backgroundColor: CHART.trip }} />
                Value lost
              </span>
            </p>
          </div>
        </Card>
      ) : null}
      {pace && pace.averageMinor > 0 && points ? (
        <Card
          label="Monthly"
          className={both ? undefined : 'lg:col-span-2'}
          trailing={
            pace.changePercent !== null ? (
              // Spending more is the thing to notice; less is the good news.
              <Delta change={pace.changePercent} good="down" said="against the year before" />
            ) : null
          }
        >
          <Figure value={money(pace.averageMinor, currency)} />
          <Spark
            values={points.slice(-12).map((point) => point.amountMinor)}
            color="var(--color-primary)"
          />
        </Card>
      ) : null}
    </div>
  );
}

/**
 * What it has cost against what it is worth, on one money axis. Both start from the price; one
 * climbs with every bill and the other falls with the market, and the gap between them is what
 * owning it has really cost. Ink for the cost, and the one hue the overview does not use for the
 * worth. Recording a value is here too; every estimate, folded under it.
 */
function ValueCard({
  vehicleId,
  summary,
  pending,
  trends,
  purchaseDate,
}: {
  vehicleId: string;
  summary: ValuationSummary | undefined;
  pending: boolean;
  trends: CostTrends | undefined;
  purchaseDate: string | null;
}) {
  const queryClient = useQueryClient();
  const [recording, setRecording] = useState(false);
  if (pending) return <Loading />;

  const current = summary?.currentValue ?? null;
  const paid = summary?.purchasePrice ?? null;
  // Nothing to draw without a price or a valuation; the vehicle's menu records the first.
  if (!current && !paid) return null;
  const change = summary?.changePercent ?? null;
  const currency = current?.currency ?? paid?.currency ?? trends?.currency ?? null;
  const owned = purchaseDate ? ownedFor(purchaseDate) : null;
  const lost =
    current && paid && current.currency === paid.currency
      ? depreciationPerYear(paid.amountMinor, current.amountMinor, purchaseDate)
      : null;

  const series: LineSeries[] = [];
  const spent = (trends?.currency === currency ? trends.ownership : []).filter(
    (row) => row.cumulativeMinor > 0,
  );
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
  const history = [...(summary?.history ?? [])].sort((a, b) =>
    a.valuationDate.localeCompare(b.valuationDate),
  );
  const worth = [
    ...(paid && purchaseDate && paid.currency === currency
      ? [{ x: Date.parse(`${purchaseDate}T00:00:00Z`), y: paid.amountMinor }]
      : []),
    ...history
      .filter((row) => row.estimatedValue.currency === currency)
      .map((row) => ({
        x: Date.parse(`${row.valuationDate}T00:00:00Z`),
        y: row.estimatedValue.amountMinor,
      })),
  ];
  if (worth.length >= 2) {
    series.push({ key: 'worth', label: 'Worth', color: CHART.trip, points: worth });
  }

  return (
    <Card
      label="Worth"
      className="lg:col-span-2"
      trailing={
        <>
          {change !== null ? <Delta change={change} good="up" said="since bought" /> : null}
          <Action label="Record a value" onClick={() => setRecording(true)}>
            <Plus className="size-3.5" aria-hidden="true" />
          </Action>
        </>
      }
    >
      <Figure value={current ? money(current.amountMinor, current.currency) : '—'} large />
      {series.length > 0 && currency ? (
        <LineChart
          series={series}
          formatY={(amount) => compact(amount, currency)}
          formatX={(x) => MONTH_YEAR.format(new Date(x))}
          area={series.length === 1}
        />
      ) : null}
      <Facts
        items={[
          paid && { label: 'Paid', value: money(paid.amountMinor, paid.currency) },
          lost !== null && lost > 0 && currency
            ? { label: 'Lost / yr', value: money(lost, currency) }
            : null,
          owned ? { label: 'Owned', value: owned } : null,
        ]}
      />
      {history.length > 0 ? (
        <Folded label="Estimates" count={history.length}>
          <ol className="flex flex-col gap-1.5">
            {[...history].reverse().map((entry) => (
              <li key={entry.id} className="flex items-baseline gap-3 text-sm">
                <time
                  dateTime={entry.valuationDate}
                  className="w-24 shrink-0 font-mono text-xs tabular-nums text-muted-foreground"
                >
                  {formatDate(entry.valuationDate)}
                </time>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">
                  {humanise(entry.source)}
                  {entry.notes ? ` · ${entry.notes}` : ''}
                </span>
                <span className="font-mono font-semibold tabular-nums text-foreground">
                  {formatMoney(entry.estimatedValue)}
                </span>
              </li>
            ))}
          </ol>
        </Folded>
      ) : null}

      {recording ? (
        <Modal
          title="Record a value"
          description="An estimate, a quote or a sale."
          icon="chart"
          onClose={() => setRecording(false)}
        >
          <ValuationForm
            vehicleId={vehicleId}
            onDone={() => {
              setRecording(false);
              void queryClient.invalidateQueries({ queryKey: queryKeys.vehicle(vehicleId) });
              void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard() });
            }}
            onCancel={() => setRecording(false)}
          />
        </Modal>
      ) : null}
    </Card>
  );
}

/** Folded away under a card: the record behind its picture, opened on a press. */
function Folded({ label, count, children }: { label: string; count: number; children: ReactNode }) {
  return (
    <details className="group border-t border-border/70 pt-3">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-label uppercase text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
        <span className="flex-1">{label}</span>
        <Tag>{String(count).padStart(2, '0')}</Tag>
        <Icon name="chevronRight" size={14} className="transition-transform group-open:rotate-90" />
      </summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}

/** The score on the dash's dial, its areas as bars, and what cost it points as chips. */
function HealthCard({ vehicleId }: { vehicleId: string }) {
  const health = useQuery(healthQuery(api, vehicleId));
  if (health.isPending) return <Loading />;
  const score = health.data?.overall ?? null;
  // Unscored, it has nothing to draw: schedules, documents and a check give it something.
  if (!health.data || score === null) return null;
  const band = healthBand(score) ?? 'success';
  const scored = health.data.categories.filter((category) => category.score !== null);
  const factors = [...health.data.factors].sort((a, b) => b.penalty - a.penalty).slice(0, 4);

  return (
    <Card
      label="Health"
      trailing={
        <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-xs font-bold text-foreground">
          <span
            aria-hidden="true"
            className={cn(
              'size-1.5 rounded-full',
              band === 'success'
                ? 'bg-success'
                : band === 'warning'
                  ? 'bg-warning'
                  : 'bg-destructive',
            )}
          />
          {band === 'success' ? 'Good' : band === 'warning' ? 'Fair' : 'Poor'}
        </span>
      }
    >
      <div className="flex items-center gap-5">
        <Gauge
          fraction={score / 100}
          tone={band}
          label={`Health ${score} out of 100`}
          className="gauge-ignite w-28 shrink-0"
        >
          <span className="font-mono text-2xl font-semibold tabular-nums text-foreground">
            {score}
          </span>
        </Gauge>
        {scored.length > 0 ? (
          <div className="min-w-0 flex-1">
            <RankBars
              max={100}
              rows={scored.map((category) => ({
                key: category.category,
                label: humanise(category.category),
                value: category.score ?? 0,
                display: String(category.score),
                color: `var(--color-${healthBand(category.score) ?? 'success'})`,
              }))}
            />
          </div>
        ) : null}
      </div>
      {factors.length > 0 ? (
        // What cost it points, worst first: the working behind the score (PRD §33), as chips.
        <ul className="flex flex-wrap gap-1.5">
          {factors.map((factor) => (
            <li
              key={`${factor.category}-${factor.label}`}
              title={factor.detail}
              className="flex max-w-full items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs text-foreground"
            >
              <span className="font-mono font-semibold tabular-nums text-destructive">
                −{factor.penalty}
              </span>
              <span className="truncate">{factor.label}</span>
              <span className="sr-only">: {factor.detail}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}

type Assessing = { initial: ConditionAssessment | null } | null;

/** The latest judgement of each part as bars in its band's colour; every check, folded under. */
function ConditionCard({ vehicleId }: { vehicleId: string }) {
  const queryClient = useQueryClient();
  const [assessing, setAssessing] = useState<Assessing>(null);
  const condition = useQuery(conditionSummaryQuery(api, vehicleId));
  const assessments = useQuery(conditionQuery(api, vehicleId));
  const photos = useQuery(photosQuery(api, vehicleId));
  const parts = condition.data?.categories.filter((part) => part.score !== null) ?? [];
  if (parts.length === 0) return null;
  const overall = condition.data?.overallScore ?? null;
  const saved = () => {
    setAssessing(null);
    // An assessment moves the health score; both live under the vehicle subtree.
    void queryClient.invalidateQueries({ queryKey: queryKeys.vehicle(vehicleId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard() });
  };
  const checks = assessments.data?.data ?? [];

  return (
    <Card
      label="Condition"
      trailing={
        <>
          {overall !== null ? <Tag>{overall} / 100</Tag> : null}
          <Action label="Assess the condition" onClick={() => setAssessing({ initial: null })}>
            <Plus className="size-3.5" aria-hidden="true" />
          </Action>
        </>
      }
    >
      <RankBars
        max={100}
        columns={2}
        rows={parts.map((part) => ({
          key: part.category,
          label: humanise(part.category),
          value: part.score ?? 0,
          display: String(part.score),
          color: `var(--color-${healthBand(part.score) ?? 'success'})`,
        }))}
      />
      {checks.length > 0 ? (
        <Folded label="Checks" count={checks.length}>
          <ol className="flex flex-col gap-2">
            {checks.map((assessment) => (
              <AssessmentRow
                key={assessment.id}
                vehicleId={vehicleId}
                assessment={assessment}
                photos={(photos.data ?? []).filter(
                  (photo) => photo.conditionAssessmentId === assessment.id,
                )}
                onEdit={() => setAssessing({ initial: assessment })}
                onDeleted={saved}
              />
            ))}
          </ol>
        </Folded>
      ) : null}

      {assessing ? (
        <Modal
          title={assessing.initial ? 'Correct the assessment' : 'Assess the condition'}
          description={ASSESS_DESCRIPTION}
          icon="inspection"
          size="lg"
          onClose={() => setAssessing(null)}
        >
          <AssessmentForm
            vehicleId={vehicleId}
            initial={assessing.initial}
            onDone={saved}
            onCancel={() => setAssessing(null)}
          />
        </Modal>
      ) : null}
    </Card>
  );
}

function DistanceCard({
  odometer,
  unit,
  engineHours,
  years,
}: {
  odometer: number | null;
  unit: 'KM' | 'MI';
  engineHours: number | null;
  years: CostTrends['distancePerYear'];
}) {
  const recent = years.slice(-6);
  const yearly = distancePerYear(years);
  return (
    <Card
      label="Odometer"
      className="lg:col-span-2"
      trailing={engineHours !== null ? <Tag>{engineHours.toLocaleString()} h</Tag> : null}
    >
      <p className="flex items-center gap-2">
        <span className="odo-drums font-mono text-xl font-semibold" aria-hidden="true">
          <Odometer value={odometer} />
        </span>
        <span className="sr-only">{formatDistance(odometer, unit)}</span>
        <span
          aria-hidden="true"
          className="font-mono text-[10px] font-semibold tracking-[0.12em] text-muted-foreground"
        >
          {unit}
        </span>
      </p>
      {recent.length >= 2 ? (
        <ColumnChart
          large={false}
          label="Per year"
          total={yearly ?? undefined}
          height={72}
          buckets={recent.map((row) => ({
            key: String(row.year),
            label: `’${String(row.year).slice(2)}`,
            long: String(row.year),
            values: { distance: row.distance },
          }))}
          series={[{ key: 'distance', label: 'Driven', color: 'var(--color-muted-foreground)' }]}
          format={(value) => formatDistance(Math.round(value), recent[0]!.distanceUnit)}
          formatAxis={short}
        />
      ) : null}
    </Card>
  );
}

/* ——— Refueling ——— */

export function RefuelingTab({ report }: { report: VehicleReport }) {
  const { spend, distance, vehicleId } = report;
  const trends = useQuery(costTrendsQuery(api, vehicleId));
  const fuel = useMemo(() => (spend ? buildRefuelReport(spend) : undefined), [spend]);
  const detail = useMemo(() => (spend ? groupDetail(spend, 'REFUELING') : undefined), [spend]);
  const unit = distanceLabel(report.odometerUnit);
  const perHundred = report.odometerUnit !== 'MI';

  if (!spend || !fuel || !detail) {
    return (
      <Bento>
        <Loading className="lg:col-span-2" />
      </Bento>
    );
  }
  const currency = spend.currency;
  const efficiency = (trends.data?.efficiency ?? []).flatMap((series) => {
    const result = efficiencyInWindow(series.points, report.from ? spend.fromMs : 0, perHundred);
    return result ? [{ unit: series.unit, ...result }] : [];
  });
  const primary = fuel.units[0];
  const leading = efficiency.find((entry) => entry.unit === primary?.unit) ?? efficiency[0];
  const rateUnit = (fuelUnit: string) =>
    perHundred
      ? `${UNIT_LABEL[fuelUnit] ?? ''}/100 ${unit}`
      : `${unit}/${UNIT_LABEL[fuelUnit] ?? ''}`;
  const units = [
    ...new Set([
      ...fuel.units.map((entry) => entry.unit),
      ...efficiency.map((entry) => entry.unit),
    ]),
  ];

  return (
    <Bento>
      {fuel.fills === 0 ? (
        <Empty icon="fuel" text="No fill-ups in this period" className="lg:col-span-2" />
      ) : (
        <>
          <Card className="lg:col-span-2">
            <ColumnChart
              label="Fuel"
              trailing={<Tag>{plural(fuel.fills, 'fill')}</Tag>}
              buckets={columns(
                detail.buckets.map((bucket) => ({
                  key: bucket.key,
                  values: { REFUELING: bucket.value },
                })),
              )}
              series={[GROUP_SERIES[0]!]}
              format={(amount) => money(amount, currency)}
              formatAxis={(amount) => compact(amount, currency)}
            />
          </Card>

          <Kpis
            className="lg:col-span-2"
            items={[
              {
                label: 'Consumption',
                value: leading ? leading.average.toFixed(1) : '—',
                unit: leading ? rateUnit(leading.unit) : undefined,
              },
              {
                label: `Per ${primary ? UNIT_LABEL[primary.unit] : 'unit'}`,
                value: primary?.pricePerUnitMinor
                  ? perUnit(primary.pricePerUnitMinor, currency)
                  : '—',
                unit: primary?.pricePerUnitMinor ? currency : undefined,
              },
              { label: `Per ${unit}`, value: rate(detail.total, distance, currency) },
            ]}
          />

          {units.flatMap((fuelUnit) => {
            const use = efficiency.find((entry) => entry.unit === fuelUnit);
            const bought = fuel.units.find((entry) => entry.unit === fuelUnit);
            const label = UNIT_LABEL[fuelUnit] ?? fuelUnit;
            const named = units.length > 1 ? ` · ${label}` : '';
            const trend = Boolean(use && use.points.length >= 2);
            const prices = Boolean(bought && bought.prices.length >= 2 && bought.pricePerUnitMinor);
            const places = Boolean(bought && bought.places.length > 0);
            // Two to a row: the odd card out takes the whole row rather than leaving a hole.
            const odd = (Number(trend) + Number(prices) + Number(places)) % 2 === 1;
            const last = places ? 'places' : prices ? 'prices' : 'trend';
            const span = (card: string) => (odd && card === last ? 'lg:col-span-2' : undefined);
            return [
              use && trend ? (
                <Card
                  key={`use-${fuelUnit}`}
                  label={`Consumption${named} · ${rateUnit(fuelUnit)}`}
                  className={span('trend')}
                >
                  <LineChart
                    series={[
                      {
                        key: 'rate',
                        label: rateUnit(fuelUnit),
                        color: CHART.REFUELING,
                        points: use.points.slice(-24),
                      },
                    ]}
                    reference={{ value: use.average, label: `avg ${use.average.toFixed(1)}` }}
                    formatY={(value) => value.toFixed(1)}
                    formatX={(x) => DAY_MONTH.format(new Date(x))}
                  />
                </Card>
              ) : null,
              bought?.pricePerUnitMinor && prices ? (
                <Card
                  key={`price-${fuelUnit}`}
                  label={`Price${named} · ${currency}/${label}`}
                  className={span('prices')}
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
                    reference={{ value: bought.pricePerUnitMinor, label: 'avg' }}
                    formatY={(value) => perUnit(value, currency)}
                    formatX={(x) => DAY_MONTH.format(new Date(x))}
                  />
                </Card>
              ) : null,
              bought && places ? (
                <Card
                  key={`places-${fuelUnit}`}
                  label={fuelUnit === 'KWH' ? 'Where you charge' : 'Where you fill up'}
                  className={span('places')}
                >
                  <Ladder
                    color={CHART.REFUELING}
                    rows={bought.places.slice(0, 6).map((place) => ({
                      key: place.vendor,
                      label: place.vendor,
                      value: place.perUnitMinor,
                      display: perUnit(place.perUnitMinor, currency),
                    }))}
                  />
                </Card>
              ) : null,
            ];
          })}

          <Kpis
            className="lg:col-span-2"
            items={[
              fuel.averageFillMinor !== null && {
                label: 'Average fill',
                value: money(fuel.averageFillMinor, currency),
              },
              primary && {
                label: 'Per fill',
                value: (primary.quantity / primary.fills).toFixed(1),
                unit: UNIT_LABEL[primary.unit],
              },
              fuel.daysBetween !== null && {
                label: 'Every',
                value: fuel.daysBetween.toFixed(fuel.daysBetween < 10 ? 1 : 0),
                unit: 'days',
              },
              fuel.distanceBetween !== null && {
                label: 'Range',
                value: Math.round(fuel.distanceBetween).toLocaleString(),
                unit,
              },
            ]}
          />
        </>
      )}

      <Ledger report={report} rows={detail.rows} category="FUEL" />
    </Bento>
  );
}

function Ledger({
  report,
  rows,
  category,
}: {
  report: VehicleReport;
  rows: Parameters<typeof ExpenseLedger>[0]['rows'];
  category: Parameters<typeof ExpenseLedger>[0]['defaultCategory'];
}) {
  return (
    <div className="lg:col-span-2">
      <ExpenseLedger
        vehicleId={report.vehicleId}
        rows={rows}
        currency={report.spend?.currency ?? report.cost?.currency ?? 'USD'}
        unitLabel={distanceLabel(report.odometerUnit)}
        defaultCategory={category}
        pending={!report.spend}
      />
    </div>
  );
}

/* ——— Services and Expenses: one shape, two slices ——— */

const GROUP_TAB = {
  SERVICES: {
    noun: 'visit',
    byVendor: 'Workshops',
    icon: 'maintenance',
    category: 'MAINTENANCE',
    empty: 'No services in this period',
  },
  EXPENSES: {
    noun: 'bill',
    byVendor: 'Paid to',
    icon: 'receipt',
    category: 'INSURANCE',
    empty: 'No bills in this period',
  },
} as const;

export function GroupTab({
  report,
  group,
}: {
  report: VehicleReport;
  group: Exclude<ReportGroup, 'REFUELING'>;
}) {
  const { spend, distance } = report;
  const copy = GROUP_TAB[group];
  const detail = useMemo(() => (spend ? groupDetail(spend, group) : undefined), [spend, group]);
  const unit = distanceLabel(report.odometerUnit);
  const label = REPORT_GROUPS.find((entry) => entry.key === group)!.label;

  if (!spend || !detail) {
    return (
      <Bento>
        <Loading className="lg:col-span-2" />
      </Bento>
    );
  }
  const currency = spend.currency;

  return (
    <Bento>
      {detail.count === 0 ? (
        <Empty icon={copy.icon} text={copy.empty} className="lg:col-span-2" />
      ) : (
        <>
          <Card className="lg:col-span-2">
            <ColumnChart
              label={label}
              trailing={<Tag>{plural(detail.count, copy.noun)}</Tag>}
              buckets={columns(
                detail.buckets.map((bucket) => ({
                  key: bucket.key,
                  values: { [group]: bucket.value },
                })),
              )}
              series={GROUP_SERIES.filter((series) => series.key === group)}
              format={(amount) => money(amount, currency)}
              formatAxis={(amount) => compact(amount, currency)}
            />
          </Card>

          <Kpis
            className="lg:col-span-2"
            items={[
              {
                label: `Per ${copy.noun}`,
                value: detail.averageMinor === null ? '—' : money(detail.averageMinor, currency),
              },
              { label: 'Per month', value: money(detail.perMonthMinor, currency) },
              { label: `Per ${unit}`, value: rate(detail.total, distance, currency) },
            ]}
          />

          <Card
            label="By kind"
            className={detail.byVendor.length > 0 ? undefined : 'lg:col-span-2'}
          >
            <RankBars
              color={CHART[group]}
              rows={detail.byCategory.map((row) => ({
                key: row.key,
                label: humanise(row.key),
                count: row.count,
                value: row.amountMinor,
                display: money(row.amountMinor, currency),
              }))}
            />
          </Card>
          {detail.byVendor.length > 0 ? (
            <Card label={copy.byVendor}>
              <RankBars
                color={CHART[group]}
                rows={detail.byVendor.slice(0, 6).map((row) => ({
                  key: row.key,
                  label: row.key,
                  count: row.count,
                  value: row.amountMinor,
                  display: money(row.amountMinor, currency),
                }))}
              />
            </Card>
          ) : null}
        </>
      )}

      <Ledger report={report} rows={detail.rows} category={copy.category} />
    </Bento>
  );
}

/* ——— Income ——— */

export function IncomeTab({ report }: { report: VehicleReport }) {
  const { spend, distance, vehicleId, from } = report;
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
      <Bento>
        <Locked wall={wall} />
      </Bento>
    );
  }
  if (income.isError) {
    return (
      <Bento>
        <Empty icon="income" text={(income.error as Error).message} className="lg:col-span-2" />
      </Bento>
    );
  }

  const record = (
    <Action label="Record income" onClick={() => setRecording(true)}>
      <Plus className="size-3.5" aria-hidden="true" />
    </Action>
  );

  return (
    <Bento>
      {!data ? (
        <Loading className="lg:col-span-2" />
      ) : data.count === 0 ? (
        <Card className="lg:col-span-2">
          <p className="flex items-center gap-3 text-sm font-medium text-muted-foreground">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-muted">
              <Icon name="income" size={18} />
            </span>
            <span className="flex-1">Nothing earned in this period</span>
            {record}
          </p>
        </Card>
      ) : (
        <>
          <Card className="lg:col-span-2">
            <ColumnChart
              mode="group"
              label="Earned"
              trailing={
                <>
                  <Tag>{`${data.count} ${data.count === 1 ? 'entry' : 'entries'}`}</Tag>
                  {record}
                </>
              }
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
            />
            <Excluded rows={data.excluded} />
          </Card>

          <Kpis
            className="lg:col-span-2"
            items={[
              {
                label: 'Net',
                value: money(data.net, currency),
                tone: data.net >= 0 ? 'success' : 'destructive',
              },
              { label: `Per ${unit}`, value: rate(data.total, distance, currency) },
              {
                label: 'Margin',
                value: data.total > 0 ? String(Math.round((data.net / data.total) * 100)) : '—',
                unit: data.total > 0 ? '%' : undefined,
              },
            ]}
          />

          <Card label="By kind" className={data.byPayer.length > 0 ? undefined : 'lg:col-span-2'}>
            <RankBars
              color={CHART.income}
              rows={data.byCategory.map((row) => ({
                key: row.key,
                label: humanise(row.key),
                count: row.count,
                value: row.amountMinor,
                display: money(row.amountMinor, currency),
              }))}
            />
          </Card>
          {data.byPayer.length > 0 ? (
            <Card label="By payer">
              <RankBars
                color={CHART.income}
                rows={data.byPayer.slice(0, 6).map((row) => ({
                  key: row.key,
                  label: row.key,
                  count: row.count,
                  value: row.amountMinor,
                  display: money(row.amountMinor, currency),
                }))}
              />
            </Card>
          ) : null}
        </>
      )}

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
    </Bento>
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
  const { vehicleId, from } = report;
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
      <Bento>
        <Locked wall={wall} />
      </Bento>
    );
  }
  if (mileage.isError) {
    return (
      <Bento>
        <Empty icon="route" text={(mileage.error as Error).message} className="lg:col-span-2" />
      </Bento>
    );
  }
  if (!routes || !mileage.data) {
    return (
      <Bento>
        <Loading className="lg:col-span-2" />
      </Bento>
    );
  }
  if (routes.trips === 0) {
    return (
      <Bento>
        <Empty icon="route" text="No trips in this period" className="lg:col-span-2" />
      </Bento>
    );
  }
  const deductions = mileage.data.deductions;

  return (
    <Bento>
      <Card className="lg:col-span-2">
        <ColumnChart
          label="Logged"
          legend={false}
          trailing={
            <>
              <Tag>{plural(routes.trips, 'trip')}</Tag>
              <Action
                label="Download the trips as CSV"
                onClick={() => download.mutate()}
                loading={download.isPending}
              >
                <Download className="size-3.5" aria-hidden="true" />
              </Action>
            </>
          }
          buckets={columns(routes.buckets)}
          series={TRIP_PURPOSES.map((purpose) => ({
            key: purpose.key,
            label: purpose.label,
            color: PURPOSE_COLOR[purpose.key],
          }))}
          format={km}
        />
        <SplitBar
          parts={TRIP_PURPOSES.map((purpose) => ({
            key: purpose.key,
            label: purpose.label,
            value: routes.byPurpose[purpose.key].distance,
            display: km(routes.byPurpose[purpose.key].distance),
            color: PURPOSE_COLOR[purpose.key],
          }))}
        />
      </Card>

      <Kpis
        className="lg:col-span-2"
        items={[
          {
            label: 'Average trip',
            value:
              routes.averageDistance === null
                ? '—'
                : Math.round(routes.averageDistance).toLocaleString(),
            unit: routes.averageDistance === null ? undefined : distanceLabel(unit),
          },
          {
            label: 'Business',
            value:
              routes.businessShare === null ? '—' : String(Math.round(routes.businessShare * 100)),
            unit: routes.businessShare === null ? undefined : '%',
          },
          {
            label: 'Deductible',
            value:
              deductions.length > 0
                ? deductions.map((amount) => money(amount.amountMinor, amount.currency)).join(' + ')
                : '—',
          },
        ]}
      />

      <Card label="Longest trips" className="lg:col-span-2">
        <RankBars
          rows={routes.longest.map((row) => ({
            key: row.eventId,
            label: row.title,
            value: row.trip.distance,
            display: km(row.trip.distance),
            color: PURPOSE_COLOR[row.trip.purpose],
          }))}
        />
      </Card>
    </Bento>
  );
}
