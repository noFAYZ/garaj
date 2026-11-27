import { Ionicons } from '@expo/vector-icons';
import { onlineManager, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Animated,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputInstance,
  type TextInputProps,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  DISTANCE_UNITS,
  VEHICLE_TYPES,
  isKnownCurrency,
  specFieldMap,
  supports,
  validateSpecs,
  type DistanceUnit,
  type VehicleType,
} from '@vehicle-os/domain';
import type {
  AiAttachment,
  CreateVehicle,
  LookUpVehicle,
  PlanState,
  VinDecodeResult,
} from '@vehicle-os/contracts';
import { ApiError } from '@vehicle-os/api-client';
import { garagesQuery, queryKeys } from '@vehicle-os/api-client/react';
import {
  VEHICLE_MAKES,
  asVin,
  digitsOnly,
  domainForMake,
  extraChips,
  splitDraft,
  typeForMake,
  type VehicleAnswers,
  type VehicleExtras,
} from '@vehicle-os/ui';
import { newId } from '@vehicle-os/utils';
import { BrandLogo } from '@/components/brand-logo';
import { api } from '@/lib/api';
import { useDiscardGuard } from '@/lib/discard';
import { enqueue, enqueueUpload, flush } from '@/lib/offline';
import {
  fromParams,
  pickPhotos,
  readBase64,
  type FileParams,
  type PickedFile,
} from '@/lib/file-picker';
import { humanise, toMinorUnits } from '@/lib/format';
import { Glyph } from '@/lib/instrument';
import { ease, Pop, PressableScale, Rise, useReduceMotion } from '@/lib/motion';
import { MenuSheet } from '@/lib/pickers';
import { figure, radius, rimmed, spacing, typeScale, useTheme, leaf } from '@/lib/theme';
import { Button } from '@/lib/ui';
import { RoundKey } from '@/components/onboarding-kit';
import { useOwnPlanGoverns, usePlan } from '@/lib/upgrade';
import { useProfile } from '@/lib/vehicle-units';

const TYPE_GLYPH: Record<VehicleType, string> = {
  CAR: '🚗',
  MOTORCYCLE: '🏍️',
  SCOOTER: '🛵',
  BICYCLE: '🚲',
  BOAT: '🚤',
  ATV: '🏁',
  // A hitch, not 🛻: that one is a pickup truck, and a pickup is a car.
  TRAILER: '🔗',
  VAN: '🚐',
  RV: '🚌',
  OTHER: '🔧',
};

/** `humanise` turns every enum into a word, which prints the acronyms as "Atv" and "Rv". */
const typeLabel = (type: VehicleType) => (type === 'ATV' || type === 'RV' ? type : humanise(type));

/** A chosen spec as it reads: the short codes (AWD, CVT, 4WD) as they are, the rest as words. */
const optionWord = (value: string) => (/^[A-Z0-9]{2,4}$/.test(value) ? value : humanise(value));

type IoniconName = keyof typeof Ionicons.glyphMap;

/** What each found fact wears: the extras by name, the specs by key. Anything new gets ⓘ. */
const FACT_ICON: Readonly<Record<string, IoniconName>> = {
  vin: 'barcode-outline',
  variant: 'pricetag-outline',
  color: 'color-palette-outline',
  purchase: 'receipt-outline',
  engineHours: 'time-outline',
  engineCode: 'code-slash-outline',
  displacementCc: 'cog-outline',
  powerHp: 'flash-outline',
  cylinders: 'grid-outline',
  oilType: 'water-outline',
  oilCapacityL: 'water-outline',
  fuelType: 'flame-outline',
  tankCapacityL: 'beaker-outline',
  batteryCapacityKwh: 'battery-charging-outline',
  rangeKm: 'navigate-outline',
  chargePortType: 'flash-outline',
  batteryType: 'battery-full-outline',
  batteryVoltage: 'flash-outline',
  transmissionType: 'git-branch-outline',
  gears: 'layers-outline',
  drivetrain: 'sync-outline',
  registrationCountry: 'flag-outline',
  insurancePolicyNumber: 'shield-checkmark-outline',
  frontTireSize: 'ellipse-outline',
  rearTireSize: 'ellipse-outline',
  tirePressureFront: 'speedometer-outline',
  tirePressureRear: 'speedometer-outline',
  chainSize: 'link-outline',
  frontSprocket: 'link-outline',
  rearSprocket: 'link-outline',
  groupset: 'settings-outline',
  hullType: 'boat-outline',
  hullMaterial: 'boat-outline',
  lengthM: 'resize-outline',
  beamM: 'resize-outline',
  draftM: 'resize-outline',
  marina: 'location-outline',
  berth: 'location-outline',
  trailerMake: 'cube-outline',
  trailerCapacityKg: 'cube-outline',
};

