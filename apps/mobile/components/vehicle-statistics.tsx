import { Ionicons } from '@expo/vector-icons';
import { planWall, type PlanWall } from '@vehicle-os/api-client';
import { PLAN_NAMES, minorUnitExponent } from '@vehicle-os/domain';
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
  monthlyPace,
  monthsSince,
  ownedFor,
  trueCostPerDistance,
  type LedgerRow,
  type ReportGroup,
  type ReportPeriod,
} from '@vehicle-os/ui';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Children, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Alert,
  Animated,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import type { CostTrends, ValuationSummary, VehicleHealth } from '@vehicle-os/contracts';
import {
  conditionSummaryQuery,
  costTrendsQuery,
  healthQuery,
  incomeLedgerQuery,
  mileageReportQuery,
  monthlySpendQuery,
  valuationsQuery,
} from '@vehicle-os/api-client/react';
import {
  ColumnChart,
  Ladder,
  LineChart,
  RankBars,
  Spark,
  SplitBar,
  type Series,
} from '@/components/charts';
import { useChartColors } from '@/lib/chart-colors';
import { REPORT_TABS, useVehicleReport, type ReportTab, type VehicleReport } from '@/lib/report';
import { shareMileageReport } from '@/lib/share-export';
import { Button, Skeleton } from '@/lib/ui';
import { showUpgrade } from '@/lib/upgrade';
import { api } from '@/lib/api';
import { Eyebrow, Glyph, Segmented } from '@/lib/instrument';
import {
  Gauge,
  haptic,
  Odometer,
  PressableScale,
  Rise,
  spring,
  useIgnition,
  useReduceMotion,
} from '@/lib/motion';
import { figure, radius, spacing, typeScale, useTheme } from '@/lib/theme';
import { compactMoney, formatDistance, formatMoney, humanise } from '@/lib/format';

const pad = (value: number) => String(value).padStart(2, '0');
const MONTH_YEAR = new Intl.DateTimeFormat('en-US', { month: 'short', year: '2-digit' });
const DAY_MONTH = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });

/** What a price or a consumption is per, as a person says it. */
const UNIT_LABEL: Record<string, string> = {
  LITER: 'L',
  US_GALLON: 'gal',
  IMP_GALLON: 'gal',
  KWH: 'kWh',
  KG: 'kg',
};

const TAB_OF_GROUP: Record<ReportGroup, ReportTab> = {
  REFUELING: 'refueling',
  SERVICES: 'services',
  EXPENSES: 'expenses',
};

/** Whole units, for a headline. */
const money = (amountMinor: number, currency: string) =>
  formatMoney({ amountMinor: Math.round(amountMinor), currency }, true);
/** With cents, for a rate — a cost per kilometre in whole euros is always €0. */
const cents = (amountMinor: number, currency: string) =>
  formatMoney({ amountMinor: Math.round(amountMinor), currency });
/** "1.759" — a pump's three places. */
const perUnit = (amountMinor: number, currency: string) =>
  (amountMinor / 10 ** minorUnitExponent(currency)).toFixed(3);
const rate = (amountMinor: number, distance: number | null, currency: string) =>
  distance ? cents(amountMinor / distance, currency) : '—';
const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;
/** `12k`, `8.4k`, `640` — a distance for an axis. */
const compact = (value: number) =>
  value >= 1000 ? `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}k` : String(Math.round(value));

const columns = (buckets: readonly { key: string; values: Record<string, number> }[]) =>
  buckets.map((bucket) => ({
    key: bucket.key,
    label: bucketLabel(bucket.key, 'short').toUpperCase(),
    long: bucketLabel(bucket.key, 'long'),
    values: bucket.values,
  }));

/**
 * The vehicle's report — the web's six parts over one period, on a phone, and drawn the web's
 * way: each part a stack of cards that are mostly picture. A card leads with its chart and the
 * one figure the chart is about; a strip of key figures sits under it; everything else is a
 * chart, a bar or a dial. Words are only what names a mark.
 *
 * Overview says what it all adds up to; Refueling, Expenses and Services are slices of the same
 * ledger, so they always add up to it; Income nets what it earns against that spend; Routes
 * splits the driving by purpose. The period applies to every part at once.
 */
export function VehicleStatistics({
  vehicleId,
  onLogOdometer,
  onJump,
}: {
  vehicleId: string;
  /** The odometer is the one reading that moves, so it is the one you can press to move it. */
  onLogOdometer?: () => void;
  /** Scrolls the screen to an offset within this section. */
  onJump?: (offset: number) => void;
}) {
  const [tab, setTab] = useState<ReportTab>('overview');
  const [period, setPeriod] = useState<ReportPeriod>('1y');
  const report = useVehicleReport(vehicleId, period);
  const theme = useTheme();

  const open = (next: ReportTab) => {
    setTab(next);
    // A new part starts at its head, not wherever the last one was scrolled to.
    onJump?.(0);
  };

  return (
    <View style={{ gap: spacing.md }}>
      <ReportTabs value={tab} onChange={open} />

      <Segmented
        small
        value={period}
        options={REPORT_PERIODS.map((option) => ({
          value: option.value,
          label: option.label,
          said: option.long,
        }))}
        onChange={setPeriod}
      />

      {/* The last window's figures stay up, dimmed, while the next one loads over them. */}
      <View style={{ opacity: report.refreshing ? 0.5 : 1 }}>
        {report.error ? (
          <Card label="Could not load the report">
            <Text style={[typeScale.caption, { color: theme.mutedForeground }]}>
              {report.error.message}
            </Text>
            <Button label="Try again" size="sm" onPress={report.refetch} />
          </Card>
        ) : tab === 'overview' ? (
          <Overview report={report} onOpen={open} onLogOdometer={onLogOdometer} />
        ) : tab === 'refueling' ? (
          <Refueling report={report} />
        ) : tab === 'expenses' ? (
          <GroupTab report={report} group="EXPENSES" />
        ) : tab === 'services' ? (
          <GroupTab report={report} group="SERVICES" />
        ) : tab === 'income' ? (
          <Income report={report} />
        ) : (
          <Routes report={report} />
        )}
      </View>
    </View>
  );
}

