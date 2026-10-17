import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from 'react';
import {
  Alert,
  Animated,
  InteractionManager,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  type ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  activityQuery,
  garagesQuery,
  healthQuery,
  monthlySpendQuery,
  photosQuery,
  queryKeys,
  vehicleQuery,
  vehiclesQuery,
} from '@vehicle-os/api-client/react';
import { capabilitiesFor } from '@vehicle-os/domain';
import { ActivityFeed, nextUp, VehiclePlanned } from '@/components/activity-feed';
import { VehicleDocuments } from '@/components/vehicle-documents';
import { VehicleStatistics } from '@/components/vehicle-statistics';
import type { QuickAction } from '@/components/add-activity';
import { useDockSpace } from '@/components/dock';
import { VehicleDock, type VehicleTab } from '@/components/vehicle-dock';
import { VehicleHero, VehicleHeroSkeleton, VehicleTopBar } from '@/components/vehicle-hero';
import { api } from '@/lib/api';
import { enqueue, flush } from '@/lib/offline';
import { fileParams, pickPhoto } from '@/lib/file-picker';
import { haptic, useScrollY } from '@/lib/motion';
import { MenuSheet } from '@/lib/pickers';
import { spacing, useTheme } from '@/lib/theme';

/** The floating bar's height under the status bar, so a jump inside the feed lands below it. */
const BAR_CLEARANCE = 60;

/**
 * One vehicle. On Logs: its stage drawn up to the top of the screen with the bar floating over it,
 * its name and plate, its dash, and its activity underneath. On Reminders, Stats and Docs the
 * vehicle is the bar's title and the section has the screen. Recording something is the dock's +.
 */
