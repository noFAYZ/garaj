import '@/lib/crash';
import NetInfo from '@react-native-community/netinfo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import {
  focusManager,
  MutationCache,
  onlineManager,
  QueryClient,
  useQueryClient,
  type Query,
} from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Stack, useRouter, type ErrorBoundaryProps } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';
import { ApiError, planWall } from '@vehicle-os/api-client';
import { api } from '@/lib/api';
import { useSession } from '@/lib/auth';
import { reportError } from '@/lib/crash';
import { registerForPush } from '@/lib/push';
import { appearanceReady } from '@/lib/appearance';
import { welcomeReady } from '@/lib/onboarding';
import { useAppFonts } from '@/lib/fonts';
import { flush, keptFiles, onPlanWall, onSynced } from '@/lib/offline';
import { showUpgrade } from '@/lib/upgrade';
import { sweepOrphans } from '@/lib/local-files';
import { spacing, typeScale, useTheme } from '@/lib/theme';
import { Button } from '@/lib/ui';
import { watchForUpdates } from '@/lib/updates';
import { DialogHost } from '@/lib/dialog';
import { Backdrop } from '@/components/backdrop';
import { Launch } from '@/components/launch';
import { StackHeader } from '@/components/settings-kit';

/*
 * The garage is always under whatever opened first. A link that cold-starts the app — the return
 * from a checkout, a shared vehicle — otherwise builds a stack of that one screen: no back button
 * on iOS, and Back on Android closes the app.
 */
export const unstable_settings = { anchor: '(tabs)' };

watchForUpdates();

/*
 * The native splash stays up until the launch screen (`components/launch`) has drawn its first
 * frame — the same frame — over it; the launch then plays while fonts, session and cache come in
 * behind it, and leaves for the garage once they have, never through a blank page, a "Starting"
 * spinner and a skeleton on the way.
 */
void SplashScreen.preventAutoHideAsync().catch(() => undefined);
try {
  // A cut, not a fade: what is under it is the same picture, and a fade would show both at once.
  SplashScreen.setOptions({ duration: 0, fade: false });
} catch {
  // Not every runtime has it; the splash simply cuts.
}
// However long the disk takes, the splash is never what is left on screen.
const SPLASH_PATIENCE_MS = 3_000;

/*
 * React Query, told what a phone knows. Out of the box it listens for a browser's window focus
 * and `online` events, neither of which exists here — so coming back to the app never refetched
 * anything stale, and a lost signal looked like a failing server. The app's foreground is the
 * focus; the radio is the connection.
 */
focusManager.setEventListener((handleFocus) => {
  const subscription = AppState.addEventListener('change', (state) =>
    handleFocus(state === 'active'),
  );
  return () => subscription.remove();
});
onlineManager.setEventListener((setOnline) =>
  // `null` is "not known yet", which is not the same as offline.
  NetInfo.addEventListener((state) => setOnline(state.isConnected !== false)),
);

/**
 * Offline reads.
 *
 * The cache is written to AsyncStorage and restored on launch, so opening the app in a car
 * park with no signal shows the garage as it was rather than an empty screen. A day is long
 * enough to cover a weekend away and short enough that nothing shown is absurd; anything
 * older is dropped and refetched.
 */
const persister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: 'vehicleos.query-cache',
});
const DAY_MS = 24 * 60 * 60 * 1000;

const isEmpty = (value: unknown) =>
  typeof value === 'object' && value !== null && Object.keys(value).length === 0;

/**
 * What is kept on disk: the screens as they first open, not everything ever looked at.
 *
 * The whole cache is one AsyncStorage value, and on Android that store caps out around 6 MB in
 * all and 2 MB for any one value it reads back — the offline queue lives in the same store. Kept
 * whole, a few vehicles' feeds, reports and a PDF being viewed would grow it past the point it
 * can be read, and the next launch would restore nothing. So: the lists, each vehicle and its
 * first page of record, photos, plans and health. Reports, older pages and files refetch.
 */
