import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
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
  isKnownCurrency,
  supports,
  validateSpecs,
  type DistanceUnit,
  type VehicleType,
} from '@vehicle-os/domain';
import type { AiAttachment, LookUpVehicle, VinDecodeResult } from '@vehicle-os/contracts';
import { ApiError } from '@vehicle-os/api-client';
import { garagesQuery, queryKeys } from '@vehicle-os/api-client/react';
import {
  VEHICLE_MAKES,
  asVin,
  digitsOnly,
  domainForMake,
  dropExtra,
  extraChips,
  splitDraft,
  typeForMake,
  type VehicleAnswers,
  type VehicleExtras,
} from '@vehicle-os/ui';
import { newId } from '@vehicle-os/utils';
import { Fact, Line } from '@/components/add-kit';
import { BrandLogo } from '@/components/brand-logo';
import { api } from '@/lib/api';
import { enqueue, enqueueUpload, flush } from '@/lib/offline';
import {
  fromParams,
  pickPhotos,
  readBase64,
  type FileParams,
  type PickedFile,
} from '@/lib/file-picker';
import { humanise, toMinorUnits } from '@/lib/format';
import { Eyebrow, Glyph, Panel, PanelCell, Segmented } from '@/lib/instrument';
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

/** `humanise` turns every enum into a word, which prints the acronyms as "Atv" and "Rv". */
const typeLabel = (type: VehicleType) => (type === 'ATV' || type === 'RV' ? type : humanise(type));

/** A plate is a physical thing: the same cream and ink whichever theme the phone is in. */
const PLATE = { ground: '#F3EFE6', ink: '#17130E', hint: 'rgba(23,19,14,0.28)' } as const;

const MAX_ODOMETER = 100_000_000;
/** Enough to show it from every side; more is a gallery job for the vehicle's own page. */
const MAX_PHOTOS = 8;
const NEXT_YEAR = new Date().getFullYear() + 1;
/** The reader's limit on a photo, as base64 (about 3 MB of picture). */
const READ_LIMIT = 4_000_000;
const READABLE = new Set<string>(['image/jpeg', 'image/png', 'image/webp']);
const EMPTY: VehicleAnswers = { name: '', make: '', model: '', year: '', plate: '', odometer: '' };

/**
 * A new vehicle: five questions, or one sentence — the web's dialog, on a screen.
 *
 * Top to bottom, as on the web: the vehicle itself — its photo badge, its name typed onto the card,
 * what it is and which garage it goes into — then one line, then the five answers as one panel:
 * make, model and year, the registration typed onto a plate, the reading rolled onto the
 * odometer's own drums. The type follows the make (a Ducati is a motorcycle) until it is chosen.
 *
 * The line takes a description and reads it into the panel, or a VIN and decodes it. What either
 * finds that the panel has no question for — the VIN, the colour, the price paid, the factory specs
 * — goes with the vehicle as chips that can be dropped; everything else is on the vehicle's page.
 *
 * The unit is asked, not assumed: a vehicle recorded in the wrong one is wrong at the one moment
 * the answer is unrecoverable, and every figure derived from it afterwards is out by 1.6.
 */
