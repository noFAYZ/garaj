import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Animated, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ApiError } from '@vehicle-os/api-client';
import {
  garageMembersQuery,
  garagesQuery,
  queryKeys,
  vehiclesQuery,
} from '@vehicle-os/api-client/react';
import type { Garage, GarageMember, Vehicle } from '@vehicle-os/contracts';
import { capabilitiesFor, GARAGE_ROLES, type GarageRole } from '@vehicle-os/domain';
import { BrandLogo } from '@/components/brand-logo';
import { photoKey, RemoteImage } from '@/components/remote-image';
import { vehicleIcon } from '@/components/vehicle-card';
import { api } from '@/lib/api';
import { humanise } from '@/lib/format';
import {
  Chip,
  Eyebrow,
  Panel,
  Reading,
  SectionHeading,
  SectionLink,
  ToneChip,
} from '@/lib/instrument';
import { haptic, PressableScale, Rise, useReduceMotion } from '@/lib/motion';
import { MenuSheet } from '@/lib/pickers';
import { figure, radius, rimmed, spacing, typeScale, useTheme } from '@/lib/theme';
import { Button, Empty, Face, Field, Ground, IconButton, Skeleton } from '@/lib/ui';
import { useProfile } from '@/lib/vehicle-units';

const pad = (value: number) => String(value).padStart(2, '0');

/** Owner is not offered: ownership is handed over, never assigned from a list. */
const ROLES = GARAGE_ROLES.filter((role) => role !== 'OWNER');

/** What each role may do, in a line a person would say — the web's words, so both say the same. */
const ROLE_POWERS: Record<GarageRole, string> = {
  OWNER: 'Everything, including billing and deleting the garage.',
  ADMIN: 'Everything else: its settings, its people and every record.',
  MEMBER: 'Adds and edits vehicles and all that is recorded on them.',
  DRIVER: 'Logs trips, fuel, services and photos. Edits and deletes nothing.',
  VIEWER: 'Sees everything, changes nothing.',
};

const plate = (vehicle: Vehicle) => vehicle.registrationIdentifier ?? humanise(vehicle.vehicleType);

type Sheet =
  | { kind: 'keys'; vehicleId: string }
  | { kind: 'person'; memberId: string }
  | { kind: 'add' }
  | null;

/**
 * A garage: who is in it and who drives what.
 *
 * The vehicles are keys on a board by the door. A key someone drives hangs with their faces on it;
 * one nobody drives is still on its hook, drawn in outline — so "who has the van" is a glance, and
 * handing it over is a press on the key. The people are the other way in: a person's sheet sets
 * their role and every key they hold at once. Both write the same many-to-many, from either side.
 */
