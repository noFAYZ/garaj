import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  Animated,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useDockSpace } from '@/components/dock';
import type { VehicleStatus } from '@vehicle-os/domain';
import { garagesQuery, vehiclesQuery } from '@vehicle-os/api-client/react';
import { useSpent, VehicleCard, VehicleCardSkeleton } from '@/components/vehicle-card';
import { api } from '@/lib/api';
import { humanise } from '@/lib/format';
import { Chip, ToneTile } from '@/lib/instrument';
import { PressableScale, Rise, useScrollY } from '@/lib/motion';
import { radius, rimmed, spacing, typeScale, useTheme } from '@/lib/theme';
import { Button, CompactHeader, IconButton, LargeHeader } from '@/lib/ui';

/** Past this many vehicles, finding one by name is quicker than scrolling for it. */
const SEARCH_FROM = 5;

/**
 * Every vehicle, as a two-up grid — "which one", where the Garage tab answers "what is
 * happening".
 *
 * Filters appear only when they are a choice: garages once there are two, statuses once the list
 * holds more than one, search once there are enough vehicles to lose one.
 */
export default function VehiclesScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const dockSpace = useDockSpace();
  const { y, onScroll } = useScrollY();
  const vehicles = useQuery(vehiclesQuery(api));
  const garages = useQuery(garagesQuery(api));
  const [status, setStatus] = useState<VehicleStatus | null>(null);
  const [query, setQuery] = useState('');
  // A garage card on the Garage tab opens this tab scoped to that garage.
  const { garageId } = useLocalSearchParams<{ garageId?: string }>();
  const [garage, setGarage] = useState<string | null>(garageId ?? null);
  useEffect(() => {
    if (garageId) setGarage(garageId);
  }, [garageId]);

  const all = vehicles.data?.data ?? [];
  const spent = useSpent(all);
  const garageList = garages.data ?? [];
  const garageName = new Map(garageList.map((item) => [item.id, item.name]));
  const inGarage = all.filter((vehicle) => !garage || vehicle.garageId === garage);
  const statuses = [...new Set(inGarage.map((vehicle) => vehicle.status))];
  const needle = query.trim().toLowerCase();
  const list = inGarage
    .filter((vehicle) => !status || vehicle.status === status)
    .filter(
      (vehicle) =>
        !needle ||
        [vehicle.displayName, vehicle.make, vehicle.model, vehicle.registrationIdentifier]
          .filter(Boolean)
          .some((field) => field!.toLowerCase().includes(needle)),
    );
  const filtered = Boolean(garage || status || needle);
  // Where a vehicle lives only matters when the grid mixes garages.
  const showGarage = garageList.length > 1 && !garage;

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <Animated.FlatList
        data={list}
        onScroll={onScroll}
        scrollEventThrottle={16}
        keyExtractor={(vehicle) => vehicle.id}
        contentContainerStyle={[
          styles.page,
          { paddingTop: insets.top + spacing.sm, paddingBottom: dockSpace },
        ]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        refreshControl={
          <RefreshControl
            refreshing={vehicles.isFetching && !vehicles.isPending}
            onRefresh={() => {
              void vehicles.refetch();
              void garages.refetch();
            }}
            tintColor={theme.mutedForeground}
          />
        }
        ListHeaderComponent={
          <View style={{ gap: spacing.lg, marginBottom: spacing.xs }}>
            <Rise>
              <LargeHeader
                eyebrow="Your garage"
                title="Vehicles"
                count={vehicles.data ? all.length : undefined}
                y={y}
                actions={
                  <IconButton
                    icon="add"
                    tone="primary"
                    label="Add a vehicle"
                    onPress={() => router.push('/add/vehicle')}
                  />
                }
              />
            </Rise>

            {all.length >= SEARCH_FROM ? (
              <View
                style={[
                  styles.search,
                  { backgroundColor: theme.input, borderColor: theme.borderStrong },
                ]}
              >
                <Ionicons name="search" size={17} color={theme.mutedForeground} />
                <TextInput
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Search name, make or plate"
                  placeholderTextColor={theme.mutedForeground}
                  accessibilityLabel="Search vehicles"
                  autoCorrect={false}
                  returnKeyType="search"
                  style={[typeScale.body, styles.searchInput, { color: theme.foreground }]}
                />
                {query ? (
                  <PressableScale
                    onPress={() => setQuery('')}
                    accessibilityRole="button"
                    accessibilityLabel="Clear search"
                    hitSlop={10}
                  >
                    <Ionicons name="close-circle" size={18} color={theme.mutedForeground} />
                  </PressableScale>
                ) : null}
              </View>
            ) : null}

            {/* One row of filters: garages, then a rule, then statuses. */}
            {garageList.length > 1 || statuses.length > 1 ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={{ marginHorizontal: -spacing.lg }}
                contentContainerStyle={styles.filters}
              >
                {garageList.length > 1 ? (
                  <>
                    <Chip
                      label="All"
                      count={all.length}
                      selected={garage === null}
                      onPress={() => setGarage(null)}
                    />
                    {garageList.map((item) => (
                      <Chip
                        key={item.id}
                        label={item.name}
                        count={all.filter((vehicle) => vehicle.garageId === item.id).length}
                        selected={garage === item.id}
                        onPress={() => setGarage(garage === item.id ? null : item.id)}
                      />
                    ))}
                  </>
                ) : null}
                {garageList.length > 1 && statuses.length > 1 ? (
                  <View style={[styles.rule, { backgroundColor: theme.border }]} />
                ) : null}
                {statuses.length > 1
                  ? statuses.map((value) => (
                      <Chip
                        key={value}
                        label={humanise(value)}
                        count={inGarage.filter((vehicle) => vehicle.status === value).length}
                        selected={status === value}
                        onPress={() => setStatus(status === value ? null : value)}
                      />
                    ))
                  : null}
              </ScrollView>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          vehicles.isPending ? (
            <View
              accessibilityRole="progressbar"
              accessibilityLabel="Loading vehicles"
              style={{ gap: spacing.md }}
            >
              {[0, 1].map((row) => (
                <VehicleCardSkeleton key={row} />
              ))}
            </View>
          ) : filtered ? (
            <View style={[styles.empty, { backgroundColor: theme.card }, rimmed(theme)]}>
              <Text style={[typeScale.title, { color: theme.foreground }]}>No matches</Text>
              <Text
                style={[typeScale.caption, { color: theme.mutedForeground, textAlign: 'center' }]}
              >
                Nothing here fits those filters.
              </Text>
              <Button
                label="Clear filters"
                icon="close"
                size="sm"
                onPress={() => {
                  setGarage(null);
                  setStatus(null);
                  setQuery('');
                }}
              />
            </View>
          ) : (
            <View style={[styles.empty, { backgroundColor: theme.card }, rimmed(theme)]}>
              <ToneTile tone="neutral" size={64}>
                <Ionicons name="car-sport" size={30} color={theme.foreground} />
              </ToneTile>
              <Text style={[typeScale.title, { color: theme.foreground }]}>No vehicles yet</Text>
              <Text
                style={[typeScale.caption, { color: theme.mutedForeground, textAlign: 'center' }]}
              >
                Add one to start its history.
              </Text>
              <Button
                label="Add a vehicle"
                icon="add"
                variant="primary"
                onPress={() => router.push('/add/vehicle')}
              />
            </View>
          )
        }
        // One card a row, as the web lays its grid out at a phone's width: the stage and the
        // figures get the room they are drawn for.
        renderItem={({ item, index }) => (
          <Rise index={index}>
            <VehicleCard
              vehicle={item}
              spent={spent.get(item.id)}
              subtitle={showGarage ? garageName.get(item.garageId) : undefined}
            />
          </Rise>
        )}
      />
      <CompactHeader title="Vehicles" y={y} />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: spacing.lg, gap: spacing.md },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 46,
    borderRadius: radius.xl,
    borderWidth: 1,
    paddingHorizontal: spacing.lg,
  },
  searchInput: { flex: 1, paddingVertical: 10 },
  filters: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: 4,
  },
  rule: { width: StyleSheet.hairlineWidth * 2, height: 20, marginHorizontal: 2 },
  empty: {
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.xl,
    paddingVertical: spacing.xxl,
  },
});