export default function AddVehicleScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  // A photo taken from the add sheet becomes the new vehicle's cover; a garage's + names its garage.
  const params = useLocalSearchParams<FileParams & { garageId?: string }>();
  const [photos, setPhotos] = useState<PickedFile[]>(() => {
    const first = fromParams(params);
    return first ? [first] : [];
  });
  const [sheet, setSheet] = useState<'photos' | 'type' | 'garage' | null>(null);
  const [photoBusy, setPhotoBusy] = useState<'camera' | 'library' | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const cover = photos[0] ?? null;
  const { limitWall } = usePlan();
  const governs = useOwnPlanGoverns();

  const garages = useQuery(garagesQuery(api));
  const [garageId, setGarageId] = useState<string | null>(params.garageId ?? null);
  const [answers, setAnswers] = useState<VehicleAnswers>(EMPTY);
  const [chosenType, setChosenType] = useState<VehicleType | null>(null);
  const [extras, setExtras] = useState<VehicleExtras>({});
  // What the line or a VIN filled, and no hand has touched since: marked ✦ until it is.
  const [marked, setMarked] = useState<ReadonlySet<string>>(new Set());
  const [line, setLine] = useState('');
  const [filled, setFilled] = useState<{
    from: 'vin' | 'line';
    count: number;
    decoded?: boolean;
  } | null>(null);
  const [makeFocused, setMakeFocused] = useState(false);
  // The unit chosen on You, until this vehicle is told otherwise.
  const profile = useProfile();
  const [chosenUnit, setChosenUnit] = useState<DistanceUnit | null>(null);
  const unit: DistanceUnit = chosenUnit ?? profile.data?.distanceUnit ?? 'KM';
  const vehicleType: VehicleType = chosenType ?? typeForMake(answers.make) ?? 'CAR';

  const list = garages.data ?? [];
  /*
   * Only a lone garage chooses itself. With more, the vehicle goes where the person says: the first
   * in the list is an accident of sort order, and a car filed into the wrong garage is shared with
   * the wrong people.
   */
  const chosenGarage = garageId ?? (list.length === 1 ? list[0]!.id : null);
  const garage = list.find((candidate) => candidate.id === chosenGarage);
  const currency =
    extras.purchaseCurrency && isKnownCurrency(extras.purchaseCurrency)
      ? extras.purchaseCurrency
      : (garage?.defaultCurrency ?? 'USD');

  const set = (key: keyof VehicleAnswers, value: string) => {
    setAnswers((now) => ({ ...now, [key]: value }));
    setMarked((now) => {
      if (!now.has(key)) return now;
      const next = new Set(now);
      next.delete(key);
      return next;
    });
  };
  const mark = (label: string, key: string) => (marked.has(key) ? `${label} ✦` : label);

  const lookUp = useMutation({
    mutationFn: (vehicle: LookUpVehicle) => api.ai.lookUpVehicle(vehicle),
    meta: { toast: false },
    onSuccess: (result) => {
      if (Object.keys(result.specs).length === 0) return;
      setExtras((now) => ({ ...now, specs: { ...result.specs, ...now.specs } }));
    },
  });

  /*
   * The line, read — a VIN decoded, anything else described. Needs signal: unlike the add itself, a
   * read cannot be queued, and without one the panel simply stays as typed.
   */
  const vin = asVin(line);
  const read = useMutation({
    mutationFn: async () => {
      if (vin) return { from: 'vin' as const, result: await api.vehicles.decodeVin(vin) };
      // The cover still names the make, the model and the colour; one, to keep the read quick.
      const photo = cover && READABLE.has(cover.mimeType) ? cover : null;
      const data = photo ? await readBase64(photo.uri) : null;
      const attachments =
        photo && data && data.length <= READ_LIMIT
          ? [{ mimeType: photo.mimeType as AiAttachment['mimeType'], data }]
          : [];
      return {
        from: 'line' as const,
        draft: await api.ai.draftVehicle({
          text: line.trim() || 'Read the attached photo.',
          ...(attachments.length ? { attachments } : {}),
        }),
      };
    },
    meta: { toast: false },
    onSuccess: (outcome) => {
      haptic.success();
      if (outcome.from === 'vin') return applyVin(outcome.result);
      const { answers: said, type, unit: saidUnit, extras: found } = splitDraft(outcome.draft);
      // The line is the person's own words, so what it says replaces what was there.
      const next = { ...answers, ...said };
      setAnswers(next);
      if (type) setChosenType(type as VehicleType);
      if (saidUnit) setChosenUnit(saidUnit as DistanceUnit);
      setExtras((now) => ({ ...now, ...found }));
      setMarked(new Set([...marked, ...Object.keys(said), ...(type ? ['type'] : [])]));
      setFilled({ from: 'line', count: Object.keys(said).length + (type ? 1 : 0) });
      if (next.make && next.model) {
        lookUp.mutate({
          vehicleType: (type as VehicleType | null) ?? vehicleType,
          make: next.make,
          model: next.model,
          ...(found.variant ? { variant: found.variant } : {}),
          ...(next.year ? { year: Number(next.year) } : {}),
        });
      }
    },
  });
  /*
   * A decode fills only what is still empty: the person may have typed a model the VIN database
   * spells differently, and silently replacing what someone wrote is the one thing a suggestion
   * must never do.
   */
  function applyVin(result: VinDecodeResult) {
    const took: string[] = [];
    const fill = (key: keyof VehicleAnswers, value: string | number | null) => {
      if (value === null || answers[key].trim()) return;
      took.push(key);
      setAnswers((now) => ({ ...now, [key]: String(value) }));
    };
    if (result.decoded) {
      fill('make', result.make);
      fill('model', result.model);
      fill('year', result.year);
    }
    setExtras((now) => ({
      ...now,
      vin: result.vin,
      ...(result.variant && !now.variant ? { variant: result.variant } : {}),
      ...(Object.keys(result.specs).length ? { specs: { ...result.specs, ...now.specs } } : {}),
    }));
    setMarked(new Set([...marked, ...took]));
    setFilled({ from: 'vin', count: took.length, decoded: result.decoded });
    setLine('');
  }

  const reading = answers.odometer ? Number(answers.odometer) : null;
  const yearOff =
    answers.year.length === 4 && (Number(answers.year) < 1885 || Number(answers.year) > NEXT_YEAR);
  const odometerError =
    reading !== null && reading > MAX_ODOMETER ? 'That is past 100,000,000' : undefined;

  const create = useMutation({
    /*
     * Queued, not posted — a vehicle is often added where it is standing, which is as likely to be
     * a lock-up with no signal as anywhere else. Its id is chosen here rather than by the server,
     * so the photos below and every entry afterwards can already name it, and so a replay of this
     * write lands on the vehicle it already made rather than beside it.
     */
    mutationFn: async () => {
      const id = newId();
      const text = (value: string | undefined) => value?.trim() || undefined;
      // Only what this type has fields for and inside their bounds: a figure a look-up got wrong
      // is left behind rather than refusing the whole vehicle.
      const specs = validateSpecs(vehicleType, extras.specs ?? {}).specs;
      const body = {
        id,
        garageId: chosenGarage!,
        vehicleType,
        nickname: text(answers.name),
        make: text(answers.make),
        model: text(answers.model),
        year: answers.year.length === 4 ? Number(answers.year) : undefined,
        registrationIdentifier: text(answers.plate)?.toUpperCase(),
        ...(reading !== null ? { currentOdometer: reading, odometerUnit: unit } : {}),
        identificationNumber: extras.vin,
        variant: text(extras.variant),
        color: text(extras.color),
        purchaseDate: extras.purchaseDate,
        ...(extras.purchasePrice
          ? {
              purchasePriceAmountMinor: toMinorUnits(extras.purchasePrice, currency),
              purchasePriceCurrency: currency,
            }
          : {}),
        ...(extras.engineHours && supports(vehicleType, 'engineHours')
          ? { currentEngineHours: extras.engineHours }
          : {}),
        ...(Object.keys(specs).length ? { specs } : {}),
      };
      // Absent, not undefined: the queue keeps the body as JSON on disk.
      await enqueue({
        kind: 'vehicle-create',
        body: Object.fromEntries(Object.entries(body).filter(([, value]) => value !== undefined)),
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
  const derived = [answers.year, answers.make.trim(), answers.model.trim()]
    .filter(Boolean)
    .join(' ');
  // The maker's mark once the make is one the logo list knows; the kind of vehicle until then.
  const branded = !cover && domainForMake(answers.make.trim()) !== null;
  const canRead = vin !== null || line.trim().length >= 3 || cover !== null;
  const chips = extraChips(extras);
  // The makes that start with what is typed, while it is typed: the web's list, as a rail.
  const typedMake = answers.make.trim().toLowerCase();
  const suggestions =
    makeFocused && typedMake && !VEHICLE_MAKES.some((m) => m.name.toLowerCase() === typedMake)
      ? VEHICLE_MAKES.filter((option) => option.name.toLowerCase().startsWith(typedMake)).slice(
          0,
          6,
        )
      : [];

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
    (yearOff ? `The year is between 1885 and ${NEXT_YEAR}` : undefined) ??
    odometerError ??
    (fieldErrors ? Object.values(fieldErrors)[0] : undefined) ??
    (create.isError ? (create.error as Error).message : undefined);
  const lineSaid = read.isPending
    ? vin
      ? 'Decoding the VIN…'
      : 'Reading…'
    : read.isError
      ? read.error instanceof ApiError && read.error.status === 503
        ? 'GarajAI is not on here. Paste a VIN, or fill it in below.'
        : 'Could not read that just now — it needs signal. Fill it in below.'
      : filled
        ? filled.from === 'vin' && !filled.decoded
          ? 'Not in the VIN database — usually a VIN from outside the US. Kept with it.'
          : filled.count === 0
            ? filled.from === 'vin'
              ? 'Decoded; the answers already there were kept.'
              : 'Nothing to fill from that. Try a make, model and year.'
            : `✦ ${filled.count} ${filled.from === 'vin' ? 'from the VIN' : 'read'} — check before adding`
        : null;

  /*
   * Every way into this screen — the add sheet, a photo's destination list, a deep link — ends
   * here, so the ceiling is checked once, here, before a single question is asked. Only when the
   * person's own plan is the one that decides (they own every garage they could add to); a member
   * of a larger fleet is let through and the server answers for the owner's plan.
   */
  const wall = governs ? limitWall('vehicles') : null;
  /*
   * At the ceiling, the upgrade screen takes this one's place in the stack — `replace`, so closing
   * it goes back to where the person started rather than to a form they cannot use.
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
      <ScrollView
        contentContainerStyle={styles.page}
        keyboardShouldPersistTaps="handled"
        alwaysBounceVertical={false}
        showsVerticalScrollIndicator={false}
      >
        {/* The vehicle itself: its badge, its name, what it is and where it goes. */}
        <Rise>
          <View style={[styles.card, { backgroundColor: theme.card }, rimmed(theme)]}>
            <Ground cx="100%" cy="0%" />
            {/* The badge is where photos are added: a press opens them. */}
            <PressableScale
              onPress={() => {
                haptic.selection();
                setSheet('photos');
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
                  cover
                    ? cover.uri
                    : branded
                      ? `make:${answers.make.trim().toLowerCase()}`
                      : vehicleType
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
                  <BrandLogo make={answers.make.trim()} size={42} />
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

            <View style={{ flex: 1, minWidth: 0, gap: spacing.sm }}>
              {/*
               * Its name, typed onto the card. Left empty it is called by its year, make and
               * model — which is what the empty field shows, so the default is never a surprise.
               */}
              <TextInput
                value={answers.name}
                onChangeText={(text) => set('name', text)}
                placeholder={derived || 'New vehicle'}
                placeholderTextColor={derived ? theme.mutedForeground : theme.borderStrong}
                maxLength={120}
                autoCorrect={false}
                accessibilityLabel="Name"
                accessibilityHint="Optional. Without one it is called by its year, make and model."
                style={[typeScale.display, styles.name, { color: theme.foreground }]}
              />
              <View style={styles.chips}>
                <Fact
                  glyph={TYPE_GLYPH[vehicleType]}
                  label={typeLabel(vehicleType)}
                  marked={marked.has('type')}
                  onPress={() => setSheet('type')}
                />
                {list.length > 1 ? (
                  <Fact
                    icon="home-outline"
                    label={garage?.name ?? 'Which garage?'}
                    selected={!garage}
                    onPress={() => setSheet('garage')}
                  />
                ) : null}
              </View>
            </View>
          </View>
        </Rise>

        {/* The line: a description to read, or a VIN to decode — the button says which. */}
        <Rise index={1} style={{ gap: 6 }}>
          <Line
            value={line}
            onChangeText={(text) => {
              setLine(text);
              if (read.isError) read.reset();
            }}
            lit={filled !== null}
            placeholder="2019 911 Carrera S, 42k km — or the VIN"
            accessibilityLabel="Describe the vehicle, or paste its VIN"
            autoCapitalize="none"
            returnKeyType={vin ? 'search' : 'done'}
            onSubmitEditing={() => canRead && !read.isPending && read.mutate()}
            trailing={
              canRead ? (
                <Button
                  label={vin ? 'Decode' : 'Fill'}
                  variant="primary"
                  size="sm"
                  loading={read.isPending}
                  onPress={() => read.mutate()}
                />
              ) : null
            }
          />
          {lineSaid || lookUp.isPending ? (
            <Text
              accessibilityLiveRegion="polite"
              style={[
                typeScale.caption,
                styles.said,
                { color: read.isError ? theme.destructive : theme.mutedForeground },
              ]}
            >
              {[lineSaid, lookUp.isPending ? 'Looking up its specs…' : null]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          ) : null}
          {chips.length ? (
            <View style={styles.chips}>
              {chips.map((chip) => (
                <Fact
                  key={chip.key}
                  icon={chip.key === 'specs' ? 'globe-outline' : 'sparkles-outline'}
                  label={chip.label}
                  onRemove={() => setExtras((now) => dropExtra(now, chip.key))}
                />
              ))}
            </View>
          ) : null}
        </Rise>

        {/* The five answers, as one panel: what it is, then the plate and the reading on it. */}
        <Rise index={2}>
          <Panel>
            <View style={styles.row}>
              <TextCell
                label={mark('Make', 'make')}
                value={answers.make}
                onChangeText={(text) => set('make', text)}
                onFocus={() => setMakeFocused(true)}
                onBlur={() => setMakeFocused(false)}
                placeholder="Mazda"
                autoCapitalize="words"
                grow={1.25}
              />
              <TextCell
                label={mark('Model', 'model')}
                value={answers.model}
                onChangeText={(text) => set('model', text)}
                placeholder="MX-5"
                grow={1}
              />
              <TextCell
                label={mark('Year', 'year')}
                value={answers.year}
                onChangeText={(text) => set('year', digitsOnly(text, 4))}
                placeholder={String(NEXT_YEAR - 1)}
                keyboardType="number-pad"
                mono
                grow={0.8}
              />
            </View>

            {/* The registration, typed onto the plate itself. */}
            <PanelCell label={mark('Plate', 'plate')}>
              <View style={styles.plate}>
                <View style={[styles.plateBand, { backgroundColor: theme.primary }]}>
                  <Ionicons name="flag" size={11} color={theme.primaryForeground} />
                </View>
                <TextInput
                  value={answers.plate}
                  onChangeText={(text) => set('plate', text.toUpperCase())}
                  placeholder="AB12 CDE"
                  placeholderTextColor={PLATE.hint}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  maxLength={12}
                  accessibilityLabel="Number plate"
                  style={[figure, styles.plateInput]}
                />
              </View>
            </PanelCell>

            <OdometerCell
              label={mark('Odometer', 'odometer')}
              value={answers.odometer}
              onChange={(text) => set('odometer', text)}
              unit={unit}
              onUnit={setChosenUnit}
            />
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
        {/* The makes that start with what is typed, over the keyboard where the thumb is. */}
        {suggestions.length ? (
          <ScrollView
            horizontal
            keyboardShouldPersistTaps="always"
            showsHorizontalScrollIndicator={false}
            style={{ marginHorizontal: -spacing.lg }}
            contentContainerStyle={styles.suggestions}
          >
            {suggestions.map((option) => (
              <PressableScale
                key={option.name}
                onPress={() => {
                  haptic.selection();
                  set('make', option.name);
                }}
                accessibilityRole="button"
                accessibilityLabel={option.name}
                scaleTo={0.94}
                style={[styles.suggestion, { backgroundColor: theme.muted }]}
              >
                <BrandLogo make={option.name} size={18} />
                <Text style={[typeScale.label, { color: theme.foreground }]}>{option.name}</Text>
              </PressableScale>
            ))}
          </ScrollView>
        ) : null}
        {problem ? (
          <Text
            accessibilityRole="alert"
            numberOfLines={2}
            style={[typeScale.caption, { color: theme.destructive }]}
          >
            {problem}
          </Text>
        ) : null}
        {/* The button reads the type back: what the make or the line decided is the last look. */}
        <Button
          label={`Add ${vehicleType === 'OTHER' ? 'vehicle' : typeLabel(vehicleType).toLowerCase()}`}
          variant="primary"
          size="lg"
          icon="add"
          loading={create.isPending}
          disabled={!chosenGarage || yearOff || Boolean(odometerError)}
          onPress={() => create.mutate()}
        />
      </View>

      {sheet === 'type' ? (
        <MenuSheet title="What is it" onClose={() => setSheet(null)}>
          <View style={styles.types}>
            {VEHICLE_TYPES.map((type) => {
              const selected = type === vehicleType;
              return (
                <PressableScale
                  key={type}
                  onPress={() => {
                    haptic.selection();
                    setChosenType(type);
                    setMarked((now) => {
                      const next = new Set(now);
                      next.delete('type');
                      return next;
                    });
                    setSheet(null);
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={typeLabel(type)}
                  scaleTo={0.92}
                  style={[
                    styles.typeTile,
                    selected
                      ? { backgroundColor: theme.primarySoft, borderColor: theme.primary }
                      : { backgroundColor: theme.muted, borderColor: 'transparent' },
                  ]}
                >
                  <Glyph size={26}>{TYPE_GLYPH[type]}</Glyph>
                  <Text
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    style={[
                      typeScale.caption,
                      {
                        fontWeight: '600',
                        color: selected ? theme.foreground : theme.mutedForeground,
                      },
                    ]}
                  >
                    {typeLabel(type)}
                  </Text>
                </PressableScale>
              );
            })}
          </View>
        </MenuSheet>
      ) : null}

      {sheet === 'photos' ? (
        <MenuSheet
          title="Photos"
          message={
            photos.length
              ? `The first is the cover — press another to make it so. ${photos.length} of ${MAX_PHOTOS}.`
              : `Up to ${MAX_PHOTOS}. The first is the cover; Fill reads it.`
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
          onClose={() => setSheet(null)}
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

      {sheet === 'garage' ? (
        <MenuSheet
          title="Which garage"
          options={list.map((option) => ({
            label: option.name,
            icon: option.id === chosenGarage ? 'checkmark-circle' : 'ellipse-outline',
            onPress: () => {
              setGarageId(option.id);
              setSheet(null);
            },
          }))}
          onClose={() => setSheet(null)}
        />
      ) : null}
    </KeyboardAvoidingView>
  );
}

/**
 * The odometer, as a cell that looks like one: the reading on the drums it will be shown on, lit
 * copper with a blinking caret while it is typed into, and km or mi beside it. Empty, it says so in
 * words — six zeros would read as a reading of zero, and zero is a reading.
 *
 * The keyboard's field is invisible over the drums, so a press anywhere on them is a press on the
 * field and every digit typed rolls into place.
 */
function OdometerCell({
  label,
  value,
  onChange,
  unit,
  onUnit,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  unit: DistanceUnit;
  onUnit: (unit: DistanceUnit) => void;
}) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  const reading = value ? Number(value) : null;

  return (
    <View style={[styles.odometer, { backgroundColor: theme.cardRaised }]}>
      <View style={styles.odometerDisplay}>
        <Eyebrow style={focused ? { color: theme.primary } : undefined}>
          {label}
          {reading === null && !focused ? ' · optional' : ''}
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
          style={[styles.odometerClear, { backgroundColor: theme.muted }]}
        >
          <Ionicons name="close" size={14} color={theme.mutedForeground} />
        </PressableScale>
      ) : null}
      <View style={{ width: 104 }}>
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

/** A plain text answer in a panel cell, the label as its eyebrow; `grow` is its share of the row. */
function TextCell({
  label,
  grow,
  mono = false,
  ...props
}: React.ComponentProps<typeof TextInput> & { label: string; grow: number; mono?: boolean }) {
  const theme = useTheme();
  return (
    <View style={{ flex: grow, minWidth: 0 }}>
      <PanelCell label={label}>
        <TextInput
          placeholderTextColor={theme.borderStrong}
          accessibilityLabel={label.replace(' ✦', '')}
          autoCorrect={false}
          maxLength={120}
          style={[
            typeScale.headline,
            mono ? figure : null,
            { color: theme.foreground, paddingVertical: 4, paddingHorizontal: 0 },
          ]}
          {...props}
        />
      </PanelCell>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: spacing.lg, paddingTop: spacing.sm, gap: spacing.md },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radius.xxxl,
    padding: spacing.lg,
    overflow: 'hidden',
  },
  badge: {
    overflow: 'hidden',
    width: 68,
    height: 68,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: { fontSize: 24, lineHeight: 30, padding: 0, margin: 0 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  said: { paddingHorizontal: 4 },
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
  row: { flexDirection: 'row', gap: StyleSheet.hairlineWidth },
  plate: {
    flexDirection: 'row',
    alignItems: 'stretch',
    height: 46,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: PLATE.ink,
    backgroundColor: PLATE.ground,
    overflow: 'hidden',
  },
  plateBand: { width: 24, alignItems: 'center', justifyContent: 'center' },
  plateInput: {
    flex: 1,
    paddingVertical: 0,
    paddingHorizontal: spacing.sm,
    textAlign: 'center',
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: 3,
    color: PLATE.ink,
  },
  odometer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    paddingLeft: spacing.lg,
    paddingRight: spacing.md,
  },
  odometerDisplay: { flex: 1, minWidth: 0, gap: 6 },
  odometerDigits: { flexDirection: 'row', alignItems: 'center', height: 28 },
  odometerClear: {
    width: 26,
    height: 26,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  caret: { width: 2, height: 22, borderRadius: 1, marginLeft: 3 },
  suggestions: { gap: 6, paddingHorizontal: spacing.lg },
  suggestion: {
    height: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 12,
    borderRadius: 999,
  },
  types: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  typeTile: {
    width: '18.3%',
    flexGrow: 1,
    height: 68,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    paddingHorizontal: 2,
  },
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
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm + 2,
    gap: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
