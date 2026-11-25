import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Animated, BackHandler, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ease, haptic, PressableScale, useReduceMotion } from './motion';
import { lift, radius, rimmed, spacing, useTheme } from './theme';

/*
 * The app's own pop-up, in place of the phone's alert (user asked: "don't use native"). A card
 * rises from the foot of the screen over a scrim: a mark in the tone of what it asks, the question,
 * a line on what it costs, and the answers as the app's own pill keys — two side by side, more in a
 * column. It is called the way `Alert.alert` is, so a call site changes its name and nothing else.
 *
 * Where it draws: the newest mounted `DialogHost`. One sits over the whole app in the root layout;
 * a sheet that is its own native window (the + drawer) carries one too, so what it asks shows over
 * it rather than behind it.
 */

export interface DialogButton {
  readonly text: string;
  readonly style?: 'default' | 'cancel' | 'destructive';
  readonly onPress?: () => void;
}

export interface DialogOptions {
  /** The mark at its head. By default a bin for a destructive question, a note for the rest. */
  readonly icon?: keyof typeof Ionicons.glyphMap;
  /** Red for something that went wrong; a destructive answer makes it red by itself. */
  readonly tone?: 'destructive';
}

/** For a "Could not …": the mark and colour of something that failed. */
export const FAILED: DialogOptions = { icon: 'alert-circle-outline', tone: 'destructive' };

interface Request {
  readonly id: number;
  readonly title: string;
  readonly message?: string;
  readonly buttons: readonly DialogButton[];
  readonly options: DialogOptions;
}

const hosts: ((request: Request) => void)[] = [];
let made = 0;

/** Asks, as `Alert.alert` would. No answers makes it a notice with one key that closes it. */
export function dialog(
  title: string,
  message?: string,
  buttons?: readonly DialogButton[],
  options: DialogOptions = {},
): void {
  hosts.at(-1)?.({
    id: (made += 1),
    title,
    message,
    buttons: buttons?.length ? buttons : [{ text: 'OK' }],
    options,
  });
}

