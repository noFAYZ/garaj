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
  monthlyPace,
  monthsSince,
  ownedFor,
  trueCostPerDistance,
  type LedgerRow,
  type ReportGroup,
  type ReportPeriod,
} from '@vehicle-os/ui';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useMemo, useState, type ReactNode } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { CostTrends, ValuationSummary, VehicleHealth } from '@vehicle-os/contracts';
import {
  costTrendsQuery,
  healthQuery,
  incomeLedgerQuery,
  mileageReportQuery,
  monthlySpendQuery,
  valuationsQuery,
} from '@vehicle-os/api-client/react';
import {
  ColumnChart,
  Donut,
  LineChart,
  RankBars,
  SplitBar,
  type Series,
} from '@/components/charts';
import { STATUS, healthStatus, useChartColors, type StatusKey } from '@/lib/chart-colors';
import { REPORT_TABS, useVehicleReport, type ReportTab, type VehicleReport } from '@/lib/report';
import { shareMileageReport } from '@/lib/share-export';
import { Button, Skeleton } from '@/lib/ui';
import { showUpgrade } from '@/lib/upgrade';
import { api } from '@/lib/api';
import { Eyebrow, Glyph, Segmented } from '@/lib/instrument';
import { haptic, PressableScale, Rise } from '@/lib/motion';
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

/** "today", "12 days ago", "3 months ago" — without `Intl.RelativeTimeFormat`, which Hermes lacks. */
function ago(iso: string): string {
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 60) return `${days} days ago`;
  const months = Math.round(days / 30.4);
  return months < 24 ? `${months} months ago` : `${Math.round(days / 365)} years ago`;
}

const columns = (buckets: readonly { key: string; values: Record<string, number> }[]) =>
  buckets.map((bucket) => ({
    key: bucket.key,
    label: bucketLabel(bucket.key, 'short').toUpperCase(),
    long: bucketLabel(bucket.key, 'long'),
    values: bucket.values,
  }));

/**
 * The vehicle's report — the web's six tabs over one period, on a phone.
 *
 * Overview says what it all adds up to; Refueling, Expenses and Services are slices of the same
 * ledger, so they always add up to it; Income nets what it earns against that spend; Routes
 * splits the driving by purpose. The period applies to every tab at once, so switching compares
 * like with like. Each section leads with its number, then its shape.
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
    // A new tab starts at its head, not wherever the last one was scrolled to.
    onJump?.(0);
  };

  return (
    <View style={{ gap: spacing.md }}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ marginHorizontal: -spacing.md }}
        contentContainerStyle={{ gap: 6, paddingHorizontal: spacing.md }}
        accessibilityRole="tablist"
      >
        {REPORT_TABS.map((item) => {
          const selected = item.value === tab;
          return (
            <PressableScale
              key={item.value}
              onPress={() => {
                if (!selected) haptic.selection();
                open(item.value);
              }}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              accessibilityLabel={item.label}
              scaleTo={0.94}
              style={[styles.tabChip, { backgroundColor: selected ? theme.primary : theme.card }]}
            >
              <Glyph size={13}>{item.glyph}</Glyph>
              <Text
                style={[
                  typeScale.label,
                  { color: selected ? theme.primaryForeground : theme.foreground },
                ]}
              >
                {item.label}
              </Text>
            </PressableScale>
          );
        })}
      </ScrollView>

      <View style={styles.between}>
        <View style={{ flex: 1 }}>
          <Segmented
            value={period}
            options={REPORT_PERIODS.map((option) => ({ value: option.value, label: option.label }))}
            onChange={setPeriod}
          />
        </View>
        {report.refreshing ? (
          <Text style={[typeScale.caption, { color: theme.mutedForeground }]}>Updating…</Text>
        ) : null}
      </View>

      {report.error ? (
        <Card>
          <View style={{ gap: spacing.sm }}>
            <Eyebrow>Could not load the report</Eyebrow>
            <Body>{report.error.message}</Body>
            <Button label="Try again" onPress={report.refetch} />
          </View>
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
  const { spend, distance, period, vehicleId, vehicle } = report;
  const health = useQuery(healthQuery(api, vehicleId));
  const value = useQuery(valuationsQuery(api, vehicleId));
  const trends = useQuery(costTrendsQuery(api, vehicleId));
  const unit = report.odometerUnit === 'MI' ? 'mi' : 'km';

  return (
    <Sections
      sections={[
        {
          key: 'summary',
          title: period.long,
          glyph: '📊',
          body: !spend ? (
            <HeroSkeleton />
          ) : (
            <View style={{ gap: spacing.md }}>
              <Hero
                label="Running cost"
                value={money(spend.total, spend.currency)}
                caption={`${pad(spend.count)} entries · the purchase left out`}
              />
              <View style={styles.grid}>
                <Tile
                  label="Per day"
                  value={cents(spend.total / spend.days, spend.currency)}
                  note={`over ${spend.days.toLocaleString()} days`}
                />
                <Tile
                  label={`Per ${unit}`}
                  value={rate(spend.total, distance, spend.currency)}
                  note={
                    distance
                      ? `over ${formatDistance(distance, report.odometerUnit)}`
                      : 'needs two readings'
                  }
                />
                <Tile
                  label="Driven"
                  value={formatDistance(distance, report.odometerUnit)}
                  note={
                    distance
                      ? `${Math.round(distance / spend.days)} ${unit} a day`
                      : 'in this period'
                  }
                />
                <Tile
                  label="Per month"
                  value={money((spend.total / spend.days) * 30.4375, spend.currency)}
                  note="at this period’s pace"
                />
              </View>
              <Excluded rows={spend.excluded} />
            </View>
          ),
        },
        {
          key: 'split',
          title: 'Where the money went',
          glyph: '💳',
          body: !spend ? (
            <HeroSkeleton />
          ) : spend.total === 0 ? (
            <Body>
              Nothing spent in this period. Fuel, services and bills appear here as you log them.
            </Body>
          ) : (
            <View style={{ gap: spacing.xl }}>
              <ColumnChart
                buckets={columns(spend.buckets)}
                series={REPORT_GROUPS.map((group) => ({
                  key: group.key,
                  label: group.label,
                  color: colors[group.key],
                }))}
                format={(amount) => money(amount, spend.currency)}
                formatAxis={(amount) => compactMoney(amount, spend.currency)}
                caption={`${period.long} · running costs`}
              />
              <Donut
                centre="Running"
                total={money(spend.total, spend.currency)}
                onOpen={(key) => onOpen(TAB_OF_GROUP[key as ReportGroup])}
                slices={REPORT_GROUPS.filter((group) => spend.groups[group.key].total > 0).map(
                  (group) => ({
                    key: group.key,
                    label: group.label,
                    value: spend.groups[group.key].total,
                    display: money(spend.groups[group.key].total, spend.currency),
                    color: colors[group.key],
                  }),
                )}
              />
            </View>
          ),
        },
        {
          key: 'insights',
          title: 'Insights',
          glyph: '💡',
          body: <Insights report={report} value={value.data} trends={trends.data} />,
        },
        {
          key: 'value',
          title: 'Value',
          glyph: '🏷️',
          body: (
            <Value
              summary={value.data}
              pending={value.isPending}
              trends={trends.data}
              purchaseDate={vehicle?.purchaseDate ?? null}
            />
          ),
        },
        {
          key: 'distance',
          title: 'Distance',
          glyph: '🛣️',
          body: (
            <Distance
              odometer={vehicle?.currentOdometer ?? null}
              unit={report.odometerUnit}
              engineHours={vehicle?.currentEngineHours ?? null}
              pending={!vehicle}
              years={trends.data?.distancePerYear ?? []}
              onLog={onLogOdometer}
            />
          ),
        },
        {
          key: 'health',
          title: 'Health',
          glyph: '🩺',
          body: <Health health={health.data} pending={health.isPending} />,
        },
      ]}
    />
  );
}

/**
 * The figures a logbook cannot give, worked out from all of it: each a tile with what it is of.
 * Only the ones the record supports are drawn — a tile of dashes is noise.
 */
