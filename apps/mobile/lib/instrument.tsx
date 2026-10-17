import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Animated,
  StyleSheet,
  Text,
  TextInput,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
} from 'react-native';
import { SvgXml } from 'react-native-svg';
import { EMOJI_ART } from './emoji-art';
import { ICON_ART, type IconName } from './icon-art';
import { haptic, PressableScale, Pulse, spring, useReduceMotion } from './motion';
import { Skeleton } from './ui';
import { figure, radius, spacing, typeScale, useTheme } from './theme';

/**
 * The instrument pieces, as the web draws them: the uppercase label, a section heading with its
 * count, filter chips, the segmented track with a copper pill that slides, readings panels with
 * hairlines between cells, the field a new entry's title is typed into, a tinted tile for a row's
 * glyph — and the glyph itself, in the web's own Fluent Emoji artwork.
 */

export type Tone = 'destructive' | 'warning' | 'success' | 'neutral';

export function useToneColors(tone: Tone) {
  const theme = useTheme();
  switch (tone) {
    case 'destructive':
      return { soft: theme.destructiveSoft, strong: theme.destructive };
    case 'warning':
      return { soft: theme.warningSoft, strong: theme.warning };
    case 'success':
      return { soft: theme.successSoft, strong: theme.success };
    default:
      return { soft: theme.muted, strong: theme.mutedForeground };
  }
}

/** The web's `text-label`: small, uppercase, tracked out. */
export function Eyebrow({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<TextStyle>;
}) {
  const theme = useTheme();
  return (
    <Text numberOfLines={1} style={[typeScale.overline, { color: theme.mutedForeground }, style]}>
      {children}
    </Text>
  );
}

/**
 * A section's title with its count beside it in figures, and its one way onward — the web's
 * `SectionHeading`: type alone, no pill, no rule, one height whether or not there is an action.
 */
export function SectionHeading({
  title,
  count,
  trailing,
}: {
  title: string;
  count?: number;
  trailing?: ReactNode;
}) {
  const theme = useTheme();
  return (
    <View style={styles.heading}>
      <View style={styles.baseline}>
        <Text
          accessibilityRole="header"
          numberOfLines={1}
          style={[typeScale.title, { flexShrink: 1, color: theme.foreground }]}
        >
          {title}
        </Text>
        {count !== undefined ? (
          <Text style={[figure, styles.headingCount, { color: theme.mutedForeground }]}>
            {String(count).padStart(2, '0')}
          </Text>
        ) : null}
      </View>
      {trailing}
    </View>
  );
}

/** The web's `SectionLink`: words and an arrow, a full 32pt tall. */
export function SectionLink({
  label,
  onPress,
  a11yLabel,
}: {
  label: string;
  onPress: () => void;
  a11yLabel?: string;
}) {
  const theme = useTheme();
  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel ?? label}
      hitSlop={8}
      scaleTo={0.94}
      style={styles.sectionLink}
    >
      <Text style={[typeScale.label, { fontWeight: '500', color: theme.mutedForeground }]}>
        {label}
      </Text>
      <Ionicons name="arrow-forward" size={14} color={theme.mutedForeground} />
    </PressableScale>
  );
}

/**
 * The web's filter chip: copper when chosen, muted when not, its count in figures. `compact` is the
 * small one, for a filter row over a list; its touch area still reaches 44pt tall.
 */
