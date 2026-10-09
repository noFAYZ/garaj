import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, G, Line, Path } from 'react-native-svg';
import { haptic, PressableScale } from '@/lib/motion';
import { figure, spacing, typeScale, useTheme } from '@/lib/theme';

/*
 * The Stats section's charts, drawn with react-native-svg and plain views.
 *
 * House rules, from the data-viz method: thin marks; a 2pt gap in the card's own colour between
 * touching fills rather than an outline; bars capped in width and rounded only at the data end;
 * hairline grid; one axis; a legend whenever there is more than one series, and a tap — the
 * phone's hover — that reads any mark out in words.
 */

export interface Slice {
  key: string;
  label: string;
  value: number;
  display: string;
  color: string;
}

/**
 * Part of a whole, as a ring. The centre says the total until a slice is chosen, then that slice;
 * the key underneath names every slice with its share and amount, so no slice is told by colour
 * alone. Slices keep the order they are given — the palette was validated for those neighbours.
 */
export function Donut({
  slices,
  total,
  centre,
  onOpen,
  size = 148,
  thickness = 18,
}: {
  slices: readonly Slice[];
  total: string;
  centre: string;
  /** Makes each key row the way into what it counts; the ring still reads a slice out. */
  onOpen?: (key: string) => void;
  size?: number;
  thickness?: number;
}) {
  const theme = useTheme();
  const [chosen, setChosen] = useState<string | null>(null);
  const sum = slices.reduce((acc, slice) => acc + slice.value, 0) || 1;
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const gap = slices.length > 1 ? 2 : 0;
  const active = slices.find((slice) => slice.key === chosen) ?? null;
  const choose = (key: string) => {
    haptic.selection();
    setChosen((current) => (current === key ? null : key));
  };

  let offset = 0;
  const arcs = slices.map((slice) => {
    const length = (slice.value / sum) * circumference;
    const arc = { slice, dash: Math.max(0.5, length - gap), offset };
    offset += length;
    return arc;
  });

  return (
    <View style={styles.donutRow}>
      <View
        accessible
        accessibilityLabel={`${centre}: ${total}. ${slices
          .map((slice) => `${slice.label} ${Math.round((slice.value / sum) * 100)}%`)
          .join(', ')}`}
        style={{ width: size, height: size }}
      >
        <Svg width={size} height={size}>
          <G rotation={-90} origin={`${size / 2}, ${size / 2}`}>
            {arcs.map(({ slice, dash, offset: start }) => (
              <Circle
                key={slice.key}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={slice.color}
                strokeWidth={thickness}
                strokeDasharray={`${dash} ${circumference}`}
                strokeDashoffset={-start}
                opacity={active && active.key !== slice.key ? 0.3 : 1}
                onPress={() => choose(slice.key)}
              />
            ))}
          </G>
        </Svg>
        <View pointerEvents="none" style={styles.donutCentre}>
          <Text
            numberOfLines={1}
            style={[typeScale.overline, styles.centreLabel, { color: theme.mutedForeground }]}
          >
            {(active?.label ?? centre).toUpperCase()}
          </Text>
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            style={[figure, styles.centreValue, { color: theme.foreground }]}
          >
            {active?.display ?? total}
          </Text>
          {active ? (
            <Text style={[figure, styles.centreShare, { color: theme.mutedForeground }]}>
              {Math.round((active.value / sum) * 100)}%
            </Text>
          ) : null}
        </View>
      </View>

      <View style={styles.key}>
        {slices.map((slice) => {
          const selected = active?.key === slice.key;
          return (
            <PressableScale
              key={slice.key}
              onPress={() => {
                if (!onOpen) return choose(slice.key);
                haptic.selection();
                onOpen(slice.key);
              }}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={`${slice.label}: ${slice.display}, ${Math.round((slice.value / sum) * 100)}%`}
              accessibilityHint={onOpen ? `Opens ${slice.label}` : undefined}
              scaleTo={0.97}
              style={[styles.keyRow, selected && { backgroundColor: theme.muted }]}
            >
              <View style={[styles.keySwatch, { backgroundColor: slice.color }]} />
              <Text
                numberOfLines={1}
                style={[typeScale.caption, styles.keyLabel, { color: theme.foreground }]}
              >
                {slice.label}
              </Text>
              <Text style={[figure, styles.keyShare, { color: theme.mutedForeground }]}>
                {Math.round((slice.value / sum) * 100)}%
              </Text>
              {onOpen ? (
                <Ionicons name="chevron-forward" size={12} color={theme.mutedForeground} />
              ) : null}
            </PressableScale>
          );
        })}
      </View>
    </View>
  );
}

