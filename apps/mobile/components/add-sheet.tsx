import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter, type Href } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ADD_ACTIONS } from '@/components/add-mode';
import { GrowCombo } from '@/components/grow-combo';
import { QUICK_ACTIONS, QuickEntryForm, type QuickAction } from '@/components/quick-entry-form';
import { fileParams, pickPhoto, type PickedFile } from '@/lib/file-picker';
import { Eyebrow } from '@/lib/instrument';
import { ease, haptic, PressableScale, Rise, useReduceMotion } from '@/lib/motion';
import { lift, radius, rimmed, spacing, typeScale, useTheme } from '@/lib/theme';

interface SheetOption {
  readonly pathname: string;
  readonly icon: keyof typeof Ionicons.glyphMap;
  readonly label: string;
  readonly hint: string;
}

/** Where a photo can go once it is taken — the question the photo step asks. */
const PHOTO_DESTINATIONS: readonly SheetOption[] = [
  {
    pathname: '/add/done',
    icon: 'receipt-outline',
    label: 'A receipt',
    hint: 'Kept with the entry',
  },
  {
    pathname: '/add/document',
    icon: 'document-text-outline',
    label: 'A document',
    hint: 'Insurance, registration',
  },
  {
    pathname: '/add/photo',
    icon: 'images-outline',
    label: 'A vehicle I have',
    hint: '',
  },
  {
    pathname: '/add/vehicle',
    icon: 'car-sport-outline',
    label: 'A new vehicle',
    hint: '',
  },
];

/**
 * + that turns to × while the sheet is open, so the button that opened it reads as its close.
 */
export function AddGlyph({
  open,
  color,
  size = 28,
}: {
  open: boolean;
  color: string;
  size?: number;
}) {
  const reduce = useReduceMotion();
  const [turn] = useState(() => new Animated.Value(open ? 1 : 0));

  useEffect(() => {
    if (reduce) {
      turn.setValue(open ? 1 : 0);
      return;
    }
    const animation = Animated.spring(turn, {
      toValue: open ? 1 : 0,
      useNativeDriver: true,
      speed: 22,
      bounciness: 8,
    });
    /*
     * Settle on the target if something other than this effect cut the spring short. Closing
     * the sheet and opening the upgrade screen in the same tap covers this screen mid-turn, and
     * Android detaches a covered screen — the native spring never finishes and the button came
     * back as a × with nothing open. A stop from our own cleanup is a newer turn taking over,
     * so it is left alone.
     */
    let superseded = false;
    animation.start(({ finished }) => {
      if (!finished && !superseded) turn.setValue(open ? 1 : 0);
    });
    return () => {
      superseded = true;
      animation.stop();
    };
  }, [open, reduce, turn]);

  const rotate = turn.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '45deg'] });
  return (
    <Animated.View style={{ transform: [{ rotate }] }}>
      <Ionicons name="add" size={size} color={color} />
    </Animated.View>
  );
}

/**
 * What + offers, as a sheet in two steps.
 *
 * First: capture — the camera or the library, because a phone is where the receipt, the paper and
 * the car actually are — or start from one of the forms. Then, with a photo in hand: what is it?
 * The answer picks the screen, and the photo goes with it.
 *
 * `vehicleId` binds every route it offers to one vehicle. Opened from the dock at the bottom of a
 * vehicle, the first question of each form — which vehicle is this for — is already answered, and
 * the two options that cannot belong to a vehicle you are standing in (starting a new one, or
 * choosing which vehicle a photo is of) are not offered at all. That is the whole difference: one
 * sheet, asked from two places, and it never asks something the caller already knows.
 */
/** What the quick entry needs to know about the vehicle it is recording against. */
export interface QuickContext {
  readonly unit: string;
  readonly currency: string;
  readonly currentOdometer: number | null;
}