export function Chip({
  label,
  selected,
  onPress,
  leading,
  count,
  compact = false,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  leading?: ReactNode;
  count?: number;
  compact?: boolean;
}) {
  const theme = useTheme();
  const ink = selected ? theme.primaryForeground : theme.mutedForeground;
  return (
    <PressableScale
      onPress={() => {
        if (!selected) haptic.selection();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={count === undefined ? label : `${label}, ${count}`}
      hitSlop={compact ? { top: 8, bottom: 8 } : undefined}
      scaleTo={0.94}
      style={[
        styles.chip,
        compact ? styles.chipCompact : null,
        { backgroundColor: selected ? theme.primary : theme.muted },
      ]}
    >
      {leading}
      <Text
        numberOfLines={1}
        style={[
          typeScale.label,
          compact ? styles.chipCompactLabel : null,
          { maxWidth: 160, color: selected ? ink : theme.foreground },
        ]}
      >
        {label}
      </Text>
      {count !== undefined ? (
        <Text
          style={[
            typeScale.caption,
            figure,
            compact ? styles.chipCompactCount : null,
            { color: ink, opacity: 0.75 },
          ]}
        >
          {count}
        </Text>
      ) : null}
    </PressableScale>
  );
}

/**
 * The web's navigation track: one rounded track on a resting card, and a copper-wash pill that
 * glides to the chosen side on the web nav's spring, so the move reads as a change of place.
 * `small` is the short one, for a track that sits beside another.
 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  small = false,
}: {
  value: T;
  options: readonly { readonly value: T; readonly label: string; readonly said?: string }[];
  onChange: (value: T) => void;
  small?: boolean;
}) {
  const theme = useTheme();
  const reduce = useReduceMotion();
  const [width, setWidth] = useState(0);
  const [x] = useState(() => new Animated.Value(0));
  const placed = useRef(false);
  const index = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const slot = width > 0 ? (width - SEGMENT_PAD * 2) / options.length : 0;

  useEffect(() => {
    if (!slot) return;
    const target = index * slot;
    if (reduce || !placed.current) {
      placed.current = true;
      x.setValue(target);
      return;
    }
    const animation = Animated.spring(x, {
      toValue: target,
      useNativeDriver: true,
      ...spring.glide,
    });
    animation.start();
    return () => animation.stop();
  }, [index, slot, reduce, x]);

  return (
    <View
      onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)}
      style={[styles.segmented, { backgroundColor: theme.card, borderColor: theme.hairline }]}
    >
      {slot ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.thumb,
            { width: slot, backgroundColor: theme.primarySoft, transform: [{ translateX: x }] },
          ]}
        />
      ) : null}
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <PressableScale
            key={option.value}
            onPress={() => {
              if (!selected) haptic.selection();
              onChange(option.value);
            }}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={option.said ?? option.label}
            scaleTo={0.95}
            style={[styles.segment, small ? styles.segmentSmall : null]}
          >
            <Text
              numberOfLines={1}
              style={[
                typeScale.label,
                small ? styles.segmentSmallLabel : null,
                { color: selected ? theme.foreground : theme.mutedForeground },
              ]}
            >
              {option.label}
            </Text>
          </PressableScale>
        );
      })}
    </View>
  );
}

/**
 * Readings off one object, in one panel: cells with hairlines between them — the web's `Readings`,
 * `gap-px` over a border-coloured ground. `row` sets them side by side; the default stacks them.
 */
export function Panel({
  children,
  direction = 'column',
}: {
  children: ReactNode;
  direction?: 'row' | 'column';
}) {
  const theme = useTheme();
  return (
    <View
      style={{
        flexDirection: direction,
        gap: StyleSheet.hairlineWidth,
        borderRadius: radius.xxl,
        overflow: 'hidden',
        backgroundColor: theme.border,
      }}
    >
      {children}
    </View>
  );
}

/**
 * One cell of a panel: the label, what it reads, and a live line under it. A `warning` note
 * carries its colour on a dot as well as in its words.
 */
export function PanelCell({
  label,
  children,
  note,
  noteTone,
  inline = false,
}: {
  label: string;
  children: ReactNode;
  note?: ReactNode;
  noteTone?: 'warning' | 'destructive';
  /** Label and note on the left, the reading on the right — a stacked panel's row. */
  inline?: boolean;
}) {
  const theme = useTheme();
  const noteNode =
    note === undefined ? null : typeof note === 'string' ? (
      <View style={styles.noteRow}>
        {noteTone ? (
          <View
            style={[
              styles.dot,
              { backgroundColor: noteTone === 'warning' ? theme.warning : theme.destructive },
            ]}
          />
        ) : null}
        <Text
          numberOfLines={1}
          style={[
            typeScale.caption,
            {
              flexShrink: 1,
              color: noteTone === 'destructive' ? theme.destructive : theme.mutedForeground,
            },
          ]}
        >
          {note}
        </Text>
      </View>
    ) : (
      note
    );

  if (inline) {
    return (
      <View style={[styles.cell, styles.inlineCell, { backgroundColor: theme.cardRaised }]}>
        <View style={{ flexShrink: 1, gap: 3 }}>
          <Eyebrow>{label}</Eyebrow>
          {noteNode}
        </View>
        <View style={{ flexShrink: 0, maxWidth: '62%' }}>{children}</View>
      </View>
    );
  }

  return (
    <View style={[styles.cell, { backgroundColor: theme.cardRaised }]}>
      <Eyebrow>{label}</Eyebrow>
      {children}
      {noteNode}
    </View>
  );
}

/**
 * One headline figure of a cluster: the label, the number, and a line saying what it is of.
 * `value: undefined` is the loading state — the label is drawn at once, only the figure waits.
 * `tone` is a colour, because what counts as bad differs per reading.
 */
export function Reading({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string | undefined;
  note?: string;
  tone?: string;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.reading, { backgroundColor: theme.cardRaised }]}>
      <Eyebrow>{label}</Eyebrow>
      {value === undefined ? (
        <Skeleton width={56} height={26} />
      ) : (
        <Text
          numberOfLines={1}
          adjustsFontSizeToFit
          style={[figure, styles.readingValue, { color: tone ?? theme.foreground }]}
        >
          {value}
        </Text>
      )}
      {note === undefined ? null : (
        <Text numberOfLines={1} style={[typeScale.caption, { color: theme.mutedForeground }]}>
          {note}
        </Text>
      )}
    </View>
  );
}