export default function VehicleScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const dockSpace = useDockSpace();
  const router = useRouter();
  const queryClient = useQueryClient();
  const scroller = useRef<ScrollView>(null);
  const { y, onScroll } = useScrollY();
  const statsY = useRef(0);
  const [tab, setTab] = useState<VehicleTab>('activity');
  /*
   * Only Logs stands the vehicle on its stage. Everywhere else the page is about something the
   * vehicle has — its jobs, its figures, its papers — so the vehicle shrinks into the bar and the
   * section starts at the top of the screen.
   */
  const staged = tab === 'activity';
  /*
   * A section is a lot to build — a whole report, a ledger — and building one, or tearing one
   * down, held the JS thread for half a second and froze the dock mid-animation. So a section once
   * built stays built, hidden while another is shown, and coming back to it is only a change of
   * which is visible. One never built waits until the dock has finished moving, then is built as a
   * transition.
   */
  const [, startTransition] = useTransition();
  const [built, setBuilt] = useState<readonly VehicleTab[]>(['activity']);
  // A build still waiting is dropped when another place is pressed first.
  const waiting = useRef<ReturnType<typeof setTimeout> | null>(null);
  const go = (next: VehicleTab) => {
    if (waiting.current) clearTimeout(waiting.current);
    const show = () =>
      startTransition(() => {
        setTab(next);
        setBuilt((done) => (done.includes(next) ? done : [...done, next]));
      });
    if (built.includes(next)) show();
    else waiting.current = setTimeout(show, DOCK_SETTLE);
  };
  // The stage comes and goes with the section, so the new one starts at its own top — once it is
  // there, not before, or the old one would jump first.
  useEffect(() => {
    scroller.current?.scrollTo({ y: 0, animated: false });
  }, [tab]);
  /* Raised by the odometer reading in Stats; the dock's sheet is what actually opens. */
  const [quickRequest, setQuickRequest] = useState<QuickAction | null>(null);
  const vehicle = useQuery(vehicleQuery(api, id));
  // Its own query, so a slow photo list never holds up the name.
  const photos = useQuery(photosQuery(api, id));
  // The hero's spend: this month, from the same months the web's cockpit reads.
  const monthly = useQuery(monthlySpendQuery(api, id));
  // The hero's gauge and its next job: the same reads Stats, Logs and the dock make.
  const health = useQuery(healthQuery(api, id));
  const activity = useQuery(activityQuery(api, id));
  // Its bay on Home, so the floor here wears the same number. Already cached from there.
  const fleet = useQuery(vehiclesQuery(api));
  const bay = Math.max(0, fleet.data?.data.findIndex((vehicle) => vehicle.id === id) ?? 0) + 1;

  /*
   * Only for the role. The list is already in cache from the home screen, so this is a read
   * rather than a request, and an absent one simply leaves the control hidden.
   */
  const garages = useQuery(garagesQuery(api));
  const data = vehicle.data;
  /*
   * The four sections as elements made once per vehicle. React skips a subtree whose element is
   * the very one it rendered last time, so a change of tab re-renders the wrappers that show and
   * hide them, and none of the sections — a report or a ledger is not rebuilt to be hidden.
   */
  const sections = useMemo(
    () =>
      data
        ? {
            activity: <ActivityFeed vehicle={data} bottom={dockSpace} />,
            planned: <VehiclePlanned vehicle={data} />,
            statistics: (
              <View
                onLayout={(event) => {
                  statsY.current = event.nativeEvent.layout.y;
                }}
              >
                {/* The odometer reading there opens the form that changes it, already scrolled to. */}
                <VehicleStatistics
                  vehicleId={id}
                  onLogOdometer={() => setQuickRequest('odometer')}
                  onJump={(offset) =>
                    scroller.current?.scrollTo({
                      y: statsY.current + offset - insets.top - BAR_CLEARANCE,
                      animated: true,
                    })
                  }
                />
              </View>
            ),
            documents: <VehicleDocuments vehicleId={id} />,
          }
        : null,
    [data, dockSpace, id, insets.top],
  );
  /*
   * Once the page has settled, the sections not yet built are built out of sight, one at a time and
   * lightest first, so even the first press on any of them only changes what is shown.
   */
  useEffect(() => {
    if (!data) return;
    const next = PREBUILD.find((section) => !built.includes(section));
    if (!next) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const task = InteractionManager.runAfterInteractions(() => {
      timer = setTimeout(
        () =>
          startTransition(() => setBuilt((done) => (done.includes(next) ? done : [...done, next]))),
        PREBUILD_GAP,
      );
    });
    return () => {
      task.cancel();
      if (timer) clearTimeout(timer);
    };
  }, [data, built]);
  const refreshing = vehicle.isFetching && !vehicle.isPending;
  // It already takes an absent vehicle, so it runs before the data arrives without a guard.
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['vehicles', id] });
  };

  const role = garages.data?.find((garage) => garage.id === data?.garageId)?.role;
  const canArchive = role ? capabilitiesFor(role).includes('vehicle.delete') : false;

  const edit = () => router.push({ pathname: '/vehicle/edit', params: { vehicleId: id } });

  /*
   * Archive, and said as archive: the server keeps the history and only takes the vehicle out
   * of the lists. Calling it Delete on the button and then not deleting is the version someone
   * discovers a year later when they go looking for what it cost them.
   */
  const archive = () => {
    setMenu(null);
    // Queued: archiving is a decision made at the vehicle, often where it is parked.
    void enqueue({ kind: 'vehicle-archive', vehicleId: id })
      .then(() => {
        haptic.success();
        void flush();
        void queryClient.invalidateQueries({ queryKey: ['vehicles'] });
        void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard() });
        router.back();
      })
      .catch((error: unknown) =>
        Alert.alert('Could not archive the vehicle', (error as Error).message),
      );
  };

  /*
   * The occasional jobs, behind one ⋯ as on the web. Archive sat one thumb-width from edit in the
   * bar; in the sheet it is a deliberate choice, and the sheet turning into its confirm is the
   * second press.
   */
  const [menu, setMenu] = useState<'actions' | 'archive' | null>(null);
  const openMenu = () => {
    haptic.selection();
    setMenu('actions');
  };
  const name = data?.displayName ?? 'this vehicle';

  const photoFrom = async (source: 'camera' | 'library') => {
    try {
      const file = await pickPhoto(source);
      if (file) {
        router.push({ pathname: '/add/photo', params: { vehicleId: id, ...fileParams(file) } });
      }
    } catch (error) {
      Alert.alert('Could not open photos', (error as Error).message);
    }
  };

  const addPhoto = () =>
    Alert.alert('Add a photo', undefined, [
      { text: 'Take a photo', onPress: () => void photoFrom('camera') },
      { text: 'Choose from library', onPress: () => void photoFrom('library') },
      { text: 'Cancel', style: 'cancel' },
    ]);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: theme.background }}
    >
      {/*
       * No header of the navigator's: the stage runs up under the status bar and the page's own
       * bar floats over it (`VehicleTopBar`). The title still names the page to the stack.
       */}
      <Stack.Screen options={{ title: data?.displayName ?? 'Vehicle', headerShown: false }} />

      <Animated.ScrollView
        ref={scroller}
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={[
          styles.page,
          {
            paddingTop: staged ? 0 : insets.top + BAR_CLEARANCE,
            paddingBottom: data && staged ? 0 : dockSpace,
          },
        ]}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            tintColor={theme.mutedForeground}
            // Below the bar on Android, where the spinner is drawn over the page.
            progressViewOffset={insets.top + BAR_CLEARANCE}
          />
        }
      >
        {/*
         * The vehicle heads its Logs, as it does on the web; elsewhere it is in the bar. Kept
         * mounted and hidden off Logs, so coming back does not rebuild it and replay its entrance —
         * the odometer rolling up from zero again read as a glitch.
         */}
        {data ? (
          <View style={staged ? undefined : styles.kept}>
            <VehicleHero
            vehicle={data}
            photos={photos.data}
            monthly={monthly.isPending ? undefined : (monthly.data ?? null)}
            health={health.isPending ? undefined : (health.data?.overall ?? null)}
            next={activity.data ? nextUp(activity.data.planned, data.odometerUnit) : undefined}
            bay={bay}
            y={y}
            refreshing={refreshing}
            onAddPhoto={addPhoto}
            onEdit={edit}
            // The reading opens the form that changes it; the spend and the gauge, Stats.
            onLogOdometer={() => setQuickRequest('odometer')}
            onOpenStats={() => go('statistics')}
            onOpenPlanned={() => go('planned')}
            />
          </View>
        ) : staged ? (
          <VehicleHeroSkeleton />
        ) : null}

        {/*
         * The whole point of the app on a phone (PRD §6.6): a few taps at a pump, saved on the
         * phone before the network is involved at all. Drawn at once, usable once the vehicle is
         * known — an entry saved before then would guess its unit and currency.
         */}
        {sections ? (
          <>
            <Kept shown={tab === 'activity'} built={built.includes('activity')}>
              {sections.activity}
            </Kept>
            <Kept shown={tab === 'planned'} built={built.includes('planned')}>
              {sections.planned}
            </Kept>
            <Kept shown={tab === 'statistics'} built={built.includes('statistics')}>
              {sections.statistics}
            </Kept>
            <Kept shown={tab === 'documents'} built={built.includes('documents')}>
              {sections.documents}
            </Kept>
          </>
        ) : null}
      </Animated.ScrollView>

      <VehicleTopBar
        vehicle={data}
        y={y}
        pinned={!staged}
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))}
        onMore={openMenu}
      />

      <VehicleDock
        vehicleId={id}
        vehicleName={data?.displayName}
        quickRequest={quickRequest}
        onQuickHandled={() => setQuickRequest(null)}
        value={tab}
        onChange={go}
      />

      {/* One sheet for both steps, so the confirm replaces the menu in place instead of stacking. */}
      {menu === 'actions' ? (
        <MenuSheet
          title={data?.displayName ?? 'Vehicle'}
          options={[
            {
              label: 'Edit details',
              icon: 'create-outline',
              onPress: () => {
                setMenu(null);
                edit();
              },
            },
            ...(canArchive
              ? [
                  {
                    label: 'Archive vehicle',
                    icon: 'archive-outline' as const,
                    destructive: true,
                    onPress: () => setMenu('archive'),
                  },
                ]
              : []),
          ]}
          onClose={() => setMenu(null)}
        />
      ) : menu === 'archive' ? (
        <MenuSheet
          title={`Archive ${name}?`}
          message="Its history and documents are kept. An owner can bring it back."
          options={[
            { label: 'Archive', icon: 'archive-outline', destructive: true, onPress: archive },
            { label: 'Keep it', icon: 'arrow-undo-outline', onPress: () => setMenu('actions') },
          ]}
          onClose={() => setMenu(null)}
        />
      ) : null}
    </KeyboardAvoidingView>
  );
}

/** How long the dock takes to move to a new place, before a section is built behind it. */
const DOCK_SETTLE = 280;
/** The sections built ahead, lightest first, and the pause before each. */
const PREBUILD: readonly VehicleTab[] = ['planned', 'documents', 'statistics'];
const PREBUILD_GAP = 700;

/** A section once built: shown, or kept out of the layout while another is. */
function Kept({ shown, built, children }: { shown: boolean; built: boolean; children: ReactNode }) {
  if (!built) return null;
  return <View style={shown ? styles.section : styles.kept}>{children}</View>;
}

const styles = StyleSheet.create({
  section: { flexGrow: 1 },
  kept: { display: 'none' },
  // The dock sits over the bottom of the screen, so the last row clears it rather than
  // ending underneath it.
  // The stage meets the top edge; everything under it keeps the page's gutter. At least a
  // screen tall, so a short logbook's sheet still reaches the bottom.
  page: { flexGrow: 1, paddingHorizontal: spacing.lg, gap: spacing.lg },
});
