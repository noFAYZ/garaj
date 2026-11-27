import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useQuery } from '@tanstack/react-query';
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
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { DueItem } from '@vehicle-os/contracts';
import { dashboardQuery } from '@vehicle-os/api-client/react';
import { readDue } from '@/components/activity-feed';
import {
  AddActivity,
  DueRing,
  QUICK_ACTIONS,
  type ActivityMode,
  type QuickAction,
} from '@/components/add-activity';
import type { AddTarget } from '@/components/add-mode';
import { GrowCombo } from '@/components/grow-combo';
import type { AddRequest } from '@/lib/add-request';
import { api } from '@/lib/api';
import { confirmDiscard } from '@/lib/discard';
import { fileParams, pickPhoto, type PickedFile } from '@/lib/file-picker';
import { Glyph } from '@/lib/instrument';
import { ease, PressableScale, Rise, useReduceMotion } from '@/lib/motion';
import { lift, radius, rimmed, spacing, typeScale, useTheme } from '@/lib/theme';
import { DialogHost } from '@/lib/dialog';

/** A way in, as a tile: the web's own artwork, its name, and a few words on what it asks. */
interface Tile {
  readonly key: string;
  readonly emoji: string;
  readonly label: string;
  readonly hint: string;
  readonly onPress: () => void;
}