export default function GarageScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const router = useRouter();
  const garages = useQuery(garagesQuery(api));
  const vehicles = useQuery(vehiclesQuery(api, { garageId: id }));
  const members = useQuery(garageMembersQuery(api, id));
  const profile = useProfile();
  const [sheet, setSheet] = useState<Sheet>(null);

  const garage = garages.data?.find((row) => row.id === id);
  const vehicleList = vehicles.data?.data ?? [];
  const memberList = members.data ?? [];
  const canManage = garage ? capabilitiesFor(garage.role).includes('garage.manage_members') : false;
  const holdersOf = (vehicleId: string) =>
    memberList.filter((member) => member.vehicleIds.includes(vehicleId));
  const drivers = memberList.filter((member) => member.vehicleIds.length > 0).length;
  const onHook = vehicleList.filter((vehicle) => holdersOf(vehicle.id).length === 0).length;
  const loading = vehicles.isPending || members.isPending;
  const shared = garage && garage.role !== 'OWNER';
  const canAddVehicle = garage ? capabilitiesFor(garage.role).includes('vehicle.write') : false;
  // The form opens with this garage already chosen.
  const addVehicle = () => {
    haptic.selection();
    router.push({ pathname: '/add/vehicle', params: { garageId: id } });
  };

  const openVehicle = (vehicleId: string) => {
    setSheet(null);
    router.push({ pathname: '/vehicle/[id]', params: { id: vehicleId } });
  };

  if (!garages.isPending && !garage) {
    return (
      <View style={[styles.missing, { backgroundColor: theme.background }]}>
        <Stack.Screen options={{ title: 'Garage' }} />
        <Empty
          title="Garage not found"
          description="It may have been deleted, or you may no longer be in it."
        />
      </View>
    );
  }

  const keysFor = sheet?.kind === 'keys' ? vehicleList.find((v) => v.id === sheet.vehicleId) : null;
  const person = sheet?.kind === 'person' ? memberList.find((m) => m.id === sheet.memberId) : null;

  return (
    <>
      <Stack.Screen
        options={{
          title: garage?.name ?? 'Garage',
          headerRight: () => (
            <View style={styles.headerActions}>
              {canManage ? (
                <IconButton
                  icon="person-add-outline"
                  size={36}
                  onPress={() => {
                    haptic.selection();
                    setSheet({ kind: 'add' });
                  }}
                  label="Add someone"
                />
              ) : null}
              {canAddVehicle ? (
                <IconButton
                  icon="add"
                  tone="primary"
                  size={36}
                  onPress={addVehicle}
                  label={`Add a vehicle to ${garage?.name ?? 'this garage'}`}
                />
              ) : null}
            </View>
          ),
        }}
      />

      <ScrollView
        style={{ backgroundColor: theme.background }}
        contentContainerStyle={styles.page}
        refreshControl={
          <RefreshControl
            refreshing={(members.isFetching || vehicles.isFetching) && !loading}
            onRefresh={() => {
              void garages.refetch();
              void vehicles.refetch();
              void members.refetch();
            }}
            tintColor={theme.mutedForeground}
          />
        }
      >
        {/* The garage's plate: what it is, who is in it, and how its keys are spread. */}
        <Rise>
          <View style={[styles.plate, { backgroundColor: theme.card }, rimmed(theme)]}>
            <Ground cx="100%" cy="0%" />
            <View style={{ gap: 4 }}>
              <Eyebrow>
                Garage
                {garage ? ` · ${garage.defaultCurrency}` : ''}
                {shared ? ` · Shared as ${humanise(garage.role)}` : ''}
              </Eyebrow>
              {garage ? (
                <Text numberOfLines={2} style={[typeScale.display, { color: theme.foreground }]}>
                  {garage.name}
                </Text>
              ) : (
                <Skeleton width={200} height={30} />
              )}
              {garage?.description ? (
                <Text
                  numberOfLines={2}
                  style={[typeScale.caption, { color: theme.mutedForeground }]}
                >
                  {garage.description}
                </Text>
              ) : null}
            </View>

            <View style={styles.crewRow}>
              {members.isPending ? (
                <Skeleton width={120} height={36} radius={999} />
              ) : (
                <View style={styles.crew}>
                  <FaceStack members={memberList} size={30} ring={theme.card} />
                  <Text style={[typeScale.caption, { color: theme.mutedForeground }]}>
                    <Text style={[figure, { fontWeight: '600', color: theme.foreground }]}>
                      {pad(memberList.length)}
                    </Text>{' '}
                    {memberList.length === 1 ? 'person' : 'people'}
                  </Text>
                </View>
              )}
              <SectionLink
                label="Vehicles"
                a11yLabel="See this garage's vehicles"
                onPress={() => router.push({ pathname: '/vehicles', params: { garageId: id } })}
              />
            </View>

            <Panel direction="row">
              <Reading
                label="Keys"
                value={vehicles.isPending ? undefined : pad(vehicleList.length)}
                note={vehicleList.length === 1 ? 'vehicle' : 'vehicles'}
              />
              <Reading
                label="Out"
                value={loading ? undefined : pad(vehicleList.length - onHook)}
                note={`${pad(drivers)} ${drivers === 1 ? 'driver' : 'drivers'}`}
              />
              <Reading
                label="On hook"
                value={loading ? undefined : pad(onHook)}
                note={onHook ? 'nobody drives' : 'all taken'}
                tone={onHook ? theme.warning : theme.success}
              />
            </Panel>
          </View>
        </Rise>

        {/* The board by the door. */}
        <Rise index={1} style={styles.section}>
          <SectionHeading
            title="Key board"
            count={vehicles.isPending ? undefined : vehicleList.length}
          />
          <Text style={[typeScale.caption, styles.lede, { color: theme.mutedForeground }]}>
            {canManage
              ? 'Who takes what. Press a key to hand it over or take it back.'
              : 'Who takes what. Press a key to open its vehicle.'}
          </Text>
          <View style={[styles.board, { backgroundColor: theme.card }, rimmed(theme)]}>
            <View style={[styles.rail, { backgroundColor: theme.borderStrong }]} />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.hooks}
            >
              {loading ? (
                [0, 1, 2].map((key) => (
                  <View key={key} style={styles.key}>
                    <View style={[styles.peg, { backgroundColor: theme.borderStrong }]} />
                    <Skeleton width={KEY} height={196} radius={radius.xl} />
                  </View>
                ))
              ) : vehicleList.length === 0 ? (
                <View style={styles.emptyBoard}>
                  <Text style={[typeScale.label, { color: theme.foreground }]}>
                    No keys on the board yet
                  </Text>
                  <Text style={[typeScale.caption, { color: theme.mutedForeground }]}>
                    Add a vehicle and its key hangs here.
                  </Text>
                  <Button label="Add a vehicle" size="sm" icon="add" onPress={addVehicle} />
                </View>
              ) : (
                vehicleList.map((vehicle, index) => (
                  <Key
                    key={vehicle.id}
                    vehicle={vehicle}
                    holders={holdersOf(vehicle.id)}
                    index={index}
                    onPress={() => {
                      haptic.selection();
                      if (canManage) setSheet({ kind: 'keys', vehicleId: vehicle.id });
                      else openVehicle(vehicle.id);
                    }}
                  />
                ))
              )}
            </ScrollView>
          </View>
        </Rise>

        <Rise index={2} style={styles.section}>
          <SectionHeading
            title="People"
            count={members.isPending ? undefined : memberList.length}
          />
          <View style={{ gap: spacing.sm }}>
            {members.isPending
              ? [0, 1].map((key) => (
                  <Skeleton key={key} width="100%" height={72} radius={radius.xl} />
                ))
              : memberList.map((member, index) => (
                  <Rise key={member.id} index={index}>
                    <PersonRow
                      member={member}
                      isYou={member.userId === profile.data?.id}
                      isOwner={member.userId === garage?.ownerId}
                      vehicles={vehicleList.filter((v) => member.vehicleIds.includes(v.id))}
                      onPress={
                        canManage
                          ? () => {
                              haptic.selection();
                              setSheet({ kind: 'person', memberId: member.id });
                            }
                          : undefined
                      }
                    />
                  </Rise>
                ))}
            {canManage && !members.isPending ? (
              <PressableScale
                onPress={() => {
                  haptic.selection();
                  setSheet({ kind: 'add' });
                }}
                accessibilityRole="button"
                accessibilityLabel="Add someone"
                scaleTo={0.98}
                style={[styles.addRow, { borderColor: theme.borderStrong }]}
              >
                <View style={[styles.addIcon, { backgroundColor: theme.primary }]}>
                  <Ionicons name="person-add" size={18} color={theme.primaryForeground} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[typeScale.label, { color: theme.foreground }]}>Add someone</Text>
                  <Text style={[typeScale.caption, { color: theme.mutedForeground }]}>
                    By email, then hand them keys.
                  </Text>
                </View>
              </PressableScale>
            ) : null}
          </View>
        </Rise>
      </ScrollView>

      {keysFor && garage ? (
        <KeysSheet
          garageId={garage.id}
          vehicle={keysFor}
          members={memberList}
          onOpenVehicle={() => openVehicle(keysFor.id)}
          onClose={() => setSheet(null)}
        />
      ) : null}
      {person && garage ? (
        <PersonSheet
          garage={garage}
          member={person}
          vehicles={vehicleList}
          isYou={person.userId === profile.data?.id}
          onLeft={() => router.back()}
          onClose={() => setSheet(null)}
        />
      ) : null}
      {sheet?.kind === 'add' && garage ? (
        <AddSheet
          garageId={garage.id}
          // Straight on to their keys: adding someone to a garage is usually so they can drive.
          onAdded={(member) => setSheet({ kind: 'person', memberId: member.id })}
          onClose={() => setSheet(null)}
        />
      ) : null}
    </>
  );
}