function Insights({
  report,
  value,
  trends,
}: {
  report: VehicleReport;
  value: ValuationSummary | undefined;
  trends: CostTrends | undefined;
}) {
  const { cost, spend, vehicle, vehicleId, period } = report;
  // Two years, once: the pace compares its two halves.
  const monthly = useQuery(monthlySpendQuery(api, vehicleId, 24));
  if (!cost || !spend) return <HeroSkeleton />;

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
  const pace =
    monthly.data && monthly.data.currency === currency
      ? monthlyPace(monthly.data.points, purchaseDate ? monthsSince(purchaseDate) : null)
      : null;
  const lost = depreciationPerYear(paid, worth, purchaseDate);
  const yearly = distancePerYear(trends?.distancePerYear ?? []);
  const busiest = spend.buckets.reduce<(typeof spend.buckets)[number] | null>(
    (best, bucket) => (bucket.total > (best?.total ?? 0) ? bucket : best),
    null,
  );

  const tiles: (TileProps & { key: string })[] = [];
  if (trueCost) {
    tiles.push({
      key: 'true',
      label: 'True cost',
      value: cents(trueCost.perDistanceMinor, currency),
      unit: `/${unit}`,
      note: trueCost.includesDepreciation ? 'running + value lost' : 'running costs only',
    });
  }
  if (cost.costPerDistance) {
    tiles.push({
      key: 'running',
      label: 'Running',
      value: formatMoney(cost.costPerDistance),
      unit: `/${unit}`,
      note: 'fuel, service and fees',
    });
  }
  if (pace && pace.averageMinor > 0) {
    tiles.push({
      key: 'pace',
      label: 'Per month',
      value: money(pace.averageMinor, currency),
      note: 'last 12 months',
      status:
        pace.changePercent !== null
          ? {
              // Spending more is the thing to notice; less is the good news.
              key: pace.changePercent > 0 ? 'serious' : 'good',
              text: `${pace.changePercent > 0 ? '▲' : '▼'} ${Math.abs(pace.changePercent)}% vs year before`,
            }
          : undefined,
    });
    tiles.push({
      key: 'ahead',
      label: 'Next 12 months',
      value: money(pace.averageMinor * 12, currency),
      note: 'at this year’s pace',
    });
  }
  if (lost !== null && lost > 0) {
    tiles.push({
      key: 'lost',
      label: 'Value lost',
      value: money(lost, currency),
      unit: '/yr',
      note: 'since bought',
    });
  }
  if (yearly !== null) {
    tiles.push({
      key: 'yearly',
      label: 'Driven',
      value: yearly.toLocaleString(),
      unit: `${unit}/yr`,
      note: 'a whole year, on average',
    });
  }
  if (busiest && spend.buckets.length > 1) {
    tiles.push({
      key: 'busiest',
      label: spend.unit === 'month' ? 'Dearest month' : 'Dearest year',
      value: money(busiest.total, spend.currency),
      note: `${bucketLabel(busiest.key, 'long')} · ${period.label}`,
    });
  }
  if (spend.total > 0) {
    tiles.push({
      key: 'energy',
      label: 'Energy share',
      value: `${Math.round((spend.groups.REFUELING.total / spend.total) * 100)}%`,
      note: 'of running costs on fuel',
    });
  }

  if (tiles.length === 0) {
    return (
      <Body>A purchase price, a couple of odometer readings and some spending fill this in.</Body>
    );
  }
  return (
    <View style={styles.grid}>
      {tiles.map(({ key, ...tile }) => (
        <Tile key={key} {...tile} />
      ))}
    </View>
  );
}

