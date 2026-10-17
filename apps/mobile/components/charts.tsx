import { useEffect, useState, type ReactNode } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';
import { STATUS } from '@/lib/chart-colors';
import { ease, haptic, PressableScale, useReduceMotion } from '@/lib/motion';
import { figure, spacing, typeScale, useTheme } from '@/lib/theme';

/*
 * The Stats section's charts, drawn with react-native-svg and plain views — the web's
 * `components/charts.tsx`, form for form, so a report reads the same on both.
 *
 * House rules, from the data-viz method: thin marks; a 2pt gap in the card's own colour between
 * touching fills rather than an outline; bars capped in width and rounded only at the data end;
 * hairline grid; one axis; colour carries the series and a word or a swatch always rides beside
 * it; a tap — the phone's hover — reads any mark out.
 */

export interface Slice {
  key: string;
  label: string;
  value: number;
  display: string;
  color: string;
}

export interface Series {
  key: string;
  label: string;
  color: string;
  /** Oldest first; `x` in epoch milliseconds. */
  points: readonly { x: number; y: number }[];
}

const share = (value: number, total: number) => `${Math.round((value / (total || 1)) * 100)}%`;

/**
 * Lines over time, on one axis. A touch anywhere on the plot moves a crosshair to the nearest
 * moment and the readout above names every series there; let go and it rests on the latest.
 *
 * The scale fits the data rather than starting at zero — lines are read by their shape, and a
 * zero floor would flatten two figures near 80k into one line. An optional `reference` draws a
 * level (an average) as a quiet dashed rule.
 */
