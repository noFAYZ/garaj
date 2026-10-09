import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import {
  Alert,
  Animated,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  type ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import {
  garagesQuery,
  monthlySpendQuery,
  photosQuery,
  queryKeys,
  vehicleQuery,
} from '@vehicle-os/api-client/react';
import { capabilitiesFor } from '@vehicle-os/domain';
import { ActivityFeed, VehiclePlanned } from '@/components/activity-feed';
import { VehicleDocuments } from '@/components/vehicle-documents';
import { VehicleStatistics } from '@/components/vehicle-statistics';
import type { QuickAction } from '@/components/quick-entry-form';
import { useDockSpace } from '@/components/dock';
import { VehicleDock, type VehicleTab } from '@/components/vehicle-dock';
import { VehicleHeaderTitle, VehicleHero, VehicleHeroSkeleton } from '@/components/vehicle-hero';
import { api } from '@/lib/api';
import { enqueue, flush } from '@/lib/offline';
import { fileParams, pickPhoto } from '@/lib/file-picker';
import { haptic, Rise, useScrollY } from '@/lib/motion';
import { MenuSheet } from '@/lib/pickers';
import { spacing, useTheme } from '@/lib/theme';
import { IconButton } from '@/lib/ui';

/** The navigation header's height, so a jump inside the feed lands below it. */
const HEADER_CLEARANCE = 68;

/**
 * One vehicle: its name and badge in the bar, its pass — photo, plate, paint, VIN — and its
 * activity underneath. What it reads is in Stats; recording something is the dock's +.
 */
export default function VehicleScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const dockSpace = useDockSpace();
  const router = useRouter();
  const queryClient = useQueryClient();
  const scroller = useRef<ScrollView>(null);
  const { y, onScroll } = useScrollY();
  const statsY = useRef(0);
  const [tab, setTab] = useState<VehicleTab>('activity');
  /* Raised by the odometer reading in Stats; the dock's sheet is what actually opens. */
  const [quickRequest, setQuickRequest] = useState<QuickAction | null>(null);
  const vehicle = useQuery(vehicleQuery(api, id));
  // Its own query, so a slow photo list never holds up the name.
  const photos = useQuery(photosQuery(api, id));
  // The hero's spend: this month, from the same months the web's cockpit reads.
  const monthly = useQuery(monthlySpendQuery(api, id));

  /*
   * Only for the role. The list is already in cache from the home screen, so this is a read
   * rather than a request, and an absent one simply leaves the control hidden.
   */
  const garages = useQuery(garagesQuery(api));
  const data = vehicle.data;
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
      <Stack.Screen
        options={{
          title: data?.displayName ?? 'Vehicle',
          /*
           * The hero says who the vehicle is; once it has scrolled away the bar takes over, fading
           * in as the name leaves — the web's header lifting at the top of a long record.
           */
          headerTitle: () => (
            <Animated.View
              style={{
                opacity: y.interpolate({
                  inputRange: [24, 64],
                  outputRange: [0, 1],
                  extrapolate: 'clamp',
                }),
              }}
            >
              <VehicleHeaderTitle vehicle={data} />
            </Animated.View>
          ),
          headerRight: () => (
            /*
             * One control up here. Adding is the dock's + at the bottom of the screen, and two
             * + buttons on one screen — one under the thumb, one in the far corner — is the
             * reader working out whether they do the same thing.
             */
            <IconButton
              icon="ellipsis-horizontal"
              size={36}
              onPress={openMenu}
              label={`More for ${data?.displayName ?? 'this vehicle'}`}
            />
          ),
        }}
      />

      <Animated.ScrollView
        ref={scroller}
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={[styles.page, { paddingBottom: dockSpace }]}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={vehicle.isFetching && !vehicle.isPending}
            onRefresh={refresh}
            tintColor={theme.mutedForeground}
          />
        }
      >
        {/* The vehicle heads every one of its sections, as it does on the web. */}
        {data ? (
          <Rise>
            <VehicleHero
              vehicle={data}
              photos={photos.data}
              monthly={monthly.isPending ? undefined : (monthly.data ?? null)}
              onAddPhoto={addPhoto}
              onEdit={edit}
              // The reading opens the form that changes it; the spend opens every other figure.
              onLogOdometer={() => setQuickRequest('odometer')}
              onOpenStats={() => setTab('statistics')}
            />
          </Rise>
        ) : (
          <VehicleHeroSkeleton />
        )}

        {/*
         * The whole point of the app on a phone (PRD §6.6): a few taps at a pump, saved on the
         * phone before the network is involved at all. Drawn at once, usable once the vehicle is
         * known — an entry saved before then would guess its unit and currency.
         */}
        {!data ? null : tab === 'activity' ? (
          <ActivityFeed vehicle={data} />
        ) : tab === 'planned' ? (
          <VehiclePlanned vehicle={data} />
        ) : tab === 'statistics' ? (
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
                  y: statsY.current + offset - HEADER_CLEARANCE,
                  animated: true,
                })
              }
            />
          </View>
        ) : (
          <VehicleDocuments vehicleId={id} />
        )}
      </Animated.ScrollView>

      <VehicleDock
        vehicleId={id}
        vehicleName={data?.displayName}
        quickContext={
          data
            ? {
                unit: data.odometerUnit === 'MI' ? 'mi' : 'km',
                currency: data.purchasePrice?.currency ?? 'USD',
                currentOdometer: data.currentOdometer,
              }
            : undefined
        }
        quickRequest={quickRequest}
        onQuickHandled={() => setQuickRequest(null)}
        value={tab}
        onChange={setTab}
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

const styles = StyleSheet.create({
  // The dock sits over the bottom of the screen, so the last row clears it rather than
  // ending underneath it.
  page: { padding: spacing.lg, paddingTop: spacing.sm, gap: spacing.lg },
});
