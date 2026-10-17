import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useEffect, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Animated,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type DimensionValue,
  type PressableProps,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { avatarFor } from '@vehicle-os/contracts';
import Svg, { Circle, Defs, Mask, Pattern, RadialGradient, Rect, Stop } from 'react-native-svg';
import { ease, PressableScale, useReduceMotion } from './motion';
import { figure, lift, radius, rimmed, spacing, typeScale, useTheme } from './theme';

/**
 * The handful of primitives every screen uses: the web's materials — the resting card, the copper
 * key, the muted secondary, the field with its ring and halo — carried into `StyleSheet` objects.
 */

/**
 * Someone's face: the DiceBear picture they chose, else the one their account id draws. Round,
 * unless `radius` squares it off — an ID photo.
 */
export function Face({
  user,
  size,
  radius: corner,
}: {
  user: { id: string; image: string | null } | undefined;
  size: number;
  radius?: number;
}) {
  const theme = useTheme();
  return (
    <Image
      source={user ? { uri: avatarFor(user) } : null}
      style={{
        width: size,
        height: size,
        borderRadius: corner ?? size / 2,
        backgroundColor: theme.primarySoft,
      }}
      contentFit="cover"
      cachePolicy="disk"
      transition={150}
      accessibilityIgnoresInvertColors
    />
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const theme = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: theme.card }, rimmed(theme), style]}>
      {children}
    </View>
  );
}

/**
 * A tappable card: the whole surface is the target, and it gives under the thumb — the web card's
 * `active:scale-[0.99]`. For cards that open something; one that does nothing stays `Card`.
 */
export function PressableCard({
  onPress,
  accessibilityLabel,
  children,
  style,
}: {
  onPress: () => void;
  accessibilityLabel: string;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      scaleTo={0.985}
      style={[styles.card, { backgroundColor: theme.card }, rimmed(theme), style]}
    >
      {children}
    </PressableScale>
  );
}

export function Title({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return (
    <Text accessibilityRole="header" style={[typeScale.title, { color: theme.foreground }]}>
      {children}
    </Text>
  );
}

export function Body({ children, muted }: { children: ReactNode; muted?: boolean }) {
  const theme = useTheme();
  return (
    <Text style={[typeScale.body, { color: muted ? theme.mutedForeground : theme.foreground }]}>
      {children}
    </Text>
  );
}

export function Caption({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return <Text style={[typeScale.caption, { color: theme.mutedForeground }]}>{children}</Text>;
}

const LIP = 2;
const AnimatedView = Animated.View;

/**
 * The web's `.key`: one flat copper face whose weight comes from light, not glow — a lit top edge,
 * a darker lip under it and a neutral contact shadow. Pressed, the face sinks onto its lip and the
 * lip is gone, so it travels like a key instead of shrinking like a picture of one. Disabled, it
 * goes flat: a key you cannot press should not look like one.
 *
 * The lip is the ground under the face, drawn in the edge colour and showing below it; the face
 * slides down over it on press. The container never changes size, so nothing around it moves.
 */
export function Key({
  onPress,
  onLongPress,
  delayLongPress,
  disabled = false,
  busy = false,
  radius: corner = radius.xl,
  style,
  faceStyle,
  children,
  ...a11y
}: {
  onPress?: () => void;
  onLongPress?: PressableProps['onLongPress'];
  delayLongPress?: number;
  disabled?: boolean;
  busy?: boolean;
  radius?: number;
  style?: StyleProp<ViewStyle>;
  faceStyle?: StyleProp<ViewStyle>;
  children: ReactNode;
} & Pick<
  PressableProps,
  | 'accessibilityLabel'
  | 'accessibilityHint'
  | 'accessibilityState'
  | 'accessibilityRole'
  | 'hitSlop'
>) {
  const theme = useTheme();
  const reduce = useReduceMotion();
  const [press] = useState(() => new Animated.Value(0));
  const live = !disabled && !busy;
  const sink = (to: 0 | 1) => {
    if (reduce) return press.setValue(to);
    Animated.timing(press, {
      toValue: to,
      duration: to ? 60 : 160,
      easing: ease.out,
      useNativeDriver: true,
    }).start();
  };

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={delayLongPress}
      disabled={!live}
      onPressIn={() => sink(1)}
      onPressOut={() => sink(0)}
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled, busy }}
      {...a11y}
      style={[
        {
          borderRadius: corner,
          paddingBottom: live ? LIP : 0,
          backgroundColor: live ? theme.primaryEdge : 'transparent',
          opacity: disabled ? 0.5 : 1,
        },
        live
          ? {
              shadowColor: theme.shadow,
              shadowOpacity: theme.dark ? 0.55 : 0.22,
              shadowRadius: 7,
              shadowOffset: { width: 0, height: 4 },
              elevation: 4,
            }
          : null,
        style,
      ]}
    >
      <AnimatedView
        style={[
          styles.keyFace,
          {
            borderRadius: corner,
            backgroundColor: theme.primary,
            borderColor: theme.primaryEdge,
            // The lit top edge: the sheen catching the light.
            borderTopColor: theme.primarySheen,
            transform: [
              { translateY: press.interpolate({ inputRange: [0, 1], outputRange: [0, LIP] }) },
            ],
          },
          faceStyle,
        ]}
      >
        {children}
      </AnimatedView>
    </Pressable>
  );
}