/** The large figure inside a panel cell. */
export function Figure({
  children,
  size = 'large',
}: {
  children: ReactNode;
  size?: 'large' | 'medium';
}) {
  const theme = useTheme();
  return (
    <Text
      numberOfLines={1}
      adjustsFontSizeToFit
      style={[
        figure,
        size === 'large'
          ? { fontSize: 22, lineHeight: 28, fontWeight: '600', letterSpacing: -0.8 }
          : { fontSize: 16, lineHeight: 21, fontWeight: '600', letterSpacing: -0.4 },
        { color: theme.foreground },
      ]}
    >
      {children}
    </Text>
  );
}

/** A figure you type into: the same mono reading, with its unit beside it. */
export function FigureInput({ unit, ...props }: TextInputProps & { unit?: string }) {
  const theme = useTheme();
  return (
    <View style={styles.figureInput}>
      <TextInput
        placeholderTextColor={theme.borderStrong}
        style={[
          figure,
          {
            flex: 1,
            fontSize: 22,
            lineHeight: 28,
            fontWeight: '600',
            letterSpacing: -0.8,
            color: theme.foreground,
            padding: 0,
          },
        ]}
        {...props}
      />
      {unit ? (
        <Text style={[typeScale.caption, figure, { color: theme.mutedForeground }]}>{unit}</Text>
      ) : null}
    </View>
  );
}

/**
 * The title of a new entry, set as the line it will become: large, on its own surface, with the
 * label inside it. Focused, the web field's ring: a crisp line in the ring colour.
 */
export function Headline({
  label,
  error,
  note,
  ...props
}: TextInputProps & { label: string; error?: string; note?: string }) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ gap: spacing.xs }}>
      <View
        style={[
          styles.headline,
          {
            backgroundColor: theme.cardRaised,
            borderColor: error ? theme.destructive : focused ? theme.ring : theme.border,
          },
        ]}
      >
        <Eyebrow>{label}</Eyebrow>
        <TextInput
          placeholderTextColor={theme.borderStrong}
          accessibilityLabel={label}
          accessibilityHint={error ?? note}
          maxLength={200}
          style={[
            typeScale.title,
            { fontSize: 20, color: theme.foreground, paddingVertical: 2, paddingHorizontal: 0 },
          ]}
          {...props}
          onFocus={(event) => {
            setFocused(true);
            props.onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            props.onBlur?.(event);
          }}
        />
      </View>
      {error || note ? (
        <Text
          accessibilityLiveRegion="polite"
          style={[
            typeScale.caption,
            { color: error ? theme.destructive : theme.mutedForeground, paddingHorizontal: 4 },
          ]}
        >
          {error ?? note}
        </Text>
      ) : null}
    </View>
  );
}

/** A row's leading slot — the web's `KindIcon` tile: a rounded square, tinted by its tone. */
export function ToneTile({
  tone,
  children,
  size = 44,
  dot = false,
}: {
  tone: Tone;
  children: ReactNode;
  size?: number;
  /** An unread marker at the corner. */
  dot?: boolean;
}) {
  const theme = useTheme();
  const { soft } = useToneColors(tone);
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.34),
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: soft,
      }}
    >
      {children}
      {dot ? (
        <View
          style={{
            position: 'absolute',
            top: -2,
            right: -2,
            width: 12,
            height: 12,
            borderRadius: 999,
            borderWidth: 2,
            borderColor: theme.background,
            backgroundColor: theme.primary,
          }}
        />
      ) : null}
    </View>
  );
}

const VARIATION = /\uFE0F/g;

export type { IconName };

/**
 * An icon from the web's own set — Solar bold-duotone, generated from the same data the web inlines
 * — in the colour it is drawn in: the full-strength layer in that colour, the second at half.
 * Decorative: the control it sits in carries the words.
 */