/* ——— Refueling ——— */

function Refueling({ report }: { report: VehicleReport }) {
  const colors = useChartColors();
  const { spend, distance, vehicleId, period } = report;
  const trends = useQuery(costTrendsQuery(api, vehicleId));
  const fuel = useMemo(() => (spend ? buildRefuelReport(spend) : undefined), [spend]);
  const detail = useMemo(() => (spend ? groupDetail(spend, 'REFUELING') : undefined), [spend]);
  const perHundred = report.odometerUnit !== 'MI';
  const unit = report.odometerUnit === 'MI' ? 'mi' : 'km';

  if (!spend || !fuel || !detail)
    return (
      <Card>
        <HeroSkeleton />
      </Card>
    );
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

  if (fuel.fills === 0) {
    return (
      <Card>
        <Eyebrow>No fill-ups in this period</Eyebrow>
        <Body>
          Record a fill with how much went in and the odometer, and this fills with consumption,
          prices and the cheapest places to fill up.
        </Body>
      </Card>
    );
  }

  return (
    <Sections
      sections={[
        {
          key: 'summary',
          title: 'Refueling',
          glyph: '⛽',
          body: (
            <View style={{ gap: spacing.md }}>
              <Hero
                label="Fuel spend"
                value={money(detail.total, currency)}
                caption={`${pad(fuel.fills)} fills · ${period.long.toLowerCase()}`}
              />
              <View style={styles.grid}>
                <Tile
                  label="Consumption"
                  value={leading ? leading.average.toFixed(1) : '—'}
                  unit={leading ? rateUnit(leading.unit) : undefined}
                  note={leading ? `best ${leading.best.toFixed(1)}` : 'needs two full tanks'}
                />
                <Tile
                  label={`Per ${primary ? UNIT_LABEL[primary.unit] : 'unit'}`}
                  value={
                    primary?.pricePerUnitMinor ? perUnit(primary.pricePerUnitMinor, currency) : '—'
                  }
                  unit={currency}
                  note="weighted by what went in"
                />
                <Tile
                  label={`Fuel per ${unit}`}
                  value={rate(detail.total, distance, currency)}
                  note={
                    spend.total > 0
                      ? `${Math.round((detail.total / spend.total) * 100)}% of running`
                      : undefined
                  }
                />
                <Tile
                  label="Last fill"
                  value={fuel.latest ? ago(fuel.latest.occurredAt) : '—'}
                  note={fuel.latest?.vendor ?? undefined}
                />
              </View>
            </View>
          ),
        },
        ...units.map((fuelUnit) => {
          const use = efficiency.find((entry) => entry.unit === fuelUnit);
          const bought = fuel.units.find((entry) => entry.unit === fuelUnit);
          const label = UNIT_LABEL[fuelUnit] ?? fuelUnit;
          return {
            key: `unit-${fuelUnit}`,
            title:
              fuelUnit === 'KWH'
                ? 'Charging'
                : units.length > 1
                  ? `Fuel · ${label}`
                  : 'Consumption and price',
            glyph: fuelUnit === 'KWH' ? '🔌' : '📈',
            body: (
              <View style={{ gap: spacing.xl }}>
                {use && use.points.length >= 2 ? (
                  <View style={{ gap: spacing.sm }}>
                    <Eyebrow>{`Consumption · ${rateUnit(fuelUnit)}`}</Eyebrow>
                    <LineChart
                      series={[
                        {
                          key: 'rate',
                          label: 'Per fill',
                          color: colors.REFUELING,
                          points: use.points.slice(-16),
                        },
                      ]}
                      reference={{ value: use.average, label: `average ${use.average.toFixed(1)}` }}
                      formatY={(value) => value.toFixed(1)}
                      formatX={(x) => DAY_MONTH.format(new Date(x))}
                      height={120}
                    />
                  </View>
                ) : null}
                {bought && bought.prices.length >= 2 && bought.pricePerUnitMinor ? (
                  <View style={{ gap: spacing.sm }}>
                    <Eyebrow>{`Price per ${label} · ${currency}`}</Eyebrow>
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
                      reference={{ value: bought.pricePerUnitMinor, label: 'average' }}
                      formatY={(value) => perUnit(value, currency)}
                      formatX={(x) => DAY_MONTH.format(new Date(x))}
                      height={120}
                    />
                  </View>
                ) : null}
                {bought && bought.places.length > 0 ? (
                  <View style={{ gap: spacing.sm }}>
                    <Eyebrow>
                      {fuelUnit === 'KWH' ? 'Where you charge' : 'Where you fill up'}
                    </Eyebrow>
                    {bought.places.slice(0, 5).map((place, index) => (
                      <Row
                        key={place.vendor}
                        title={place.vendor}
                        meta={`${pad(place.fills)} ${place.fills === 1 ? 'fill' : 'fills'}`}
                        trailing={`${perUnit(place.perUnitMinor, currency)} ${currency}`}
                        status={index === 0 && bought.places.length > 1 ? 'good' : undefined}
                      />
                    ))}
                  </View>
                ) : null}
              </View>
            ),
          };
        }),
        {
          key: 'monthly',
          title: 'Fuel spend',
          glyph: '💳',
          body: (
            <ColumnChart
              buckets={columns(
                detail.buckets.map((bucket) => ({
                  key: bucket.key,
                  values: { REFUELING: bucket.value },
                })),
              )}
              series={[{ key: 'REFUELING', label: 'Refueling', color: colors.REFUELING }]}
              format={(amount) => money(amount, currency)}
              formatAxis={(amount) => compactMoney(amount, currency)}
              caption={`${period.long} · fuel and charging`}
            />
          ),
        },
        {
          key: 'habits',
          title: 'Habits',
          glyph: '⏱️',
          body: (
            <View style={styles.grid}>
              {fuel.averageFillMinor !== null ? (
                <Tile
                  label="Average fill"
                  value={money(fuel.averageFillMinor, currency)}
                  note="per visit"
                />
              ) : null}
              {primary ? (
                <Tile
                  label="Per fill"
                  value={(primary.quantity / primary.fills).toFixed(1)}
                  unit={UNIT_LABEL[primary.unit]}
                  note="on average"
                />
              ) : null}
              {fuel.daysBetween !== null ? (
                <Tile
                  label="Every"
                  value={fuel.daysBetween.toFixed(fuel.daysBetween < 10 ? 1 : 0)}
                  unit="days"
                  note="between fills"
                />
              ) : null}
              {fuel.distanceBetween !== null ? (
                <Tile
                  label="Range used"
                  value={Math.round(fuel.distanceBetween).toLocaleString()}
                  unit={unit}
                  note="between fills"
                />
              ) : null}
            </View>
          ),
        },
        { key: 'recent', title: 'Fill-ups', glyph: '🧾', body: <Recent rows={detail.rows} /> },
      ]}
    />
  );
}