/* ——— Overview ——— */

function Overview({
  report,
  onOpen,
  onLogOdometer,
}: {
  report: VehicleReport;
  onOpen: (tab: ReportTab) => void;
  onLogOdometer?: () => void;
}) {
  const colors = useChartColors();
  const { spend, distance, vehicleId, vehicle } = report;
  const health = useQuery(healthQuery(api, vehicleId));
  const value = useQuery(valuationsQuery(api, vehicleId));
  const trends = useQuery(costTrendsQuery(api, vehicleId));
  const unit = report.odometerUnit === 'MI' ? 'mi' : 'km';

  if (!spend) return <Loading />;
  const currency = spend.currency;

  return (
    <Stack>
      <Card>
        <ColumnChart
          label="Running cost"
          legend={false}
          buckets={columns(spend.buckets)}
          series={REPORT_GROUPS.map((group) => ({
            key: group.key,
            label: group.label,
            color: colors[group.key],
          }))}
          format={(amount) => money(amount, currency)}
          formatAxis={(amount) => compactMoney(amount, currency)}
        />
        {spend.total > 0 ? (
          <SplitBar
            onSelect={(key) => onOpen(TAB_OF_GROUP[key as ReportGroup])}
            parts={REPORT_GROUPS.map((group) => ({
              key: group.key,
              label: group.label,
              value: spend.groups[group.key].total,
              display: money(spend.groups[group.key].total, currency),
              color: colors[group.key],
            }))}
          />
        ) : null}
        <Excluded rows={spend.excluded} />
      </Card>

      <Kpis
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

      <Value
        summary={value.data}
        pending={value.isPending}
        trends={trends.data}
        purchaseDate={vehicle?.purchaseDate ?? null}
      />

      <Health health={health.data} pending={health.isPending} />

      <Condition vehicleId={vehicleId} />

      <Distance
        odometer={vehicle?.currentOdometer ?? null}
        unit={report.odometerUnit}
        engineHours={vehicle?.currentEngineHours ?? null}
        years={trends.data?.distancePerYear ?? []}
        onLog={onLogOdometer}
      />
    </Stack>
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
  const theme = useTheme();
  const colors = useChartColors();
  const { cost, vehicle, vehicleId } = report;
  // Two years, once: the pace compares its two halves.
  const monthly = useQuery(monthlySpendQuery(api, vehicleId, 24));
  if (!cost) return null;

  const currency = cost.currency;
  const unit = cost.distanceUnit === 'MI' ? 'mi' : 'km';
  const paid = cost.purchasePrice?.amountMinor ?? null;
  const worth =
    value?.currentValue && value.currentValue.currency === currency
      ? value.currentValue.amountMinor
      : null;
  const running = Math.max(0, cost.ownershipCost.amountMinor - (paid ?? 0));
  const purchaseDate = vehicle?.purchaseDate ?? null;
  const trueCost = trueCostPerDistance({
    runningMinor: running,
    paidMinor: paid,
    worthMinor: worth,
    distance: cost.distanceCovered,
  });
  const points = monthly.data && monthly.data.currency === currency ? monthly.data.points : null;
  const pace = points ? monthlyPace(points, purchaseDate ? monthsSince(purchaseDate) : null) : null;
  // Only once the value lost is known: without it, it is the running cost the strip above shows.
  const lostShare =
    trueCost?.includesDepreciation && trueCost.perDistanceMinor > 0 && cost.distanceCovered
      ? Math.min(1, Math.max(0, 1 - running / cost.distanceCovered / trueCost.perDistanceMinor))
      : null;
  const showPace = pace !== null && pace.averageMinor > 0;
  if (lostShare === null && !showPace) return null;

  return (
    <View style={styles.pair}>
      {trueCost && lostShare !== null ? (
        <Card label="True cost" style={styles.half}>
          <Figure value={cents(trueCost.perDistanceMinor, currency)} unit={`/${unit}`} />
          <View
            accessible
            accessibilityLabel={`${Math.round((1 - lostShare) * 100)}% running costs, ${Math.round(lostShare * 100)}% value lost`}
            style={{ gap: 6 }}
          >
            <View style={styles.split}>
              <View style={{ flex: 1 - lostShare, backgroundColor: colors.ink, borderRadius: 3 }} />
              <View style={{ flex: lostShare, backgroundColor: colors.trip, borderRadius: 3 }} />
            </View>
            <View style={styles.legend}>
              <Swatch color={colors.ink} label="Running" />
              <Swatch color={colors.trip} label="Value lost" />
            </View>
          </View>
        </Card>
      ) : null}
      {showPace && points ? (
        <Card
          label="Monthly"
          trailing={
            pace.changePercent !== null ? (
              // Spending more is the thing to notice; less is the good news.
              <Delta change={pace.changePercent} good="down" />
            ) : null
          }
          style={styles.half}
        >
          <Figure value={money(pace.averageMinor, currency)} />
          <Spark
            values={points.slice(-12).map((point) => point.amountMinor)}
            color={theme.primary}
          />
        </Card>
      ) : null}
    </View>
  );
}

/* ——— Refueling ——— */

function Refueling({ report }: { report: VehicleReport }) {
  const colors = useChartColors();
  const { spend, distance, vehicleId } = report;
  const trends = useQuery(costTrendsQuery(api, vehicleId));
  const fuel = useMemo(() => (spend ? buildRefuelReport(spend) : undefined), [spend]);
  const detail = useMemo(() => (spend ? groupDetail(spend, 'REFUELING') : undefined), [spend]);
  const perHundred = report.odometerUnit !== 'MI';
  const unit = report.odometerUnit === 'MI' ? 'mi' : 'km';

  if (!spend || !fuel || !detail) return <Loading />;
  if (fuel.fills === 0) return <Empty glyph="⛽" text="No fill-ups in this period" />;

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
    <Stack>
      <Card>
        <ColumnChart
          label="Fuel"
          trailing={<Tag>{plural(fuel.fills, 'fill')}</Tag>}
          buckets={columns(
            detail.buckets.map((bucket) => ({
              key: bucket.key,
              values: { REFUELING: bucket.value },
            })),
          )}
          series={[{ key: 'REFUELING', label: 'Refueling', color: colors.REFUELING }]}
          format={(amount) => money(amount, currency)}
          formatAxis={(amount) => compactMoney(amount, currency)}
        />
      </Card>

      <Kpis
        items={[
          {
            label: 'Consumption',
            value: leading ? leading.average.toFixed(1) : '—',
            unit: leading ? rateUnit(leading.unit) : undefined,
          },
          {
            label: `Per ${primary ? UNIT_LABEL[primary.unit] : 'unit'}`,
            value: primary?.pricePerUnitMinor ? perUnit(primary.pricePerUnitMinor, currency) : '—',
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
        return [
          use && use.points.length >= 2 ? (
            <Card key={`use-${fuelUnit}`} label={`Consumption${named} · ${rateUnit(fuelUnit)}`}>
              <LineChart
                series={[
                  {
                    key: 'rate',
                    label: rateUnit(fuelUnit),
                    color: colors.REFUELING,
                    points: use.points.slice(-16),
                  },
                ]}
                reference={{ value: use.average, label: `avg ${use.average.toFixed(1)}` }}
                formatY={(value) => value.toFixed(1)}
                formatX={(x) => DAY_MONTH.format(new Date(x))}
              />
            </Card>
          ) : null,
          bought && bought.prices.length >= 2 && bought.pricePerUnitMinor ? (
            <Card key={`price-${fuelUnit}`} label={`Price${named} · ${currency}/${label}`}>
              <LineChart
                series={[
                  {
                    key: 'price',
                    label: `per ${label}`,
                    color: colors.REFUELING,
                    points: bought.prices
                      .map((price) => ({ x: price.at, y: price.perUnitMinor }))
                      .slice(-16),
                  },
                ]}
                reference={{ value: bought.pricePerUnitMinor, label: 'avg' }}
                formatY={(value) => perUnit(value, currency)}
                formatX={(x) => DAY_MONTH.format(new Date(x))}
              />
            </Card>
          ) : null,
          bought && bought.places.length > 0 ? (
            <Card
              key={`places-${fuelUnit}`}
              label={fuelUnit === 'KWH' ? 'Where you charge' : 'Where you fill up'}
            >
              <Ladder
                color={colors.REFUELING}
                rows={bought.places.slice(0, 5).map((place) => ({
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

      <Entries rows={detail.rows} />
    </Stack>
  );
}

/* ——— Expenses and Services: one shape, two slices ——— */

const GROUP_COPY = {
  SERVICES: {
    glyph: '🧰',
    noun: 'visit',
    byVendor: 'Workshops',
    empty: 'No services in this period',
  },
  EXPENSES: { glyph: '🧾', noun: 'bill', byVendor: 'Paid to', empty: 'No bills in this period' },
} as const;

function GroupTab({ report, group }: { report: VehicleReport; group: 'SERVICES' | 'EXPENSES' }) {
  const colors = useChartColors();
  const { spend, distance } = report;
  const detail = useMemo(() => (spend ? groupDetail(spend, group) : undefined), [spend, group]);
  const copy = GROUP_COPY[group];
  const label = REPORT_GROUPS.find((entry) => entry.key === group)!.label;
  const unit = report.odometerUnit === 'MI' ? 'mi' : 'km';

  if (!spend || !detail) return <Loading />;
  if (detail.count === 0) return <Empty glyph={copy.glyph} text={copy.empty} />;
  const currency = spend.currency;

  return (
    <Stack>
      <Card>
        <ColumnChart
          label={label}
          trailing={<Tag>{plural(detail.count, copy.noun)}</Tag>}
          buckets={columns(
            detail.buckets.map((bucket) => ({
              key: bucket.key,
              values: { [group]: bucket.value },
            })),
          )}
          series={[{ key: group, label, color: colors[group] }]}
          format={(amount) => money(amount, currency)}
          formatAxis={(amount) => compactMoney(amount, currency)}
        />
      </Card>

      <Kpis
        items={[
          {
            label: `Per ${copy.noun}`,
            value: detail.averageMinor === null ? '—' : money(detail.averageMinor, currency),
          },
          { label: 'Per month', value: money(detail.perMonthMinor, currency) },
          { label: `Per ${unit}`, value: rate(detail.total, distance, currency) },
        ]}
      />

      <Card label="By kind">
        <RankBars
          rows={detail.byCategory.map((row) => ({
            key: row.key,
            label: humanise(row.key),
            count: row.count,
            value: row.amountMinor,
            display: money(row.amountMinor, currency),
            color: colors[group],
          }))}
        />
      </Card>

      {detail.byVendor.length > 0 ? (
        <Card label={copy.byVendor}>
          <RankBars
            rows={detail.byVendor.slice(0, 5).map((row) => ({
              key: row.key,
              label: row.key,
              count: row.count,
              value: row.amountMinor,
              display: money(row.amountMinor, currency),
              color: colors[group],
            }))}
          />
        </Card>
      ) : null}

      <Entries rows={detail.rows} />
    </Stack>
  );
}

/* ——— Income ——— */

function Income({ report }: { report: VehicleReport }) {
  const colors = useChartColors();
  const theme = useTheme();
  const { spend, distance, vehicleId, from } = report;
  const income = useQuery({
    ...incomeLedgerQuery(api, vehicleId, from),
    placeholderData: keepPreviousData,
  });
  const data = useMemo(
    () => (spend && income.data ? buildIncomeReport(income.data, spend) : undefined),
    [spend, income.data],
  );
  const unit = report.odometerUnit === 'MI' ? 'mi' : 'km';

  const wall = planWall(income.error);
  if (wall) return <Locked wall={wall} title="What it earns, against what it costs" />;
  if (!spend || !data) return <Loading />;
  if (data.count === 0) return <Empty glyph="💵" text="Nothing earned in this period" />;
  const currency = spend.currency;
  const ahead = data.net >= 0;

  return (
    <Stack>
      <Card>
        <ColumnChart
          mode="group"
          label="Earned"
          trailing={<Tag>{`${data.count} ${data.count === 1 ? 'entry' : 'entries'}`}</Tag>}
          buckets={columns(
            data.buckets.map((bucket) => ({
              key: bucket.key,
              values: { earned: bucket.earned, spent: bucket.spent },
            })),
          )}
          series={[
            { key: 'earned', label: 'Earned', color: colors.income },
            // Grey ink, not a spend group's hue: this is every group at once.
            { key: 'spent', label: 'Spent', color: colors.muted },
          ]}
          format={(amount) => money(amount, currency)}
          formatAxis={(amount) => compactMoney(amount, currency)}
        />
        <Excluded rows={data.excluded} />
      </Card>

      <Kpis
        items={[
          {
            label: 'Net',
            value: money(data.net, currency),
            tone: ahead ? theme.success : theme.destructive,
          },
          { label: `Per ${unit}`, value: rate(data.total, distance, currency) },
          {
            label: 'Margin',
            value: data.total > 0 ? `${Math.round((data.net / data.total) * 100)}` : '—',
            unit: data.total > 0 ? '%' : undefined,
          },
        ]}
      />

      <Card label="By kind">
        <RankBars
          rows={data.byCategory.map((row) => ({
            key: row.key,
            label: humanise(row.key),
            count: row.count,
            value: row.amountMinor,
            display: money(row.amountMinor, currency),
            color: colors.income,
          }))}
        />
      </Card>

      {data.byPayer.length > 0 ? (
        <Card label="By payer">
          <RankBars
            rows={data.byPayer.slice(0, 5).map((row) => ({
              key: row.key,
              label: row.key,
              count: row.count,
              value: row.amountMinor,
              display: money(row.amountMinor, currency),
              color: colors.income,
            }))}
          />
        </Card>
      ) : null}
    </Stack>
  );
}

/* ——— Routes ——— */

/** The end of today in UTC: stable all day, so it keys the report without a request per render. */
function endOfToday() {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59),
  ).toISOString();
}

function Routes({ report }: { report: VehicleReport }) {
  const colors = useChartColors();
  const theme = useTheme();
  const { vehicleId, from, vehicle } = report;
  const range = { from: from ?? '2000-01-01T00:00:00.000Z', to: endOfToday() };
  const mileage = useQuery({
    ...mileageReportQuery(api, vehicleId, range),
    placeholderData: keepPreviousData,
  });
  const routes = useMemo(
    () => (mileage.data ? buildRoutesReport(mileage.data.trips, { from }) : undefined),
    [mileage.data, from],
  );
  const [sharing, setSharing] = useState(false);
  const unit = report.odometerUnit;
  const km = (value: number) => formatDistance(Math.round(value), unit);
  const purposeColor = {
    BUSINESS: colors.trip,
    COMMUTE: colors.EXPENSES,
    PERSONAL: colors.neutral,
  };

  const wall = planWall(mileage.error);
  if (wall) return <Locked wall={wall} title="Every trip, by purpose" />;
  if (!routes || !mileage.data) return <Loading />;
  if (routes.trips === 0) return <Empty glyph="🛣️" text="No trips in this period" />;

  const share = async () => {
    setSharing(true);
    try {
      await shareMileageReport({ id: vehicleId, name: vehicle?.displayName ?? 'vehicle' }, range);
    } catch (error) {
      Alert.alert('Could not share the report', (error as Error).message);
    } finally {
      setSharing(false);
    }
  };
  const deductions = mileage.data.deductions;

  return (
    <Stack>
      <Card>
        <ColumnChart
          label="Logged"
          legend={false}
          trailing={
            <View style={styles.trail}>
              <Tag>{plural(routes.trips, 'trip')}</Tag>
              <PressableScale
                onPress={() => void share()}
                disabled={sharing}
                accessibilityRole="button"
                accessibilityLabel="Share the trips as CSV"
                hitSlop={8}
                scaleTo={0.88}
                style={[styles.round, { backgroundColor: theme.muted, opacity: sharing ? 0.5 : 1 }]}
              >
                <Ionicons name="share-outline" size={14} color={theme.foreground} />
              </PressableScale>
            </View>
          }
          buckets={columns(routes.buckets)}
          series={TRIP_PURPOSES.map((purpose) => ({
            key: purpose.key,
            label: purpose.label,
            color: purposeColor[purpose.key],
          }))}
          format={km}
        />
        <SplitBar
          parts={TRIP_PURPOSES.map((purpose) => ({
            key: purpose.key,
            label: purpose.label,
            value: routes.byPurpose[purpose.key].distance,
            display: km(routes.byPurpose[purpose.key].distance),
            color: purposeColor[purpose.key],
          }))}
        />
      </Card>

      <Kpis
        items={[
          {
            label: 'Average trip',
            value:
              routes.averageDistance === null
                ? '—'
                : Math.round(routes.averageDistance).toLocaleString(),
            unit: routes.averageDistance === null ? undefined : unit === 'MI' ? 'mi' : 'km',
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
                ? deductions.map((amount) => formatMoney(amount, true)).join(' + ')
                : '—',
          },
        ]}
      />

      <Card label="Longest trips">
        <RankBars
          rows={routes.longest.map((row) => ({
            key: row.eventId,
            label: row.title,
            value: row.trip.distance,
            display: km(row.trip.distance),
            color: purposeColor[row.trip.purpose],
          }))}
        />
      </Card>
    </Stack>
  );
}

/* ——— Overview's lifetime cards ——— */

function Value({
  summary,
  pending,
  trends,
  purchaseDate,
}: {
  summary: ValuationSummary | undefined;
  pending: boolean;
  trends: CostTrends | undefined;
  purchaseDate: string | null;
}) {
  const colors = useChartColors();
  if (pending) return <Loading />;

  const current = summary?.currentValue ?? null;
  const paid = summary?.purchasePrice ?? null;
  // Nothing to say without a price or a valuation; the card waits for one.
  if (!current && !paid) return null;
  const change = summary?.changePercent ?? null;
  const currency = current?.currency ?? paid?.currency ?? trends?.currency ?? null;
  const owned = purchaseDate ? ownedFor(purchaseDate) : null;
  const lost =
    current && paid && current.currency === paid.currency
      ? depreciationPerYear(paid.amountMinor, current.amountMinor, purchaseDate)
      : null;

  /*
   * What it has cost you against what it is worth, on one money axis. Both start from the price;
   * one climbs with every bill and the other falls with the market, and the gap between them is
   * what owning it has really cost. Ink for the cost; the worth takes the hue no spend group uses.
   */
  const series: Series[] = [];
  if (trends && trends.currency === currency) {
    const spent = trends.ownership.filter((row) => row.cumulativeMinor > 0);
    if (spent.length >= 2) {
      series.push({
        key: 'cost',
        label: 'Cost to own',
        color: colors.ink,
        points: spent.map((row) => {
          const [year, month] = row.month.split('-').map(Number) as [number, number];
          return { x: Date.UTC(year, month - 1, 15), y: row.cumulativeMinor };
        }),
      });
    }
  }
  const worth = [
    ...(paid && purchaseDate && paid.currency === currency
      ? [{ x: Date.parse(`${purchaseDate}T00:00:00`), y: paid.amountMinor }]
      : []),
    ...[...(summary?.history ?? [])]
      .filter((row) => row.estimatedValue.currency === currency)
      .sort((a, b) => a.valuationDate.localeCompare(b.valuationDate))
      .map((row) => ({
        x: Date.parse(`${row.valuationDate}T00:00:00`),
        y: row.estimatedValue.amountMinor,
      })),
  ];
  if (worth.length >= 2) {
    series.push({ key: 'worth', label: 'Worth', color: colors.trip, points: worth });
  }

  return (
    <Card label="Worth" trailing={change !== null ? <Delta change={change} good="up" /> : null}>
      <Figure value={current ? formatMoney(current, true) : '—'} large />
      {series.length > 0 && currency ? (
        <LineChart
          series={series}
          formatY={(amount) => compactMoney(amount, currency)}
          formatX={(x) => MONTH_YEAR.format(new Date(x))}
          area={series.length === 1}
        />
      ) : null}
      <Facts
        items={[
          paid && { label: 'Paid', value: formatMoney(paid, true) },
          lost !== null &&
            lost > 0 &&
            currency && { label: 'Lost / yr', value: money(lost, currency) },
          owned ? { label: 'Owned', value: owned } : null,
        ]}
      />
    </Card>
  );
}

function Health({ health, pending }: { health: VehicleHealth | undefined; pending: boolean }) {
  const theme = useTheme();
  const score = health?.overall ?? null;
  const progress = useIgnition(score === null ? 0 : score / 100);
  if (pending) return <Loading />;
  // Unscored, it has nothing to draw: schedules, documents and a check give it something.
  if (!health || score === null) return null;

  const band = healthBand(score) ?? 'success';
  const scored = health.categories.filter((category) => category.score !== null);
  const factors = [...health.factors].sort((a, b) => b.penalty - a.penalty).slice(0, 4);

  return (
    <Card
      label="Health"
      trailing={
        <Word color={theme[band]}>
          {band === 'success' ? 'Good' : band === 'warning' ? 'Fair' : 'Poor'}
        </Word>
      }
    >
      <View style={styles.healthRow}>
        <Gauge
          progress={progress}
          size={108}
          color={theme[band]}
          label={`Health ${score} out of 100`}
        >
          <Text style={[figure, styles.gaugeFigure, { color: theme.foreground }]}>{score}</Text>
        </Gauge>
        {scored.length > 0 ? (
          <View style={{ flex: 1, minWidth: 0 }}>
            <RankBars
              max={100}
              rows={scored.map((category) => ({
                key: category.category,
                label: humanise(category.category),
                value: category.score ?? 0,
                display: String(category.score),
                color: theme[healthBand(category.score) ?? 'success'],
              }))}
            />
          </View>
        ) : null}
      </View>
      {factors.length > 0 ? (
        // What cost it points, worst first: the working behind the score, as a row of chips.
        <View style={styles.chips}>
          {factors.map((factor) => (
            <View
              key={`${factor.category}-${factor.label}`}
              accessible
              accessibilityLabel={`${factor.label}: ${factor.detail} Minus ${factor.penalty}`}
              style={[styles.penalty, { backgroundColor: theme.muted }]}
            >
              <Text style={[figure, styles.penaltyFigure, { color: theme.destructive }]}>
                −{factor.penalty}
              </Text>
              <Text numberOfLines={1} style={[typeScale.caption, { color: theme.foreground }]}>
                {factor.label}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </Card>
  );
}

/** The latest judgement of each part, as bars in its band's colour. */
function Condition({ vehicleId }: { vehicleId: string }) {
  const theme = useTheme();
  const condition = useQuery(conditionSummaryQuery(api, vehicleId));
  const parts = condition.data?.categories.filter((part) => part.score !== null) ?? [];
  const overall = condition.data?.overallScore ?? null;
  if (parts.length === 0) return null;
  return (
    <Card label="Condition" trailing={overall === null ? null : <Tag>{`${overall} / 100`}</Tag>}>
      <RankBars
        max={100}
        columns={2}
        rows={parts.map((part) => ({
          key: part.category,
          label: humanise(part.category),
          value: part.score ?? 0,
          display: String(part.score),
          color: theme[healthBand(part.score) ?? 'success'],
        }))}
      />
    </Card>
  );
}

function Distance({
  odometer,
  unit,
  engineHours,
  years,
  onLog,
}: {
  odometer: number | null;
  unit: 'KM' | 'MI';
  engineHours: number | null;
  years: CostTrends['distancePerYear'];
  onLog?: () => void;
}) {
  const theme = useTheme();
  const colors = useChartColors();
  const recent = years.slice(-6);
  const yearly = distancePerYear(years);

  return (
    <Card
      label="Odometer"
      trailing={engineHours !== null ? <Tag>{`${engineHours.toLocaleString()} h`}</Tag> : null}
    >
      <PressableScale
        onPress={
          onLog
            ? () => {
                haptic.selection();
                onLog();
              }
            : undefined
        }
        disabled={!onLog}
        accessibilityRole="button"
        accessibilityLabel={`Odometer: ${formatDistance(odometer, unit)}`}
        accessibilityHint="Record a new reading"
        scaleTo={0.97}
        style={styles.odometer}
      >
        <Odometer value={odometer} size={20} />
        <Text style={[figure, styles.odometerUnit, { color: theme.mutedForeground }]}>{unit}</Text>
        {onLog ? (
          <View style={[styles.round, { marginLeft: 'auto', backgroundColor: theme.muted }]}>
            <Ionicons name="add" size={16} color={theme.foreground} />
          </View>
        ) : null}
      </PressableScale>
      {recent.length >= 2 ? (
        <ColumnChart
          large={false}
          label="Per year"
          total={yearly ?? undefined}
          height={64}
          buckets={recent.map((row) => ({
            key: String(row.year),
            label: `’${String(row.year).slice(2)}`,
            long: String(row.year),
            values: { distance: row.distance },
          }))}
          series={[{ key: 'distance', label: 'Driven', color: colors.muted }]}
          format={(value) => formatDistance(value, recent[0]!.distanceUnit)}
          formatAxis={compact}
        />
      ) : null}
    </Card>
  );
}

/* ——— Pieces ——— */

/**
 * The report's parts as tabs, not chips: words on a rule, the chosen one in ink with a copper bar
 * under it that glides to the next — navigation, so it should not look like the Logs' filters.
 * Scrolls sideways when the parts outrun the screen, keeping the chosen one in view.
 */
function ReportTabs({ value, onChange }: { value: ReportTab; onChange: (tab: ReportTab) => void }) {
  const theme = useTheme();
  const reduce = useReduceMotion();
  const scroller = useRef<ScrollView>(null);
  const placed = useRef(false);
  const [frames, setFrames] = useState<Partial<Record<ReportTab, { x: number; width: number }>>>(
    {},
  );
  const [left] = useState(() => new Animated.Value(0));
  const [width] = useState(() => new Animated.Value(0));
  const frame = frames[value];

  useEffect(() => {
    if (!frame) return;
    if (reduce || !placed.current) {
      placed.current = true;
      left.setValue(frame.x);
      width.setValue(frame.width);
      return;
    }
    // Width is a layout prop, so the bar rides the JS driver; one bar, a few frames.
    const glide = (to: Animated.Value, toValue: number) =>
      Animated.spring(to, { toValue, useNativeDriver: false, ...spring.glide });
    const animation = Animated.parallel([glide(left, frame.x), glide(width, frame.width)]);
    animation.start();
    scroller.current?.scrollTo({ x: Math.max(0, frame.x - spacing.xxl), animated: true });
    return () => animation.stop();
  }, [frame, reduce, left, width]);

  return (
    <View style={[styles.tabs, { borderBottomColor: theme.border }]}>
      <ScrollView
        ref={scroller}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.tabsRow}
        accessibilityRole="tablist"
      >
        {REPORT_TABS.map((item) => {
          const selected = item.value === value;
          return (
            <PressableScale
              key={item.value}
              onLayout={(event) => {
                const { x, width: span } = event.nativeEvent.layout;
                setFrames((known) => ({ ...known, [item.value]: { x, width: span } }));
              }}
              onPress={() => {
                if (selected) return;
                haptic.selection();
                onChange(item.value);
              }}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              accessibilityLabel={item.label}
              hitSlop={{ top: 6, bottom: 6 }}
              scaleTo={0.96}
              style={styles.tab}
            >
              <Text
                style={[
                  styles.tabLabel,
                  { color: selected ? theme.foreground : theme.mutedForeground },
                ]}
              >
                {item.label}
              </Text>
            </PressableScale>
          );
        })}
        {frame ? (
          <Animated.View
            pointerEvents="none"
            style={[styles.tabBar, { backgroundColor: theme.primary, left, width }]}
          />
        ) : null}
      </ScrollView>
    </View>
  );
}

/** A part's cards, rising into place in turn. */
function Stack({ children }: { children: ReactNode }) {
  return (
    <View style={{ gap: spacing.md }}>
      {Children.toArray(children).map((child, index) => (
        <Rise key={index} index={index}>
          {child}
        </Rise>
      ))}
    </View>
  );
}

function Card({
  label,
  trailing,
  children,
  style,
}: {
  label?: string;
  trailing?: ReactNode;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: theme.card }, style]}>
      {label ? (
        <View style={styles.cardHead}>
          <Eyebrow style={{ flex: 1 }}>{label}</Eyebrow>
          {trailing}
        </View>
      ) : null}
      {children}
    </View>
  );
}

interface Kpi {
  label: string;
  value: string;
  unit?: string;
  tone?: string;
}

/**
 * The figures under a chart, as one strip of cells with hairlines between them — three across,
 * four as two by two. Only those the record supports: a cell of dashes is noise.
 */
function Kpis({ items }: { items: (Kpi | null | false | undefined | '')[] }) {
  const theme = useTheme();
  const shown = items.filter((item): item is Kpi => Boolean(item));
  if (shown.length === 0) return null;
  const basis =
    shown.length === 4 || shown.length === 2 ? '49%' : shown.length === 1 ? '100%' : '32%';
  return (
    <View style={[styles.kpis, { backgroundColor: theme.border }]}>
      {shown.map((item) => (
        <View
          key={item.label}
          accessible
          accessibilityLabel={`${item.label}: ${item.value}${item.unit ? ` ${item.unit}` : ''}`}
          style={[styles.kpi, { flexBasis: basis, backgroundColor: theme.card }]}
        >
          <Eyebrow style={styles.kpiLabel}>{item.label}</Eyebrow>
          <View style={styles.kpiLine}>
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.7}
              style={[figure, styles.kpiValue, { color: item.tone ?? theme.foreground }]}
            >
              {item.value}
            </Text>
            {item.unit ? (
              <Text
                numberOfLines={1}
                style={[figure, styles.kpiUnit, { color: theme.mutedForeground }]}
              >
                {item.unit}
              </Text>
            ) : null}
          </View>
        </View>
      ))}
    </View>
  );
}

/** A card's own figure, large in mono, its unit small beside it. */
function Figure({ value, unit, large = false }: { value: string; unit?: string; large?: boolean }) {
  const theme = useTheme();
  return (
    <View style={styles.figureLine}>
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.6}
        style={[figure, large ? styles.figureLarge : styles.figure, { color: theme.foreground }]}
      >
        {value}
      </Text>
      {unit ? (
        <Text style={[figure, styles.kpiUnit, { color: theme.mutedForeground }]}>{unit}</Text>
      ) : null}
    </View>
  );
}

/** Small figures at a card's foot, side by side: label over value. */
function Facts({
  items,
}: {
  items: (false | null | undefined | '' | { label: string; value: string })[];
}) {
  const theme = useTheme();
  const shown = items.filter((item): item is { label: string; value: string } => Boolean(item));
  if (shown.length === 0) return null;
  return (
    <View style={[styles.facts, { borderTopColor: theme.border }]}>
      {shown.map((item) => (
        <View
          key={item.label}
          accessible
          accessibilityLabel={`${item.label}: ${item.value}`}
          style={{ flex: 1, gap: 2 }}
        >
          <Eyebrow style={styles.kpiLabel}>{item.label}</Eyebrow>
          <Text numberOfLines={1} style={[figure, styles.factValue, { color: theme.foreground }]}>
            {item.value}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** A change, as an arrow and a percentage in good-news or worth-a-look colours. */
function Delta({ change, good }: { change: number; good: 'up' | 'down' }) {
  const theme = useTheme();
  const up = change > 0;
  const fine = change === 0 || up === (good === 'up');
  return (
    <View style={[styles.tag, { backgroundColor: fine ? theme.successSoft : theme.warningSoft }]}>
      <Text style={[figure, styles.tagText, { color: fine ? theme.success : theme.warning }]}>
        {up ? '▲' : change < 0 ? '▼' : '='} {Math.abs(change)}%
      </Text>
    </View>
  );
}

function Tag({ children }: { children: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.tag, { backgroundColor: theme.muted }]}>
      <Text style={[figure, styles.tagText, { color: theme.mutedForeground }]}>{children}</Text>
    </View>
  );
}

/** A status word with its dot, so no state is told by colour alone. */
function Word({ color, children }: { color: string; children: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.tag, { backgroundColor: theme.muted }]}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={[styles.tagText, { fontWeight: '700', color: theme.foreground }]}>
        {children}
      </Text>
    </View>
  );
}

function Swatch({ color, label }: { color: string; label: string }) {
  const theme = useTheme();
  return (
    <View style={styles.swatchItem}>
      <View style={[styles.dot, { borderRadius: 2.5, backgroundColor: color }]} />
      <Text numberOfLines={1} style={[styles.swatchText, { color: theme.mutedForeground }]}>
        {label}
      </Text>
    </View>
  );
}

/**
 * A part's entries, folded away: the figures above are the point, and the record itself is the
 * Logs tab's. Opened, the newest first, read-only.
 */
function Entries({ rows }: { rows: readonly LedgerRow[] }) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  if (rows.length === 0) return null;
  return (
    <Card>
      <PressableScale
        onPress={() => {
          haptic.selection();
          setOpen((shown) => !shown);
        }}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`Entries, ${rows.length}`}
        scaleTo={0.98}
        style={styles.cardHead}
      >
        <Eyebrow style={{ flex: 1 }}>Entries</Eyebrow>
        <Tag>{pad(rows.length)}</Tag>
        <Ionicons
          name={open ? 'chevron-up' : 'chevron-down'}
          size={14}
          color={theme.mutedForeground}
        />
      </PressableScale>
      {open
        ? rows.map((row) => (
            <View
              key={row.id}
              accessible
              accessibilityLabel={`${row.description}, ${DAY_MONTH.format(new Date(row.occurredAt))}, ${formatMoney(row.amount)}`}
              style={styles.entry}
            >
              <Text style={[figure, styles.entryDate, { color: theme.mutedForeground }]}>
                {DAY_MONTH.format(new Date(row.occurredAt)).toUpperCase()}
              </Text>
              <Text
                numberOfLines={1}
                style={[typeScale.caption, styles.entryTitle, { color: theme.foreground }]}
              >
                {row.vendor ?? row.description}
              </Text>
              <Text style={[figure, styles.entryAmount, { color: theme.foreground }]}>
                {formatMoney(row.amount)}
              </Text>
            </View>
          ))
        : null}
    </Card>
  );
}

/** A plan's wall, in the part it guards: what it would show, and the one way to get it. */
function Locked({ wall, title }: { wall: PlanWall; title: string }) {
  const theme = useTheme();
  return (
    <Card>
      <View style={styles.lockRow}>
        <View style={[styles.lockTile, { backgroundColor: theme.primarySoft }]}>
          <Ionicons name="lock-closed" size={16} color={theme.primary} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Eyebrow>
            {wall.requiredPlan ? `${PLAN_NAMES[wall.requiredPlan]} plan` : 'Paid plan'}
          </Eyebrow>
          <Text style={[typeScale.headline, { color: theme.foreground }]}>{title}</Text>
        </View>
      </View>
      <Button label="See plans" variant="primary" size="sm" onPress={() => showUpgrade(wall)} />
    </Card>
  );
}

/** Nothing in this period: the part's glyph and a few words, not a paragraph. */
function Empty({ glyph, text }: { glyph: string; text: string }) {
  const theme = useTheme();
  return (
    <Card>
      <View style={styles.lockRow}>
        <View style={[styles.lockTile, { backgroundColor: theme.muted }]}>
          <Glyph size={16}>{glyph}</Glyph>
        </View>
        <Text style={[typeScale.label, { flex: 1, color: theme.mutedForeground }]}>{text}</Text>
      </View>
    </Card>
  );
}

/** What the totals left out, named rather than converted at a guess. */
function Excluded({ rows }: { rows: readonly { currency: string; amountMinor: number }[] }) {
  const theme = useTheme();
  if (rows.length === 0) return null;
  return (
    <Text style={[typeScale.caption, { color: theme.mutedForeground }]}>
      +{' '}
      {rows
        .map((row) => formatMoney({ amountMinor: row.amountMinor, currency: row.currency }, true))
        .join(' + ')}{' '}
      not counted
    </Text>
  );
}

function Loading() {
  return (
    <Card>
      <Skeleton width={90} height={11} />
      <Skeleton width={150} height={30} />
      <Skeleton width="100%" height={112} radius={radius.md} />
    </Card>
  );
}

const styles = StyleSheet.create({
  // Edge to edge under the bar, a hairline rule the chosen tab's bar sits on.
  tabs: { marginHorizontal: -spacing.lg, borderBottomWidth: StyleSheet.hairlineWidth },
  tabsRow: { gap: spacing.xl, paddingHorizontal: spacing.lg },
  tab: { paddingTop: 4, paddingBottom: 11 },
  tabLabel: { fontSize: 14.5, lineHeight: 19, fontWeight: '600', letterSpacing: -0.1 },
  tabBar: { position: 'absolute', bottom: 0, height: 2.5, borderRadius: 2 },
  card: { borderRadius: radius.xxl, padding: spacing.lg, gap: spacing.md },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 22 },
  pair: { flexDirection: 'row', gap: spacing.md },
  half: { flex: 1, minWidth: 0 },
  trail: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  round: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  kpis: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: StyleSheet.hairlineWidth * 2,
    borderRadius: radius.xxl,
    overflow: 'hidden',
  },
  kpi: { flexGrow: 1, minWidth: 0, gap: 4, paddingHorizontal: 14, paddingVertical: 12 },
  kpiLabel: { fontSize: 10, lineHeight: 13 },
  kpiLine: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  kpiValue: { flexShrink: 1, fontSize: 18, lineHeight: 23, fontWeight: '700', letterSpacing: -0.5 },
  kpiUnit: { fontSize: 11, fontWeight: '600' },
  figureLine: { flexDirection: 'row', alignItems: 'baseline', gap: 5 },
  figure: { flexShrink: 1, fontSize: 22, lineHeight: 27, fontWeight: '700', letterSpacing: -0.7 },
  figureLarge: {
    flexShrink: 1,
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '700',
    letterSpacing: -1,
  },
  facts: {
    flexDirection: 'row',
    gap: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth * 2,
    paddingTop: spacing.md,
  },
  factValue: { fontSize: 14, lineHeight: 18, fontWeight: '700' },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  tagText: { fontSize: 11, lineHeight: 14, fontWeight: '600' },
  dot: { width: 7, height: 7, borderRadius: 999 },
  split: { flexDirection: 'row', gap: 2, height: 8 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 10, rowGap: 2 },
  swatchItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  swatchText: { fontSize: 11, lineHeight: 14, fontWeight: '500' },
  healthRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  gaugeFigure: { fontSize: 22, lineHeight: 26, fontWeight: '700', letterSpacing: -0.6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  penalty: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: '100%',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  penaltyFigure: { fontSize: 11, lineHeight: 14, fontWeight: '700' },
  odometer: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  odometerUnit: { fontSize: 10, fontWeight: '600', letterSpacing: 1.2 },
  entry: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 28 },
  entryDate: { width: 48, fontSize: 10, fontWeight: '600', letterSpacing: 0.4 },
  entryTitle: { flex: 1, fontWeight: '500' },
  entryAmount: { fontSize: 12, fontWeight: '700' },
  lockRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  lockTile: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