/**
 * The button, as the web sizes it: `md` 44pt with the web's 16pt corners, `lg` 52pt for the one
 * action at the foot of a form, `sm` for rows. Primary is the copper key; secondary the muted fill
 * with a hairline; ghost only words; danger the red.
 */
export function Button({
  label,
  onPress,
  variant = 'secondary',
  size = 'md',
  icon,
  disabled,
  loading,
  a11yLabel,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  /** `xs` is a row's own action: small enough to sit beside the words it acts on. */
  size?: 'xs' | 'sm' | 'md' | 'lg';
  icon?: keyof typeof Ionicons.glyphMap;
  disabled?: boolean;
  loading?: boolean;
  /** What a screen reader says, where the label alone ("Log") needs the row's name. */
  a11yLabel?: string;
}) {
  const theme = useTheme();
  const shape = SIZES[size];
  const color = {
    primary: theme.primaryForeground,
    danger: theme.destructiveForeground,
    secondary: theme.foreground,
    ghost: theme.mutedForeground,
  }[variant];
  const inside = loading ? (
    <ActivityIndicator color={color} />
  ) : (
    <>
      {icon ? (
        <Ionicons name={icon} size={size === 'xs' ? 13 : size === 'sm' ? 15 : 17} color={color} />
      ) : null}
      <Text
        numberOfLines={1}
        style={[
          size === 'lg' ? typeScale.headline : size === 'xs' ? styles.xsLabel : typeScale.label,
          { color, fontWeight: '600' },
        ]}
      >
        {label}
      </Text>
    </>
  );

  if (variant === 'primary') {
    return (
      <Key
        onPress={onPress}
        disabled={disabled}
        busy={loading}
        radius={shape.borderRadius}
        accessibilityLabel={a11yLabel ?? label}
        faceStyle={[styles.buttonFace, shape]}
      >
        {inside}
      </Key>
    );
  }

  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled || loading}
      scaleTo={0.97}
      style={[
        styles.buttonFace,
        shape,
        variant === 'secondary'
          ? { backgroundColor: theme.muted, borderWidth: 1, borderColor: theme.border }
          : variant === 'danger'
            ? { backgroundColor: theme.destructive }
            : null,
        { opacity: disabled ? 0.5 : 1 },
      ]}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel ?? label}
      accessibilityState={{ disabled: Boolean(disabled), busy: Boolean(loading) }}
    >
      {inside}
    </PressableScale>
  );
}

const SIZES = {
  xs: { minHeight: 30, borderRadius: radius.md, paddingHorizontal: 10, gap: 5 },
  sm: { minHeight: 36, borderRadius: radius.md, paddingHorizontal: spacing.md },
  md: { minHeight: 44, borderRadius: radius.xl, paddingHorizontal: spacing.lg },
  lg: { minHeight: 52, borderRadius: radius.xxl, paddingHorizontal: spacing.xl },
} as const;

/** A round icon-only control: back, close, more, bell. Drawn small, touched at 44. */
export function IconButton({
  icon,
  onPress,
  label,
  tone = 'muted',
  size = 40,
  children,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  label: string;
  tone?: 'muted' | 'card' | 'primary' | 'ghost';
  size?: number;
  children?: ReactNode;
}) {
  const theme = useTheme();
  const glyph = (color: string) => (
    <Ionicons name={icon} size={Math.round(size * 0.46)} color={color} />
  );
  const slop = Math.max(0, (44 - size) / 2);

  if (tone === 'primary') {
    return (
      <Key
        onPress={onPress}
        radius={size / 2}
        hitSlop={slop}
        accessibilityLabel={label}
        faceStyle={{ width: size, height: size - LIP }}
      >
        {glyph(theme.primaryForeground)}
        {children}
      </Key>
    );
  }

  return (
    <PressableScale
      onPress={onPress}
      hitSlop={slop}
      accessibilityRole="button"
      accessibilityLabel={label}
      scaleTo={0.88}
      style={[
        styles.iconButton,
        { width: size, height: size },
        tone === 'muted'
          ? { backgroundColor: theme.muted }
          : tone === 'card'
            ? [{ backgroundColor: theme.card }, rimmed(theme)]
            : null,
      ]}
    >
      {glyph(tone === 'ghost' ? theme.mutedForeground : theme.foreground)}
      {children}
    </PressableScale>
  );
}