/* ——— Expenses and Services: one shape, two slices ——— */

const GROUP_COPY = {
  SERVICES: {
    glyph: '🔧',
    noun: 'visit',
    last: 'Last service',
    byVendor: 'By workshop',
    empty: 'No services in this period',
    emptyText:
      'Maintenance, repairs, parts and cleaning appear here with what they cost and where.',
  },
  EXPENSES: {
    glyph: '🧾',
    noun: 'bill',
    last: 'Latest',
    byVendor: 'Paid to',
    empty: 'No other expenses in this period',
    emptyText:
      'Insurance, tax, registration, parking, tolls and upgrades — everything that is not fuel or a service.',
  },
} as const;

function GroupTab({ report, group }: { report: VehicleReport; group: 'SERVICES' | 'EXPENSES' }) {
  const colors = useChartColors();
  const { spend, distance, period } = report;
  const detail = useMemo(() => (spend ? groupDetail(spend, group) : undefined), [spend, group]);
  const copy = GROUP_COPY[group];
  const label = REPORT_GROUPS.find((entry) => entry.key === group)!.label;
  const unit = report.odometerUnit === 'MI' ? 'mi' : 'km';

  if (!spend || !detail)
    return (
      <Card>
        <HeroSkeleton />
      </Card>
    );
  const currency = spend.currency;
  if (detail.count === 0) {
    return (
      <Card>
        <Eyebrow>{copy.empty}</Eyebrow>
        <Body>{copy.emptyText}</Body>
      </Card>
    );
  }

  return (
    <Sections
      sections={[
        {
          key: 'summary',
          title: label,
          glyph: copy.glyph,
          body: (
            <View style={{ gap: spacing.md }}>
              <Hero
                label={`${label} spend`}
                value={money(detail.total, currency)}
                caption={`${pad(detail.count)} ${copy.noun}s · ${Math.round((detail.total / (spend.total || 1)) * 100)}% of running costs`}
              />
              <View style={styles.grid}>
                <Tile
                  label={`Per ${copy.noun}`}
                  value={detail.averageMinor === null ? '—' : money(detail.averageMinor, currency)}
                  note="on average"
                />
                <Tile
                  label="Per month"
                  value={money(detail.perMonthMinor, currency)}
                  note={`${rate(detail.total, distance, currency)} per ${unit}`}
                />
                <Tile
                  label={copy.last}
                  value={detail.latest ? ago(detail.latest.occurredAt) : '—'}
                  note={detail.latest?.description}
                />
                {detail.largest[0] ? (
                  <Tile
                    label="Biggest"
                    value={money(detail.largest[0].amount.amountMinor, currency)}
                    note={detail.largest[0].description}
                  />
                ) : null}
              </View>
            </View>
          ),
        },
        {
          key: 'monthly',
          title: 'By month',
          glyph: '📊',
          body: (
            <ColumnChart
              buckets={columns(
                detail.buckets.map((bucket) => ({
                  key: bucket.key,
                  values: { [group]: bucket.value },
                })),
              )}
              series={[{ key: group, label, color: colors[group] }]}
              format={(amount) => money(amount, currency)}
              formatAxis={(amount) => compactMoney(amount, currency)}
              caption={`${period.long} · ${label.toLowerCase()}`}
            />
          ),
        },
        {
          key: 'kind',
          title: 'By kind',
          glyph: '🗂️',
          body: (
            <View style={{ gap: spacing.xl }}>
              <RankBars
                rows={detail.byCategory.map((row) => ({
                  key: row.key,
                  label: humanise(row.key),
                  note: `${pad(row.count)} ${row.count === 1 ? 'entry' : 'entries'}`,
                  value: row.amountMinor,
                  display: money(row.amountMinor, currency),
                  color: colors[group],
                }))}
              />
              {detail.byVendor.length > 0 ? (
                <View style={{ gap: spacing.sm }}>
                  <Eyebrow>{copy.byVendor}</Eyebrow>
                  <RankBars
                    rows={detail.byVendor.slice(0, 5).map((row) => ({
                      key: row.key,
                      label: row.key,
                      note: `${pad(row.count)} ${row.count === 1 ? copy.noun : `${copy.noun}s`}`,
                      value: row.amountMinor,
                      display: money(row.amountMinor, currency),
                      color: colors[group],
                    }))}
                  />
                </View>
              ) : null}
            </View>
          ),
        },
        { key: 'recent', title: 'Entries', glyph: '🧾', body: <Recent rows={detail.rows} /> },
      ]}
    />
  );
}