const KEY = 132;

/**
 * One vehicle's key, hanging from the rail: a peg, the ring, then the tag — the vehicle, its plate,
 * and the faces of everyone who drives it. A key nobody drives is an outline still on its hook.
 * Hung a degree or three off true, alternately, the way keys hang; it straightens while pressed.
 */
function Key({
  vehicle,
  holders,
  index,
  onPress,
}: {
  vehicle: Vehicle;
  holders: readonly GarageMember[];
  index: number;
  onPress: () => void;
}) {
  const theme = useTheme();
  const reduce = useReduceMotion();
  const free = holders.length === 0;
  // -1 and 1 are its two resting tilts; 0 is hanging straight.
  const rest = index % 2 ? 1 : -1;
  const [swing] = useState(() => new Animated.Value(rest));
  const swingTo = (value: number) => {
    if (reduce) return swing.setValue(value);
    Animated.spring(swing, {
      toValue: value,
      useNativeDriver: true,
      speed: 14,
      bounciness: 16,
    }).start();
  };

  return (
    <Rise index={index} style={styles.key}>
      <View style={[styles.peg, { backgroundColor: theme.borderStrong }]} />
      <PressableScale
        onPress={onPress}
        onPressIn={() => swingTo(0)}
        // Let go, it swings back past true and settles, the way a key does.
        onPressOut={() => swingTo(rest)}
        accessibilityRole="button"
        accessibilityLabel={`${vehicle.displayName}, ${
          free ? 'nobody drives it' : `driven by ${holders.map((h) => h.name).join(', ')}`
        }`}
        scaleTo={0.96}
        style={{ alignItems: 'center' }}
      >
        {/* Its own view: PressableScale's press scale would replace a transform given to it. */}
        <Animated.View
          style={{
            alignItems: 'center',
            transformOrigin: 'top',
            transform: [
              {
                rotate: swing.interpolate({
                  inputRange: [-1, 1],
                  outputRange: ['-2.5deg', '2.5deg'],
                }),
              },
            ],
          }}
        >
          <View style={[styles.ring, { borderColor: theme.borderStrong }]} />
          <View
            style={[
              styles.tag,
              free
                ? { borderColor: theme.borderStrong, borderStyle: 'dashed' }
                : [
                    { backgroundColor: theme.cardRaised, borderColor: theme.hairline },
                    rimmed(theme),
                  ],
            ]}
          >
            {/* The tag's punched hole, and a copper band on a key that is out. */}
            <View style={[styles.hole, { backgroundColor: theme.card }]} />
            {free ? null : <View style={[styles.band, { backgroundColor: theme.primary }]} />}
            <VehicleBadge vehicle={vehicle} size={48} />
            <View style={{ gap: 2, alignSelf: 'stretch' }}>
              <Text
                numberOfLines={2}
                style={[typeScale.headline, { textAlign: 'center', color: theme.foreground }]}
              >
                {vehicle.displayName}
              </Text>
              <Text
                numberOfLines={1}
                style={[
                  figure,
                  typeScale.caption,
                  { textAlign: 'center', textTransform: 'uppercase', color: theme.mutedForeground },
                ]}
              >
                {plate(vehicle)}
              </Text>
            </View>
            <View style={styles.tagFoot}>
              {free ? (
                <Text style={[typeScale.caption, { fontWeight: '600', color: theme.warning }]}>
                  On the hook
                </Text>
              ) : (
                <FaceStack members={holders} size={24} max={3} ring={theme.cardRaised} />
              )}
            </View>
          </View>
        </Animated.View>
      </PressableScale>
    </Rise>
  );
}