/** One fact found for the vehicle. */
interface Found {
  readonly key: string;
  readonly icon: IoniconName;
  readonly label: string;
  readonly value: string;
  readonly mono?: boolean;
}

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
 * One screen's height, no scrolling, on a small phone (360×640): Log it's head (the garage it goes
 * into under the title), the vehicle as a card (its face, the maker's mark filling it, and its
 * name), what it is, then the questions as the sign-in form's panel — the line, make, model and
 * year, the plate beside the reading and its unit — and Log it's foot: the photo's key and the one
 * action. The type follows the make (a Ducati is a motorcycle) until it is chosen.
 *
 * The line takes a description and reads it into the panel, or a VIN and decodes it. What either
 * finds that the panel has no question for — the VIN, the trim, the colour, the price paid, every
 * factory spec — goes with the vehicle, folded under the panel until opened, each fact with its
 * icon; "Leave these out" drops it. Everything else is on the vehicle's page.
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
  // `then: 'back'`: opened from a flow that carries on after it (the first-run setup).
  const params = useLocalSearchParams<FileParams & { garageId?: string; then?: string }>();
  const [arrived] = useState(() => fromParams(params));
  const [photos, setPhotos] = useState<PickedFile[]>(() => (arrived ? [arrived] : []));
  const [sheet, setSheet] = useState<'photos' | 'garage' | 'type' | null>(null);
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
  // What the line or a VIN filled, and no hand has touched since: a copper dot until it is.
  const [marked, setMarked] = useState<ReadonlySet<string>>(new Set());
  const [line, setLine] = useState('');
  const [filled, setFilled] = useState<{
    from: 'vin' | 'line';
    count: number;
    decoded?: boolean;
  } | null>(null);
  const [makeFocused, setMakeFocused] = useState(false);
  const nameField = useRef<TextInputInstance>(null);
  const [naming, setNaming] = useState(false);
  const lineField = useRef<TextInputInstance>(null);
  const [lineFocused, setLineFocused] = useState(false);
  // The unit chosen on You, until this vehicle is told otherwise.
  const profile = useProfile();
  const [chosenUnit, setChosenUnit] = useState<DistanceUnit | null>(null);
  const unit: DistanceUnit = chosenUnit ?? profile.data?.distanceUnit ?? 'KM';
  // Anything typed, read in, or a photo beyond the one it arrived with.
  const release = useDiscardGuard(
    line.trim() !== '' ||
      Object.values(answers).some((value) => value.trim() !== '') ||
      Object.values(extras).some(Boolean) ||
      photos.length > (arrived ? 1 : 0),
  );
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
  // Chosen by a hand: the dot a make or the line put on it goes.
  const chooseType = (type: VehicleType) => {
    setChosenType(type);
    setMarked((now) => {
      const next = new Set(now);
      next.delete('type');
      return next;
    });
  };

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

  const [checking, setChecking] = useState(false);
  const create = useMutation({
    /*
     * Queued, not posted — a vehicle is often added where it is standing, which is as likely to be
     * a lock-up with no signal as anywhere else. Its id is chosen here rather than by the server,
     * so the photos below and every entry afterwards can already name it, and so a replay of this
     * write lands on the vehicle it already made rather than beside it.
     */
    mutationFn: async (): Promise<{ id: string | null; plan?: PlanState }> => {
      /*
       * The ceiling, read from the server at the press rather than from the cached plan: the cache
       * can be a vehicle behind, and a vehicle queued past the limit is refused only when the queue
       * sends it — a paywall surfacing long after the press, with nothing shown meanwhile. Offline,
       * that refusal is still the backstop.
       */
      if (governs && onlineManager.isOnline()) {
        setChecking(true);
        // A slow answer gives way to the queue after a few seconds rather than holding the press.
        const fresh = await Promise.race([
          api.users.plan().catch(() => null),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 5_000)),
        ]).finally(() => setChecking(false));
        if (fresh && fresh.usage.vehicles >= fresh.limits.vehicles)
          return { id: null, plan: fresh };
      }
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
        body: Object.fromEntries(
          Object.entries(body).filter(([, value]) => value !== undefined),
        ) as CreateVehicle,
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
      if (!vehicle.id) {
        // At the limit: nothing was queued. The fresh plan in the cache raises the wall (`wall`
        // below replaces this screen with it); the form is let go first so leaving it asks nothing.
        release();
        queryClient.setQueryData(queryKeys.plan(), vehicle.plan);
        return;
      }
      void queryClient.invalidateQueries({ queryKey: queryKeys.vehicles() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard() });
      // Straight into it: the next thing anyone does is record something against it — unless a
      // flow sent here carries on from where it was.
      release();
      if (params.then === 'back') router.back();
      else router.replace({ pathname: '/vehicle/[id]', params: { id: vehicle.id } });
    },
  });

  const fieldErrors = create.error instanceof ApiError ? create.error.fields : undefined;
  const derived = [answers.year, answers.make.trim(), answers.model.trim()]
    .filter(Boolean)
    .join(' ');
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
      ? 'Decoding…'
      : 'Reading…'
    : read.isError
      ? read.error instanceof ApiError && read.error.status === 503
        ? 'GarajjAI is off here. Fill it in yourself.'
        : 'Needs signal. Fill it in yourself.'
      : filled
        ? filled.from === 'vin' && !filled.decoded
          ? 'Not in the VIN database. Kept with it.'
          : filled.count === 0
            ? 'Nothing new to fill.'
            : null
        : null;

  /*
   * What a VIN, a description or a look-up found that the answers have no question for. A spec this
   * type has no field for is left off: the save drops it too (`validateSpecs`), so the list shows
   * only what is kept.
   */
  const specFields = specFieldMap(vehicleType);
  const found: Found[] = [];
  const fact = (key: string, label: string, value: string, mono = false) =>
    found.push({ key, icon: FACT_ICON[key] ?? 'information-circle-outline', label, value, mono });
  if (extras.vin) fact('vin', 'VIN', extras.vin, true);
  if (extras.variant) fact('variant', 'Trim', extras.variant);
  if (extras.color) fact('color', 'Color', extras.color);
  for (const chip of chips) {
    if (chip.key === 'purchase') fact('purchase', 'Bought', chip.label.replace(/^Bought /, ''));
    if (chip.key === 'engineHours') fact('engineHours', 'Engine hours', chip.label, true);
  }
  for (const [key, value] of Object.entries(extras.specs ?? {})) {
    const field = specFields.get(key);
    if (!field) continue;
    const said =
      field.kind === 'select'
        ? optionWord(String(value))
        : typeof value === 'number'
          ? value.toLocaleString()
          : String(value);
    fact(
      key,
      field.label,
      field.unit ? `${said} ${field.unit}` : said,
      field.kind === 'number' || field.kind === 'integer',
    );
  }
  // Under the VIN: what is under way or went wrong. What it filled wears the dot.
  const status = [lineSaid, lookUp.isPending ? 'Looking up its specs…' : null]
    .filter(Boolean)
    .join(' · ');
  const model = answers.model.trim();
  const action = `Add ${
    vehicleType === 'OTHER'
      ? 'vehicle'
      : vehicleType === 'ATV' || vehicleType === 'RV'
        ? vehicleType
        : humanise(vehicleType).toLowerCase()
  }${model ? ` · ${model}` : ''}`;

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
  if (wall) return <View style={{ flex: 1, backgroundColor: 'transparent' }} />;

  // Where it parks: a choice when there is more than one garage, a word when not.
  const garageLine = (
    <>
      {list.length > 1 ? (
        <PressableScale
          onPress={() => {
            setSheet('garage');
          }}
          accessibilityRole="button"
          accessibilityLabel={garage ? `Garage: ${garage.name}. Change` : 'Choose a garage'}
          hitSlop={8}
          scaleTo={0.96}
          style={styles.parks}
        >
          <Ionicons
            name="home-outline"
            size={12}
            color={garage ? theme.mutedForeground : theme.primary}
          />
          <Text
            numberOfLines={1}
            style={[
              typeScale.caption,
              {
                flexShrink: 1,
                color: garage ? theme.mutedForeground : theme.primary,
                fontWeight: garage ? '400' : '600',
              },
            ]}
          >
            {garage?.name ?? 'Choose a garage'}
          </Text>
          <Ionicons
            name="chevron-down"
            size={12}
            color={garage ? theme.mutedForeground : theme.primary}
          />
        </PressableScale>
      ) : garage ? (
        <View style={styles.parks}>
          <Ionicons name="home-outline" size={12} color={theme.mutedForeground} />
          <Text
            numberOfLines={1}
            style={[typeScale.caption, { flexShrink: 1, color: theme.mutedForeground }]}
          >
            {garage.name}
          </Text>
        </View>
      ) : null}
    </>
  );

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: 'transparent' }}
    >
      {/* No navigator bar: the page's own. */}
      <Stack.Screen options={{ headerShown: false }} />

      {/* The head: the key out, what this is and where it parks; what it is, at the right. */}
      <View style={[styles.bar, { paddingTop: insets.top + spacing.sm }]}>
        <RoundKey icon="close" label="Close" onPress={() => router.back()} />
        <View style={styles.heading}>
          <Text
            accessibilityRole="header"
            numberOfLines={1}
            style={[styles.title, { color: theme.foreground }]}
          >
            Add vehicle
          </Text>
          {garageLine}
        </View>
        <PressableScale
          onPress={() => {
            setSheet('type');
          }}
          accessibilityRole="button"
          accessibilityLabel={`What it is: ${typeLabel(vehicleType)}${
            marked.has('type') ? ', filled for you' : ''
          }. Change`}
          hitSlop={6}
          scaleTo={0.95}
          style={[
            styles.typePick,
            { backgroundColor: theme.cardRaised, borderColor: theme.hairline },
          ]}
        >
          <Glyph size={18}>{TYPE_GLYPH[vehicleType]}</Glyph>
          <Text numberOfLines={1} style={[typeScale.label, { color: theme.foreground }]}>
            {typeLabel(vehicleType)}
          </Text>
          {marked.has('type') ? <AutoDot /> : null}
          <Ionicons name="chevron-down" size={14} color={theme.mutedForeground} />
        </PressableScale>
      </View>

      <ScrollView
        contentContainerStyle={styles.stage}
        keyboardShouldPersistTaps="handled"
        alwaysBounceVertical={false}
        showsVerticalScrollIndicator={false}
      >
        {/*
         * Who it is: its face as an icon in the middle of the screen, the name under it. The face
         * is whatever is known best (a photo, the maker's mark, what kind of vehicle) and changes
         * as the answers come in; the name is the year, make and model until it is given one.
         */}
        <Rise style={styles.who}>
          <Medallion
            cover={cover}
            make={answers.make.trim()}
            glyph={TYPE_GLYPH[vehicleType]}
            busy={read.isPending || lookUp.isPending}
            count={photos.length}
            onPress={() => {
              setSheet('photos');
            }}
          />
          <Pressable
            onPress={() => nameField.current?.focus()}
            accessible={false}
            style={styles.naming}
          >
            <View style={styles.nameField}>
              {/* Sizes the field to its words; never seen. */}
              <Text numberOfLines={1} style={[styles.name, styles.nameSizer]}>
                {answers.name || derived || 'New vehicle'}
              </Text>
              <TextInput
                ref={nameField}
                value={answers.name}
                onChangeText={(text) => set('name', text)}
                onFocus={() => setNaming(true)}
                onBlur={() => setNaming(false)}
                placeholder={derived || 'New vehicle'}
                placeholderTextColor={derived ? theme.mutedForeground : theme.placeholder}
                maxLength={120}
                autoCorrect={false}
                returnKeyType="done"
                accessibilityLabel="Name"
                accessibilityHint="Optional. Without one it is called by its year, make and model."
                style={[styles.name, styles.nameInput, { color: theme.foreground }]}
              />
            </View>
            <Ionicons
              name="pencil"
              size={14}
              color={naming ? theme.primary : theme.mutedForeground}
            />
          </Pressable>
        </Rise>

        {/* The VIN on its own: decoding it can fill everything under it. */}
        <Rise index={1} style={styles.vinBlock}>
          <Cell
            label="VIN"
            focused={lineFocused}
            onPress={() => lineField.current?.focus()}
            trailing={
              canRead ? (
                <Button
                  label={vin ? 'Decode' : 'Fill'}
                  icon={vin ? 'barcode-outline' : 'color-wand-outline'}
                  variant="primary"
                  size="sm"
                  pill
                  loading={read.isPending}
                  onPress={() => read.mutate()}
                />
              ) : null
            }
          >
            <TextInput
              ref={lineField}
              value={line}
              onChangeText={(text) => {
                setLine(text);
                if (read.isError) read.reset();
              }}
              onFocus={() => setLineFocused(true)}
              onBlur={() => setLineFocused(false)}
              placeholder="Paste it, or describe the vehicle"
              placeholderTextColor={theme.placeholder}
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={200}
              returnKeyType={vin ? 'search' : 'done'}
              onSubmitEditing={() => canRead && !read.isPending && read.mutate()}
              accessibilityLabel="VIN, or a description of the vehicle"
              style={[
                typeScale.headline,
                vin ? figure : null,
                styles.cellInput,
                { color: theme.foreground },
              ]}
            />
          </Cell>
          {status ? (
            <Text
              accessibilityLiveRegion="polite"
              numberOfLines={1}
              style={[
                typeScale.caption,
                styles.note,
                { color: read.isError ? theme.destructive : theme.mutedForeground },
              ]}
            >
              {status}
            </Text>
          ) : null}
        </Rise>

        {/*
         * The answers, each a field of its own: make, model and year, then the plate and the reading.
         * A copper dot beside a label: filled for you, not yet touched.
         */}
        <Rise index={2} style={styles.fields}>
          <View style={styles.row}>
            <TextCell
              label="Make"
              auto={marked.has('make')}
              grow={1.3}
              lead={
                domainForMake(answers.make.trim()) ? (
                  <View style={styles.makeMark}>
                    <BrandLogo make={answers.make.trim()} size={18} />
                  </View>
                ) : null
              }
              value={answers.make}
              onChangeText={(text) => set('make', text)}
              onFocus={() => setMakeFocused(true)}
              onBlur={() => setMakeFocused(false)}
              placeholder="Mazda"
              autoCapitalize="words"
            />
            <TextCell
              label="Model"
              auto={marked.has('model')}
              grow={1.15}
              value={answers.model}
              onChangeText={(text) => set('model', text)}
              placeholder="MX-5"
            />
            <TextCell
              label="Year"
              auto={marked.has('year')}
              grow={0.85}
              invalid={yearOff}
              value={answers.year}
              onChangeText={(text) => set('year', digitsOnly(text, 4))}
              placeholder={String(NEXT_YEAR - 1)}
              keyboardType="number-pad"
              mono={answers.year !== ''}
            />
          </View>
          <View style={styles.row}>
            <TextCell
              label="Plate"
              auto={marked.has('plate')}
              grow={1}
              value={answers.plate}
              onChangeText={(text) => set('plate', text.toUpperCase())}
              placeholder="AB12 CDE"
              autoCapitalize="characters"
              maxLength={12}
              mono={answers.plate !== ''}
              plate
            />
            <OdometerCell
              label="Odometer"
              auto={marked.has('odometer')}
              value={answers.odometer}
              onChange={(text) => set('odometer', text)}
              invalid={Boolean(odometerError)}
              unit={unit}
              onUnit={setChosenUnit}
            />
          </View>
        </Rise>

        {found.length ? (
          <Rise index={3}>
            <FoundFacts
              title={filled?.from === 'vin' ? 'Decoded from the VIN' : 'Found for you'}
              icon={filled?.from === 'vin' ? 'barcode-outline' : 'document-text-outline'}
              facts={found}
              onClear={() => setExtras({})}
            />
          </Rise>
        ) : null}
      </ScrollView>

      {/* Pinned: the one way forward is always on screen, keyboard or not. */}
      <View
        style={[styles.footer, { paddingBottom: Math.max(insets.bottom, spacing.md) + spacing.xs }]}
      >
        {/* The makes that start with what is typed, over the keyboard where the thumb is. */}
        {suggestions.length ? (
          <ScrollView
            horizontal
            keyboardShouldPersistTaps="always"
            showsHorizontalScrollIndicator={false}
            style={{ marginHorizontal: -spacing.md }}
            contentContainerStyle={styles.suggestions}
          >
            {suggestions.map((option) => (
              <PressableScale
                key={option.name}
                onPress={() => {
                  set('make', option.name);
                }}
                accessibilityRole="button"
                accessibilityLabel={option.name}
                scaleTo={0.94}
                style={[
                  styles.suggestion,
                  { backgroundColor: theme.cardRaised, borderColor: theme.hairline },
                ]}
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
            style={[typeScale.caption, styles.centred, { color: theme.destructive }]}
          >
            {problem}
          </Text>
        ) : null}
        {/* The button reads back what is being added: the type, and the model once there is one. */}
        <Button
          label={action}
          icon="add"
          variant="primary"
          size="lg"
          pill
          loading={create.isPending}
          busyLabel={checking ? 'Checking your plan…' : 'Adding…'}
          disabled={!chosenGarage || yearOff || Boolean(odometerError)}
          onPress={() => create.mutate()}
        />
      </View>

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
                      <Text style={[styles.coverWord, { color: theme.primaryForeground }]}>
                        COVER
                      </Text>
                    </View>
                  ) : null}
                  <PressableScale
                    onPress={() => {
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

      {sheet === 'type' ? (
        <MenuSheet title="What is it" onClose={() => setSheet(null)}>
          <View style={styles.typeGrid}>
            {VEHICLE_TYPES.map((type) => {
              const on = type === vehicleType;
              return (
                <PressableScale
                  key={type}
                  onPress={() => {
                    chooseType(type);
                    setSheet(null);
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={typeLabel(type)}
                  scaleTo={0.95}
                  style={[
                    styles.typeTile,
                    on
                      ? { backgroundColor: theme.primarySoft, borderColor: theme.primary }
                      : { backgroundColor: theme.muted, borderColor: 'transparent' },
                  ]}
                >
                  <Glyph size={26}>{TYPE_GLYPH[type]}</Glyph>
                  <Text numberOfLines={1} style={[typeScale.label, { color: theme.foreground }]}>
                    {typeLabel(type)}
                  </Text>
                </PressableScale>
              );
            })}
          </View>
        </MenuSheet>
      ) : null}
    </KeyboardAvoidingView>
  );
}

/** The face's size, and the rings it sits in. */
const FACE = 72;
const RING_IN = 94;
const RING_OUT = 116;

/**
 * The vehicle's face, as an app icon in the middle of the head: its cover photo, else the maker's
 * mark filling the tile, else what kind of vehicle it is. It sits in two quiet rings, and while a
 * VIN or a description is being read a copper ring breathes out of it: the one moment the screen
 * is working for the person. Its key is the camera; pressed, the photos.
 */
function Medallion({
  cover,
  make,
  glyph,
  busy,
  count,
  onPress,
}: {
  cover: PickedFile | null;
  make: string;
  glyph: string;
  busy: boolean;
  count: number;
  onPress: () => void;
}) {
  const theme = useTheme();
  const reduce = useReduceMotion();
  const [pulse] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (!busy || reduce) {
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.timing(pulse, {
        toValue: 1,
        duration: 1300,
        easing: ease.out,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [busy, reduce, pulse]);
  const branded = !cover && domainForMake(make) !== null;
  const ring = (size: number) => ({
    width: size,
    height: size,
    top: (FACE - size) / 2,
    left: (FACE - size) / 2,
    borderRadius: size * 0.3,
  });

  return (
    <View style={styles.face}>
      <View
        pointerEvents="none"
        style={[styles.ring, ring(RING_OUT), { borderColor: theme.hairline }]}
      />
      <View
        pointerEvents="none"
        style={[styles.ring, ring(RING_IN), { borderColor: theme.borderStrong, opacity: 0.45 }]}
      />
      {busy && !reduce ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.ring,
            ring(RING_IN),
            {
              borderWidth: 2,
              borderColor: theme.primary,
              opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.9, 0] }),
              transform: [
                { scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1.35] }) },
              ],
            },
          ]}
        />
      ) : null}
      <PressableScale
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={
          count ? `${count} ${count === 1 ? 'photo' : 'photos'}, change` : 'Add photos'
        }
        scaleTo={0.94}
        style={[
          styles.faceTile,
          { backgroundColor: branded || cover ? '#ffffff' : theme.cardRaised },
          rimmed(theme),
        ]}
      >
        {/* Keyed by what it shows, so a change of face pops in rather than swapping. */}
        <Pop
          key={cover ? cover.uri : branded ? `make:${make.toLowerCase()}` : glyph}
          style={styles.faceClip}
        >
          {cover ? (
            <Image
              source={{ uri: cover.uri }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              accessibilityIgnoresInvertColors
            />
          ) : branded ? (
            <BrandLogo make={make} size={FACE} />
          ) : (
            <Glyph size={34}>{glyph}</Glyph>
          )}
        </Pop>
        {/* Inside the tile: Android draws an elevated tile over a sibling that comes after it. */}
        <View
          pointerEvents="none"
          style={[
            styles.faceKey,
            { backgroundColor: theme.foreground, borderColor: theme.background },
          ]}
        >
          {count > 1 ? (
            <Text style={[figure, styles.faceCount, { color: theme.background }]}>{count}</Text>
          ) : (
            <Ionicons name="camera" size={13} color={theme.background} />
          )}
        </View>
      </PressableScale>
    </View>
  );
}