/** Where dialogs draw: once over the app, and once inside each sheet that is its own window. */
export function DialogHost() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const reduce = useReduceMotion();
  const [request, setRequest] = useState<Request | null>(null);
  const [enter] = useState(() => new Animated.Value(0));

  useEffect(() => {
    const show = (next: Request) => setRequest(next);
    hosts.push(show);
    return () => {
      hosts.splice(hosts.indexOf(show), 1);
    };
  }, []);

  const destructive =
    request?.options.tone === 'destructive' ||
    Boolean(request?.buttons.some((button) => button.style === 'destructive'));

  useEffect(() => {
    if (!request) return;
    if (destructive) haptic.warning();
    if (reduce) return enter.setValue(1);
    enter.setValue(0);
    Animated.spring(enter, { toValue: 1, useNativeDriver: true, speed: 20, bounciness: 5 }).start();
    // A new request is a new card; its tone is read with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.id]);

  // The answer runs once the card has gone, so what it opens next is never drawn under it.
  const answer = (button: DialogButton | undefined) => {
    const done = () => {
      setRequest(null);
      button?.onPress?.();
    };
    if (reduce) return done();
    Animated.timing(enter, {
      toValue: 0,
      duration: 130,
      easing: ease.in,
      useNativeDriver: true,
    }).start(done);
  };

  // Dismissing — the scrim, Android's Back — is the cancel answer, or the only one a notice has.
  const dismissal = request
    ? (request.buttons.find((button) => button.style === 'cancel') ??
      (request.buttons.length === 1 ? request.buttons[0] : undefined))
    : undefined;

  useEffect(() => {
    if (!request) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (dismissal) answer(dismissal);
      return true;
    });
    return () => subscription.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request, dismissal]);

  if (!request) return null;

  const tone = destructive ? theme.destructive : theme.primary;
  const soft = destructive ? theme.destructiveSoft : theme.primarySoft;
  const icon =
    request.options.icon ??
    (destructive
      ? 'trash-outline'
      : request.buttons.length > 1
        ? 'help-circle-outline'
        : 'information-circle-outline');
  // Two answers side by side, the way out on the left; more as a column, the way out last.
  const side = request.buttons.length <= 2;
  const isCancel = (button: DialogButton) => button.style === 'cancel';
  const keys = side
    ? [...request.buttons.filter(isCancel), ...request.buttons.filter((b) => !isCancel(b))]
    : [...request.buttons.filter((b) => !isCancel(b)), ...request.buttons.filter(isCancel)];

  return (
    <View style={styles.host} accessibilityViewIsModal>
      <Animated.View
        style={[StyleSheet.absoluteFill, { backgroundColor: theme.scrim, opacity: enter }]}
      >
        <Pressable
          onPress={dismissal ? () => answer(dismissal) : undefined}
          accessibilityRole="button"
          accessibilityLabel="Close"
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
      <Animated.View
        style={[
          styles.card,
          rimmed(theme),
          lift(theme),
          {
            backgroundColor: theme.popover,
            marginBottom: insets.bottom + spacing.md,
            opacity: enter,
            transform: [
              { translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [56, 0] }) },
              { scale: enter.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) },
            ],
          },
        ]}
      >
        <View style={styles.head}>
          <View style={[styles.mark, { backgroundColor: soft }]}>
            <Ionicons name={icon} size={21} color={tone} />
          </View>
          <View style={styles.words}>
            <Text accessibilityRole="header" style={[styles.title, { color: theme.foreground }]}>
              {request.title}
            </Text>
            {request.message ? (
              <Text style={[styles.message, { color: theme.mutedForeground }]}>
                {request.message}
              </Text>
            ) : null}
          </View>
        </View>
        <View style={[styles.keys, side ? styles.keysSide : null]}>
          {keys.map((button) => {
            const out = isCancel(button);
            // The one answer that matters is filled; a column of choices is quiet until one is.
            const filled = !out && (side || button.style === 'destructive');
            const ground = out
              ? theme.muted
              : button.style === 'destructive'
                ? filled
                  ? theme.destructive
                  : theme.destructiveSoft
                : filled
                  ? theme.primary
                  : theme.muted;
            const ink = out
              ? theme.foreground
              : button.style === 'destructive'
                ? filled
                  ? theme.destructiveForeground
                  : theme.destructive
                : filled
                  ? theme.primaryForeground
                  : theme.foreground;
            return (
              <PressableScale
                key={button.text}
                onPress={() => {
                  haptic.selection();
                  answer(button);
                }}
                accessibilityRole="button"
                accessibilityLabel={button.text}
                scaleTo={0.96}
                style={[styles.key, side ? styles.keySide : null, { backgroundColor: ground }]}
              >
                <Text numberOfLines={1} style={[styles.keyText, { color: ink }]}>
                  {button.text}
                </Text>
              </PressableScale>
            );
          })}
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Over everything in its window, native screens included.
  host: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    zIndex: 1000,
    elevation: 1000,
  },
  card: {
    width: '100%',
    maxWidth: 460,
    borderRadius: radius.xxxl + 4,
    padding: spacing.lg + 2,
    gap: spacing.lg,
  },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 14 },
  mark: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  words: { flex: 1, minWidth: 0, gap: 4, paddingTop: 1 },
  title: { fontSize: 17.5, lineHeight: 23, fontWeight: '700', letterSpacing: -0.4 },
  message: { fontSize: 14, lineHeight: 20 },
  keys: { gap: spacing.sm },
  keysSide: { flexDirection: 'row' },
  key: {
    height: 48,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  keySide: { flex: 1 },
  keyText: { fontSize: 15, lineHeight: 20, fontWeight: '700', letterSpacing: -0.1 },
});