/** Faces overlapped, the rest counted: who is in here, or who drives this. */
function FaceStack({
  members,
  size,
  ring,
  max = 4,
}: {
  members: readonly GarageMember[];
  size: number;
  ring: string;
  max?: number;
}) {
  const theme = useTheme();
  const rest = members.length - max;
  const overlap = -Math.round(size * 0.32);
  return (
    <View style={{ flexDirection: 'row' }} accessibilityElementsHidden>
      {members.slice(0, max).map((member, index) => (
        <View
          key={member.id}
          style={{
            marginLeft: index ? overlap : 0,
            zIndex: max - index,
            borderRadius: 999,
            borderWidth: 2,
            borderColor: ring,
          }}
        >
          <Face user={{ id: member.userId, image: member.image }} size={size} />
        </View>
      ))}
      {rest > 0 ? (
        <View
          style={[
            styles.more,
            {
              marginLeft: overlap,
              width: size + 4,
              height: size + 4,
              borderColor: ring,
              backgroundColor: theme.primarySoft,
            },
          ]}
        >
          <Text
            style={[figure, { fontSize: size * 0.38, fontWeight: '700', color: theme.foreground }]}
          >
            +{rest}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/** The photo if there is one, else the make's badge, else the kind of vehicle. */
function VehicleBadge({ vehicle, size }: { vehicle: Vehicle; size: number }) {
  const theme = useTheme();
  const photo = vehicle.primaryPhoto;
  const box = { width: size, height: size, borderRadius: size / 3 };
  if (photo?.thumbnailUrl) {
    return (
      <RemoteImage
        uri={photo.thumbnailUrl}
        cacheKey={photoKey(photo, 'thumb')}
        style={[box, !photo.isCutout && { backgroundColor: theme.muted }]}
        contentFit={photo.isCutout ? 'contain' : 'cover'}
        transition={200}
        accessible={false}
      />
    );
  }
  return (
    <View style={[box, styles.badge, { backgroundColor: theme.muted }]}>
      {vehicle.make ? (
        <BrandLogo make={vehicle.make} size={size * 0.8} />
      ) : (
        <Ionicons
          name={vehicleIcon(vehicle.vehicleType)}
          size={size * 0.45}
          color={theme.mutedForeground}
        />
      )}
    </View>
  );
}

/** A person: face, name, role, and the keys they hold as the vehicles' own badges. */
function PersonRow({
  member,
  isYou,
  isOwner,
  vehicles,
  onPress,
}: {
  member: GarageMember;
  isYou: boolean;
  isOwner: boolean;
  vehicles: readonly Vehicle[];
  onPress?: () => void;
}) {
  const theme = useTheme();
  const keys = vehicles.length;
  return (
    <PressableScale
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`${member.name}${isYou ? ', you' : ''}, ${humanise(member.role)}, ${
        keys ? `drives ${vehicles.map((v) => v.displayName).join(', ')}` : 'no keys'
      }`}
      scaleTo={0.98}
      style={[styles.person, { backgroundColor: theme.card }, rimmed(theme)]}
    >
      <Face user={{ id: member.userId, image: member.image }} size={44} />
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <View style={styles.nameLine}>
          <Text
            numberOfLines={1}
            style={[typeScale.headline, { flexShrink: 1, color: theme.foreground }]}
          >
            {member.name || member.email}
          </Text>
          {isYou ? <ToneChip tone="neutral" label="You" /> : null}
        </View>
        <View style={styles.nameLine}>
          <Text
            style={[
              typeScale.caption,
              { fontWeight: '600', color: isOwner ? theme.primary : theme.mutedForeground },
            ]}
          >
            {humanise(member.role)}
          </Text>
          <Text style={[typeScale.caption, { color: theme.mutedForeground }]}>·</Text>
          <Ionicons name="key-outline" size={12} color={theme.mutedForeground} />
          <Text style={[typeScale.caption, { color: theme.mutedForeground }]}>
            {keys ? (
              <Text style={[figure, { fontWeight: '600', color: theme.foreground }]}>
                {pad(keys)}
              </Text>
            ) : (
              'No keys'
            )}
          </Text>
        </View>
      </View>
      {/* Their keys, as a little fan of the vehicles' badges. */}
      {keys ? (
        <View style={{ flexDirection: 'row' }}>
          {vehicles.slice(0, 3).map((vehicle, index) => (
            <View
              key={vehicle.id}
              style={{
                marginLeft: index ? -10 : 0,
                transform: [{ rotate: `${(index - 1) * 6}deg` }],
              }}
            >
              <VehicleBadge vehicle={vehicle} size={28} />
            </View>
          ))}
        </View>
      ) : null}
      {onPress ? <Ionicons name="chevron-forward" size={16} color={theme.mutedForeground} /> : null}
    </PressableScale>
  );
}

/** A row to tick: what it is on the left, a copper check on the right when chosen. */
function TickRow({
  leading,
  title,
  caption,
  checked,
  onPress,
}: {
  leading: ReactNode;
  title: string;
  caption?: string;
  checked: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <PressableScale
      onPress={() => {
        haptic.selection();
        onPress();
      }}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={caption ? `${title}, ${caption}` : title}
      scaleTo={0.98}
      style={[styles.tick, { backgroundColor: checked ? theme.primarySoft : theme.muted }]}
    >
      {leading}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={[typeScale.label, { color: theme.foreground }]}>
          {title}
        </Text>
        {caption ? (
          <Text numberOfLines={1} style={[typeScale.caption, { color: theme.mutedForeground }]}>
            {caption}
          </Text>
        ) : null}
      </View>
      <View
        style={[
          styles.check,
          checked
            ? { backgroundColor: theme.primary, borderColor: theme.primary }
            : { borderColor: theme.borderStrong },
        ]}
      >
        {checked ? <Ionicons name="checkmark" size={14} color={theme.primaryForeground} /> : null}
      </View>
    </PressableScale>
  );
}

function ErrorLine({ error }: { error: unknown }) {
  const theme = useTheme();
  if (!error) return null;
  return (
    <Text accessibilityRole="alert" style={[typeScale.caption, { color: theme.destructive }]}>
      {(error as Error).message}
    </Text>
  );
}

const sameSet = (a: ReadonlySet<string>, b: readonly string[]) =>
  a.size === b.length && b.every((id) => a.has(id));

function toggled(set: ReadonlySet<string>, id: string) {
  const next = new Set(set);
  if (!next.delete(id)) next.add(id);
  return next;
}

/**
 * One key, handed out: everyone in the garage, ticked if they drive it. Save appears once the
 * ticks differ from what is saved, and replaces the vehicle's whole set of drivers.
 */
function KeysSheet({
  garageId,
  vehicle,
  members,
  onOpenVehicle,
  onClose,
}: {
  garageId: string;
  vehicle: Vehicle;
  members: readonly GarageMember[];
  onOpenVehicle: () => void;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const saved = members.filter((m) => m.vehicleIds.includes(vehicle.id)).map((m) => m.id);
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set(saved));

  const save = useMutation({
    mutationFn: () => api.garages.assignDrivers(garageId, vehicle.id, [...picked]),
    onSuccess: () => {
      haptic.success();
      onClose();
    },
    onSettled: () =>
      void queryClient.invalidateQueries({ queryKey: queryKeys.garageMembers(garageId) }),
  });

  return (
    <MenuSheet
      title={`Keys to ${vehicle.displayName}`}
      message="Tick who drives it. A vehicle can have several drivers."
      options={[{ label: 'Open vehicle', icon: 'car-sport-outline', onPress: onOpenVehicle }]}
      onClose={onClose}
    >
      <ScrollView style={{ maxHeight: 340 }} contentContainerStyle={{ gap: spacing.xs }}>
        {members.map((member) => (
          <TickRow
            key={member.id}
            leading={<Face user={{ id: member.userId, image: member.image }} size={36} />}
            title={member.name || member.email}
            caption={humanise(member.role)}
            checked={picked.has(member.id)}
            onPress={() => setPicked((current) => toggled(current, member.id))}
          />
        ))}
      </ScrollView>
      <ErrorLine error={save.error} />
      {sameSet(picked, saved) ? null : (
        <Button
          label={picked.size ? `Hand to ${picked.size}` : 'Put it back on the hook'}
          variant="primary"
          icon="key"
          loading={save.isPending}
          onPress={() => save.mutate()}
        />
      )}
    </MenuSheet>
  );
}

/**
 * A person: their role and every key they hold, saved together; and, apart, taking them out of the
 * garage — a second step that says what they lose and what stays. The owner's role is fixed: the
 * server refuses to demote them, so offering it would be offering a control that always fails.
 */
function PersonSheet({
  garage,
  member,
  vehicles,
  isYou,
  onLeft,
  onClose,
}: {
  garage: Garage;
  member: GarageMember;
  vehicles: readonly Vehicle[];
  isYou: boolean;
  onLeft: () => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const isOwner = member.userId === garage.ownerId;
  const [role, setRole] = useState<GarageRole>(member.role);
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set(member.vehicleIds));
  const [confirming, setConfirming] = useState(false);
  const first = (member.name || member.email).split(' ')[0];

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.garageMembers(garage.id) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.garages() });
  };
  const roleChanged = role !== member.role;
  const keysChanged = !sameSet(picked, member.vehicleIds);

  const save = useMutation({
    mutationFn: async () => {
      if (roleChanged) await api.garages.updateMember(garage.id, member.id, role);
      if (keysChanged) await api.garages.assignVehicles(garage.id, member.id, [...picked]);
    },
    onSuccess: () => {
      haptic.success();
      onClose();
    },
    // Settled, not success: the role can land and the keys fail, and the list should say so.
    onSettled: invalidate,
  });
  const remove = useMutation({
    mutationFn: () => api.garages.removeMember(garage.id, member.id),
    onSuccess: () => {
      haptic.success();
      invalidate();
      onClose();
      if (isYou) onLeft();
    },
  });

  // The same sheet becomes the confirm, rather than a second one stacking over it.
  if (confirming) {
    return (
      <MenuSheet
        title={isYou ? `Leave ${garage.name}?` : `Remove ${first}?`}
        message={`${isYou ? 'You lose' : 'They lose'} access to ${garage.name} and stop driving its vehicles. What ${isYou ? 'you' : 'they'} recorded stays.`}
        options={[
          {
            label: remove.isPending ? 'Removing…' : isYou ? 'Leave garage' : 'Remove from garage',
            icon: 'person-remove-outline',
            destructive: true,
            onPress: () => {
              if (!remove.isPending) remove.mutate();
            },
          },
          { label: 'Keep', icon: 'arrow-undo-outline', onPress: () => setConfirming(false) },
        ]}
        onClose={onClose}
      >
        <ErrorLine error={remove.error} />
      </MenuSheet>
    );
  }

  return (
    <MenuSheet
      title={isYou ? `${member.name || 'You'} (you)` : member.name || member.email}
      message={member.email}
      options={
        isOwner
          ? []
          : [
              {
                label: isYou ? 'Leave garage' : 'Remove from garage',
                icon: 'person-remove-outline',
                destructive: true,
                onPress: () => setConfirming(true),
              },
            ]
      }
      onClose={onClose}
    >
      <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ gap: spacing.lg }}>
        <View style={{ gap: spacing.sm }}>
          <Eyebrow>Role</Eyebrow>
          {isOwner ? null : (
            <View style={styles.roles}>
              {ROLES.map((option) => (
                <Chip
                  key={option}
                  label={humanise(option)}
                  selected={role === option}
                  onPress={() => setRole(option)}
                />
              ))}
            </View>
          )}
          <Text style={[typeScale.caption, { color: theme.mutedForeground }]}>
            {isOwner ? `Owner. ${ROLE_POWERS.OWNER}` : ROLE_POWERS[role]}
          </Text>
        </View>

        <View style={{ gap: spacing.sm }}>
          <Eyebrow>Keys{picked.size ? ` · ${pad(picked.size)}` : ''}</Eyebrow>
          {vehicles.length === 0 ? (
            <Text style={[typeScale.caption, { color: theme.mutedForeground }]}>
              No vehicles in this garage yet.
            </Text>
          ) : (
            <View style={{ gap: spacing.xs }}>
              {vehicles.map((vehicle) => (
                <TickRow
                  key={vehicle.id}
                  leading={<VehicleBadge vehicle={vehicle} size={36} />}
                  title={vehicle.displayName}
                  caption={plate(vehicle)}
                  checked={picked.has(vehicle.id)}
                  onPress={() => setPicked((current) => toggled(current, vehicle.id))}
                />
              ))}
            </View>
          )}
        </View>
      </ScrollView>
      <ErrorLine error={save.error} />
      {roleChanged || keysChanged ? (
        <Button
          label="Save"
          variant="primary"
          loading={save.isPending}
          onPress={() => save.mutate()}
        />
      ) : null}
    </MenuSheet>
  );
}