/** Filled for you and not yet touched: a copper dot, beside a label or a note. */
function AutoDot() {
  const theme = useTheme();
  return <View style={[styles.autoDot, { backgroundColor: theme.primary }]} />;
}

/**
 * A field of its own: a white card with a hairline, a small label over what is typed, a copper edge
 * while it is typed in (red while what it holds cannot be saved), and a copper dot beside the label
 * when it was filled for you. A press anywhere on it is a press on its field; `trailing` sits beside
 * the words, the field's full height.
 */
function Cell({
  label,
  focused,
  auto = false,
  invalid = false,
  grow,
  onPress,
  trailing,
  children,
}: {
  label: string;
  focused: boolean;
  auto?: boolean;
  invalid?: boolean;
  /** Its share of a row; absent, a row of its own. */
  grow?: number;
  onPress: () => void;
  trailing?: ReactNode;
  children: ReactNode;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessible={false}
      style={[
        styles.cell,
        grow === undefined ? null : { flex: grow },
        {
          backgroundColor: theme.cardRaised,
          borderColor: invalid ? theme.destructive : focused ? theme.primary : theme.hairline,
        },
      ]}
    >
      <View style={styles.cellBody}>
        <View style={styles.cellLabel}>
          <Text
            numberOfLines={1}
            style={[
              styles.label,
              {
                color: invalid
                  ? theme.destructive
                  : focused
                    ? theme.primary
                    : theme.mutedForeground,
              },
            ]}
          >
            {label}
          </Text>
          {auto ? <AutoDot /> : null}
        </View>
        <View style={styles.cellLine}>{children}</View>
      </View>
      {trailing}
    </Pressable>
  );
}