export interface Series {
  key: string;
  label: string;
  color: string;
  /** Oldest first; `x` in epoch milliseconds. */
  points: readonly { x: number; y: number }[];
}

/**
 * Lines over time, on one axis. A touch anywhere on the plot moves a crosshair to the nearest
 * moment and the key above reads every series out there; let go and it rests on the latest.
 *
 * The scale fits the data rather than starting at zero — lines are read by their shape, and a
 * zero floor would flatten two figures near 80k into one line. An optional `reference` draws a
 * level (an average) as a quiet rule, labelled.
 */
export function LineChart({
  series,
  formatY,
  formatX,
  formatAxis = formatY,
  reference,
  height = 150,
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
  const ticks = [maxY - pad, (maxY + minY) / 2, minY + pad];

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

  return (
    <View style={{ gap: spacing.sm }}>
      <View style={styles.readout}>
        <Text style={[figure, styles.readoutDate, { color: theme.mutedForeground }]}>
          {formatX(at).toUpperCase()}
        </Text>
        {reading.map(({ line, point }) => (
          <View key={line.key} style={styles.readoutItem}>
            <View style={[styles.keySwatch, { backgroundColor: line.color }]} />
            <Text style={[typeScale.caption, { color: theme.mutedForeground }]}>{line.label}</Text>
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
            {area && series.length === 1 && series[0]!.points.length > 1 ? (
              <Path
                d={`${series[0]!.points
                  .map(
                    (point, index) =>
                      `${index === 0 ? 'M' : 'L'}${toX(point.x).toFixed(1)} ${toY(point.y).toFixed(1)}`,
                  )
                  .join(' ')} L${toX(series[0]!.points[series[0]!.points.length - 1]!.x)} ${
                  top + plotHeight
                } L${toX(series[0]!.points[0]!.x)} ${top + plotHeight} Z`}
                fill={series[0]!.color}
                opacity={0.12}
              />
            ) : null}
            {series.map((line) => (
              <Path
                key={line.key}
                d={line.points
                  .map(
                    (point, index) =>
                      `${index === 0 ? 'M' : 'L'}${toX(point.x).toFixed(1)} ${toY(point.y).toFixed(1)}`,
                  )
                  .join(' ')}
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
        <Text style={[figure, styles.xLabel, { color: theme.mutedForeground }]}>
          {formatX(minX).toUpperCase()}
        </Text>
        {reference ? (
          <Text style={[figure, styles.xLabel, { color: theme.mutedForeground }]}>
            ┄ {reference.label}
          </Text>
        ) : null}
        <Text style={[figure, styles.xLabel, { color: theme.mutedForeground, marginRight: 44 }]}>
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
 * Columns over time: one series, several stacked, or two side by side (`group`). A tap reads a
 * column out in the header — its period, its total and each series beside its swatch — and a
 * second tap lets go, back to the window's total. A quiet period is a hairline, not a gap:
 * nothing spent and nothing known are opposites.
 */
export function ColumnChart({
  buckets,
  series,
  mode = 'stack',
  format,
  formatAxis = format,
  caption,
  height = 120,
}: {
  buckets: readonly ColumnBucket[];
  series: readonly { key: string; label: string; color: string }[];
  mode?: 'stack' | 'group';
  format: (value: number) => string;
  formatAxis?: (value: number) => string;
  caption: string;
  height?: number;
}) {
  const theme = useTheme();
  const [chosen, setChosen] = useState<number | null>(null);
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
        : totals.reduce((sum, value) => sum + value, 0);

  return (
    <View style={{ gap: spacing.sm }}>
      <View style={{ gap: 2 }}>
        <Text style={[typeScale.caption, { color: theme.mutedForeground }]}>
          {shown ? shown.long : caption}
        </Text>
        <Text style={[figure, styles.headline, { color: theme.foreground }]}>
          {format(headline)}
        </Text>
        {series.length > 1 ? (
          <View style={styles.readout}>
            {series.map((line) => (
              <View key={line.key} style={styles.readoutItem}>
                <View style={[styles.keySwatch, { backgroundColor: line.color }]} />
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
        {[1, 0.5].map((share) => (
          <View
            key={share}
            pointerEvents="none"
            style={[styles.gridRow, { top: (1 - share) * height }]}
          >
            <View
              style={{
                flex: 1,
                height: StyleSheet.hairlineWidth * 2,
                backgroundColor: theme.border,
              }}
            />
            <Text style={[figure, styles.gridLabel, { color: theme.mutedForeground }]}>
              {formatAxis(peak * share)}
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
                style={[styles.column, { opacity: chosen !== null && !selected ? 0.4 : 1 }]}
              >
                <View
                  style={[
                    styles.stack,
                    { flexDirection: mode === 'stack' ? 'column-reverse' : 'row' },
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
                </View>
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

/** Magnitudes compared, largest first: label and figure, then a bar against the largest or `max`. */
export function RankBars({
  rows,
  max,
}: {
  rows: readonly {
    key: string;
    label: string;
    note?: string;
    value: number;
    display: string;
    color: string;
  }[];
  max?: number;
}) {
  const theme = useTheme();
  const top = max ?? (Math.max(...rows.map((row) => row.value), 0) || 1);
  return (
    <View style={{ gap: 12 }}>
      {rows.map((row) => (
        <View
          key={row.key}
          accessible
          accessibilityLabel={`${row.label}: ${row.display}${row.note ? `, ${row.note}` : ''}`}
          style={{ gap: 5 }}
        >
          <View style={styles.between}>
            <Text numberOfLines={1} style={[typeScale.label, { flex: 1, color: theme.foreground }]}>
              {row.label}
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
          {row.note ? (
            <Text numberOfLines={1} style={[typeScale.caption, { color: theme.mutedForeground }]}>
              {row.note}
            </Text>
          ) : null}
        </View>
      ))}
    </View>
  );
}

/** A whole in two or three parts, side by side with a gap of card between, and a key with figures. */
export function SplitBar({ parts }: { parts: readonly Slice[] }) {
  const theme = useTheme();
  const total = parts.reduce((sum, part) => sum + part.value, 0) || 1;
  return (
    <View style={{ gap: spacing.sm }}>
      <View style={styles.split}>
        {parts.map((part) => (
          <View
            key={part.key}
            style={{ flex: part.value / total, backgroundColor: part.color, borderRadius: 3 }}
          />
        ))}
      </View>
      <View style={{ gap: 6 }}>
        {parts.map((part) => (
          <View key={part.key} style={styles.between}>
            <View style={[styles.keySwatch, { backgroundColor: part.color }]} />
            <Text
              numberOfLines={1}
              style={[typeScale.caption, { flex: 1, color: theme.mutedForeground }]}
            >
              {part.label}
            </Text>
            <Text style={[figure, styles.readoutValue, { color: theme.foreground }]}>
              {part.display}
              <Text style={{ color: theme.mutedForeground }}>
                {'  '}
                {Math.round((part.value / total) * 100)}%
              </Text>
            </Text>
          </View>
        ))}
      </View>
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
  donutRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  donutCentre: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 26,
  },
  centreLabel: { fontSize: 9, lineHeight: 12 },
  centreValue: { fontSize: 17, lineHeight: 21, fontWeight: '700' },
  centreShare: { fontSize: 11, fontWeight: '600' },
  key: { flex: 1, minWidth: 0, gap: 2 },
  keyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 6,
    paddingVertical: 5,
    borderRadius: 8,
  },
  keySwatch: { width: 9, height: 9, borderRadius: 3 },
  keyLabel: { flex: 1, fontWeight: '600' },
  keyShare: { fontSize: 11, fontWeight: '700' },
  readout: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: 12,
    rowGap: 4,
  },
  readoutDate: { fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  readoutItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  readoutValue: { fontSize: 12, fontWeight: '700' },
  yLabel: { position: 'absolute', right: 0, width: 40, fontSize: 9, textAlign: 'right' },
  xAxis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: -4 },
  xLabel: { fontSize: 9, fontWeight: '600' },
  columns: { flexDirection: 'row', alignItems: 'flex-end', gap: 4, paddingRight: 40 },
  column: { flex: 1, height: '100%', alignItems: 'center', justifyContent: 'flex-end' },
  ticks: { flexDirection: 'row', gap: 4, paddingRight: 40, marginTop: 4 },
  headline: { fontSize: 22, lineHeight: 27, fontWeight: '700' },
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
  },
  quiet: { width: '100%', height: 2, borderRadius: 1, alignSelf: 'flex-end' },
  tick: { flex: 1, fontSize: 9, fontWeight: '600', textAlign: 'center' },
  track: { height: 6, borderRadius: 999, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 999 },
  split: { flexDirection: 'row', gap: 2, height: 10 },
});