function persists(query: Query): boolean {
  if (query.state.status !== 'success') return false;
  const [root, id, section, filters] = query.queryKey;
  if (root !== 'vehicles') {
    return ['me', 'garages', 'dashboard', 'tasks', 'due', 'vehicle-types'].includes(root as string);
  }
  // The list (`['vehicles', filters]`) and each vehicle (`['vehicles', id]`).
  if (typeof id !== 'string' || query.queryKey.length === 2) return true;
  if (section === 'activity') return query.queryKey.length === 4 && isEmpty(filters);
  if (section === 'maintenance') return query.queryKey.length === 4 && typeof filters === 'object';
  return section === 'photos' || section === 'health';
}

/*
 * A cache written by another version of the app is not read: the shape of a response can change
 * between releases, and a screen handed last version's shape crashes before it can refetch.
 */
const BUSTER = `${Constants.expoConfig?.version ?? '0'}+1`;

/*
 * How long a read counts as current before a focus or a remount asks again.
 *
 * A minute by default. The reports — totals, trends, the ledger, readings, income, value and
 * condition — are sums of the person's own records, and every write to a vehicle already
 * invalidates everything under it (`onSynced`, the forms), so asking again on each return to the
 * app only re-sends the same sums: with a vehicle open that was a dozen requests per foreground.
 * They keep for ten minutes; a garage member's edit made elsewhere shows within that, or at once
 * on a pull to refresh.
 */
const STALE_MS = 60_000;
const REPORT_STALE_MS = 10 * 60_000;
const REPORTS = new Set(['cost', 'income', 'mileage-report', 'condition', 'valuations']);
function staleTimeOf(query: Query): number {
  const [root, , section, part] = query.queryKey;
  const report =
    root === 'vehicles' &&
    (REPORTS.has(section as string) || (section === 'events' && part === 'readings'));
  return report ? REPORT_STALE_MS : STALE_MS;
}

function createQueryClient() {
  return new QueryClient({
    /*
     * A refusal that costs money opens the upgrade wall, from whichever screen raised it — one
     * branch here rather than one per form, so no gated action can forget to have one. Writes
     * that went through the offline queue arrive by `onPlanWall` instead, below.
     */
    mutationCache: new MutationCache({
      onError: (error) => {
        const wall = planWall(error);
        if (wall) showUpgrade(wall);
      },
    }),
    defaultOptions: {
      queries: {
        staleTime: staleTimeOf,
        // Long enough to survive being restored from disk — the default five minutes would
        // have every restored query garbage-collected before it was ever shown.
        gcTime: DAY_MS,
        retry(failureCount, error) {
          // A 401 will not become a 200 on the second attempt, and retrying it delays the
          // sign-in screen the user actually needs.
          if (error instanceof ApiError && error.status < 500) return false;
          return failureCount < 2;
        },
      },
      /*
       * Every save goes through the offline queue, which is local work: a mutation paused for
       * "no network" would hold a fill-up typed in a car park until the signal came back.
       */
      mutations: { retry: false, networkMode: 'always' },
    },
  });
}

/**
 * The last word on a screen that threw while drawing: what happened, and the way back — rather
 * than the blank page a release build otherwise leaves. The error goes to crash reporting.
 */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  const theme = useTheme();
  useEffect(() => reportError(error, { boundary: 'root' }), [error]);
  // A launch that threw never let the native splash go: this page is not left under it.
  useEffect(() => void SplashScreen.hideAsync().catch(() => undefined), []);
  return (
    <View style={[styles.fault, { backgroundColor: theme.background }]}>
      <Text style={[typeScale.title, { color: theme.foreground, textAlign: 'center' }]}>
        Something went wrong
      </Text>
      <Text style={[typeScale.body, { color: theme.mutedForeground, textAlign: 'center' }]}>
        This screen ran into a problem. Your records are safe — nothing saved has been lost.
      </Text>
      <Button label="Try again" variant="primary" onPress={() => void retry()} />
    </View>
  );
}