export function LineChart({
  series,
  formatY,
  formatX,
  formatAxis = formatY,
  reference,
  height = 112,
  area = false,
}: {
  series: readonly Series[];
  formatY: (value: number) => string;
  formatX: (x: number) => string;
  /** The scale's labels, when the readout's format is too wide for the gutter. */
  formatAxis?: (value: number) => string;
  reference?: { value: number; label: string };
  height?: number;
  /** A soft fill under a single line, for a figure that accumulates. */
  area?: boolean;
}) {
  const theme = useTheme();
  const [width, setWidth] = useState(0);
  const [cursor, setCursor] = useState<number | null>(null);

  const all = series.flatMap((line) => line.points);
  const xs = all.map((point) => point.x);
  const ys = [...all.map((point) => point.y), ...(reference ? [reference.value] : [])];
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const low = Math.min(...ys);
  const high = Math.max(...ys);
  const pad = (high - low) * 0.12 || Math.abs(high) * 0.1 || 1;
  const minY = low - pad;
  const maxY = high + pad;

  const plotWidth = Math.max(0, width - 44);
  const top = 6;
  const plotHeight = height - top - 4;
  const toX = (x: number) =>
    maxX === minX ? plotWidth / 2 : ((x - minX) / (maxX - minX)) * plotWidth;
  const toY = (y: number) => top + (1 - (y - minY) / (maxY - minY)) * plotHeight;
  const ticks = [maxY - pad, minY + pad];
  const path = (points: readonly { x: number; y: number }[]) =>
    points
      .map(
        (point, index) =>
          `${index === 0 ? 'M' : 'L'}${toX(point.x).toFixed(1)} ${toY(point.y).toFixed(1)}`,
      )
      .join(' ');

  // The moment under the finger, or the latest; each series read at its last point up to it.
  const at = cursor ?? maxX;
  const reading = series.map((line) => {
    const upTo = line.points.filter((point) => point.x <= at);
    return { line, point: upTo[upTo.length - 1] ?? line.points[0] };
  });
  const nearest = (locationX: number) => {
    const x =
      minX + (Math.min(Math.max(locationX, 0), plotWidth) / (plotWidth || 1)) * (maxX - minX);
    return xs.reduce(
      (best, candidate) => (Math.abs(candidate - x) < Math.abs(best - x) ? candidate : best),
      xs[0]!,
    );
  };
  const only = series.length === 1 ? series[0]! : null;

  return (
    <View style={{ gap: spacing.sm }}>
      <View style={styles.readout}>
        <Text style={[figure, styles.axisText, { color: theme.mutedForeground }]}>
          {formatX(at).toUpperCase()}
        </Text>
        {reading.map(({ line, point }) => (
          <View key={line.key} style={styles.readoutItem}>
            <View style={[styles.swatch, { backgroundColor: line.color }]} />
            {series.length > 1 ? (
              <Text style={[typeScale.caption, { color: theme.mutedForeground }]}>
                {line.label}
              </Text>
            ) : null}
            <Text style={[figure, styles.readoutValue, { color: theme.foreground }]}>
              {point ? formatY(point.y) : '—'}
            </Text>
          </View>
        ))}
      </View>

      <View
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
        onStartShouldSetResponder={() => true}
        onResponderTerminationRequest={() => true}
        onResponderGrant={(event) => setCursor(nearest(event.nativeEvent.locationX))}
        onResponderMove={(event) => setCursor(nearest(event.nativeEvent.locationX))}
        onResponderRelease={() => setCursor(null)}
        onResponderTerminate={() => setCursor(null)}
        accessible
        accessibilityLabel={series
          .map((line) => {
            const first = line.points[0];
            const last = line.points[line.points.length - 1];
            return first && last
              ? `${line.label} from ${formatY(first.y)} to ${formatY(last.y)}`
              : line.label;
          })
          .join('; ')}
        style={{ height }}
      >
        {width > 0 ? (
          <Svg width={width} height={height}>
            {ticks.map((tick) => (
              <Line
                key={tick}
                x1={0}
                x2={plotWidth}
                y1={toY(tick)}
                y2={toY(tick)}
                stroke={theme.border}
                strokeWidth={StyleSheet.hairlineWidth * 2}
              />
            ))}
            {reference ? (
              <Line
                x1={0}
                x2={plotWidth}
                y1={toY(reference.value)}
                y2={toY(reference.value)}
                stroke={theme.mutedForeground}
                strokeWidth={1}
                strokeDasharray="3 4"
              />
            ) : null}
            {cursor !== null ? (
              <Line
                x1={toX(at)}
                x2={toX(at)}
                y1={top}
                y2={top + plotHeight}
                stroke={theme.mutedForeground}
                strokeWidth={1}
              />
            ) : null}
            {(area || only) && only && only.points.length > 1 ? (
              <Path
                d={`${path(only.points)} L${toX(only.points[only.points.length - 1]!.x)} ${
                  top + plotHeight
                } L${toX(only.points[0]!.x)} ${top + plotHeight} Z`}
                fill={only.color}
                opacity={area ? 0.14 : 0.07}
              />
            ) : null}
            {series.map((line) => (
              <Path
                key={line.key}
                d={path(line.points)}
                fill="none"
                stroke={line.color}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ))}
            {reading.map(({ line, point }) =>
              point ? (
                <Circle
                  key={line.key}
                  cx={toX(point.x)}
                  cy={toY(point.y)}
                  r={4}
                  fill={line.color}
                  stroke={theme.card}
                  strokeWidth={2}
                />
              ) : null,
            )}
          </Svg>
        ) : null}
        {/* The scale on the right edge, outside the plot, so it never sits on a line. */}
        {width > 0
          ? ticks.map((tick) => (
              <Text
                key={tick}
                style={[
                  figure,
                  styles.yLabel,
                  { top: toY(tick) - 7, color: theme.mutedForeground },
                ]}
              >
                {formatAxis(tick)}
              </Text>
            ))
          : null}
      </View>

      <View style={styles.xAxis}>
        <Text style={[figure, styles.axisText, { color: theme.mutedForeground }]}>
          {formatX(minX).toUpperCase()}
        </Text>
        {reference ? (
          <Text style={[figure, styles.axisText, { color: theme.mutedForeground }]}>
            ┄ {reference.label}
          </Text>
        ) : null}
        <Text style={[figure, styles.axisText, { color: theme.mutedForeground, marginRight: 44 }]}>
          {formatX(maxX).toUpperCase()}
        </Text>
      </View>
    </View>
  );
}