/** A word or a figure typed into a cell, with what it is ahead of it (the maker's mark). */
function TextCell({
  label,
  auto,
  grow,
  invalid,
  mono = false,
  plate = false,
  lead,
  ...props
}: TextInputProps & {
  label: string;
  auto?: boolean;
  grow: number;
  invalid?: boolean;
  mono?: boolean;
  /** Spaced like a plate. */
  plate?: boolean;
  lead?: ReactNode;
}) {
  const theme = useTheme();
  const field = useRef<TextInputInstance>(null);
  const [focused, setFocused] = useState(false);
  return (
    <Cell
      label={label}
      focused={focused}
      auto={auto}
      invalid={invalid}
      grow={grow}
      onPress={() => field.current?.focus()}
    >
      {lead}
      <TextInput
        ref={field}
        placeholderTextColor={theme.placeholder}
        accessibilityLabel={auto ? `${label}, filled for you` : label}
        autoCorrect={false}
        maxLength={120}
        returnKeyType="done"
        {...props}
        onFocus={(event) => {
          setFocused(true);
          props.onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          props.onBlur?.(event);
        }}
        style={[
          typeScale.headline,
          mono ? figure : null,
          plate && mono ? styles.plateWords : null,
          styles.cellInput,
          { color: theme.foreground },
        ]}
      />
    </Cell>
  );
}