export function AddSheet({
  initialFile,
  initialQuick = null,
  vehicleId,
  subject,
  quickContext,
  onClose,
}: {
  initialFile: PickedFile | null;
  /** Opens straight onto one of the quick entries — the hero's odometer press does this. */
  initialQuick?: QuickAction | null;
  /** Scopes every route to this vehicle. Absent from the app's own tab bar, which asks. */
  vehicleId?: string;
  /** What the sheet says it is adding to, e.g. "2019 Mazda MX-5". */
  subject?: string;
  /** Present only with a vehicle: without its unit and currency a quick entry would guess. */
  quickContext?: QuickContext;
  onClose: () => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [file, setFile] = useState<PickedFile | null>(initialFile);
  const [quick, setQuick] = useState<QuickAction | null>(initialQuick);
  const [busy, setBusy] = useState<'camera' | 'library' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reduce = useReduceMotion();

  /*
   * The sheet's own motion: it springs up from below while the page dims, follows a thumb that
   * drags it down by its grabber, and drops away — then closes — when let go far or fast enough.
   * Native-driven throughout; the drag only ever sets the value the springs animate.
   */
  const [drop] = useState(() => new Animated.Value(reduce ? 0 : 600));
  const [dim] = useState(() => new Animated.Value(reduce ? 1 : 0));
  useEffect(() => {
    if (reduce) return;
    Animated.parallel([
      Animated.spring(drop, { toValue: 0, useNativeDriver: true, speed: 14, bounciness: 3 }),
      Animated.timing(dim, { toValue: 1, duration: 260, easing: ease.out, useNativeDriver: true }),
    ]).start();
  }, [drop, dim, reduce]);

  const dismiss = () => {
    if (reduce) {
      onClose();
      return;
    }
    Animated.parallel([
      Animated.timing(drop, {
        toValue: 600,
        duration: 220,
        easing: ease.in,
        useNativeDriver: true,
      }),
      Animated.timing(dim, { toValue: 0, duration: 220, useNativeDriver: true }),
    ]).start(() => onClose());
  };

  // The responder is made once; the close it calls is whatever this render's is.
  const dismissRef = useRef(dismiss);
  dismissRef.current = dismiss;

  const [pan] = useState(() =>
    PanResponder.create({
      onMoveShouldSetPanResponder: (_event, gesture) =>
        gesture.dy > 6 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
      onPanResponderMove: (_event, gesture) => drop.setValue(Math.max(0, gesture.dy)),
      onPanResponderRelease: (_event, gesture) => {
        if (gesture.dy > 110 || gesture.vy > 1.1) {
          haptic.light();
          dismissRef.current();
        } else {
          Animated.spring(drop, {
            toValue: 0,
            useNativeDriver: true,
            speed: 18,
            bounciness: 6,
          }).start();
        }
      },
    }),
  );
  const capture = async (source: 'camera' | 'library') => {
    setError(null);
    setBusy(source);
    try {
      const picked = await pickPhoto(source);
      if (picked) {
        haptic.success();
        setFile(picked);
      }
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const go = (pathname: string, params: Record<string, string> = {}) => {
    onClose();
    router.push({
      pathname,
      params: vehicleId ? { vehicleId, ...params } : params,
    } as Href);
  };

  /*
   * A new vehicle is not in the list: it grows the garage rather than recording something about a
   * vehicle, so it lives in the combo below with a new garage. Bound to one vehicle, the combo is
   * not shown at all — neither is something you do to the vehicle you are looking at.
   */
  const actions: SheetOption[] = ADD_ACTIONS.filter((action) => action.href !== '/add/vehicle').map(
    (action) => ({
      pathname: action.href,
      icon: action.icon,
      label: action.label,
      hint: action.hint,
    }),
  );
  /*
   * No "Photo" row: the two capture tiles above are how a photo gets added, and a third way to
   * reach the same screen is a choice the reader has to work out rather than one they wanted.
   */

  const destinations: readonly SheetOption[] = vehicleId
    ? [
        ...PHOTO_DESTINATIONS.filter(
          (destination) =>
            destination.pathname !== '/add/vehicle' && destination.pathname !== '/add/photo',
        ),
        {
          pathname: '/add/photo',
          icon: 'images-outline',
          label: 'This vehicle',
          hint: '',
        },
      ]
    : PHOTO_DESTINATIONS;

  return (
    <Modal visible transparent animationType="none" onRequestClose={dismiss} statusBarTranslucent>
      {/*
       * The sheet lifts with the keyboard. Without this the quick entry inside it is typed at
       * blind — the odometer is the first field, and on a short phone the keyboard covers the
       * panel the moment it opens.
       */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <View style={styles.frame}>
          <Animated.View
            style={[StyleSheet.absoluteFill, { backgroundColor: theme.scrim, opacity: dim }]}
          >
            <Pressable
              onPress={dismiss}
              accessibilityRole="button"
              accessibilityLabel="Close"
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>
          <Animated.View style={{ transform: [{ translateY: drop }] }}>
            <View
              style={[
                styles.sheet,
                {
                  backgroundColor: theme.popover,
                  paddingBottom: insets.bottom + spacing.lg,
                },
                rimmed(theme),
                lift(theme),
              ]}
            >
              {/* The handle: a drag here, down, puts the sheet away. */}
              <View {...pan.panHandlers} style={styles.handle}>
                <View style={[styles.grabber, { backgroundColor: theme.borderStrong }]} />
              </View>

              {quick && vehicleId && quickContext ? (
                <Rise key="quick" style={{ gap: spacing.md }}>
                  <View style={styles.sheetHeader}>
                    <PressableScale
                      onPress={() => setQuick(null)}
                      accessibilityRole="button"
                      accessibilityLabel="Back"
                      hitSlop={8}
                      style={[styles.iconButton, { backgroundColor: theme.muted }]}
                    >
                      <Ionicons name="chevron-back" size={18} color={theme.foreground} />
                    </PressableScale>
                    <Text style={[typeScale.title, { flex: 1, color: theme.foreground }]}>
                      {QUICK_ACTIONS.find((action) => action.kind === quick)?.label}
                    </Text>
                  </View>

                  {/*
                   * The form itself, in the sheet. It saves to this phone's queue and closes — the
                   * point of a quick entry is that it is over before the network is involved.
                   */}
                  {/* Scrolls: with the keyboard up there is less room than the form needs. */}
                  <ScrollView
                    keyboardShouldPersistTaps="handled"
                    showsVerticalScrollIndicator={false}
                    style={{ maxHeight: 420 }}
                  >
                    <QuickEntryForm
                      kind={quick}
                      vehicleId={vehicleId}
                      unit={quickContext.unit}
                      currency={quickContext.currency}
                      currentOdometer={quickContext.currentOdometer}
                      onDone={onClose}
                    />
                  </ScrollView>
                </Rise>
              ) : file ? (
                <Rise key="photo" style={{ gap: spacing.md }}>
                  <View style={styles.sheetHeader}>
                    <PressableScale
                      onPress={() => setFile(null)}
                      accessibilityRole="button"
                      accessibilityLabel="Back"
                      hitSlop={8}
                      style={[styles.iconButton, { backgroundColor: theme.muted }]}
                    >
                      <Ionicons name="chevron-back" size={18} color={theme.foreground} />
                    </PressableScale>
                    <Text style={[typeScale.title, { flex: 1, color: theme.foreground }]}>
                      What is in the photo?
                    </Text>
                  </View>

                  <View style={[styles.preview, { backgroundColor: theme.muted }]}>
                    <Image
                      source={{ uri: file.uri }}
                      style={StyleSheet.absoluteFill}
                      contentFit="cover"
                      transition={150}
                      accessibilityIgnoresInvertColors
                    />
                    <PressableScale
                      onPress={() => void capture('camera')}
                      accessibilityRole="button"
                      accessibilityLabel="Retake photo"
                      style={[styles.retake, { backgroundColor: theme.background }]}
                    >
                      <Ionicons name="camera-reverse-outline" size={14} color={theme.foreground} />
                      <Text
                        style={[typeScale.caption, { fontWeight: '600', color: theme.foreground }]}
                      >
                        Retake
                      </Text>
                    </PressableScale>
                  </View>

                  <OptionList
                    options={destinations.map((destination) => ({
                      key: destination.pathname,
                      icon: destination.icon,
                      label: destination.label,
                      hint: destination.hint,
                      onPress: () => go(destination.pathname, fileParams(file)),
                    }))}
                  />
                </Rise>
              ) : (
                <Rise key="menu" style={{ gap: spacing.md }}>
                  <View style={styles.sheetHeader}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={[typeScale.title, { color: theme.foreground }]}>
                        What are you adding?
                      </Text>
                      {/* Named, so a sheet that will not ask which vehicle says which it means. */}
                      {subject ? (
                        <Text
                          numberOfLines={1}
                          style={[typeScale.caption, { color: theme.mutedForeground }]}
                        >
                          to {subject}
                        </Text>
                      ) : null}
                    </View>
                  </View>

                  {/*
                   * The pump-side three, as tiles rather than rows.
                   *
                   * They are not one of seven equal options: they are what someone standing at a
                   * vehicle actually opened this for, and they are the only ones that finish inside
                   * the sheet instead of pushing a screen. Given the size of the difference, they
                   * are given the size to match — and a thumb reaching the bottom of a phone finds
                   * a target rather than a line of text.
                   */}
                  {vehicleId && quickContext ? (
                    <View style={styles.quickRow}>
                      {QUICK_ACTIONS.map((action, index) => (
                        <Rise key={action.kind} index={index} style={{ flex: 1 }}>
                          <PressableScale
                            onPress={() => setQuick(action.kind)}
                            accessibilityRole="button"
                            accessibilityLabel={action.label}
                            accessibilityHint={action.hint}
                            scaleTo={0.94}
                            style={[styles.quickTile, { backgroundColor: theme.muted }]}
                          >
                            <View
                              style={[styles.quickIcon, { backgroundColor: theme.primarySoft }]}
                            >
                              <Ionicons name={action.icon} size={20} color={theme.primary} />
                            </View>
                            <Text
                              numberOfLines={1}
                              adjustsFontSizeToFit
                              style={[typeScale.label, { fontSize: 13, color: theme.foreground }]}
                            >
                              {action.label}
                            </Text>
                          </PressableScale>
                        </Rise>
                      ))}
                    </View>
                  ) : null}

                  <View style={styles.captureRow}>
                    <CaptureTile
                      icon="camera"
                      label="Camera"
                      inked
                      busy={busy === 'camera'}
                      onPress={() => void capture('camera')}
                    />
                    <CaptureTile
                      icon="images"
                      label="Upload"
                      busy={busy === 'library'}
                      onPress={() => void capture('library')}
                    />
                  </View>

                  {error ? (
                    <View style={[styles.banner, { backgroundColor: theme.warningSoft }]}>
                      <Text
                        accessibilityRole="alert"
                        style={[typeScale.caption, { color: theme.warning }]}
                      >
                        {error}
                      </Text>
                    </View>
                  ) : null}

                  {actions.length > 0 ? (
                    <View style={{ gap: spacing.xs }}>
                      <Eyebrow>Else</Eyebrow>
                      <OptionList
                        options={actions.map((action) => ({
                          key: action.pathname,
                          icon: action.icon,
                          label: action.label,
                          hint: action.hint,
                          onPress: () => go(action.pathname),
                        }))}
                      />
                    </View>
                  ) : null}

                  {vehicleId ? null : (
                    <View style={{ gap: spacing.xs }}>
                      <Eyebrow>Grow the garage</Eyebrow>
                      <GrowCombo
                        onVehicle={() => go('/add/vehicle')}
                        onGarage={() => go('/add/garage')}
                        onClose={onClose}
                      />
                    </View>
                  )}

                  {/*
                   * Said once, here, because it is the thing that makes the rest of this sheet
                   * usable in a basement — and because a queue nobody is told about reads as an
                   * app that did not save what they typed.
                   */}
                  <View style={styles.assurance}>
                    <Ionicons name="flash-outline" size={13} color={theme.mutedForeground} />
                    <Text
                      numberOfLines={2}
                      style={[typeScale.caption, { flex: 1, color: theme.mutedForeground }]}
                    >
                      Saved here, sent when there is signal.
                    </Text>
                  </View>
                </Rise>
              )}
            </View>
          </Animated.View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** A capture tile: the glyph and the word. Anything more is a caption on a button. */
function CaptureTile({
  icon,
  label,
  inked = false,
  busy,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  inked?: boolean;
  busy: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const ink = inked ? theme.primaryForeground : theme.foreground;
  return (
    <PressableScale
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ busy }}
      scaleTo={0.95}
      style={[styles.capture, { backgroundColor: inked ? theme.primary : theme.muted }]}
    >
      <View
        style={[
          styles.captureIcon,
          { backgroundColor: inked ? theme.primaryForeground : theme.card },
        ]}
      >
        {busy ? (
          <ActivityIndicator size="small" color={inked ? theme.primary : theme.foreground} />
        ) : (
          <Ionicons name={icon} size={20} color={inked ? theme.primary : theme.foreground} />
        )}
      </View>
      <Text style={[typeScale.label, { color: ink }]}>{label}</Text>
    </PressableScale>
  );
}

function OptionList({
  options,
}: {
  options: {
    key: string;
    icon: keyof typeof Ionicons.glyphMap;
    label: string;
    hint: string;
    onPress: () => void;
  }[];
}) {
  const theme = useTheme();
  return (
    <View style={[styles.options, { backgroundColor: theme.border }]}>
      {options.map((option, index) => (
        <Rise key={option.key} index={index + 1}>
          <PressableScale
            onPress={option.onPress}
            accessibilityRole="button"
            accessibilityLabel={option.label}
            accessibilityHint={option.hint}
            scaleTo={0.98}
            style={[styles.option, { backgroundColor: theme.muted }]}
          >
            <View style={[styles.optionIcon, { backgroundColor: theme.card }]}>
              <Ionicons name={option.icon} size={18} color={theme.foreground} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[typeScale.label, { color: theme.foreground }]}>{option.label}</Text>
              {/* Only where the label genuinely needs help; most do not. */}
              {option.hint ? (
                <Text
                  numberOfLines={1}
                  style={[typeScale.caption, { color: theme.mutedForeground }]}
                >
                  {option.hint}
                </Text>
              ) : null}
            </View>
            <Ionicons name="chevron-forward" size={16} color={theme.mutedForeground} />
          </PressableScale>
        </Rise>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: radius.xxxl + 4,
    borderTopRightRadius: radius.xxxl + 4,
    borderBottomWidth: 0,
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  handle: { alignItems: 'center', paddingTop: spacing.sm + 2, paddingBottom: spacing.sm },
  grabber: { width: 40, height: 5, borderRadius: 999 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 40 },
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickRow: { flexDirection: 'row', gap: spacing.sm },
  quickTile: {
    minHeight: 92,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  quickIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  assurance: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 2 },
  captureRow: { flexDirection: 'row', gap: spacing.sm },
  capture: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 60,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
  },
  captureIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  banner: { borderRadius: radius.md, padding: spacing.md },
  options: { borderRadius: radius.lg, overflow: 'hidden', gap: StyleSheet.hairlineWidth },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    minHeight: 54,
  },
  optionIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  preview: { height: 184, borderRadius: radius.lg, overflow: 'hidden' },
  retake: {
    position: 'absolute',
    right: 10,
    bottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
});