export interface ColumnBucket {
  key: string;
  /** Under the column: `SEP`, `’25`. */
  label: string;
  /** In the readout: `September 2026`. */
  long: string;
  values: Record<string, number>;
}

/**
 * Columns over time, headed by their own figure: one series, several stacked, or two side by
 * side (`group`). At rest the head says `label` and the window's total (or `total`); a tap on a
 * column turns it into that column's period and figure, each series beside its swatch, and a
 * second tap lets go. A quiet period is a hairline, not a gap: nothing spent and nothing known
 * are opposites. The columns rise from the axis in a wave from the oldest.
 */
export function ColumnChart({
  buckets,
  series,
  mode = 'stack',
  format,
  formatAxis = format,
  label,
  total,
  trailing,
  legend = true,
  large = true,
  height = 112,
}: {
  buckets: readonly ColumnBucket[];
  series: readonly { key: string; label: string; color: string }[];
  mode?: 'stack' | 'group';
  format: (value: number) => string;
  formatAxis?: (value: number) => string;
  /** What the resting figure is: "Running cost". */
  label: string;
  /** The resting figure, when it is not the sum of the columns (an average, say). */
  total?: number;
  /** Beside the label: a count, an action. */
  trailing?: ReactNode;
  /** The series key; off where a split under the chart names them instead. */
  legend?: boolean;
  /** The card's headline figure, or a smaller one inside a card that has its own. */
  large?: boolean;
  height?: number;
}) {
  const theme = useTheme();
  const reduce = useReduceMotion();
  const [chosen, setChosen] = useState<number | null>(null);
  const [grow] = useState(() => new Animated.Value(reduce ? 1 : 0));
  useEffect(() => {
    if (reduce) return;
    const animation = Animated.timing(grow, {
      toValue: 1,
      duration: 900,
      delay: 150,
      easing: ease.out,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [grow, reduce]);

  const totals = buckets.map((bucket) =>
    series.reduce((sum, line) => sum + (bucket.values[line.key] ?? 0), 0),
  );
  const peak =
    Math.max(
      ...buckets.flatMap((bucket, index) =>
        mode === 'stack' ? [totals[index]!] : series.map((line) => bucket.values[line.key] ?? 0),
      ),
      0,
    ) || 1;
  const shown = chosen === null ? null : buckets[chosen]!;
  // Every label when they fit; past eight, a few, or they run into a smear.
  const every = buckets.length > 8 ? Math.ceil(buckets.length / 6) : 1;
  const headline =
    mode === 'group' && shown
      ? (shown.values[series[0]!.key] ?? 0)
      : shown
        ? totals[chosen!]!
        : (total ?? totals.reduce((sum, value) => sum + value, 0));

  return (
    <View style={{ gap: spacing.md }}>
      <View style={{ gap: 2 }}>
        <View style={styles.headRow}>
          <Text
            numberOfLines={1}
            style={[typeScale.overline, { flex: 1, color: theme.mutedForeground }]}
          >
            {shown ? shown.long : label}
          </Text>
          {trailing}
        </View>
        <Text
          numberOfLines={1}
          adjustsFontSizeToFit
          style={[
            figure,
            large ? styles.headline : styles.headlineSmall,
            { color: theme.foreground },
          ]}
        >
          {format(headline)}
        </Text>
        {legend && series.length > 1 ? (
          <View style={styles.readout}>
            {series.map((line) => (
              <View key={line.key} style={styles.readoutItem}>
                <View style={[styles.swatch, { backgroundColor: line.color }]} />
                <Text style={[typeScale.caption, { color: theme.mutedForeground }]}>
                  {line.label}
                </Text>
                {shown ? (
                  <Text style={[figure, styles.readoutValue, { color: theme.foreground }]}>
                    {format(shown.values[line.key] ?? 0)}
                  </Text>
                ) : null}
              </View>
            ))}
          </View>
        ) : null}
      </View>

      <View>
        {/* The peak and its half, labelled at the right, under the marks. */}
        {[1, 0.5].map((part) => (
          <View
            key={part}
            pointerEvents="none"
            style={[styles.gridRow, { top: (1 - part) * height }]}
          >
            <View
              style={{
                flex: 1,
                height: StyleSheet.hairlineWidth * 2,
                backgroundColor: theme.border,
              }}
            />
            <Text style={[figure, styles.gridLabel, { color: theme.mutedForeground }]}>
              {formatAxis(peak * part)}
            </Text>
          </View>
        ))}
        <View
          style={[
            styles.columns,
            {
              height,
              borderBottomColor: theme.border,
              borderBottomWidth: StyleSheet.hairlineWidth * 2,
            },
          ]}
        >
          {buckets.map((bucket, index) => {
            const selected = chosen === index;
            const from = (index / Math.max(1, buckets.length)) * 0.4;
            return (
              <PressableScale
                key={bucket.key}
                onPress={() => {
                  haptic.selection();
                  setChosen(selected ? null : index);
                }}
                accessibilityRole="button"
                accessibilityLabel={`${bucket.long}: ${series
                  .map((line) => `${line.label} ${format(bucket.values[line.key] ?? 0)}`)
                  .join(', ')}`}
                accessibilityState={{ selected }}
                scaleTo={0.92}
                style={[styles.column, { opacity: chosen !== null && !selected ? 0.35 : 1 }]}
              >
                <Animated.View
                  style={[
                    styles.stack,
                    {
                      flexDirection: mode === 'stack' ? 'column-reverse' : 'row',
                      transform: [
                        {
                          scaleY: grow.interpolate({
                            inputRange: [from, from + 0.6],
                            outputRange: [0, 1],
                            extrapolate: 'clamp',
                          }),
                        },
                      ],
                    },
                  ]}
                >
                  {totals[index] === 0 ? (
                    <View style={[styles.quiet, { backgroundColor: theme.border }]} />
                  ) : (
                    series.map((line, position) => {
                      const value = bucket.values[line.key] ?? 0;
                      if (value <= 0) {
                        return mode === 'group' ? (
                          <View key={line.key} style={{ flex: 1 }} />
                        ) : null;
                      }
                      const top =
                        mode === 'group' ||
                        series
                          .slice(position + 1)
                          .every((next) => (bucket.values[next.key] ?? 0) <= 0);
                      return (
                        <View
                          key={line.key}
                          style={[
                            {
                              height: Math.max(3, (value / peak) * height - 2),
                              backgroundColor: line.color,
                            },
                            mode === 'group' ? { flex: 1 } : { width: '100%' },
                            top ? { borderTopLeftRadius: 4, borderTopRightRadius: 4 } : null,
                          ]}
                        />
                      );
                    })
                  )}
                </Animated.View>
              </PressableScale>
            );
          })}
        </View>
        <View style={styles.ticks}>
          {buckets.map((bucket, index) => (
            <Text
              key={bucket.key}
              numberOfLines={1}
              style={[
                figure,
                styles.tick,
                {
                  color: chosen === index ? theme.foreground : theme.mutedForeground,
                  opacity: index % every === 0 || chosen === index ? 1 : 0,
                },
              ]}
            >
              {bucket.label}
            </Text>
          ))}
        </View>
      </View>
    </View>
  );
}

/**
 * Magnitudes compared, largest first: the name and its count, the figure, and a bar against the
 * largest (or `max`). `columns={2}` sets short bars side by side, for scores out of a hundred.
 */
export function RankBars({
  rows,
  max,
  columns = 1,
}: {
  rows: readonly {
    key: string;
    label: string;
    count?: number;
    value: number;
    display: string;
    color: string;
  }[];
  max?: number;
  columns?: 1 | 2;
}) {
  const theme = useTheme();
  const top = max ?? (Math.max(...rows.map((row) => row.value), 0) || 1);
  return (
    <View style={columns === 2 ? styles.rankGrid : { gap: 11 }}>
      {rows.map((row) => (
        <View
          key={row.key}
          accessible
          accessibilityLabel={`${row.label}: ${row.display}${row.count ? `, ${row.count}` : ''}`}
          style={[{ gap: 5 }, columns === 2 ? styles.rankCell : null]}
        >
          <View style={styles.between}>
            <Text
              numberOfLines={1}
              style={[typeScale.label, styles.rankLabel, { color: theme.foreground }]}
            >
              {row.label}
              {row.count ? (
                <Text style={[figure, { color: theme.mutedForeground }]}>
                  {'  '}
                  {String(row.count).padStart(2, '0')}
                </Text>
              ) : null}
            </Text>
            <Text style={[figure, styles.readoutValue, { color: theme.foreground }]}>
              {row.display}
            </Text>
          </View>
          <View style={[styles.track, { backgroundColor: theme.muted }]}>
            <View
              style={[
                styles.fill,
                {
                  width: `${Math.max(2, Math.min(100, (row.value / top) * 100))}%`,
                  backgroundColor: row.color,
                },
              ]}
            />
          </View>
        </View>
      ))}
    </View>
  );
}

/**
 * A whole in a few parts: one bar of them side by side with a gap of card between, and a key of
 * each part's share. `onSelect` makes each key the way into what it counts.
 */
export function SplitBar({
  parts,
  onSelect,
}: {
  parts: readonly Slice[];
  onSelect?: (key: string) => void;
}) {
  const theme = useTheme();
  const total = parts.reduce((sum, part) => sum + part.value, 0);
  const shown = parts.filter((part) => part.value > 0);
  return (
    <View style={{ gap: 10 }}>
      <View style={styles.split}>
        {shown.map((part) => (
          <View
            key={part.key}
            style={{ flex: part.value, minWidth: 3, backgroundColor: part.color, borderRadius: 3 }}
          />
        ))}
      </View>
      <View style={styles.keyRow}>
        {shown.map((part) => (
          <PressableScale
            key={part.key}
            onPress={
              onSelect
                ? () => {
                    haptic.selection();
                    onSelect(part.key);
                  }
                : undefined
            }
            disabled={!onSelect}
            accessibilityRole={onSelect ? 'button' : 'text'}
            accessibilityLabel={`${part.label}: ${part.display}, ${share(part.value, total)}`}
            accessibilityHint={onSelect ? `Opens ${part.label}` : undefined}
            scaleTo={0.95}
            style={[styles.keyItem, onSelect ? { backgroundColor: theme.muted } : styles.keyPlain]}
          >
            <View style={[styles.swatch, { backgroundColor: part.color }]} />
            <Text style={[typeScale.caption, { fontWeight: '600', color: theme.foreground }]}>
              {part.label}
            </Text>
            <Text style={[figure, styles.keyShare, { color: theme.mutedForeground }]}>
              {share(part.value, total)}
            </Text>
          </PressableScale>
        ))}
      </View>
    </View>
  );
}

/** A trend at a glance: one line over a soft fill, its latest point marked. Oldest first. */
export function Spark({
  values,
  color,
  height = 36,
}: {
  values: readonly number[];
  color: string;
  height?: number;
}) {
  const [width, setWidth] = useState(0);
  const theme = useTheme();
  const high = Math.max(...values, 0) || 1;
  const step = values.length > 1 ? width / (values.length - 1) : 0;
  const point = (value: number, index: number) =>
    [index * step, 3 + (1 - value / high) * (height - 6)] as const;
  const line = values
    .map((value, index) => {
      const [x, y] = point(value, index);
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');
  const [lastX, lastY] = point(values[values.length - 1] ?? 0, values.length - 1);
  return (
    <View
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ height }}
    >
      {width > 0 && values.length > 1 ? (
        <Svg width={width} height={height} style={{ overflow: 'visible' }}>
          <Path d={`${line} L${width} ${height} L0 ${height} Z`} fill={color} opacity={0.14} />
          <Path d={line} fill="none" stroke={color} strokeWidth={1.75} strokeLinejoin="round" />
          <Circle
            cx={lastX}
            cy={lastY}
            r={3.5}
            fill={color}
            stroke={theme.card}
            strokeWidth={1.5}
          />
        </Svg>
      ) : null}
    </View>
  );
}

/**
 * Prices side by side on one scale, cheapest to dearest: each place a dot on the span between
 * them, the figure at the end. The cheapest wears the good-news colour.
 */
export function Ladder({
  rows,
  color,
}: {
  rows: readonly { key: string; label: string; value: number; display: string }[];
  color: string;
}) {
  const theme = useTheme();
  const low = Math.min(...rows.map((row) => row.value));
  const high = Math.max(...rows.map((row) => row.value));
  return (
    <View style={{ gap: 12 }}>
      {rows.map((row, index) => {
        const at = high === low ? 0.5 : (row.value - low) / (high - low);
        const best = index === 0 && rows.length > 1;
        return (
          <View
            key={row.key}
            accessible
            accessibilityLabel={`${row.label}: ${row.display}${best ? ', cheapest' : ''}`}
            style={styles.ladderRow}
          >
            <Text
              numberOfLines={1}
              style={[typeScale.label, styles.ladderLabel, { color: theme.foreground }]}
            >
              {row.label}
            </Text>
            <View style={styles.ladderTrack}>
              <View style={[styles.ladderLine, { backgroundColor: theme.border }]} />
              <View
                style={[
                  styles.ladderDot,
                  {
                    left: `${at * 100}%`,
                    backgroundColor: best ? STATUS.good : color,
                    borderColor: theme.card,
                  },
                ]}
              />
            </View>
            <Text style={[figure, styles.ladderValue, { color: theme.foreground }]}>
              {row.display}
            </Text>
          </View>
        );
      })}
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
  headRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 22 },
  headline: { fontSize: 30, lineHeight: 36, fontWeight: '700', letterSpacing: -1 },
  headlineSmall: { fontSize: 20, lineHeight: 25, fontWeight: '700', letterSpacing: -0.6 },
  swatch: { width: 8, height: 8, borderRadius: 2.5 },
  readout: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: 12,
    rowGap: 4,
  },
  readoutItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  readoutValue: { fontSize: 12, fontWeight: '700' },
  axisText: { fontSize: 9, fontWeight: '600', letterSpacing: 0.4 },
  yLabel: { position: 'absolute', right: 0, width: 40, fontSize: 9, textAlign: 'right' },
  xAxis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: -4 },
  columns: { flexDirection: 'row', alignItems: 'flex-end', gap: 4, paddingRight: 40 },
  column: { flex: 1, height: '100%', alignItems: 'center', justifyContent: 'flex-end' },
  ticks: { flexDirection: 'row', gap: 4, paddingRight: 40, marginTop: 5 },
  gridRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  gridLabel: { width: 36, fontSize: 9, textAlign: 'right' },
  stack: {
    width: '100%',
    maxWidth: 22,
    height: '100%',
    gap: 2,
    alignItems: 'flex-end',
    justifyContent: 'flex-start',
    transformOrigin: 'bottom',
  },
  quiet: { width: '100%', height: 2, borderRadius: 1, alignSelf: 'flex-end' },
  tick: { flex: 1, fontSize: 9, fontWeight: '600', textAlign: 'center' },
  rankLabel: { flex: 1, fontSize: 13 },
  rankGrid: { flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing.lg, rowGap: 11 },
  rankCell: { flexBasis: '45%', flexGrow: 1, minWidth: 0 },
  track: { height: 5, borderRadius: 999, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 999 },
  split: { flexDirection: 'row', gap: 2, height: 8 },
  keyRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  keyItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  keyPlain: { paddingHorizontal: 0, marginRight: 8 },
  keyShare: { fontSize: 11, fontWeight: '700' },
  ladderRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  ladderLabel: { width: '34%', fontSize: 13 },
  ladderTrack: { flex: 1, height: 14, justifyContent: 'center', marginHorizontal: 6 },
  ladderLine: { height: 2, borderRadius: 1 },
  ladderDot: {
    position: 'absolute',
    width: 12,
    height: 12,
    marginLeft: -6,
    borderRadius: 6,
    borderWidth: 2,
  },
  ladderValue: { minWidth: 48, fontSize: 12, fontWeight: '700', textAlign: 'right' },
});