/** Where a photo can go, once it is taken: what it is decides the screen. */
const PHOTO_DESTINATIONS: readonly (Omit<Tile, 'onPress'> & { readonly to: AddTarget })[] = [
  {
    key: 'receipt',
    to: { form: 'done' },
    emoji: '🧾',
    label: 'Receipt',
    hint: 'Read into an entry',
  },
  {
    key: 'document',
    to: { screen: '/add/document' },
    emoji: '📋',
    label: 'Document',
    hint: 'Insurance, papers',
  },
  {
    key: 'photo',
    to: { screen: '/add/photo' },
    emoji: '🚗',
    label: 'My vehicle',
    hint: 'To its gallery',
  },
  {
    key: 'vehicle',
    to: { screen: '/add/vehicle' },
    emoji: '🏠',
    label: 'New vehicle',
    hint: 'Starts from the photo',
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
   * What to log, as one grid of equal tiles: the pump-side three first, where a thumb lands, then a
   * reminder, a paper, and the catch-all last. A new vehicle is not here: it grows the garage rather
   * than recording something about a vehicle, so it lives with a new garage further down.
   */
  const tiles: readonly Tile[] = [
    ...QUICK_ACTIONS.map((action) => ({
      key: action.kind,
      emoji: action.emoji,
      label: action.label,
      hint: action.hint,
      onPress: () => open('done', action.kind),
    })),
    {
      key: 'planned',
      emoji: '🗓️',
      label: 'Reminder',
      hint: 'Once or a repeat',
      onPress: () => open('planned'),
    },
    {
      key: 'document',
      emoji: '📋',
      label: 'Document',
      hint: 'Papers, cover',
      onPress: () => go('/add/document'),
    },
    {
      key: 'done',
      emoji: '✨',
      label: 'Other',
      hint: 'Repair, wash, toll',
      onPress: () => open('done'),
    },
  ];

  // Bound to a vehicle, a photo is of this one, and starting a new vehicle is not offered.
  const destinations = PHOTO_DESTINATIONS.filter(
    (destination) => !vehicleId || destination.key !== 'vehicle',
  ).map((destination) =>
    vehicleId && destination.key === 'photo'
      ? { ...destination, label: 'This vehicle' }
      : destination,
  );

  /*
   * What is due now, where the thing most likely to be added is the thing that is due: from Home's
   * own read (cached), this vehicle's alone when the sheet is bound to one. Two at most, the late
   * first; a press opens the form already completing it.
   */
  const dashboard = useQuery(dashboardQuery(api));
  const due = (dashboard.data?.attention.maintenance ?? [])
    .filter(
      (item) =>
        (!vehicleId || item.vehicleId === vehicleId) &&
        (item.plan.status === 'OVERDUE' || item.plan.status === 'DUE_SOON'),
    )
    // `sort` on the array `filter` made: Hermes has no `toSorted`.
    .sort((a, b) => Number(b.plan.status === 'OVERDUE') - Number(a.plan.status === 'OVERDUE'))
    .slice(0, 2);
  const complete = (item: DueItem) =>
    setForm({
      mode: 'done',
      quick: null,
      photo: null,
      request: { vehicleId: item.vehicleId, planId: item.plan.id, mode: 'done' },
    });

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
                    initialEntry={starts?.entry}
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
                <Rise key="photo" style={styles.menu}>
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
                    <View style={styles.heading}>
                      <Text
                        accessibilityRole="header"
                        style={[styles.title, { color: theme.foreground }]}
                      >
                        What is this?
                      </Text>
                    </View>
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
                      scaleTo={0.94}
                      style={[styles.retake, { backgroundColor: theme.popover }]}
                    >
                      <Ionicons name="camera-reverse-outline" size={14} color={theme.foreground} />
                      <Text style={[styles.pillLabel, { color: theme.foreground }]}>Retake</Text>
                    </PressableScale>
                  </View>

                  <Tiles
                    // Three (bound to a vehicle) fill one row; four, two rows of two.
                    columns={destinations.length === 3 ? 3 : 2}
                    tiles={destinations.map((destination) => ({
                      ...destination,
                      // A receipt is read into the add form, here; the rest go to their screens.
                      onPress: () => follow(destination.to, file),
                    }))}
                  />
                </Rise>
              ) : (
                <Rise key="menu" style={styles.menuFrame}>
                  <View style={styles.sheetHeader}>
                    <View style={styles.heading}>
                      <Text
                        accessibilityRole="header"
                        style={[styles.title, { color: theme.foreground }]}
                      >
                        Add
                      </Text>
                      {/* Named, so a sheet that will not ask which vehicle says which it means. */}
                      {subject ? (
                        <Text
                          numberOfLines={1}
                          style={[styles.subtitle, { color: theme.mutedForeground }]}
                        >
                          {subject}
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
                   * Under the header, the rest scrolls: with what is due and the garage's own
                   * keys it is taller than a small phone's room, and the sheet shrinks to fit.
                   */}
                  <ScrollView
                    showsVerticalScrollIndicator={false}
                    style={styles.menuScroll}
                    contentContainerStyle={styles.menu}
                  >
                    {/*
                     * The photo first, as the sheet's one copper: the receipt, the paper and the car
                     * are in front of the phone, and what is in the picture is read for you. The
                     * camera is the press; the library rides on it as a small key.
                     */}
                    <Rise
                      index={1}
                      style={[styles.capture, { backgroundColor: theme.primarySoft }]}
                    >
                      <PressableScale
                        onPress={() => void capture('camera')}
                        disabled={busy !== null}
                        accessibilityRole="button"
                        accessibilityLabel="Snap a photo"
                        accessibilityHint="A receipt, a paper or the vehicle, read for you"
                        accessibilityState={{ busy: busy === 'camera' }}
                        scaleTo={0.97}
                        style={styles.captureMain}
                      >
                        <View style={[styles.captureKey, { backgroundColor: theme.primary }]}>
                          {busy === 'camera' ? (
                            <ActivityIndicator size="small" color={theme.primaryForeground} />
                          ) : (
                            <Ionicons name="camera" size={21} color={theme.primaryForeground} />
                          )}
                        </View>
                        <View style={styles.captureLine}>
                          <Text style={[styles.captureTitle, { color: theme.foreground }]}>
                            Snap a photo
                          </Text>
                          {/* It reads what it sees: the spark says so, as on the form's key. */}
                          <Ionicons name="sparkles" size={13} color={theme.primary} />
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
                          <Ionicons name="images-outline" size={16} color={theme.foreground} />
                        )}
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

                    {due.length > 0 ? (
                      <View style={styles.section}>
                        {due.map((item, index) => (
                          <Rise key={item.plan.id} index={index + 2}>
                            <DueCard
                              item={item}
                              showVehicle={!vehicleId}
                              onLog={() => complete(item)}
                            />
                          </Rise>
                        ))}
                      </View>
                    ) : null}

                    <Tiles columns={3} tiles={tiles} />

                    {vehicleId ? null : (
                      <GrowCombo
                        onVehicle={() => go('/add/vehicle')}
                        onGarage={() => go('/add/garage')}
                        onClose={onClose}
                      />
                    )}
                  </ScrollView>
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

/** Ways in, as a grid of equal tiles, each rising into place in turn. */
function Tiles({ tiles, columns }: { tiles: readonly Tile[]; columns: 2 | 3 }) {
  const theme = useTheme();
  return (
    <View style={styles.grid}>
      {tiles.map((tile, index) => (
        <Rise key={tile.key} index={index + 2} style={columns === 3 ? styles.third : styles.half}>
          <PressableScale
            onPress={() => {
              tile.onPress();
            }}
            accessibilityRole="button"
            accessibilityLabel={tile.label}
            accessibilityHint={tile.hint || undefined}
            scaleTo={0.95}
            style={[styles.tile, { backgroundColor: theme.muted }]}
          >
            <View style={[styles.tileArt, { backgroundColor: theme.cardRaised }]}>
              <Glyph size={22}>{tile.emoji}</Glyph>
            </View>
            <Text numberOfLines={1} style={[styles.tileLabel, { color: theme.foreground }]}>
              {tile.label}
            </Text>
          </PressableScale>
        </Rise>
      ))}
    </View>
  );
}

/**
 * A reminder that is due, as the shortest way to log it: its glyph in the ring of how due it is,
 * its name, how late or how soon in its tone (and whose, on Home), and a copper Log key. The whole
 * card is the press.
 */
function DueCard({
  item,
  showVehicle,
  onLog,
}: {
  item: DueItem;
  showVehicle: boolean;
  onLog: () => void;
}) {
  const theme = useTheme();
  const { headline, tone } = readDue(item.plan, item.odometerUnit);
  const color =
    tone === 'destructive'
      ? theme.destructive
      : tone === 'warning'
        ? theme.warning
        : theme.mutedForeground;
  return (
    <PressableScale
      onPress={() => {
        onLog();
      }}
      accessibilityRole="button"
      accessibilityLabel={`Log ${item.plan.title}, ${headline}${showVehicle ? `, ${item.vehicleName}` : ''}`}
      scaleTo={0.98}
      style={[styles.due, { backgroundColor: theme.muted }]}
    >
      <DueRing plan={item.plan} unit={item.odometerUnit} size={40} glyph={19} />
      <View style={styles.dueWords}>
        <Text numberOfLines={1} style={[styles.dueTitle, { color: theme.foreground }]}>
          {item.plan.title}
        </Text>
        <Text numberOfLines={1} style={[styles.dueLine, { color }]}>
          {headline}
          {showVehicle ? (
            // Its own weight: a nested Text is dressed to its own font file.
            <Text style={[styles.dueWhose, { color: theme.mutedForeground }]}>
              {` · ${item.vehicleName}`}
            </Text>
          ) : null}
        </Text>
      </View>
      <View style={[styles.logKey, { backgroundColor: theme.primary }]}>
        <Ionicons name="checkmark" size={13} color={theme.primaryForeground} />
        <Text style={[styles.logLabel, { color: theme.primaryForeground }]}>Log</Text>
      </View>
    </PressableScale>
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
  menu: { gap: spacing.md },
  // The menu shrinks to the sheet's room; its header stays, the rest scrolls under it.
  menuFrame: { flexShrink: 1, gap: spacing.md },
  menuScroll: { flexShrink: 1 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 40 },
  heading: { flex: 1, minWidth: 0, gap: 1 },
  title: { fontSize: 18, lineHeight: 23, fontWeight: '700', letterSpacing: -0.45 },
  subtitle: { fontSize: 12, lineHeight: 16 },
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  capture: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radius.lg,
    paddingRight: 10,
  },
  captureMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 68,
    paddingLeft: 11,
  },
  captureKey: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
  },
  captureTitle: { fontSize: 15, lineHeight: 19, fontWeight: '700', letterSpacing: -0.2 },
  captureLine: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 6 },
  upload: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillLabel: { fontSize: 12.5, lineHeight: 16, fontWeight: '600' },
  section: { gap: spacing.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 8 },
  third: { width: '31.9%' },
  half: { width: '48.9%' },
  tile: {
    minHeight: 80,
    padding: 10,
    justifyContent: 'space-between',
    gap: 10,
    borderRadius: radius.lg,
  },
  tileArt: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileLabel: { fontSize: 13.5, lineHeight: 17, fontWeight: '600', letterSpacing: -0.1 },
  due: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 58,
    paddingLeft: 9,
    paddingRight: 10,
    borderRadius: radius.lg,
  },
  dueWords: { flex: 1, minWidth: 0, gap: 1 },
  dueTitle: { fontSize: 14, lineHeight: 18, fontWeight: '600', letterSpacing: -0.1 },
  dueLine: { fontSize: 11.5, lineHeight: 15, fontWeight: '600' },
  dueWhose: { fontSize: 11.5, lineHeight: 15, fontWeight: '500' },
  logKey: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 30,
    borderRadius: 999,
    paddingHorizontal: 12,
  },
  logLabel: { fontSize: 12.5, lineHeight: 16, fontWeight: '700' },
  banner: { borderRadius: radius.md, padding: spacing.md },
  preview: { borderRadius: radius.lg, height: 176, overflow: 'hidden' },
  retake: {
    position: 'absolute',
    right: 10,
    bottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 32,
    borderRadius: 999,
    paddingHorizontal: 12,
  },
});
