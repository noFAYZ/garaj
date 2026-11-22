import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  AddActivity,
  QUICK_ACTIONS,
  type ActivityMode,
  type QuickAction,
} from '@/components/add-activity';
import { ADD_ACTIONS, type AddOption, type AddTarget } from '@/components/add-mode';
import { GrowCombo } from '@/components/grow-combo';
import type { AddRequest } from '@/lib/add-request';
import { confirmDiscard } from '@/lib/discard';
import { fileParams, pickPhoto, type PickedFile } from '@/lib/file-picker';
import { Eyebrow } from '@/lib/instrument';
import { ease, haptic, PressableScale, Rise, useReduceMotion } from '@/lib/motion';
import { leaf, lift, radius, rimmed, spacing, typeScale, useTheme } from '@/lib/theme';
import { DialogHost } from '@/lib/dialog';

const PHOTO_DESTINATIONS: readonly AddOption[] = [
  {
    key: 'receipt',
    to: { form: 'done' },
    icon: 'receipt-outline',
    label: 'A receipt',
    hint: 'Kept with the entry',
  },
  {
    key: 'document',
    to: { screen: '/add/document' },
    icon: 'document-text-outline',
    label: 'A document',
    hint: 'Insurance, registration',
  },
  {
    key: 'photo',
    to: { screen: '/add/photo' },
    icon: 'images-outline',
    label: 'A vehicle I have',
    hint: '',
  },
  {
    key: 'vehicle',
    to: { screen: '/add/vehicle' },
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
/** The add form, open in the sheet: its mode, the quick entry it started as, a photo it holds. */
interface OpenForm {
  readonly mode: ActivityMode;
  readonly quick: QuickAction | null;
  readonly photo: PickedFile | null;
  /** What it was opened for from elsewhere: a vehicle, a kind, a reminder to complete. */
  readonly request?: AddRequest;
}

export function AddSheet({
  initialFile,
  initialQuick = null,
  initialMode = null,
  initialRequest = null,
  vehicleId,
  subject,
  onClose,
}: {
  initialFile: PickedFile | null;
  /**
   * Opens straight onto one of the quick entries — the hero's odometer press does this, and the
   * app's own + for a fill-up, a reading or a service, where the form asks which vehicle first.
   */
  initialQuick?: QuickAction | null;
  /** Opens straight onto the add form in this mode — a dock's Reminder. */
  initialMode?: ActivityMode | null;
  /** Opens straight onto the add form for this — a reminder's Log, Home's Up next. */
  initialRequest?: AddRequest | null;
  /** Scopes every route to this vehicle. Absent from the app's own tab bar, which asks. */
  vehicleId?: string;
  /** What the sheet says it is adding to, e.g. "2019 Mazda MX-5". */
  subject?: string;
  onClose: () => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [file, setFile] = useState<PickedFile | null>(initialFile);
  const [form, setForm] = useState<OpenForm | null>(
    initialQuick || initialMode || initialRequest
      ? {
          mode: initialRequest?.mode ?? initialMode ?? 'done',
          quick: initialQuick,
          photo: null,
          ...(initialRequest ? { request: initialRequest } : {}),
        }
      : null,
  );
  const [busy, setBusy] = useState<'camera' | 'library' | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The form inside holds something typed: every way of putting the sheet away asks first.
  const [dirty, setDirty] = useState(false);
  const reduce = useReduceMotion();
  const open = (
    mode: ActivityMode,
    quick: QuickAction | null = null,
    photo: PickedFile | null = null,
  ) => setForm({ mode, quick, photo });
  const starts = QUICK_ACTIONS.find((action) => action.kind === form?.quick)?.starts;

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

  // `drop` never changes, so the responder made on the first render can call this one.
  const settle = () =>
    Animated.spring(drop, { toValue: 0, useNativeDriver: true, speed: 18, bounciness: 6 }).start();
  /** Leaving the form for `then` — the menu, or no sheet at all — once a form with input agrees. */
  const leave = (then: () => void) => {
    if (!dirty) {
      then();
      return;
    }
    // Back in place under the question, wherever a drag left it.
    settle();
    confirmDiscard(then);
  };
  const slideAway = () => {
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
  const dismiss = () => leave(slideAway);

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
          settle();
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

  const go = (
    pathname: Extract<AddTarget, { screen: string }>['screen'] | '/add/garage',
    params: Record<string, string> = {},
  ) => {
    onClose();
    router.push({ pathname, params: vehicleId ? { vehicleId, ...params } : params });
  };
  /** An option, followed: its form opens in the sheet, its screen is pushed. */
  const follow = (to: AddTarget, file?: PickedFile) =>
    'form' in to ? open(to.form, null, file ?? null) : go(to.screen, file ? fileParams(file) : {});

  /*
   * A new vehicle is not in the list: it grows the garage rather than recording something about a
   * vehicle, so it lives in the combo below with a new garage. Bound to one vehicle, the combo is
   * not shown at all — neither is something you do to the vehicle you are looking at.
   */
  const actions = ADD_ACTIONS.filter((action) => action.key !== 'vehicle');
  /*
   * No "Photo" key: the copper photo key is how a photo gets added, and a second way to reach the
   * same screen is a choice the reader has to work out rather than one they wanted.
   */
  const tiles = [
    ...QUICK_ACTIONS.map((action) => ({
      key: action.kind,
      icon: action.icon,
      label: action.label,
      hint: action.hint,
      onPress: () => open('done', action.kind),
    })),
    // "Something done" is the catch-all, so it comes last, after the keys that name a thing.
    ...[...actions]
      .sort((a, b) => Number(a.key === 'done') - Number(b.key === 'done'))
      .map((action) => ({
        key: action.key,
        icon: action.icon,
        // A key is a noun: "A reminder" reads as a sentence in a list, "Reminder" on a key.
        label:
          action.key === 'done'
            ? 'Anything else'
            : action.label.replace(/^An? (\w)/, (_, first: string) => first.toUpperCase()),
        hint: action.hint,
        onPress: () => follow(action.to),
      })),
  ];

  const destinations: readonly AddOption[] = vehicleId
    ? [
        ...PHOTO_DESTINATIONS.filter(
          (destination) => destination.key !== 'vehicle' && destination.key !== 'photo',
        ),
        {
          key: 'photo',
          to: { screen: '/add/photo' },
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
        {/* Never under the status bar: a sheet taller than the room left shrinks instead. */}
        <View style={[styles.frame, { paddingTop: insets.top + spacing.sm }]}>
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
          <Animated.View style={{ flexShrink: 1, transform: [{ translateY: drop }] }}>
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

              {form ? (
                <Rise key="form" style={{ flexShrink: 1 }}>
                  {/*
                   * The add form itself, the same one the add screens show. It saves to this
                   * phone's queue and closes: a quick entry is over before the network is involved.
                   */}
                  <AddActivity
                    vehicleId={form.request?.vehicleId ?? vehicleId}
                    initialMode={form.mode}
                    initialKind={form.request?.kind ?? starts?.kind ?? null}
                    initialLine={starts?.line ?? ''}
                    initialScheduleId={form.request?.planId ?? null}
                    initialPhoto={form.photo}
                    inSheet
                    onDirty={setDirty}
                    lead={
                      <PressableScale
                        onPress={() => leave(() => setForm(null))}
                        accessibilityRole="button"
                        accessibilityLabel="Back"
                        hitSlop={8}
                        style={[styles.iconButton, { backgroundColor: theme.muted }]}
                      >
                        <Ionicons name="chevron-back" size={18} color={theme.foreground} />
                      </PressableScale>
                    }
                    onDone={onClose}
                    onAddVehicle={() => go('/add/vehicle')}
                  />
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
                    <Text
                      accessibilityRole="header"
                      style={[styles.title, { flex: 1, color: theme.foreground }]}
                    >
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
                      key: destination.key,
                      icon: destination.icon,
                      label: destination.label,
                      hint: destination.hint,
                      // A receipt is read into the add form, here; the rest go to their screens.
                      onPress: () => follow(destination.to, file),
                    }))}
                  />
                </Rise>
              ) : (
                <Rise key="menu" style={{ gap: spacing.sm + 4 }}>
                  <View style={styles.sheetHeader}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text
                        accessibilityRole="header"
                        style={[styles.title, { color: theme.foreground }]}
                      >
                        What are you adding?
                      </Text>
                      {/* Named, so a sheet that will not ask which vehicle says which it means. */}
                      {subject ? (
                        <Text
                          numberOfLines={1}
                          style={[typeScale.caption, { color: theme.mutedForeground }]}
                        >
                          To {subject}
                        </Text>
                      ) : null}
                    </View>
                    <PressableScale
                      onPress={dismiss}
                      accessibilityRole="button"
                      accessibilityLabel="Close"
                      hitSlop={8}
                      scaleTo={0.9}
                      style={[styles.iconButton, { backgroundColor: theme.muted }]}
                    >
                      <Ionicons name="close" size={18} color={theme.foreground} />
                    </PressableScale>
                  </View>

                  {/*
                   * Everything that is a record about a vehicle, as one grid of equal keys: the
                   * pump-side three first, where a thumb lands, then the rest. Each opens its form
                   * here in the sheet, or (a document) its own screen.
                   */}
                  <View style={styles.grid}>
                    {tiles.map((tile, index) => (
                      <Rise key={tile.key} index={index} style={styles.cell}>
                        <PressableScale
                          onPress={tile.onPress}
                          accessibilityRole="button"
                          accessibilityLabel={tile.label}
                          accessibilityHint={tile.hint || undefined}
                          scaleTo={0.94}
                          style={[styles.tile, { backgroundColor: theme.muted }]}
                        >
                          <View style={[styles.tileIcon, { backgroundColor: theme.cardRaised }]}>
                            <Ionicons name={tile.icon} size={18} color={theme.foreground} />
                          </View>
                          <Text
                            numberOfLines={1}
                            adjustsFontSizeToFit
                            style={[styles.tileLabel, { color: theme.foreground }]}
                          >
                            {tile.label}
                          </Text>
                        </PressableScale>
                      </Rise>
                    ))}
                  </View>

                  {/*
                   * The photo, as one wide key: the camera is the press, because the receipt, the
                   * paper and the car are in front of the phone; the library rides on it as a
                   * smaller key for what was already taken. Its camera is the sheet's one copper.
                   */}
                  <Rise
                    index={tiles.length}
                    style={[styles.capture, { backgroundColor: theme.muted }]}
                  >
                    <PressableScale
                      onPress={() => void capture('camera')}
                      disabled={busy !== null}
                      accessibilityRole="button"
                      accessibilityLabel="Camera"
                      accessibilityHint="A receipt, a paper or the vehicle"
                      accessibilityState={{ busy: busy === 'camera' }}
                      scaleTo={0.97}
                      style={styles.captureMain}
                    >
                      <View style={[styles.captureIcon, { backgroundColor: theme.primary }]}>
                        {busy === 'camera' ? (
                          <ActivityIndicator size="small" color={theme.primaryForeground} />
                        ) : (
                          <Ionicons name="camera" size={20} color={theme.primaryForeground} />
                        )}
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={[typeScale.label, { color: theme.foreground }]}>
                          Snap a photo
                        </Text>
                        <Text
                          numberOfLines={1}
                          style={[typeScale.caption, { color: theme.mutedForeground }]}
                        >
                          A receipt, a paper or the car
                        </Text>
                      </View>
                    </PressableScale>
                    <PressableScale
                      onPress={() => void capture('library')}
                      disabled={busy !== null}
                      accessibilityRole="button"
                      accessibilityLabel="Upload"
                      accessibilityHint="A photo already on this phone"
                      accessibilityState={{ busy: busy === 'library' }}
                      scaleTo={0.92}
                      style={[styles.upload, { backgroundColor: theme.cardRaised }]}
                    >
                      {busy === 'library' ? (
                        <ActivityIndicator size="small" color={theme.foreground} />
                      ) : (
                        <Ionicons name="images-outline" size={15} color={theme.foreground} />
                      )}
                      <Text style={[styles.uploadLabel, { color: theme.foreground }]}>Upload</Text>
                    </PressableScale>
                  </Rise>

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
                    <Ionicons name="flash-outline" size={12} color={theme.mutedForeground} />
                    <Text style={[styles.assuranceText, { color: theme.mutedForeground }]}>
                      Saved here, sent when there is signal.
                    </Text>
                  </View>
                </Rise>
              )}
            </View>
          </Animated.View>
        </View>
        {/* This sheet is its own window: what it asks has to show inside it, not behind it. */}
        <DialogHost />
      </KeyboardAvoidingView>
    </Modal>
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
    flexShrink: 1,
    borderTopLeftRadius: radius.xxxl + 4,
    borderTopRightRadius: radius.xxxl + 4,
    borderBottomWidth: 0,
    paddingHorizontal: spacing.md + 2,
    gap: spacing.xs,
  },
  handle: { alignItems: 'center', paddingTop: spacing.sm + 2, paddingBottom: spacing.xs },
  grabber: { width: 40, height: 5, borderRadius: 999 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 40 },
  title: { fontSize: 20, lineHeight: 25, fontWeight: '700', letterSpacing: -0.5 },
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 8 },
  cell: { width: '31.9%' },
  tile: { ...leaf('sm'), minHeight: 74, padding: 10, justifyContent: 'space-between', gap: 8 },
  tileIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileLabel: { fontSize: 13, lineHeight: 17, fontWeight: '600' },
  capture: {
    ...leaf('md'),
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingRight: 10,
  },
  captureMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 4,
    minHeight: 62,
    paddingLeft: 10,
  },
  captureIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  upload: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 36,
    borderRadius: 999,
    paddingHorizontal: 12,
  },
  uploadLabel: { fontSize: 13, lineHeight: 17, fontWeight: '600' },
  assurance: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingTop: 2,
  },
  assuranceText: { fontSize: 11.5, lineHeight: 15 },
  banner: { borderRadius: radius.md, padding: spacing.md },
  options: { ...leaf('md'), overflow: 'hidden', gap: StyleSheet.hairlineWidth },
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
  preview: { ...leaf('md'), height: 184, overflow: 'hidden' },
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