export default function RootLayout() {
  const theme = useTheme();
  const fontsLoaded = useAppFonts();
  const { loading, token } = useSession();
  const signedIn = Boolean(token);
  // In state rather than at module scope so a fast refresh does not hand the app a client
  // whose cache belongs to the previous module instance.
  const [queryClient] = useState(createQueryClient);
  const [restored, setRestored] = useState(false);
  // Light or dark as chosen in Settings: read under the splash, so the first frame is already in it.
  const [schemed, setSchemed] = useState(false);
  useEffect(() => {
    void appearanceReady.then(() => setSchemed(true));
  }, []);
  // Whether this phone has seen the welcome: read under the launch screen, so a new install opens
  // straight onto it rather than flashing the sign-in form first.
  const [welcomeRead, setWelcomeRead] = useState(false);
  useEffect(() => {
    void welcomeReady.then(() => setWelcomeRead(true));
  }, []);

  const ready = fontsLoaded && !loading && restored && schemed && welcomeRead;
  // The launch screen over everything until the app behind is ready and it has driven off.
  const [launching, setLaunching] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setRestored(true), SPLASH_PATIENCE_MS);
    return () => clearTimeout(timer);
  }, []);

  /*
   * The launch screen needs no font, so it is mounted at once and takes over from the native
   * splash (in Expo Go, from Expo Go's own loading page) while the fonts are still on their way.
   * It is always the fragment's second child, so nothing that arrives in front of it remounts it.
   *
   * Nothing else renders until the font is in memory. RN has no `font-display: swap` — text
   * drawn before the file loads is drawn in the system font and then re-laid-out, which moves
   * the whole screen under the reader on every cold start. The launch screen covers the wait.
   */
  return (
    <>
      {fontsLoaded ? (
        <PersistQueryClientProvider
          client={queryClient}
          persistOptions={{
            persister,
            maxAge: DAY_MS,
            buster: BUSTER,
            dehydrateOptions: { shouldDehydrateQuery: persists },
          }}
          onSuccess={() => setRestored(true)}
          onError={() => setRestored(true)}
        >
          {/* The app's scheme, not the phone's: they differ once one is chosen in Settings. */}
          <StatusBar style={theme.dark ? 'light' : 'dark'} />
          {/*
           * No navigator until the keystore has been read. Mounted any sooner, its first frame is a
           * signed-out one — only sign-in exists — and the token arriving a moment later swaps the
           * whole stack under it: the garage mounts mid-change, and its tabs' history is reconciled
           * against a state that has already been replaced ('ROUTE_NAMES_CHANGED … was not handled').
           * The launch screen covers the wait.
           */}
          {loading ? null : (
            <AuthGate>
              <Stack
                /*
                 * Every screen on the app's grained copper backdrop. Each keeps an opaque layer of its
                 * own (the page colour under the gradient), so a screen pushed over another never shows
                 * the one beneath through it.
                 *
                 * The header is drawn here, on that backdrop, rather than in the navigator's slot: the
                 * slot sits above this layer on the plain page colour, a white band over the gradient
                 * (user asked it gone). The app's header, not the platform's: back in a round key, the
                 * title large beside it, actions round at the side — Settings' own. Fixed above the
                 * screen, so content scrolls under an edge, not beneath a floating bar.
                 */
                screenLayout={({ children, options }) => (
                  <View style={{ flex: 1, backgroundColor: theme.background }}>
                    <Backdrop />
                    {options.headerShown === false ? null : <StackHeader options={options} />}
                    {children}
                  </View>
                )}
                screenOptions={{
                  // The navigator draws no header of its own: `screenLayout` above draws the app's.
                  header: () => null,
                  headerTransparent: false,
                  // A push slides with the platform's own curve; the content inside does the rest.
                  animation: 'ios_from_right',
                  contentStyle: { backgroundColor: theme.background },
                  /*
                   * A screen under another stops re-rendering until it is back on top: the garage
                   * behind a vehicle, the vehicle behind an entry. Its state is kept; a query that
                   * changed meanwhile draws once, as it returns.
                   */
                  freezeOnBlur: true,
                }}
              >
                {/*
                 * The session decides which screens exist at all. Signed out, the garage and everything
                 * under it are not in the stack — nothing mounts, nothing fetches, and a link into it
                 * lands on sign-in; signed in, sign-in is not there to go back to. A session that ends
                 * (signed out, or refused by the server) moves the person the moment it changes.
                 */}
                <Stack.Protected guard={!signedIn}>
                  <Stack.Screen name="sign-in" options={{ headerShown: false }} />
                </Stack.Protected>
                <Stack.Protected guard={signedIn}>
                  <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                  {/*
                   * The first-run garage setup: over everything, full screen, and not swiped away — it
                   * closes from its own key, or by finishing.
                   */}
                  <Stack.Screen
                    name="onboarding"
                    options={{
                      headerShown: false,
                      presentation: 'fullScreenModal',
                      animation: 'fade_from_bottom',
                      gestureEnabled: false,
                    }}
                  />
                  <Stack.Screen name="vehicle/[id]" options={{ title: 'Vehicle' }} />
                  <Stack.Screen name="garage/[id]" options={{ title: 'Garage' }} />
                  <Stack.Screen name="vehicle/edit" options={{ title: 'Edit details' }} />
                  <Stack.Screen name="add/vehicle" options={{ title: 'Add a vehicle' }} />
                  <Stack.Screen name="add/garage" options={{ title: 'New garage' }} />
                  <Stack.Screen name="add/document" options={{ title: 'Add a document' }} />
                  <Stack.Screen name="add/photo" options={{ title: 'Add a photo' }} />
                  <Stack.Screen name="event/[id]" options={{ title: 'Entry' }} />
                  <Stack.Screen name="document/[id]" options={{ title: 'Document' }} />
                  <Stack.Screen name="notifications" options={{ title: 'Notifications' }} />
                  {/* The branches of You: the root is a map, each control one level down. */}
                  <Stack.Screen name="settings/account" options={{ title: 'Account' }} />
                  <Stack.Screen name="settings/plan" options={{ title: 'Plan' }} />
                  <Stack.Screen name="settings/currency" options={{ headerShown: false }} />
                  <Stack.Screen name="settings/timezone" options={{ headerShown: false }} />
                  <Stack.Screen name="settings/device" options={{ title: 'This phone' }} />
                  <Stack.Screen name="settings/data" options={{ title: 'Data & garages' }} />
                  {/*
                   * A modal, so it rises over the screen that hit the wall and closing it returns there —
                   * the add form, the vehicle, the tab — rather than to wherever settings sat.
                   */}
                  <Stack.Screen
                    name="upgrade"
                    options={{
                      headerShown: false,
                      presentation: 'modal',
                      animation: 'slide_from_bottom',
                    }}
                  />
                  {/* Moving to a smaller plan: the diff, over the plan screen that asked for it. */}
                  <Stack.Screen
                    name="plan-change"
                    options={{
                      headerShown: false,
                      presentation: 'modal',
                      animation: 'slide_from_bottom',
                    }}
                  />
                </Stack.Protected>
                <Stack.Screen name="+not-found" options={{ title: 'Not found' }} />
              </Stack>
            </AuthGate>
          )}
          {/* The app's own pop-up, over every screen. */}
          <DialogHost />
        </PersistQueryClientProvider>
      ) : null}
      {launching ? <Launch ready={ready} onDone={() => setLaunching(false)} /> : null}
    </>
  );
}