/** The reading, typed as a number and grouped as it is typed, with km and mi beside it. */
function OdometerCell({
  label,
  auto,
  value,
  onChange,
  invalid,
  unit,
  onUnit,
}: {
  label: string;
  auto?: boolean;
  value: string;
  onChange: (value: string) => void;
  invalid: boolean;
  unit: DistanceUnit;
  onUnit: (unit: DistanceUnit) => void;
}) {
  const theme = useTheme();
  const field = useRef<TextInputInstance>(null);
  const [focused, setFocused] = useState(false);
  return (
    <Cell
      label={label}
      focused={focused}
      auto={auto}
      invalid={invalid}
      grow={1.45}
      onPress={() => field.current?.focus()}
      trailing={<UnitSwitch unit={unit} onUnit={onUnit} />}
    >
      <TextInput
        ref={field}
        value={value ? Number(value).toLocaleString() : ''}
        onChangeText={(text) => onChange(digitsOnly(text, 10))}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder="0"
        placeholderTextColor={theme.placeholder}
        keyboardType="number-pad"
        returnKeyType="done"
        accessibilityLabel={`Odometer reading in ${unit === 'MI' ? 'miles' : 'kilometres'}`}
        accessibilityHint="Optional. Leave it blank if you do not know it yet."
        style={[
          typeScale.headline,
          value ? figure : null,
          styles.cellInput,
          { color: theme.foreground },
        ]}
      />
    </Cell>
  );
}