/* ——— Income ——— */

function Income({ report }: { report: VehicleReport }) {
  const colors = useChartColors();
  const { spend, distance, vehicleId, from, period } = report;
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
  if (wall) {
    return (
      <Locked
        wall={wall}
        title="What it earns, against what it costs"
        text="Fares, deliveries, rentals and reimbursements, netted against the same period’s running costs — month by month, by payer, per kilometre."
      />
    );
  }
  if (!spend || !data)
    return (
      <Card>
        <HeroSkeleton />
      </Card>
    );
  const currency = spend.currency;

  return (
    <Sections
      sections={[
        {
          key: 'summary',
          title: 'Income',
          glyph: '💵',
          body: (
            <View style={{ gap: spacing.md }}>
              <Hero
                label="Earned"
                value={money(data.total, currency)}
                caption={`${pad(data.count)} entries · ${period.long.toLowerCase()}`}
              />
              <View style={styles.grid}>
                <Tile
                  label="Net"
                  value={money(data.net, currency)}
                  note="earned less running costs"
                  status={
                    data.count > 0
                      ? {
                          key: data.net >= 0 ? 'good' : 'critical',
                          text: data.net >= 0 ? 'In profit' : 'Cost more than it made',
                        }
                      : undefined
                  }
                />
                <Tile
                  label={`Per ${unit}`}
                  value={rate(data.total, distance, currency)}
                  note="earned per distance"
                />
                <Tile
                  label="Margin"
                  value={data.total > 0 ? `${Math.round((data.net / data.total) * 100)}%` : '—'}
                  note="of what came in, kept"
                />
              </View>
              <Excluded rows={data.excluded} />
            </View>
          ),
        },
        ...(data.count > 0
          ? [
              {
                key: 'against',
                title: 'Earned against spent',
                glyph: '⚖️',
                body: (
                  <ColumnChart
                    mode="group"
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
                    caption={`${period.long} · earned`}
                  />
                ),
              },
              {
                key: 'kind',
                title: 'By kind',
                glyph: '🗂️',
                body: (
                  <View style={{ gap: spacing.xl }}>
                    <RankBars
                      rows={data.byCategory.map((row) => ({
                        key: row.key,
                        label: humanise(row.key),
                        note: `${pad(row.count)} entries`,
                        value: row.amountMinor,
                        display: money(row.amountMinor, currency),
                        color: colors.income,
                      }))}
                    />
                    {data.byPayer.length > 0 ? (
                      <View style={{ gap: spacing.sm }}>
                        <Eyebrow>By payer</Eyebrow>
                        <RankBars
                          rows={data.byPayer.slice(0, 5).map((row) => ({
                            key: row.key,
                            label: row.key,
                            note: `${pad(row.count)} entries`,
                            value: row.amountMinor,
                            display: money(row.amountMinor, currency),
                            color: colors.income,
                          }))}
                        />
                      </View>
                    ) : null}
                  </View>
                ),
              },
            ]
          : [
              {
                key: 'empty',
                title: 'Nothing earned yet',
                glyph: '⚖️',
                body: (
                  <Body>
                    Fares, deliveries and rentals logged against this vehicle are netted against its
                    costs here.
                  </Body>
                ),
              },
            ]),
      ]}
    />
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
  const { distance, vehicleId, from, period, vehicle } = report;
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
  if (wall) {
    return (
      <Locked
        wall={wall}
        title="Every trip, by purpose"
        text="Business, commute and personal distance for any period, with the deduction at each trip’s own rate — ready for a tax return or an expense claim."
      />
    );
  }
  if (!routes || !mileage.data)
    return (
      <Card>
        <HeroSkeleton />
      </Card>
    );
  if (routes.trips === 0) {
    return (
      <Card>
        <Eyebrow>No trips in this period</Eyebrow>
        <Body>
          Log a trip with its purpose and distance and this splits your driving into business,
          commute and personal — with what it is worth to claim.
        </Body>
      </Card>
    );
  }

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

  return (
    <Sections
      sections={[
        {
          key: 'summary',
          title: 'Routes',
          glyph: '🛣️',
          body: (
            <View style={{ gap: spacing.md }}>
              <Hero
                label="Logged"
                value={km(routes.distance)}
                caption={
                  distance
                    ? `${pad(routes.trips)} trips · ${Math.min(100, Math.round((routes.distance / distance) * 100))}% of the odometer’s ${km(distance)}`
                    : `${pad(routes.trips)} trips · ${period.long.toLowerCase()}`
                }
              />
              <View style={styles.grid}>
                <Tile
                  label="Average trip"
                  value={routes.averageDistance === null ? '—' : km(routes.averageDistance)}
                  note={
                    routes.longest[0] ? `longest ${km(routes.longest[0].trip.distance)}` : undefined
                  }
                />
                <Tile
                  label="Business"
                  value={
                    routes.businessShare === null
                      ? '—'
                      : `${Math.round(routes.businessShare * 100)}%`
                  }
                  note={`${km(routes.byPurpose.BUSINESS.distance)} claimable`}
                />
                <Tile
                  label="Deductible"
                  value={
                    mileage.data.deductions.length > 0
                      ? mileage.data.deductions
                          .map((amount) => formatMoney(amount, true))
                          .join(' + ')
                      : '—'
                  }
                  note={
                    mileage.data.unratedBusinessTrips > 0
                      ? `${mileage.data.unratedBusinessTrips} trips without a rate`
                      : 'at each trip’s own rate'
                  }
                />
              </View>
            </View>
          ),
        },
        {
          key: 'monthly',
          title: routes.unit === 'month' ? 'Distance by month' : 'Distance by year',
          glyph: '📊',
          body: (
            <View style={{ gap: spacing.xl }}>
              <ColumnChart
                buckets={columns(routes.buckets)}
                series={TRIP_PURPOSES.map((purpose) => ({
                  key: purpose.key,
                  label: purpose.label,
                  color: purposeColor[purpose.key],
                }))}
                format={km}
                caption={`${period.long} · logged trips`}
              />
              <SplitBar
                parts={TRIP_PURPOSES.map((purpose) => ({
                  key: purpose.key,
                  label: `${purpose.label} · ${pad(routes.byPurpose[purpose.key].trips)} trips`,
                  value: routes.byPurpose[purpose.key].distance,
                  display: km(routes.byPurpose[purpose.key].distance),
                  color: purposeColor[purpose.key],
                }))}
              />
            </View>
          ),
        },
        {
          key: 'longest',
          title: 'Longest trips',
          glyph: '📍',
          body: (
            <View style={{ gap: spacing.sm }}>
              {routes.longest.map((row) => (
                <Row
                  key={row.eventId}
                  title={row.title}
                  meta={`${DAY_MONTH.format(new Date(row.occurredAt))} · ${humanise(row.trip.purpose)}`}
                  trailing={km(row.trip.distance)}
                />
              ))}
              <Button label="Share as CSV" loading={sharing} onPress={() => void share()} />
            </View>
          ),
        },
      ]}
    />
  );
}

/* ——— Overview's lifetime sections ——— */

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
  if (pending) return <HeroSkeleton />;

  const current = summary?.currentValue ?? null;
  const paid = summary?.purchasePrice ?? null;
  const change = summary?.changePercent ?? null;
  const currency = current?.currency ?? paid?.currency ?? trends?.currency ?? null;
  const owned = purchaseDate ? ownedFor(purchaseDate) : null;

  /*
   * What it has cost you against what it is worth, on one money axis. Both start from the price;
   * one climbs with every bill and the other falls with the market, and the gap between them is
   * what owning it has really cost. Ink for the cost; the worth takes the hue no spend group uses.
   */
  const series: Series[] = [];
  if (trends && trends.currency === currency) {
    const spend = trends.ownership.filter((row) => row.cumulativeMinor > 0);
    if (spend.length >= 2) {
      series.push({
        key: 'cost',
        label: 'Cost to own',
        color: colors.ink,
        points: spend.map((row) => {
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
    <View style={{ gap: spacing.xl }}>
      <Hero
        label="Worth now"
        value={current ? formatMoney(current, true) : '—'}
        status={
          change !== null
            ? {
                // A gain is good news; a loss is the ordinary life of a car, not an alarm.
                key: change >= 0 ? 'good' : 'serious',
                text: `${change >= 0 ? '▲' : '▼'} ${Math.abs(change)}% since bought`,
              }
            : undefined
        }
        caption={current ? undefined : 'No valuation recorded yet'}
      />

      {series.length > 0 && currency ? (
        <View style={{ gap: spacing.sm }}>
          <Eyebrow>{series.length > 1 ? 'Cost against worth' : 'Cost to own over time'}</Eyebrow>
          <LineChart
            series={series}
            formatY={(amount) => compactMoney(amount, currency)}
            formatX={(x) => MONTH_YEAR.format(new Date(x))}
            area={series.length === 1}
          />
        </View>
      ) : null}

      <View style={styles.grid}>
        <Tile label="Paid" value={paid ? formatMoney(paid, true) : '—'} note="purchase price" />
        <Tile
          label="Owned"
          value={owned ?? '—'}
          note={
            purchaseDate
              ? `since ${new Date(`${purchaseDate}T00:00:00`).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}`
              : 'no purchase date'
          }
        />
      </View>
    </View>
  );
}

function Distance({
  odometer,
  unit,
  engineHours,
  pending,
  years,
  onLog,
}: {
  odometer: number | null;
  unit: 'KM' | 'MI';
  engineHours: number | null;
  pending: boolean;
  years: CostTrends['distancePerYear'];
  onLog?: () => void;
}) {
  const colors = useChartColors();
  if (pending) return <HeroSkeleton />;
  const recent = years.slice(-6);

  return (
    <View style={{ gap: spacing.xl }}>
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
        scaleTo={0.98}
      >
        <Hero
          label="Odometer"
          value={formatDistance(odometer, unit)}
          caption={
            engineHours !== null
              ? `${engineHours.toLocaleString()} engine hours`
              : onLog
                ? 'Tap to record a new reading'
                : undefined
          }
          action
        />
      </PressableScale>

      {recent.length >= 2 ? (
        <ColumnChart
          buckets={recent.map((row) => ({
            key: String(row.year),
            label: `’${String(row.year).slice(2)}`,
            long: String(row.year),
            values: { distance: row.distance },
          }))}
          series={[{ key: 'distance', label: 'Driven', color: colors.muted }]}
          format={(value) => formatDistance(value, recent[0]!.distanceUnit)}
          caption="Driven per year"
        />
      ) : (
        <Body>A second reading, a while after the first, draws how far it goes each year.</Body>
      )}
    </View>
  );
}

function Health({ health, pending }: { health: VehicleHealth | undefined; pending: boolean }) {
  const theme = useTheme();
  if (pending) return <HeroSkeleton />;
  const score = health?.overall ?? null;
  if (!health || score === null) {
    return (
      <View style={{ gap: spacing.sm }}>
        <Hero label="Score" value="—" caption="Not scored yet" />
        <Body>Schedules, documents and a condition check give it something to score.</Body>
      </View>
    );
  }

  const status = healthStatus(score);
  const scored = health.categories.filter((category) => category.score !== null);
  const factors = [...health.factors].sort((a, b) => b.penalty - a.penalty).slice(0, 6);

  return (
    <View style={{ gap: spacing.xl }}>
      <View style={{ gap: spacing.sm }}>
        <Hero
          label="Score"
          value={String(score)}
          unit="/ 100"
          status={{
            key: status,
            text: status === 'good' ? 'Good' : status === 'warning' ? 'Fair' : 'Poor',
          }}
          caption={health.summary}
        />
        {/* Ten cells, as many lit as the score has tens, in its status colour. */}
        <View accessible accessibilityLabel={`Health ${score} out of 100`} style={styles.cells}>
          {Array.from({ length: 10 }, (_, index) => (
            <View
              key={index}
              style={[
                styles.cell,
                { backgroundColor: index < Math.round(score / 10) ? STATUS[status] : theme.muted },
              ]}
            />
          ))}
        </View>
      </View>

      {scored.length > 0 ? (
        <View style={{ gap: spacing.sm }}>
          <Eyebrow>By area</Eyebrow>
          <RankBars
            max={100}
            rows={scored.map((category) => ({
              key: category.category,
              label: humanise(category.category),
              note: category.basis,
              value: category.score ?? 0,
              display: String(category.score),
              color: STATUS[healthStatus(category.score ?? 0)],
            }))}
          />
        </View>
      ) : null}

      {factors.length > 0 ? (
        <View style={{ gap: spacing.sm }}>
          <Eyebrow>What cost it points</Eyebrow>
          <RankBars
            rows={factors.map((factor) => ({
              key: `${factor.category}-${factor.label}`,
              label: factor.label,
              note: factor.detail,
              value: factor.penalty,
              display: `−${factor.penalty}`,
              color: STATUS.critical,
            }))}
          />
        </View>
      ) : null}
    </View>
  );
}

/* ——— Pieces ——— */

/** Sections in the house style: numbered, named, each in its own card, rising in turn. */
function Sections({
  sections,
}: {
  sections: readonly { key: string; title: string; glyph: string; body: ReactNode }[];
}) {
  return (
    <View style={{ gap: spacing.lg }}>
      {sections.map((section, index) => (
        <Rise key={section.key} index={index} style={{ gap: spacing.sm }}>
          <SectionHead index={index + 1} title={section.title} glyph={section.glyph} />
          <Card>{section.body}</Card>
        </Rise>
      ))}
    </View>
  );
}

/** A tab's latest entries, read-only: recording and correcting are the dock's and the entry's. */
function Recent({ rows }: { rows: readonly LedgerRow[] }) {
  const [all, setAll] = useState(false);
  if (rows.length === 0) return <Body>Nothing recorded in this period.</Body>;
  const shown = all ? rows : rows.slice(0, 5);
  return (
    <View style={{ gap: spacing.sm }}>
      {shown.map((row) => (
        <Row
          key={row.id}
          title={row.description}
          meta={`${DAY_MONTH.format(new Date(row.occurredAt))} · ${humanise(row.category)}${row.vendor ? ` · ${row.vendor}` : ''}`}
          trailing={formatMoney(row.amount)}
        />
      ))}
      {rows.length > 5 ? (
        <Button
          label={all ? 'Show fewer' : `Show all ${rows.length}`}
          onPress={() => setAll((open) => !open)}
        />
      ) : null}
    </View>
  );
}

function Row({
  title,
  meta,
  trailing,
  status,
}: {
  title: string;
  meta: string;
  trailing: string;
  status?: StatusKey;
}) {
  const theme = useTheme();
  return (
    <View
      accessible
      accessibilityLabel={`${title}, ${meta}, ${trailing}`}
      style={[styles.row, { backgroundColor: theme.muted }]}
    >
      <View style={[styles.rowRule, { backgroundColor: status ? STATUS[status] : theme.border }]} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={[typeScale.label, { color: theme.foreground }]}>
          {title}
        </Text>
        <Text numberOfLines={1} style={[typeScale.caption, { color: theme.mutedForeground }]}>
          {meta}
        </Text>
      </View>
      <Text style={[figure, styles.rowValue, { color: theme.foreground }]}>{trailing}</Text>
    </View>
  );
}

/** A plan's wall, in the tab it guards: what the tab would show, and the one way to get it. */
function Locked({ wall, title, text }: { wall: PlanWall; title: string; text: string }) {
  const theme = useTheme();
  return (
    <Card>
      <View style={{ gap: spacing.sm }}>
        <Eyebrow>
          {wall.requiredPlan ? `${PLAN_NAMES[wall.requiredPlan]} plan` : 'Paid plan'}
        </Eyebrow>
        <Text style={[typeScale.headline, { color: theme.foreground }]}>{title}</Text>
        <Body>{text}</Body>
        <Button label="See plans" variant="primary" onPress={() => showUpgrade(wall)} />
      </View>
    </Card>
  );
}

/** What the totals left out, named rather than converted at a guess. */
function Excluded({ rows }: { rows: readonly { currency: string; amountMinor: number }[] }) {
  if (rows.length === 0) return null;
  return (
    <Body>
      Not included, in other currencies:{' '}
      {rows
        .map((row) => formatMoney({ amountMinor: row.amountMinor, currency: row.currency }))
        .join(', ')}
      .
    </Body>
  );
}

/** A section's name, set as the house sets steps: the glyph of its kind, the title, a mono number. */
function SectionHead({ index, title, glyph }: { index: number; title: string; glyph: string }) {
  const theme = useTheme();
  return (
    <View style={styles.head}>
      <View style={[styles.headGlyph, { backgroundColor: theme.card }]}>
        <Glyph size={16}>{glyph}</Glyph>
      </View>
      <Text
        accessibilityRole="header"
        style={[typeScale.title, { flex: 1, color: theme.foreground }]}
      >
        {title}
      </Text>
      <Text style={[figure, styles.headIndex, { color: theme.mutedForeground }]}>{pad(index)}</Text>
    </View>
  );
}

function Card({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return <View style={[styles.card, { backgroundColor: theme.card }]}>{children}</View>;
}

function Body({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return <Text style={[typeScale.caption, { color: theme.mutedForeground }]}>{children}</Text>;
}

/** A status told three ways — a dot in its colour, a word, and the figure beside it. */
function StatusChip({ status }: { status: { key: StatusKey; text: string } }) {
  const theme = useTheme();
  return (
    <View style={[styles.statusChip, { backgroundColor: theme.muted }]}>
      <View style={[styles.statusDot, { backgroundColor: STATUS[status.key] }]} />
      <Text style={[typeScale.caption, { fontWeight: '700', color: theme.foreground }]}>
        {status.text}
      </Text>
    </View>
  );
}

/**
 * The one number a section is about: its label, the figure large in mono, its unit small beside
 * it, a status where the figure is good or bad news, and a line saying what it is of.
 */
function Hero({
  label,
  value,
  unit,
  caption,
  status,
  action = false,
}: {
  label: string;
  value: string;
  unit?: string;
  caption?: string;
  status?: { key: StatusKey; text: string };
  action?: boolean;
}) {
  const theme = useTheme();
  return (
    <View style={{ gap: 3 }}>
      <View style={styles.between}>
        <Eyebrow>{label}</Eyebrow>
        {action ? (
          <Ionicons name="chevron-forward" size={13} color={theme.mutedForeground} />
        ) : null}
      </View>
      <View style={styles.heroLine}>
        <Text
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.6}
          style={[figure, styles.heroValue, { color: theme.foreground }]}
        >
          {value}
        </Text>
        {unit ? (
          <Text style={[figure, styles.heroUnit, { color: theme.mutedForeground }]}>{unit}</Text>
        ) : null}
        {status ? <StatusChip status={status} /> : null}
      </View>
      {caption ? (
        <Text numberOfLines={2} style={[typeScale.caption, { color: theme.mutedForeground }]}>
          {caption}
        </Text>
      ) : null}
    </View>
  );
}

function HeroSkeleton() {
  return (
    <View style={{ gap: 6 }}>
      <Skeleton width={80} height={11} />
      <Skeleton width={150} height={28} />
      <Skeleton width="100%" height={96} radius={radius.md} />
    </View>
  );
}

interface TileProps {
  label: string;
  value: string;
  unit?: string;
  note?: string;
  status?: { key: StatusKey; text: string };
}

/** A secondary figure, two to a row: label, figure with its unit, what it is of, and any status. */
function Tile({ label, value, unit, note, status }: TileProps) {
  const theme = useTheme();
  return (
    <View
      accessible
      accessibilityLabel={`${label}: ${value}${unit ? ` ${unit}` : ''}${note ? `, ${note}` : ''}${status ? `, ${status.text}` : ''}`}
      style={[styles.tile, { backgroundColor: theme.muted }]}
    >
      <Eyebrow style={{ fontSize: 10 }}>{label}</Eyebrow>
      <View style={styles.tileLine}>
        <Text
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.7}
          style={[figure, styles.tileValue, { color: theme.foreground }]}
        >
          {value}
        </Text>
        {unit ? (
          <Text style={[figure, styles.tileUnit, { color: theme.mutedForeground }]}>{unit}</Text>
        ) : null}
      </View>
      {note ? (
        <Text numberOfLines={1} style={[typeScale.caption, { color: theme.mutedForeground }]}>
          {note}
        </Text>
      ) : null}
      {status ? (
        <View style={styles.tileStatus}>
          <View style={[styles.statusDot, { backgroundColor: STATUS[status.key] }]} />
          <Text
            numberOfLines={1}
            style={[
              typeScale.caption,
              { flexShrink: 1, fontWeight: '600', color: theme.foreground },
            ]}
          >
            {status.text}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  between: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  card: { borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  headGlyph: {
    width: 30,
    height: 30,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headIndex: { fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },
  tabChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 36,
    paddingHorizontal: 13,
    borderRadius: 999,
  },
  heroLine: {
    flexDirection: 'row',
    alignItems: 'baseline',
    flexWrap: 'wrap',
    columnGap: 6,
    rowGap: 4,
  },
  heroValue: { fontSize: 26, lineHeight: 31, fontWeight: '700', flexShrink: 1 },
  heroUnit: { fontSize: 13, fontWeight: '600' },
  statusChip: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  statusDot: { width: 7, height: 7, borderRadius: 999 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tile: {
    flexGrow: 1,
    flexBasis: '46%',
    minWidth: 0,
    gap: 2,
    borderRadius: radius.md,
    padding: 10,
  },
  tileLine: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  tileValue: { fontSize: 17, lineHeight: 21, fontWeight: '700', flexShrink: 1 },
  tileUnit: { fontSize: 11, fontWeight: '600' },
  tileStatus: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  cells: { flexDirection: 'row', gap: 3 },
  cell: { flex: 1, height: 8, borderRadius: 2 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radius.md,
    paddingVertical: 9,
    paddingRight: 10,
    overflow: 'hidden',
  },
  rowRule: { width: 3, alignSelf: 'stretch', borderRadius: 2, marginRight: 4 },
  rowValue: { fontSize: 13, fontWeight: '700' },
});