/** Notification taps already acted on, so a remount does not open the same one twice. */
const opened = new Set<string>();

/**
 * What a signed-in session runs in the background: notification taps, push registration, and the
 * write queue draining. Which screens exist is the stack's own `Stack.Protected` guard, above.
 */
function AuthGate({ children }: { children: React.ReactNode }) {
  const { token } = useSession();
  const router = useRouter();
  const queryClient = useQueryClient();

  /*
   * A reminder tapped on the lock screen opens what it is about — the vehicle, or the list when
   * it names none — whether the app was running or launched by the tap. Marked read on the way,
   * so the bell does not still count it.
   */
  const response = Notifications.useLastNotificationResponse();
  useEffect(() => {
    if (!token || !response) return;
    const key = response.notification.request.identifier;
    if (opened.has(key)) return;
    opened.add(key);
    const data = (response.notification.request.content.data ?? {}) as {
      vehicleId?: unknown;
      notificationId?: unknown;
    };
    if (typeof data.notificationId === 'string') {
      void api.notifications
        .markRead(data.notificationId)
        .then(() => queryClient.invalidateQueries({ queryKey: ['notifications'] }))
        .catch(() => undefined);
    }
    if (typeof data.vehicleId === 'string') {
      router.push({ pathname: '/vehicle/[id]', params: { id: data.vehicleId } });
    } else {
      router.push('/notifications');
    }
  }, [response, token, router, queryClient]);

  /*
   * Anything queued while offline goes out on launch and every time the app comes back to
   * the foreground, and the moment the radio reports a usable connection again — which is the
   * one that matters in a basement, where the app never left the foreground and the timer would
   * otherwise be the only thing trying.
   */
  useEffect(() => {
    if (!token) return;

    void flush();
    // Only where permission is already given: the question itself is asked when a reminder is
    // made, the moment it means something (`lib/push`).
    void registerForPush().catch(() => undefined);
    // Bytes from a crash between copying a file and queueing the entry that names it.
    void keptFiles().then((paths) => sweepOrphans(paths).catch(() => 0));

    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void flush();
    });

    /*
     * The edge that matters: `isInternetReachable` going true is the phone leaving the tunnel,
     * and the queue goes out in the same second rather than up to fifteen later. Only on the
     * rising edge — a listener that fires on every state object would flush on each change of
     * signal strength.
     */
    let reachable = false;
    const stopWatching = NetInfo.addEventListener((state) => {
      const now = state.isConnected === true && state.isInternetReachable !== false;
      if (now && !reachable) void flush();
      reachable = now;
    });
    /*
     * And on a timer, cheaply, while the app is in front: a flush with nothing queued is a
     * storage read, not a request. So an entry saved in a basement still goes out even if the
     * radio never reports the change.
     */
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') void flush();
    }, 15_000);
    /*
     * Once anything reaches the server, what it changed is refetched — the lists, the dashboard,
     * the task lists, and everything under the vehicles the writes were about (the feed, the
     * odometer, the reports). Not every vehicle's: a fill-up on one is no reason to refetch the
     * open screens of another.
     */
    const stopListening = onSynced((vehicles) => {
      void queryClient.invalidateQueries({
        queryKey: ['vehicles'],
        predicate: vehicles
          ? ({ queryKey: [, id] }) => typeof id !== 'string' || vehicles.has(id)
          : undefined,
      });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
    });
    // A notification arriving while the app is open: the bell and the list count it now, not on
    // the next return to the app.
    const received = Notifications.addNotificationReceivedListener(() => {
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    });
    // A write queued offline and refused by the plan on reconnect: the form is long gone, so
    // the wall is raised from here, and the plan is refetched so the counts match the refusal.
    const stopWalls = onPlanWall((wall) => {
      showUpgrade(wall);
      void queryClient.invalidateQueries({ queryKey: ['me', 'plan'] });
    });
    return () => {
      subscription.remove();
      stopWatching();
      clearInterval(timer);
      stopListening();
      received.remove();
      stopWalls();
    };
  }, [token, queryClient]);

  return <>{children}</>;
}

const styles = StyleSheet.create({
  fault: {
    flex: 1,
    justifyContent: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
  },
});
