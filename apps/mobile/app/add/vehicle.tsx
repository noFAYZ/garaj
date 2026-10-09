import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  DISTANCE_UNITS,
  VEHICLE_TYPES,
  specFieldsFor,
  type DistanceUnit,
  type VehicleType,
} from '@vehicle-os/domain';
import { ApiError } from '@vehicle-os/api-client';
import { garagesQuery, queryKeys } from '@vehicle-os/api-client/react';
import { digitsOnly, domainForMake } from '@vehicle-os/ui';
import { newId } from '@vehicle-os/utils';
import { BrandLogo } from '@/components/brand-logo';
import { api } from '@/lib/api';
import { enqueue, enqueueUpload, flush } from '@/lib/offline';
import { fromParams, pickPhotos, type FileParams, type PickedFile } from '@/lib/file-picker';
import { humanise } from '@/lib/format';
import { Eyebrow, FigureInput, Glyph, Panel, PanelCell, Segmented } from '@/lib/instrument';
import { haptic, Odometer, Pop, PressableScale, Rise, useReduceMotion } from '@/lib/motion';
import { MenuSheet } from '@/lib/pickers';
import { figure, radius, rimmed, spacing, typeScale, useTheme } from '@/lib/theme';
import { Button, Ground } from '@/lib/ui';
import { useOwnPlanGoverns, usePlan } from '@/lib/upgrade';
import { useProfile } from '@/lib/vehicle-units';

const TYPE_GLYPH: Record<VehicleType, string> = {
  CAR: '🚗',
  MOTORCYCLE: '🏍️',
  SCOOTER: '🛵',
  BICYCLE: '🚲',
  BOAT: '🚤',
  ATV: '🏁',
  TRAILER: '🛻',
  VAN: '🚐',
  RV: '🚌',
  OTHER: '🔧',
};

/** A plate is a physical thing: the same cream and ink whichever theme the phone is in. */
const PLATE = { ground: '#F3EFE6', ink: '#17130E', hint: 'rgba(23,19,14,0.28)' } as const;

const MAX_ODOMETER = 100_000_000;
/** Enough to show it from every side; more is a gallery job for the vehicle's own page. */
const MAX_PHOTOS = 8;
const THIS_YEAR = new Date().getFullYear();

/**
 * A new vehicle, on one screen and built as it is answered.
 *
 * The card at the top is the vehicle itself, not a summary of the form: its badge turns from the
 * kind of vehicle into the maker's mark as the make is typed (or into its cover photo, the badge
 * being where photos are added), its name is typed on the card with the year, make and model as
 * the name it gets otherwise, and two more answers are given on the card — the registration typed
 * onto a plate, the reading rolled onto the odometer's own drums. Under it, the rest in as few rows as they fit:
 * the kind as one rail, make · model · year as one row, the VIN that can fill them in. Nothing
 * scrolls at rest; the button is pinned, so it rides up with the keyboard.
 *
 * The unit is asked, not assumed: a vehicle recorded in the wrong one is wrong at the one moment
 * the answer is unrecoverable, and every figure derived from it afterwards is out by 1.6.
 */
