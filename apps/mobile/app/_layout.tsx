import NetInfo from '@react-native-community/netinfo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { MutationCache, QueryClient, useQueryClient } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { AppState, View } from 'react-native';
import { ApiError, planWall } from '@vehicle-os/api-client';
import { useSession } from '@/lib/auth';
import { registerForPush } from '@/lib/push';
import { useAppFonts } from '@/lib/fonts';
import { flush, keptFiles, onPlanWall, onSynced } from '@/lib/offline';
import { showUpgrade } from '@/lib/upgrade';
import { sweepOrphans } from '@/lib/local-files';
import { useTheme } from '@/lib/theme';
import { Loading } from '@/lib/ui';

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
        staleTime: 60_000,
        // Long enough to survive being restored from disk — the default five minutes would
        // have every restored query garbage-collected before it was ever shown.
        gcTime: 24 * 60 * 60 * 1000,
        retry(failureCount, error) {
          // A 401 will not become a 200 on the second attempt, and retrying it delays the
          // sign-in screen the user actually needs.
          if (error instanceof ApiError && error.status < 500) return false;
          return failureCount < 2;
        },
      },
      mutations: { retry: false },
    },
  });
}

export default function RootLayout() {
  const theme = useTheme();
  const fontsLoaded = useAppFonts();
  // In state rather than at module scope so a fast refresh does not hand the app a client
  // whose cache belongs to the previous module instance.
  const [queryClient] = useState(createQueryClient);

  /*
   * Nothing renders until the font is in memory. RN has no `font-display: swap` — text drawn
   * before the file loads is drawn in the system font and then re-laid-out, which moves the
   * whole screen under the reader on every cold start.
   */
  if (!fontsLoaded) {
    return <View style={{ flex: 1, backgroundColor: theme.background }} />;
  }

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{ persister, maxAge: 24 * 60 * 60 * 1000 }}
    >
      <StatusBar style="auto" />
      <AuthGate>
        <Stack
          screenOptions={{
            /*
             * The header is part of the page: the page's own colour, no shadow or hairline, and
             * never transparent — content scrolls under a fixed edge, not beneath a floating bar.
             */
            headerStyle: { backgroundColor: theme.background },
            headerShadowVisible: false,
            headerTransparent: false,
            headerTintColor: theme.foreground,
            // Named outright: the navigator sets its own family, which the font patch leaves alone.
            headerTitleStyle: {
              fontFamily: 'AlbertSans_700Bold',
              fontSize: 16,
              color: theme.foreground,
            },
            // A push slides with the platform's own curve; the content inside does the rest.
            animation: 'ios_from_right',
            headerBackButtonDisplayMode: 'minimal',
            contentStyle: { backgroundColor: theme.background },
          }}
        >
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="sign-in" options={{ headerShown: false }} />
          <Stack.Screen name="vehicle/[id]" options={{ title: 'Vehicle' }} />
          <Stack.Screen name="garage/[id]" options={{ title: 'Garage' }} />
          <Stack.Screen name="vehicle/edit" options={{ title: 'Edit details' }} />
          <Stack.Screen name="add/vehicle" options={{ title: 'Add a vehicle' }} />
          <Stack.Screen name="add/garage" options={{ title: 'New garage' }} />
          <Stack.Screen name="add/done" options={{ title: 'Something done' }} />
          <Stack.Screen name="add/planned" options={{ title: 'Something planned' }} />
          <Stack.Screen name="add/document" options={{ title: 'Add a document' }} />
          <Stack.Screen name="add/photo" options={{ title: 'Add a photo' }} />
          <Stack.Screen name="event/[id]" options={{ title: 'Entry' }} />
          <Stack.Screen name="document/[id]" options={{ title: 'Document' }} />
          <Stack.Screen name="notifications" options={{ title: 'Notifications' }} />
          {/* The branches of You: the root is a map, each control one level down. */}
          <Stack.Screen name="settings/account" options={{ title: 'Account' }} />
          <Stack.Screen name="settings/plan" options={{ title: 'Plan' }} />
          <Stack.Screen name="settings/units" options={{ title: 'Units & region' }} />
          <Stack.Screen name="settings/device" options={{ title: 'This phone' }} />
          <Stack.Screen name="settings/data" options={{ title: 'Data & garages' }} />
          {/*
           * A modal, so it rises over the screen that hit the wall and closing it returns there —
           * the add form, the vehicle, the tab — rather than to wherever settings sat.
           */}
          <Stack.Screen
            name="upgrade"
            options={{ headerShown: false, presentation: 'modal', animation: 'slide_from_bottom' }}
          />
          {/* Moving to a smaller plan: the diff, over the plan screen that asked for it. */}
          <Stack.Screen
            name="plan-change"
            options={{ headerShown: false, presentation: 'modal', animation: 'slide_from_bottom' }}
          />
        </Stack>
      </AuthGate>
    </PersistQueryClientProvider>
  );
}

/**
 * Sends people to the sign-in screen, and drains the write queue.
 *
 * The redirect runs in an effect rather than by rendering `<Redirect>`: Expo Router cannot
 * navigate until the root layout has mounted, and doing it during render throws.
 */
function AuthGate({ children }: { children: React.ReactNode }) {
  const { token, loading } = useSession();
  const segments = useSegments();
  const router = useRouter();
  const theme = useTheme();

  const onSignIn = segments[0] === 'sign-in';

  useEffect(() => {
    if (loading) return;
    if (!token && !onSignIn) router.replace('/sign-in');
    if (token && onSignIn) router.replace('/');
  }, [token, loading, onSignIn, router]);

  /*
   * Anything queued while offline goes out on launch and every time the app comes back to
   * the foreground, and the moment the radio reports a usable connection again — which is the
   * one that matters in a basement, where the app never left the foreground and the timer would
   * otherwise be the only thing trying.
   */
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!token) return;

    void flush();
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
     * And on a timer, cheaply: a flush with nothing queued is a storage read, not a request. So an
     * entry saved in a basement still goes out even if the radio never reports the change — the
     * belt to NetInfo's braces, and a flush with nothing queued is a storage read, not a request.
     */
    const timer = setInterval(() => void flush(), 15_000);
    // Once anything reaches the server, what it changed is refetched — the feed, the odometer,
    // the dashboard and the task lists.
    const stopListening = onSynced(() => {
      void queryClient.invalidateQueries({ queryKey: ['vehicles'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
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
      stopWalls();
    };
  }, [token, queryClient]);

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.background }}>
        <Loading label="Starting" />
      </View>
    );
  }

  return <>{children}</>;
}