export function Icon({ name, size = 20, color }: { name: IconName; size?: number; color: string }) {
  const art = ICON_ART[name];
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <SvgXml
        xml={`<svg xmlns='http://www.w3.org/2000/svg' viewBox='${art.viewBox}'>${art.body}</svg>`}
        width={size}
        height={size}
        color={color}
      />
    </View>
  );
}

/**
 * An emoji, in the web's own artwork: the same Fluent Emoji drawing the web inlines for every entry
 * kind, so a fill-up wears the same pump on both. A character outside that set — a one-off in a
 * notification — falls back to the phone's emoji font. Excluded from font scaling either way, so
 * it keeps to its tile.
 */
export function Glyph({ children, size = 22 }: { children: string; size?: number }) {
  const art = EMOJI_ART[children] ?? EMOJI_ART[children.replace(VARIATION, '')];
  if (art) {
    return (
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <SvgXml
          xml={`<svg xmlns='http://www.w3.org/2000/svg' viewBox='${art.viewBox}'>${art.body}</svg>`}
          width={size}
          height={size}
        />
      </View>
    );
  }
  return (
    <Text allowFontScaling={false} style={{ fontSize: size, lineHeight: Math.round(size * 1.25) }}>
      {children}
    </Text>
  );
}

/** A status in words with its colour on a dot — the web's `status-ping` when it is overdue. */
export function StatusDot({ tone, label }: { tone: Tone; label: string }) {
  const theme = useTheme();
  const { strong } = useToneColors(tone);
  return (
    <View style={styles.noteRow}>
      {tone === 'destructive' ? (
        <Pulse color={strong} size={7} />
      ) : (
        <View style={[styles.dot, { backgroundColor: strong }]} />
      )}
      <Text style={[typeScale.caption, { fontWeight: '600', color: theme.mutedForeground }]}>
        {label}
      </Text>
    </View>
  );
}

/** A status named on its own wash — the pairing the contrast tests cover. */
export function ToneChip({ tone, label }: { tone: Tone; label: string }) {
  const { soft, strong } = useToneColors(tone);
  const theme = useTheme();
  return (
    <View style={[styles.toneChip, { backgroundColor: soft }]}>
      <Text
        style={[
          typeScale.caption,
          { fontWeight: '600', color: tone === 'neutral' ? theme.mutedForeground : strong },
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

/** The web's `Marker`: a labelled hairline across a record — "Start of the record". */
export function Marker({ children, emphasis }: { children: ReactNode; emphasis?: boolean }) {
  const theme = useTheme();
  const rule = { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: theme.border };
  return (
    <View style={styles.markerRow}>
      <View style={rule} />
      <View
        style={[
          styles.markerLabel,
          emphasis
            ? { backgroundColor: theme.card, paddingHorizontal: 12, paddingVertical: 6 }
            : null,
        ]}
      >
        {children}
      </View>
      <View style={rule} />
    </View>
  );
}

const SEGMENT_PAD = 4;

const styles = StyleSheet.create({
  heading: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.lg,
  },
  baseline: { flexShrink: 1, flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  headingCount: { fontSize: 14, lineHeight: 18, fontWeight: '500' },
  sectionLink: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginRight: -spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  reading: { flex: 1, minWidth: 0, gap: 6, padding: spacing.lg },
  readingValue: { fontSize: 24, lineHeight: 30, fontWeight: '600', letterSpacing: -0.9 },
  chip: {
    height: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: 14,
    borderRadius: 999,
  },
  chipCompact: { height: 28, gap: 5, paddingHorizontal: 10 },
  chipCompactLabel: { fontSize: 12.5, lineHeight: 16 },
  chipCompactCount: { fontSize: 11, lineHeight: 14 },
  segmented: {
    flexDirection: 'row',
    padding: SEGMENT_PAD,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  thumb: {
    position: 'absolute',
    top: SEGMENT_PAD,
    bottom: SEGMENT_PAD,
    left: SEGMENT_PAD,
    borderRadius: 999,
  },
  segment: {
    flex: 1,
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    paddingHorizontal: spacing.md,
  },
  segmentSmall: { minHeight: 30, paddingHorizontal: 4 },
  segmentSmallLabel: { fontSize: 13, lineHeight: 17 },
  cell: { flex: 1, gap: 4, paddingHorizontal: spacing.lg, paddingVertical: spacing.md + 2 },
  inlineCell: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  figureInput: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  headline: {
    borderRadius: radius.xxl,
    borderWidth: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm + 2,
    gap: 4,
  },
  noteRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 7, height: 7, borderRadius: 999 },
  toneChip: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  markerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  markerLabel: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderRadius: 999 },
});