/**
 * Adding someone: their address and the role they get. Driver by default — on a key board, the
 * person being added is usually someone who needs a key. Membership is for an account that
 * already exists; the hint says so before the server has to.
 */
function AddSheet({
  garageId,
  onAdded,
  onClose,
}: {
  garageId: string;
  onAdded: (member: GarageMember) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<GarageRole>('DRIVER');
  const trimmed = email.trim();

  const add = useMutation({
    mutationFn: () => api.garages.addMember(garageId, { email: trimmed, role }),
    onSuccess: (member) => {
      haptic.success();
      // In the list before the refetch lands, so their sheet can open on them at once.
      queryClient.setQueryData<GarageMember[]>(queryKeys.garageMembers(garageId), (list) =>
        list ? [...list, member] : list,
      );
      void queryClient.invalidateQueries({ queryKey: queryKeys.garageMembers(garageId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.garages() });
      onAdded(member);
    },
  });
  const error =
    add.error instanceof ApiError
      ? (add.error.fields?.email ?? add.error.message)
      : add.error
        ? (add.error as Error).message
        : undefined;
  const submit = () => {
    if (trimmed.includes('@') && !add.isPending) add.mutate();
  };

  return (
    <MenuSheet title="Add someone" message="They need a Garaj account already." onClose={onClose}>
      <Field
        label="Email"
        value={email}
        onChangeText={setEmail}
        placeholder="them@example.com"
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="off"
        autoFocus
        returnKeyType="done"
        onSubmitEditing={submit}
        error={error}
      />
      <View style={{ gap: spacing.sm }}>
        <Eyebrow>Role</Eyebrow>
        <View style={styles.roles}>
          {ROLES.map((option) => (
            <Chip
              key={option}
              label={humanise(option)}
              selected={role === option}
              onPress={() => setRole(option)}
            />
          ))}
        </View>
        <Text style={[typeScale.caption, { color: theme.mutedForeground }]}>
          {ROLE_POWERS[role]}
        </Text>
      </View>
      <Button
        label="Add to garage"
        variant="primary"
        icon="person-add"
        loading={add.isPending}
        disabled={!trimmed.includes('@')}
        onPress={submit}
      />
    </MenuSheet>
  );
}

const styles = StyleSheet.create({
  page: {
    padding: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xxl * 2,
    gap: spacing.xl,
  },
  missing: { flex: 1, padding: spacing.lg, justifyContent: 'center' },
  section: { gap: spacing.sm },
  lede: { marginTop: -spacing.xs },
  plate: {
    borderRadius: radius.xxxl,
    padding: spacing.lg,
    gap: spacing.lg,
    overflow: 'hidden',
  },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  crewRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  crew: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  board: { borderRadius: radius.xxl, overflow: 'hidden', paddingTop: spacing.md },
  // The rail the hooks are screwed to, across the top of the board.
  rail: {
    position: 'absolute',
    top: spacing.md,
    left: spacing.md,
    right: spacing.md,
    height: 4,
    borderRadius: 999,
  },
  hooks: { paddingHorizontal: spacing.md, paddingBottom: spacing.lg, gap: spacing.md },
  key: { width: KEY, alignItems: 'center' },
  peg: { width: 6, height: 12, borderRadius: 3 },
  ring: { width: 20, height: 20, borderRadius: 999, borderWidth: 2.5, marginTop: -4 },
  tag: {
    width: KEY,
    marginTop: -6,
    borderRadius: radius.xl,
    borderWidth: 1,
    paddingTop: spacing.lg + 2,
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.md,
    alignItems: 'center',
    gap: spacing.sm,
    overflow: 'hidden',
  },
  hole: { position: 'absolute', top: 7, width: 10, height: 10, borderRadius: 999 },
  band: { position: 'absolute', top: 0, left: 0, right: 0, height: 3 },
  tagFoot: { height: 28, justifyContent: 'center' },
  emptyBoard: {
    width: 280,
    paddingTop: spacing.xl,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
    alignItems: 'flex-start',
  },
  more: { borderRadius: 999, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  badge: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  person: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radius.xl,
    padding: spacing.md,
  },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radius.xl,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    padding: spacing.md,
  },
  addIcon: {
    width: 44,
    height: 44,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roles: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tick: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 56,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  check: {
    width: 22,
    height: 22,
    borderRadius: 999,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