/**
 * A field as the web draws one: the input fill with a hairline at rest; focused, a crisp line in
 * the ring colour inside a soft copper halo — the halo a wrapper, so nothing inside moves.
 */
export function Field({
  label,
  hint,
  error,
  ...props
}: TextInputProps & { label: string; hint?: string; error?: string }) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ gap: spacing.xs + 2 }}>
      <Text style={[typeScale.label, { color: theme.foreground }]}>{label}</Text>
      <View
        style={[
          styles.halo,
          { backgroundColor: focused && !error ? theme.primarySoft : 'transparent' },
        ]}
      >
        <TextInput
          placeholderTextColor={theme.mutedForeground}
          style={[
            styles.input,
            {
              backgroundColor: theme.input,
              color: theme.foreground,
              borderColor: error ? theme.destructive : focused ? theme.ring : theme.borderStrong,
            },
          ]}
          accessibilityLabel={label}
          // The visible hint and error are separate `Text`s a screen reader never links to the
          // input; as its hint they are read out when the field is focused.
          accessibilityHint={error ?? hint}
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
      {error ? (
        <Text
          // Announced when it appears, not only when someone happens to swipe onto it.
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          style={[typeScale.caption, { color: theme.destructive }]}
        >
          {error}
        </Text>
      ) : hint ? (
        <Text style={[typeScale.caption, { color: theme.mutedForeground }]}>{hint}</Text>
      ) : null}
    </View>
  );
}

export function Stat({
  label,
  value,
}: {
  label: string;
  /** `undefined` while it loads: the label is known up front, only the figure waits. */
  value: string | undefined;
}) {
  const theme = useTheme();
  return (
    <View style={{ flex: 1, minWidth: 90, gap: 4 }}>
      <Text style={[typeScale.overline, { color: theme.mutedForeground }]}>{label}</Text>
      {value === undefined ? (
        <Skeleton width={64} height={22} />
      ) : (
        <Text style={[typeScale.headline, figure, { color: theme.foreground }]}>{value}</Text>
      )}
    </View>
  );
}

/**
 * A placeholder for data that has not arrived — never for a heading or a label, which are the
 * same before and after the request and are drawn as real text straight away.
 *
 * The web's `animate-pulse`: a muted block breathing between full and half strength over two
 * seconds. Still under reduce motion.
 */
export function Skeleton({
  width,
  height,
  radius: cornerRadius = radius.sm,
  style,
}: {
  width?: DimensionValue;
  height?: DimensionValue;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const reduce = useReduceMotion();
  const [opacity] = useState(() => new Animated.Value(1));

  useEffect(() => {
    if (reduce) {
      opacity.setValue(1);
      return;
    }
    const half = (toValue: number) =>
      Animated.timing(opacity, {
        toValue,
        duration: 1000,
        easing: ease.inOut,
        useNativeDriver: true,
      });
    const loop = Animated.loop(Animated.sequence([half(0.5), half(1)]));
    loop.start();
    return () => loop.stop();
  }, [opacity, reduce]);

  return (
    <Animated.View
      // Decorative: the screen's own progress label announces the loading, once.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        { width, height, borderRadius: cornerRadius, backgroundColor: theme.muted, opacity },
        style,
      ]}
    />
  );
}

/**
 * The web's ground: workshop graph paper — a fine dot grid behind a panel, strongest in one corner
 * and gone before it reaches the words. Absolutely fills its parent; put it first.
 */
export function Ground({ cx = '100%', cy = '100%' }: { cx?: string; cy?: string }) {
  const theme = useTheme();
  return (
    <Svg
      pointerEvents="none"
      style={StyleSheet.absoluteFill}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Defs>
        <Pattern id="dots" width={16} height={16} patternUnits="userSpaceOnUse">
          <Circle cx={8} cy={8} r={1} fill={theme.borderStrong} />
        </Pattern>
        <RadialGradient id="fade" cx={cx} cy={cy} rx="90%" ry="120%" fx={cx} fy={cy}>
          <Stop offset="0" stopColor="#ffffff" stopOpacity={1} />
          <Stop offset="0.6" stopColor="#ffffff" stopOpacity={0} />
        </RadialGradient>
        <Mask id="reach">
          <Rect width="100%" height="100%" fill="url(#fade)" />
        </Mask>
      </Defs>
      <Rect width="100%" height="100%" fill="url(#dots)" mask="url(#reach)" opacity={0.6} />
    </Svg>
  );
}

/**
 * A tab's large title: a label-style eyebrow, the title with its count beside it in figures, and
 * actions on the right. With `y` (from `useScrollY`) it lifts and fades as the page scrolls and
 * stretches a little on an overscroll pull — `CompactHeader` takes over above it.
 */