/** km and mi, both in view: the unit is asked, not assumed. */
function UnitSwitch({
  unit,
  onUnit,
}: {
  unit: DistanceUnit;
  onUnit: (unit: DistanceUnit) => void;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.units, { backgroundColor: theme.muted }]}>
      {DISTANCE_UNITS.map((option) => {
        const on = option === unit;
        return (
          <PressableScale
            key={option}
            onPress={() => {
              onUnit(option);
            }}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            accessibilityLabel={option === 'MI' ? 'Miles' : 'Kilometres'}
            hitSlop={{ top: 10, bottom: 10 }}
            scaleTo={0.9}
            style={[styles.unit, on ? { backgroundColor: theme.primary } : null]}
          >
            <Text
              style={[
                styles.unitWord,
                { color: on ? theme.primaryForeground : theme.mutedForeground },
              ]}
            >
              {option === 'MI' ? 'mi' : 'km'}
            </Text>
          </PressableScale>
        );
      })}
    </View>
  );
}

/**
 * What was found that the questions have no question for, folded away: one row saying where it came
 * from and the first of it, opening onto every fact — its icon, a small label, the value. All of it
 * is saved with the vehicle; "Leave these out" drops it.
 */
function FoundFacts({
  title,
  icon,
  facts,
  onClear,
}: {
  title: string;
  icon: IoniconName;
  facts: readonly Found[];
  onClear: () => void;
}) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const first = facts
    // Values that say what they are on their own: 2,999 cc, Gasoline — not a bare 6.
    .filter((fact) => fact.key !== 'vin' && /[a-z]/i.test(fact.value))
    .slice(0, 3)
    .map((fact) => fact.value);
  return (
    <View
      style={[styles.found, { backgroundColor: theme.cardRaised, borderColor: theme.hairline }]}
    >
      <PressableScale
        onPress={() => {
          setOpen(!open);
        }}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${title}: ${facts.length} details`}
        scaleTo={0.98}
        style={styles.foundHead}
      >
        <Ionicons name={icon} size={22} color={theme.primary} />
        <View style={styles.foundWords}>
          <Text numberOfLines={1} style={[styles.foundTitle, { color: theme.foreground }]}>
            {title}
          </Text>
          <Text numberOfLines={1} style={[typeScale.caption, { color: theme.mutedForeground }]}>
            {[`${facts.length} details`, ...first].join(' · ')}
          </Text>
        </View>
        <Ionicons
          name={open ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={theme.mutedForeground}
        />
      </PressableScale>
      {open ? (
        <Rise style={[styles.foundBody, { borderTopColor: theme.hairline }]}>
          <View style={styles.facts}>
            {facts.map((fact) => (
              <View
                key={fact.key}
                accessible
                accessibilityLabel={`${fact.label}: ${fact.value}`}
                // Two to a row; the VIN, seventeen characters, on one of its own.
                style={[styles.fact, { width: fact.key === 'vin' ? '100%' : '50%' }]}
              >
                <Ionicons name={fact.icon} size={17} color={theme.primary} />
                <View style={styles.factWords}>
                  <Text
                    numberOfLines={1}
                    style={[styles.factLabel, { color: theme.mutedForeground }]}
                  >
                    {fact.label}
                  </Text>
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.factValue,
                      fact.mono ? figure : null,
                      { color: theme.foreground },
                    ]}
                  >
                    {fact.value}
                  </Text>
                </View>
              </View>
            ))}
          </View>
          <PressableScale
            onPress={() => {
              onClear();
            }}
            accessibilityRole="button"
            hitSlop={8}
            scaleTo={0.95}
            style={styles.leaveOut}
          >
            <Ionicons name="close-circle-outline" size={14} color={theme.mutedForeground} />
            <Text
              style={[typeScale.caption, styles.leaveOutWord, { color: theme.mutedForeground }]}
            >
              Leave these out
            </Text>
          </PressableScale>
        </Rise>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  heading: { flex: 1, minWidth: 0, gap: 1 },
  title: { fontSize: 18, lineHeight: 23, fontWeight: '700', letterSpacing: -0.45 },
  parks: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start' },
  typePick: {
    height: 38,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  // What is on the screen sits in the middle of what is left of it.
  stage: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.md + 2,
  },
  who: { alignItems: 'center', gap: spacing.sm + 2 },
  // Room for the rings, which are drawn outside it.
  face: { width: FACE, height: FACE, marginVertical: (RING_OUT - FACE) / 2 - 6 },
  ring: { position: 'absolute', borderWidth: 1, borderCurve: 'continuous' },
  faceTile: {
    width: FACE,
    height: FACE,
    borderRadius: FACE * 0.3,
    borderCurve: 'continuous',
  },
  faceClip: {
    flex: 1,
    borderRadius: FACE * 0.3,
    borderCurve: 'continuous',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  faceKey: {
    position: 'absolute',
    right: -6,
    bottom: -6,
    minWidth: 28,
    height: 28,
    paddingHorizontal: 5,
    borderRadius: 14,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  faceCount: { fontSize: 12, fontWeight: '700' },
  naming: {
    maxWidth: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  nameField: { flexShrink: 1, minWidth: 0, justifyContent: 'center' },
  name: {
    fontSize: 21,
    lineHeight: 27,
    fontWeight: '700',
    letterSpacing: -0.6,
    includeFontPadding: false,
  },
  // A little over, so the caret has room after the last letter.
  nameSizer: { opacity: 0, paddingRight: 3 },
  nameInput: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    padding: 0,
    margin: 0,
    textAlignVertical: 'center',
  },
  centred: { textAlign: 'center' },
  vinBlock: { gap: 6 },
  note: { paddingHorizontal: 6 },
  fields: { gap: spacing.sm },
  row: { flexDirection: 'row', gap: spacing.sm },
  cell: {
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingLeft: 13,
    paddingRight: 10,
    paddingTop: 9,
    paddingBottom: 8,
    borderRadius: radius.xl,
    borderCurve: 'continuous',
    borderWidth: 1,
  },
  cellBody: { flex: 1, minWidth: 0, gap: 2 },
  cellLabel: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  // Small and barely tracked: the field reads as its value, not its caption.
  label: { fontSize: 10.5, lineHeight: 13, fontWeight: '600', letterSpacing: 0.3 },
  cellLine: { minHeight: 26, flexDirection: 'row', alignItems: 'center', gap: 7 },
  cellInput: { flex: 1, minWidth: 0, paddingVertical: 2, paddingHorizontal: 0, margin: 0 },
  autoDot: { width: 5, height: 5, borderRadius: 2.5 },
  makeMark: { width: 18, height: 18, borderRadius: 5, overflow: 'hidden' },
  plateWords: { fontWeight: '700', letterSpacing: 1.5 },
  units: { flexDirection: 'row', padding: 2, gap: 2, borderRadius: 10 },
  unit: {
    minWidth: 30,
    height: 28,
    paddingHorizontal: 6,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unitWord: { fontSize: 12.5, lineHeight: 16, fontWeight: '600' },
  found: { ...leaf('md'), overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth },
  foundHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  foundWords: { flex: 1, minWidth: 0, gap: 1 },
  foundTitle: { fontSize: 14, lineHeight: 18, fontWeight: '600', letterSpacing: -0.15 },
  foundBody: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  facts: { flexDirection: 'row', flexWrap: 'wrap', rowGap: spacing.md },
  fact: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingRight: spacing.sm },
  factWords: { flex: 1, minWidth: 0 },
  factLabel: { fontSize: 11, lineHeight: 14 },
  factValue: { fontSize: 14, lineHeight: 19, fontWeight: '600', letterSpacing: -0.2 },
  leaveOut: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start' },
  leaveOutWord: { fontWeight: '600' },
  footer: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, gap: spacing.sm },
  suggestions: { gap: 6, paddingHorizontal: spacing.md },
  suggestion: {
    height: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
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
  coverWord: { fontSize: 10, lineHeight: 14, fontWeight: '700' },
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
  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  typeTile: {
    width: '31.5%',
    height: 80,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: radius.lg,
    borderWidth: 1.5,
  },
});