export default function AddVehicleScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const plateInput = useRef<TextInput>(null);
  const odometerInput = useRef<TextInput>(null);
  const [pickingGarage, setPickingGarage] = useState(false);
  // A photo taken from the add sheet becomes the new vehicle's cover; a garage's + names its garage.
  const params = useLocalSearchParams<FileParams & { garageId?: string }>();
  const [photos, setPhotos] = useState<PickedFile[]>(() => {
    const first = fromParams(params);
    return first ? [first] : [];
  });
  const [photosOpen, setPhotosOpen] = useState(false);
  const [photoBusy, setPhotoBusy] = useState<'camera' | 'library' | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const cover = photos[0] ?? null;
  const { limitWall } = usePlan();
  const governs = useOwnPlanGoverns();

  const garages = useQuery(garagesQuery(api));
  const [garageId, setGarageId] = useState<string | null>(params.garageId ?? null);
  const [vehicleType, setVehicleType] = useState<VehicleType>('CAR');
  const [nickname, setNickname] = useState('');
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [year, setYear] = useState('');
  const [plate, setPlate] = useState('');
  const [vin, setVin] = useState('');
  const [vinSpecs, setVinSpecs] = useState<Record<string, string | number>>({});
  const [odometer, setOdometer] = useState('');
  // The unit chosen on You, until this vehicle is told otherwise.
  const profile = useProfile();
  const [pickedUnit, setOdometerUnit] = useState<DistanceUnit | null>(null);
  const odometerUnit: DistanceUnit = pickedUnit ?? profile.data?.distanceUnit ?? 'KM';

  const list = garages.data ?? [];
  // One garage is the common case; asking which is a question with one answer.
  const chosenGarage = garageId ?? list[0]?.id ?? null;
  const reading = odometer ? Number(odometer) : null;
  const yearError =
    year.length === 4 && (Number(year) < 1885 || Number(year) > THIS_YEAR + 1)
      ? `Between 1885 and ${THIS_YEAR + 1}`
      : undefined;
  const odometerError =
    reading !== null && reading > MAX_ODOMETER ? 'That is past 100,000,000' : undefined;

  /*
   * A suggestion, never an overwrite: only fields still empty are filled, since the person may
   * have typed a model the VIN database spells differently. Needs signal — unlike the create
   * below, a lookup cannot be queued, and without one the form simply stays manual.
   */
  const lookUp = useMutation({
    mutationFn: () => api.vehicles.decodeVin(vin),
    meta: { toast: false },
    onSuccess: (result) => {
      if (!result.decoded) return;
      haptic.success();
      if (!make.trim() && result.make) setMake(result.make);
      if (!model.trim() && result.model) setModel(result.model);
      if (!year && result.year) setYear(String(result.year));
      setVinSpecs(result.specs);
    },
  });
  const vinFailed = lookUp.error instanceof ApiError;
  const vinNote = lookUp.error
    ? lookUp.error instanceof ApiError
      ? (lookUp.error.fields?.vin ?? lookUp.error.message)
      : 'No connection — fill it in below'
    : lookUp.data
      ? lookUp.data.decoded
        ? `Found: ${[lookUp.data.year, lookUp.data.make, lookUp.data.model].filter(Boolean).join(' ')}`
        : 'Not in the database — usually a VIN from outside the US'
      : undefined;

  const create = useMutation({
    /*
     * Queued, not posted — a vehicle is often added where it is standing, which is as likely to
     * be a lock-up with no signal as anywhere else. Its id is chosen here rather than by the
     * server, so the photo below and every entry afterwards can already name it, and so a replay
     * of this write lands on the vehicle it already made rather than beside it.
     */
    mutationFn: async () => {
      const id = newId();
      await enqueue({
        kind: 'vehicle-create',
        body: {
          id,
          garageId: chosenGarage!,
          vehicleType,
          ...(nickname.trim() ? { nickname: nickname.trim() } : {}),
          ...(make.trim() ? { make: make.trim() } : {}),
          ...(model.trim() ? { model: model.trim() } : {}),
          ...(year.length === 4 ? { year: Number(year) } : {}),
          ...(plate.trim() ? { registrationIdentifier: plate.trim().toUpperCase() } : {}),
          ...(vin.trim() ? { identificationNumber: vin.trim() } : {}),
          // Only the decoded specs this type has fields for; the server refuses any other key.
          ...(Object.keys(vinSpecs).length > 0
            ? {
                specs: Object.fromEntries(
                  specFieldsFor(vehicleType)
                    .filter((field) => field.key in vinSpecs)
                    .map((field) => [field.key, vinSpecs[field.key]!]),
                ),
              }
            : {}),
          ...(reading !== null ? { currentOdometer: reading, odometerUnit } : {}),
        },
      });

      // Each photo is its own queued write, after the vehicle: the queue sends in order, so the
      // vehicle exists by the time its pictures are offered. The first is the cover.
      for (const [index, photo] of photos.entries()) {
        await enqueueUpload({
          kind: 'upload',
          target: 'photo',
          vehicleId: id,
          uri: photo.uri,
          name: photo.name,
          mimeType: photo.mimeType,
          size: photo.size,
          body: { setAsPrimary: index === 0 },
        });
      }
      void flush();
      return { id };
    },
    onSuccess: (vehicle) => {
      haptic.success();
      void queryClient.invalidateQueries({ queryKey: queryKeys.vehicles() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard() });
      // Straight into it: the next thing anyone does is record something against it.
      router.replace({ pathname: '/vehicle/[id]', params: { id: vehicle.id } });
    },
  });

  const fieldErrors = create.error instanceof ApiError ? create.error.fields : undefined;
  const spec = [year.length === 4 ? year : null, make.trim(), model.trim()]
    .filter(Boolean)
    .join(' ');
  const garageName = list.find((garage) => garage.id === chosenGarage)?.name ?? 'garage';
  // The maker's mark once the make is one the logo list knows; the kind of vehicle until then.
  const branded = !cover && domainForMake(make.trim()) !== null;

  // Picked photos join the end; the library offers only as many as are left.
  const addPhotos = async (source: 'camera' | 'library') => {
    setPhotoError(null);
    setPhotoBusy(source);
    try {
      const picked = await pickPhotos(source, MAX_PHOTOS - photos.length);
      if (picked.length) {
        haptic.success();
        setPhotos((current) => [...current, ...picked].slice(0, MAX_PHOTOS));
      }
    } catch (error) {
      setPhotoError((error as Error).message);
    } finally {
      setPhotoBusy(null);
    }
  };
  // One line for whatever is wrong, over the button — the rows above never grow to make room.
  const problem =
    yearError ??
    odometerError ??
    (fieldErrors ? Object.values(fieldErrors)[0] : undefined) ??
    (create.isError ? (create.error as Error).message : undefined);

  /*
   * Every way into this screen — the add sheet, a photo's destination list, a deep link — ends
   * here, so the ceiling is checked once, here, before a single question is asked. Only when the
   * person's own plan is the one that decides (they own every garage they could add to); a
   * member of a larger fleet is let through and the server answers for the owner's plan.
   */
  const wall = governs ? limitWall('vehicles') : null;
  /*
   * At the ceiling, the upgrade screen takes this one's place in the stack — `replace`, so
   * closing it goes back to where the person started rather than to a form they cannot use.
   */
  useEffect(() => {
    if (!wall) return;
    router.replace({
      pathname: '/upgrade',
      params: {
        reason: 'limit',
        limit: 'vehicles',
        ...(wall.requiredPlan ? { plan: wall.requiredPlan } : {}),
      },
    });
  }, [wall, router]);
  if (wall) return <View style={{ flex: 1, backgroundColor: theme.background }} />;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top + 44 : 0}
      style={{ flex: 1, backgroundColor: theme.background }}
    >
      <Stack.Screen options={{ title: 'Add a vehicle' }} />
      {/* Scrollable only for what does not fit — a small phone with the keyboard up. */}
      <ScrollView
        contentContainerStyle={styles.page}
        keyboardShouldPersistTaps="handled"
        alwaysBounceVertical={false}
        showsVerticalScrollIndicator={false}
      >
        <Rise>
          <View style={[styles.build, { backgroundColor: theme.card }, rimmed(theme)]}>
            <Ground cx="100%" cy="0%" />

            <View style={styles.buildTop}>
              {/* The badge is where photos are added: a press opens them. */}
              <PressableScale
                onPress={() => {
                  haptic.selection();
                  setPhotosOpen(true);
                }}
                accessibilityRole="button"
                accessibilityLabel={
                  photos.length
                    ? `${photos.length} ${photos.length === 1 ? 'photo' : 'photos'}, change`
                    : 'Add photos'
                }
                scaleTo={0.92}
              >
                {/* Keyed by what it shows, so a change of face pops in rather than swapping. */}
                <Pop
                  key={
                    cover ? cover.uri : branded ? `make:${make.trim().toLowerCase()}` : vehicleType
                  }
                  style={[styles.badge, { backgroundColor: theme.muted }]}
                >
                  {cover ? (
                    <Image
                      source={{ uri: cover.uri }}
                      style={StyleSheet.absoluteFill}
                      contentFit="cover"
                      accessibilityIgnoresInvertColors
                    />
                  ) : branded ? (
                    <BrandLogo make={make.trim()} size={42} />
                  ) : (
                    <Glyph size={34}>{TYPE_GLYPH[vehicleType]}</Glyph>
                  )}
                </Pop>
                <View
                  style={[
                    styles.badgeTag,
                    { backgroundColor: theme.primary, borderColor: theme.card },
                  ]}
                >
                  {photos.length > 1 ? (
                    <Text style={[figure, styles.badgeCount, { color: theme.primaryForeground }]}>
                      {photos.length}
                    </Text>
                  ) : (
                    <Ionicons
                      name={photos.length ? 'images' : 'camera'}
                      size={12}
                      color={theme.primaryForeground}
                    />
                  )}
                </View>
              </PressableScale>
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                {/* Where it is going, and — with more than one garage — the way to change it. */}
                <PressableScale
                  onPress={() => {
                    haptic.selection();
                    setPickingGarage(true);
                  }}
                  disabled={list.length < 2}
                  accessibilityRole="button"
                  accessibilityLabel={`Into ${garageName}${list.length > 1 ? ', change garage' : ''}`}
                  hitSlop={8}
                  scaleTo={0.95}
                  style={styles.into}
                >
                  <Eyebrow style={{ flexShrink: 1 }}>Into {garageName}</Eyebrow>
                  {list.length > 1 ? (
                    <Ionicons name="chevron-down" size={12} color={theme.mutedForeground} />
                  ) : null}
                </PressableScale>
                {/*
                 * Its name, typed here. Left empty it is called by its year, make and model —
                 * which is what the empty field shows, so the default is never a surprise.
                 */}
                <TextInput
                  value={nickname}
                  onChangeText={setNickname}
                  placeholder={spec || `A new ${humanise(vehicleType).toLowerCase()}`}
                  placeholderTextColor={spec ? theme.mutedForeground : theme.borderStrong}
                  maxLength={120}
                  autoCorrect={false}
                  returnKeyType="next"
                  onSubmitEditing={() => plateInput.current?.focus()}
                  accessibilityLabel="Name"
                  accessibilityHint="Optional. Without one it is called by its year, make and model."
                  style={[typeScale.display, styles.name, { color: theme.foreground }]}
                />
                <View style={styles.nameNote}>
                  <Ionicons
                    name={nickname.trim() ? 'pricetag-outline' : 'pencil'}
                    size={11}
                    color={theme.mutedForeground}
                  />
                  <Text
                    numberOfLines={1}
                    style={[typeScale.caption, { flexShrink: 1, color: theme.mutedForeground }]}
                  >
                    {nickname.trim()
                      ? spec || humanise(vehicleType)
                      : 'Name it, or it goes by its make and model'}
                  </Text>
                </View>
              </View>
            </View>

            {/* The registration, typed onto the plate itself. */}
            <View style={styles.plate}>
              <View style={[styles.plateBand, { backgroundColor: theme.primary }]}>
                <Ionicons name="flag" size={11} color={theme.primaryForeground} />
              </View>
              <TextInput
                ref={plateInput}
                value={plate}
                onChangeText={(text) => setPlate(text.toUpperCase())}
                placeholder="AB12 CDE"
                placeholderTextColor={PLATE.hint}
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={12}
                returnKeyType="next"
                onSubmitEditing={() => odometerInput.current?.focus()}
                accessibilityLabel="Number plate"
                style={[figure, styles.plateInput]}
              />
            </View>

            <OdometerField
              inputRef={odometerInput}
              value={odometer}
              onChange={setOdometer}
              unit={odometerUnit}
              onUnit={setOdometerUnit}
            />
          </View>
        </Rise>

        {/* The kind of vehicle, as one rail: ten choices in a row's height. */}
        <Rise index={1}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ marginHorizontal: -spacing.md }}
            contentContainerStyle={styles.rail}
          >
            {VEHICLE_TYPES.map((type) => {
              const selected = type === vehicleType;
              return (
                <PressableScale
                  key={type}
                  onPress={() => {
                    if (!selected) haptic.selection();
                    setVehicleType(type);
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={humanise(type)}
                  scaleTo={0.92}
                  style={[
                    styles.typeTile,
                    selected
                      ? { backgroundColor: theme.primarySoft, borderColor: theme.primary }
                      : { backgroundColor: theme.card, borderColor: 'transparent' },
                  ]}
                >
                  <Glyph size={24}>{TYPE_GLYPH[type]}</Glyph>
                  <Text
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    style={[
                      typeScale.caption,
                      {
                        fontSize: 11,
                        fontWeight: '600',
                        color: selected ? theme.foreground : theme.mutedForeground,
                      },
                    ]}
                  >
                    {humanise(type)}
                  </Text>
                </PressableScale>
              );
            })}
          </ScrollView>
        </Rise>

        <Rise index={2}>
          <Panel>
            <View style={styles.row}>
              <TextCell label="Make" value={make} onChangeText={setMake} placeholder="Mazda" />
              <TextCell label="Model" value={model} onChangeText={setModel} placeholder="MX-5" />
              <PanelCell label="Year">
                <FigureInput
                  value={year}
                  onChangeText={(text) => setYear(digitsOnly(text, 4))}
                  placeholder={String(THIS_YEAR)}
                  keyboardType="number-pad"
                  accessibilityLabel="Year"
                />
              </PanelCell>
            </View>
            <View style={styles.row}>
              <TextCell
                label="VIN"
                value={vin}
                onChangeText={(text) => {
                  setVin(text.toUpperCase());
                  lookUp.reset();
                }}
                placeholder="Optional · fills in the rest"
                autoCapitalize="characters"
                mono
                maxLength={24}
                returnKeyType="search"
                onSubmitEditing={() => vin.trim() && lookUp.mutate()}
                note={vinFailed ? undefined : vinNote}
                error={vinFailed ? vinNote : undefined}
              />
              <View style={[styles.decode, { backgroundColor: theme.cardRaised }]}>
                <Button
                  label="Decode"
                  size="sm"
                  icon="sparkles"
                  disabled={!vin.trim()}
                  loading={lookUp.isPending}
                  onPress={() => lookUp.mutate()}
                />
              </View>
            </View>
          </Panel>
        </Rise>
      </ScrollView>

      {/* Pinned: the one way forward is always on screen, keyboard or not. */}
      <View
        style={[
          styles.footer,
          {
            paddingBottom: Math.max(insets.bottom, spacing.md),
            borderTopColor: theme.hairline,
            backgroundColor: theme.background,
          },
        ]}
      >
        {problem ? (
          <Text
            accessibilityRole="alert"
            numberOfLines={2}
            style={[typeScale.caption, { color: theme.destructive }]}
          >
            {problem}
          </Text>
        ) : null}
        <Button
          label={`Add to ${garageName}`}
          variant="primary"
          size="lg"
          icon="add"
          loading={create.isPending}
          disabled={!chosenGarage || Boolean(yearError) || Boolean(odometerError)}
          onPress={() => create.mutate()}
        />
      </View>

      {photosOpen ? (
        <MenuSheet
          title="Photos"
          message={
            photos.length
              ? `The first is the cover — press another to make it so. ${photos.length} of ${MAX_PHOTOS}.`
              : `Up to ${MAX_PHOTOS}. The first is the cover.`
          }
          options={
            photos.length >= MAX_PHOTOS
              ? []
              : [
                  {
                    label: photoBusy === 'camera' ? 'Opening the camera…' : 'Take a photo',
                    icon: 'camera-outline',
                    onPress: () => void addPhotos('camera'),
                  },
                  {
                    label: photoBusy === 'library' ? 'Opening your photos…' : 'Choose from library',
                    icon: 'images-outline',
                    onPress: () => void addPhotos('library'),
                  },
                ]
          }
          onClose={() => setPhotosOpen(false)}
        >
          {photos.length ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.shots}
            >
              {photos.map((shot, index) => (
                <PressableScale
                  key={shot.uri}
                  onPress={() => {
                    if (index === 0) return;
                    haptic.selection();
                    setPhotos((current) => [shot, ...current.filter((other) => other !== shot)]);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={
                    index === 0 ? 'Cover photo' : `Photo ${index + 1}, make it the cover`
                  }
                  scaleTo={0.95}
                  style={[
                    styles.shot,
                    { borderColor: index === 0 ? theme.primary : 'transparent' },
                  ]}
                >
                  <Image
                    source={{ uri: shot.uri }}
                    style={StyleSheet.absoluteFill}
                    contentFit="cover"
                    accessibilityIgnoresInvertColors
                  />
                  {index === 0 ? (
                    <View style={[styles.coverTag, { backgroundColor: theme.primary }]}>
                      <Text
                        style={[
                          typeScale.caption,
                          { fontSize: 10, fontWeight: '700', color: theme.primaryForeground },
                        ]}
                      >
                        COVER
                      </Text>
                    </View>
                  ) : null}
                  <PressableScale
                    onPress={() => {
                      haptic.selection();
                      setPhotos((current) => current.filter((other) => other !== shot));
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove photo ${index + 1}`}
                    hitSlop={6}
                    scaleTo={0.85}
                    style={[styles.shotRemove, { backgroundColor: theme.scrim }]}
                  >
                    <Ionicons name="close" size={13} color="#ffffff" />
                  </PressableScale>
                </PressableScale>
              ))}
            </ScrollView>
          ) : null}
          {photoError ? (
            <Text
              accessibilityRole="alert"
              style={[typeScale.caption, { color: theme.destructive }]}
            >
              {photoError}
            </Text>
          ) : null}
        </MenuSheet>
      ) : null}

      {pickingGarage ? (
        <MenuSheet
          title="Which garage"
          options={list.map((garage) => ({
            label: garage.name,
            icon: garage.id === chosenGarage ? 'checkmark-circle' : 'ellipse-outline',
            onPress: () => {
              setGarageId(garage.id);
              setPickingGarage(false);
            },
          }))}
          onClose={() => setPickingGarage(false)}
        />
      ) : null}
    </KeyboardAvoidingView>
  );
}

/**
 * The odometer, as a field that looks like one: a display that lights copper while it is being
 * typed into, the reading on the drums it will be shown on with a caret blinking after it, a clear
 * when there is something to clear, and km or mi beside it. Empty, it says so in words — six
 * zeros would read as a reading of zero, and zero is a reading.
 *
 * The keyboard's field is invisible over the display, so a press anywhere on it is a press on the
 * field and every digit typed rolls into place.
 */
function OdometerField({
  inputRef,
  value,
  onChange,
  unit,
  onUnit,
}: {
  inputRef: React.RefObject<TextInput | null>;
  value: string;
  onChange: (value: string) => void;
  unit: DistanceUnit;
  onUnit: (unit: DistanceUnit) => void;
}) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  const reading = value ? Number(value) : null;

  return (
    <View
      style={[
        styles.odometerField,
        {
          backgroundColor: theme.muted,
          borderColor: focused ? theme.primary : theme.hairline,
        },
      ]}
    >
      <View style={styles.odometerDisplay}>
        <Eyebrow style={focused ? { color: theme.primary } : undefined}>
          Odometer{reading === null && !focused ? ' · optional' : ''}
        </Eyebrow>
        <View style={styles.odometerDigits}>
          {reading === null && !focused ? (
            <Text style={[typeScale.headline, { color: theme.borderStrong }]}>
              Tap to enter the reading
            </Text>
          ) : (
            <>
              <Odometer value={reading ?? 0} digits={6} size={20} />
              {focused ? <Caret /> : null}
            </>
          )}
        </View>
        <TextInput
          ref={inputRef}
          value={value}
          onChangeText={(text) => onChange(digitsOnly(text, 10))}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          keyboardType="number-pad"
          caretHidden
          contextMenuHidden
          selectionColor="transparent"
          underlineColorAndroid="transparent"
          accessibilityLabel={`Odometer reading in ${unit === 'MI' ? 'miles' : 'kilometres'}`}
          accessibilityHint="Optional. Leave it blank if you do not know it yet."
          style={[StyleSheet.absoluteFill, { color: 'transparent' }]}
        />
      </View>
      {reading !== null ? (
        <PressableScale
          onPress={() => {
            haptic.selection();
            onChange('');
          }}
          accessibilityRole="button"
          accessibilityLabel="Clear the reading"
          hitSlop={8}
          scaleTo={0.85}
          style={[styles.odometerClear, { backgroundColor: theme.card }]}
        >
          <Ionicons name="close" size={14} color={theme.mutedForeground} />
        </PressableScale>
      ) : null}
      <View style={{ width: 96 }}>
        <Segmented
          value={unit}
          options={DISTANCE_UNITS.map((option) => ({
            value: option,
            label: option === 'MI' ? 'mi' : 'km',
          }))}
          onChange={onUnit}
        />
      </View>
    </View>
  );
}

/** A text caret, blinking at the system's rate; steady when motion is reduced. */
function Caret() {
  const theme = useTheme();
  const reduce = useReduceMotion();
  const [blink] = useState(() => new Animated.Value(1));
  useEffect(() => {
    if (reduce) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(blink, { toValue: 0, duration: 0, delay: 530, useNativeDriver: true }),
        Animated.timing(blink, { toValue: 1, duration: 0, delay: 530, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [blink, reduce]);
  return (
    <Animated.View style={[styles.caret, { backgroundColor: theme.primary, opacity: blink }]} />
  );
}

/** A plain text answer in a panel cell, the label as its eyebrow. */
function TextCell({
  label,
  error,
  note,
  mono = false,
  ...props
}: React.ComponentProps<typeof TextInput> & {
  label: string;
  error?: string;
  /** A neutral line under the answer; an `error` replaces it and is tinted. */
  note?: string;
  mono?: boolean;
}) {
  const theme = useTheme();
  return (
    <PanelCell label={label} note={error ?? note} noteTone={error ? 'destructive' : undefined}>
      <TextInput
        placeholderTextColor={theme.borderStrong}
        accessibilityLabel={label}
        autoCorrect={false}
        style={[
          typeScale.headline,
          mono ? [figure, { letterSpacing: 1.5 }] : null,
          { color: theme.foreground, paddingVertical: 4, paddingHorizontal: 0 },
        ]}
        {...props}
      />
    </PanelCell>
  );
}

const styles = StyleSheet.create({
  page: { padding: spacing.md, paddingTop: spacing.sm, gap: spacing.md },
  build: {
    borderRadius: radius.xxxl,
    padding: spacing.lg,
    gap: spacing.md + 2,
    overflow: 'hidden',
  },
  buildTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  badge: {
    overflow: 'hidden',
    width: 64,
    height: 64,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  into: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start' },
  name: { fontSize: 24, lineHeight: 30, padding: 0, margin: 0 },
  nameNote: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  badgeTag: {
    position: 'absolute',
    right: -4,
    bottom: -4,
    minWidth: 24,
    height: 24,
    paddingHorizontal: 4,
    borderRadius: 999,
    borderWidth: 2.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeCount: { fontSize: 11, fontWeight: '700' },
  shots: { gap: spacing.sm, paddingVertical: 2 },
  shot: {
    width: 84,
    height: 84,
    borderRadius: radius.lg,
    borderWidth: 2,
    overflow: 'hidden',
  },
  coverTag: {
    position: 'absolute',
    left: 4,
    bottom: 4,
    borderRadius: 6,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  shotRemove: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 22,
    height: 22,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  plate: {
    flexDirection: 'row',
    alignItems: 'stretch',
    height: 52,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: PLATE.ink,
    backgroundColor: PLATE.ground,
    overflow: 'hidden',
  },
  plateBand: { width: 26, alignItems: 'center', justifyContent: 'center' },
  plateInput: {
    flex: 1,
    paddingVertical: 0,
    paddingHorizontal: spacing.sm,
    textAlign: 'center',
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: 3,
    color: PLATE.ink,
  },
  odometerField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    paddingVertical: spacing.sm,
    paddingLeft: spacing.md,
    paddingRight: spacing.sm,
  },
  odometerDisplay: { flex: 1, minWidth: 0, gap: 4 },
  odometerDigits: { flexDirection: 'row', alignItems: 'center', height: 28 },
  odometerClear: {
    width: 26,
    height: 26,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  caret: { width: 2, height: 22, borderRadius: 1, marginLeft: 3 },
  rail: { paddingHorizontal: spacing.md, gap: spacing.sm },
  typeTile: {
    width: 66,
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    paddingHorizontal: 2,
  },
  row: { flexDirection: 'row', gap: StyleSheet.hairlineWidth },
  decode: { justifyContent: 'center', paddingRight: spacing.md },
  footer: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm + 2,
    gap: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