export function LargeHeader({
  eyebrow,
  title,
  count,
  actions,
  y,
}: {
  eyebrow?: string;
  title: string;
  count?: number;
  actions?: ReactNode;
  y?: Animated.Value;
}) {
  const theme = useTheme();
  const motion = y
    ? {
        opacity: y.interpolate({ inputRange: [0, 56], outputRange: [1, 0], extrapolate: 'clamp' }),
        transform: [
          {
            scale: y.interpolate({
              inputRange: [-120, 0],
              outputRange: [1.1, 1],
              extrapolate: 'clamp',
            }),
          },
          {
            translateY: y.interpolate({
              inputRange: [0, 56],
              outputRange: [0, -8],
              extrapolate: 'clamp',
            }),
          },
        ],
      }
    : null;
  return (
    <View style={styles.largeHeader}>
      <Animated.View style={[{ flex: 1, minWidth: 0, transformOrigin: 'left' }, motion]}>
        {eyebrow ? (
          <Text numberOfLines={1} style={[typeScale.overline, { color: theme.mutedForeground }]}>
            {eyebrow}
          </Text>
        ) : null}
        <View style={styles.titleRow}>
          <Text
            accessibilityRole="header"
            numberOfLines={1}
            style={[typeScale.display, { color: theme.foreground, flexShrink: 1 }]}
          >
            {title}
          </Text>
          {count !== undefined ? (
            <Text style={[figure, styles.count, { color: theme.mutedForeground }]}>
              {String(count).padStart(2, '0')}
            </Text>
          ) : null}
        </View>
      </Animated.View>
      {actions ? <View style={styles.actions}>{actions}</View> : null}
    </View>
  );
}

/**
 * The web's `header-scroll`: once the large title has gone, a bar fades in over the top of the tab
 * in the page's colour with a hairline and a soft shadow, so the page still says where you are.
 * Absolutely positioned; render it after the scroller.
 */
export function CompactHeader({ title, y }: { title: string; y: Animated.Value }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Animated.View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.compact,
        lift(theme, 'low'),
        {
          paddingTop: insets.top,
          backgroundColor: `${theme.background}E6`,
          borderBottomColor: theme.border,
          opacity: y.interpolate({
            inputRange: [32, 64],
            outputRange: [0, 1],
            extrapolate: 'clamp',
          }),
        },
      ]}
    >
      <Animated.Text
        style={[
          typeScale.label,
          {
            color: theme.foreground,
            transform: [
              {
                translateY: y.interpolate({
                  inputRange: [32, 64],
                  outputRange: [6, 0],
                  extrapolate: 'clamp',
                }),
              },
            ],
          },
        ]}
      >
        {title}
      </Animated.Text>
    </Animated.View>
  );
}

export function Loading({ label }: { label: string }) {
  const theme = useTheme();
  return (
    <View style={styles.centered} accessibilityLabel={label} accessibilityRole="progressbar">
      <ActivityIndicator color={theme.primary} />
    </View>
  );
}

/** The web's `EmptyState`: a resting card, a title, a line, and the one way forward. */
export function Empty({
  title,
  description,
  icon,
  action,
}: {
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
}) {
  const theme = useTheme();
  return (
    <View style={styles.emptyScreen}>
      <View style={[styles.empty, { backgroundColor: theme.card }, rimmed(theme)]}>
        {icon ? <View style={{ marginBottom: spacing.sm }}>{icon}</View> : null}
        <Text style={[typeScale.headline, { color: theme.foreground, textAlign: 'center' }]}>
          {title}
        </Text>
        {description ? (
          <Text
            style={[
              typeScale.label,
              { fontWeight: '400', color: theme.mutedForeground, textAlign: 'center' },
            ]}
          >
            {description}
          </Text>
        ) : null}
        {action ? <View style={{ marginTop: spacing.lg }}>{action}</View> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.xxl, padding: spacing.lg },
  keyFace: {
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  xsLabel: { fontSize: 12, lineHeight: 16 },
  buttonFace: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconButton: { borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  halo: { borderRadius: radius.xl + 4, padding: 3, margin: -3 },
  input: {
    minHeight: 48,
    borderRadius: radius.xl,
    borderWidth: 1,
    paddingHorizontal: spacing.md + 2,
    fontSize: 16,
  },
  largeHeader: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.md,
    paddingTop: spacing.sm,
  },
  titleRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm, marginTop: 4 },
  count: { fontSize: 14, lineHeight: 18, fontWeight: '500' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingBottom: 2 },
  compact: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  emptyScreen: { flex: 1, justifyContent: 'center', padding: spacing.lg },
  empty: {
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radius.xxl,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xxl + 8,
  },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
