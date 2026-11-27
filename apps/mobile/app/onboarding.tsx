import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import { Stack, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  Animated,
  BackHandler,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { AccountKind, DistanceUnit, VolumeUnit } from '@vehicle-os/domain';
import type { Garage, Vehicle } from '@vehicle-os/contracts';
import { planWall } from '@vehicle-os/api-client';
import { queryKeys, vehiclesQuery } from '@vehicle-os/api-client/react';
import { BayStage, Floor, Room } from '@/components/bay-stage';
import {
  ChoiceCard,
  Footer,
  Kicker,
  RoundKey,
  Slide,
  StepRail,
  TwoTone,
} from '@/components/onboarding-kit';
import { Flag, useProfileUpdate } from '@/components/settings-kit';
import { api } from '@/lib/api';
import { formatMoney, toMinorUnits } from '@/lib/format';
import { Chip, Glyph, Headline, Segmented } from '@/lib/instrument';
import { CURRENCIES } from '@/lib/locale-options';
import { PressableScale, Pulse, Rise, useReduceMotion } from '@/lib/motion';
import { regionDefaults } from '@/lib/onboarding';
import { ListPicker } from '@/lib/pickers';
import { askForPush } from '@/lib/push';
import { figure, leaf, rimmed, spacing, typeScale, useTheme } from '@/lib/theme';
import { Button } from '@/lib/ui';
import { useProfile } from '@/lib/vehicle-units';

/*
 * The garage setup: what a new account does before its first look at the garage.
 *
 * Five questions, one a screen, each already answered as well as the phone can guess so most are a
 * single tap: what the account is for, the money and units its records are kept in, the garage's
 * name (the one step that cannot be skipped — everything lives in a garage), its first vehicle,
 * and whether it may nudge them when something falls due. The permission is asked last and only
 * after saying what it is for, so the system's prompt is never the first thing a person sees.
 *
 * The rail counts the account as done, so nobody starts at zero. Each answer is kept as it is
 * given — the profile through the offline queue, the garage online — so leaving halfway loses
 * nothing; Home's empty state is the way back in.
 */

type Step = 'use' | 'units' | 'garage' | 'vehicle' | 'reminders' | 'done';
const STEPS: readonly Step[] = ['use', 'units', 'garage', 'vehicle', 'reminders', 'done'];
/** The rail: the account, then the five questions. */
const RAIL = 6;

/** Names people actually give garages, so the common case is one tap. */
const SUGGESTIONS = ['Home', 'Family', 'Work', 'Weekend', 'Project cars'] as const;

export default function OnboardingScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const profile = useProfile();
  const update = useProfileUpdate();
  const guess = useMemo(regionDefaults, []);

  const [step, setStep] = useState<Step>('use');
  const [direction, setDirection] = useState<1 | -1>(1);
  // The answers, seeded from what the account already says or else the phone's best guess.
  const [kind, setKind] = useState<AccountKind>('PERSONAL');
  const [currency, setCurrency] = useState(guess.currency);
  const [distance, setDistance] = useState<DistanceUnit>(guess.distanceUnit);
  const [volume, setVolume] = useState<VolumeUnit>(guess.volumeUnit);
  const [garage, setGarage] = useState<Garage | null>(null);
  const [reminders, setReminders] = useState(false);
  const seeded = useSeedFromProfile(profile.data, { setKind, setCurrency, setDistance, setVolume });

  const at = STEPS.indexOf(step);
  const go = (next: Step) => {
    setDirection(STEPS.indexOf(next) >= at ? 1 : -1);
    setStep(next);
  };
  const back = () => {
    if (at === 0 || step === 'done') return false;
    go(STEPS[at - 1]!);
    return true;
  };

  // Android's back goes a step back, not out of the setup.
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', back);
    return () => subscription.remove();
  });

  const close = () => router.back();

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: 'transparent' }}
    >
      <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />
      {step === 'done' ? null : (
        <View style={[styles.top, { paddingTop: insets.top + spacing.sm }]}>
          {at === 0 ? (
            <RoundKey icon="close" label="Close the setup" onPress={close} />
          ) : (
            <RoundKey icon="chevron-back" label="Back" onPress={back} />
          )}
          <StepRail step={at + 2} total={RAIL} />
          <Text style={[figure, styles.count, { color: theme.mutedForeground }]}>
            {at + 2}/{RAIL}
          </Text>
        </View>
      )}

      {step === 'use' ? (
        <UseStep
          key={step}
          direction={direction}
          kind={kind}
          onKind={setKind}
          onNext={() => {
            if (profile.data?.accountKind !== kind) update.mutate({ accountKind: kind });
            go('units');
          }}
          ready={seeded}
        />
      ) : step === 'units' ? (
        <UnitsStep
          key={step}
          direction={direction}
          currency={currency}
          distance={distance}
          volume={volume}
          onCurrency={setCurrency}
          onDistance={setDistance}
          onVolume={setVolume}
          onNext={() => {
            const body = {
              defaultCurrency: currency,
              distanceUnit: distance,
              volumeUnit: volume,
              ...(guess.timezone && profile.data?.timezone !== guess.timezone
                ? { timezone: guess.timezone }
                : {}),
            };
            update.mutate(body);
            go('garage');
          }}
        />
      ) : step === 'garage' ? (
        <GarageStep
          key={step}
          direction={direction}
          owner={profile.data?.name ?? ''}
          currency={currency}
          created={garage}
          onCreated={(made) => {
            setGarage(made);
            void queryClient.invalidateQueries({ queryKey: queryKeys.garages() });
            void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard() });
            void queryClient.invalidateQueries({ queryKey: queryKeys.plan() });
            go('vehicle');
          }}
        />
      ) : step === 'vehicle' ? (
        <VehicleStep
          key={step}
          direction={direction}
          garage={garage}
          onAdd={() =>
            router.push({
              pathname: '/add/vehicle',
              params: { ...(garage ? { garageId: garage.id } : {}), then: 'back' },
            })
          }
          onNext={() => go('reminders')}
        />
      ) : step === 'reminders' ? (
        <RemindersStep
          key={step}
          direction={direction}
          onDone={(on) => {
            setReminders(on);
            go('done');
          }}
        />
      ) : (
        <DoneStep
          garage={garage}
          kind={kind}
          currency={currency}
          distance={distance}
          volume={volume}
          reminders={reminders}
          onOpen={close}
        />
      )}
    </KeyboardAvoidingView>
  );
}

/**
 * The answers start from what the account already says where it has been set (on the web, say) —
 * the server's defaults are USD, km and litres, so only something else counts as chosen.
 */
function useSeedFromProfile(
  data: ReturnType<typeof useProfile>['data'],
  set: {
    setKind: (kind: AccountKind) => void;
    setCurrency: (currency: string) => void;
    setDistance: (unit: DistanceUnit) => void;
    setVolume: (unit: VolumeUnit) => void;
  },
): boolean {
  const [seeded, setSeeded] = useState(false);
  useEffect(() => {
    if (!data || seeded) return;
    set.setKind(data.accountKind);
    if (data.defaultCurrency !== 'USD') set.setCurrency(data.defaultCurrency);
    if (data.distanceUnit !== 'KM') set.setDistance(data.distanceUnit);
    if (data.volumeUnit !== 'LITER') set.setVolume(data.volumeUnit);
    setSeeded(true);
  }, [data, seeded, set]);
  return seeded;
}

/** A step's page: its words, its content, and the footer where its decision is. */
function Page({
  direction,
  kicker,
  lead,
  rest,
  line,
  children,
  footer,
}: {
  direction: 1 | -1;
  kicker: string;
  lead: string;
  rest?: string;
  line?: string;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  const theme = useTheme();
  return (
    <>
      <ScrollView
        contentContainerStyle={styles.page}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Slide direction={direction} style={styles.words}>
          <Kicker tone="copper">{kicker}</Kicker>
          <TwoTone lead={lead} rest={rest} />
          {line ? (
            <Text style={[styles.lede, { color: theme.mutedForeground }]}>{line}</Text>
          ) : null}
        </Slide>
        <Slide direction={direction} style={styles.content}>
          {children}
        </Slide>
      </ScrollView>
      <Footer>{footer}</Footer>
    </>
  );
}

/* ---------------------------------------------------------------- what the account is for */

function UseStep({
  direction,
  kind,
  onKind,
  onNext,
  ready,
}: {
  direction: 1 | -1;
  kind: AccountKind;
  onKind: (kind: AccountKind) => void;
  onNext: () => void;
  ready: boolean;
}) {
  return (
    <Page
      direction={direction}
      kicker="Make it yours"
      lead="Who is this"
      rest="garage for?"
      line="It decides what Garajj puts first. You can change it any time."
      footer={<Button label="Continue" variant="primary" disabled={!ready} onPress={onNext} />}
    >
      <View style={styles.choices} accessibilityRole="radiogroup">
        <Rise index={1}>
          <ChoiceCard
            icon="people-outline"
            title="Me and my family"
            line="Your own cars, bikes and everything you look after."
            selected={kind === 'PERSONAL'}
            onPress={() => onKind('PERSONAL')}
          />
        </Rise>
        <Rise index={2}>
          <ChoiceCard
            icon="briefcase-outline"
            title="A business"
            line="A fleet, deliveries or clients' vehicles — with income and routes."
            selected={kind === 'BUSINESS'}
            onPress={() => onKind('BUSINESS')}
          />
        </Rise>
      </View>
    </Page>
  );
}

/* ---------------------------------------------------------------- money and units */

const VOLUMES: readonly { value: VolumeUnit; label: string; said: string }[] = [
  { value: 'LITER', label: 'L', said: 'Litres' },
  { value: 'US_GALLON', label: 'US gal', said: 'US gallons' },
  { value: 'IMP_GALLON', label: 'UK gal', said: 'UK gallons' },
];
const LITRES_PER = { LITER: 1, US_GALLON: 3.78541, IMP_GALLON: 4.54609 } as const;

function UnitsStep({
  direction,
  currency,
  distance,
  volume,
  onCurrency,
  onDistance,
  onVolume,
  onNext,
}: {
  direction: 1 | -1;
  currency: string;
  distance: DistanceUnit;
  volume: VolumeUnit;
  onCurrency: (currency: string) => void;
  onDistance: (unit: DistanceUnit) => void;
  onVolume: (unit: VolumeUnit) => void;
  onNext: () => void;
}) {
  const theme = useTheme();
  const [picking, setPicking] = useState(false);
  const named = CURRENCIES.find((option) => option.value === currency)?.label ?? currency;

  // A fill-up as it will be written: the same 40 litres, in the units chosen.
  const quantity = 40 / LITRES_PER[volume];
  const fuel = `${quantity.toFixed(volume === 'LITER' ? 0 : 1)} ${VOLUMES.find((option) => option.value === volume)!.label}`;
  const reading = `${(distance === 'KM' ? 52300 : 32500).toLocaleString()} ${distance === 'KM' ? 'km' : 'mi'}`;
  let price: string;
  try {
    price = formatMoney({ amountMinor: toMinorUnits(62.4, currency), currency });
  } catch {
    price = `${currency} 62.40`;
  }

  return (
    <Page
      direction={direction}
      kicker="Your units"
      lead="Money and miles,"
      rest="the way you count them."
      line="Guessed from your phone. Fix anything that is off."
      footer={<Button label="Looks right" variant="primary" onPress={onNext} />}
    >
      {/* What a record will look like, live: the answer to "why does this matter". */}
      <Rise
        index={1}
        style={[styles.receipt, { backgroundColor: theme.cardRaised }, rimmed(theme)]}
      >
        <View style={styles.receiptHead}>
          <Glyph size={20}>⛽</Glyph>
          <Text style={[styles.receiptTitle, { color: theme.foreground }]}>
            A fill-up, as you'll see it
          </Text>
        </View>
        <View style={styles.receiptRow}>
          <Reading label="Fuel" value={fuel} />
          <Reading label="Paid" value={price} />
          <Reading label="Odometer" value={reading} />
        </View>
      </Rise>

      <Rise
        index={2}
        style={[styles.settings, { backgroundColor: theme.cardRaised }, rimmed(theme)]}
      >
        <View style={styles.settingRow}>
          <Text style={[styles.settingLabel, { color: theme.foreground }]}>Currency</Text>
          <Button
            label={currency}
            size="sm"
            icon="chevron-down"
            onPress={() => setPicking(true)}
            a11yLabel={`Currency, ${named}. Change`}
          />
        </View>
        <View style={styles.currencyLine}>
          <Flag currency={currency} />
          <Text style={[typeScale.caption, { color: theme.mutedForeground }]}>{named}</Text>
        </View>
        <View style={[styles.rule, { backgroundColor: theme.border }]} />
        <View style={styles.settingRow}>
          <Text style={[styles.settingLabel, { color: theme.foreground }]}>Distance</Text>
          <View style={styles.segment}>
            <Segmented
              small
              value={distance}
              options={[
                { value: 'KM', label: 'km', said: 'Kilometres' },
                { value: 'MI', label: 'mi', said: 'Miles' },
              ]}
              onChange={onDistance}
            />
          </View>
        </View>
        <View style={[styles.rule, { backgroundColor: theme.border }]} />
        <View style={styles.settingRow}>
          <Text style={[styles.settingLabel, { color: theme.foreground }]}>Fuel</Text>
          <View style={styles.segmentWide}>
            <Segmented small value={volume} options={VOLUMES} onChange={onVolume} />
          </View>
        </View>
      </Rise>

      {picking ? (
        <ListPicker
          title="Currency"
          value={currency}
          options={CURRENCIES}
          placeholder="Search currencies"
          onChange={(next) => {
            onCurrency(next);
            setPicking(false);
          }}
          onClose={() => setPicking(false)}
        />
      ) : null}
    </Page>
  );
}

function Reading({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return (
    <View style={styles.reading}>
      <Text style={[styles.readingLabel, { color: theme.mutedForeground }]}>
        {label.toUpperCase()}
      </Text>
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.7}
        style={[figure, styles.readingValue, { color: theme.foreground }]}
      >
        {value}
      </Text>
    </View>
  );
}

/* ---------------------------------------------------------------- the garage */

function GarageStep({
  direction,
  owner,
  currency,
  created,
  onCreated,
}: {
  direction: 1 | -1;
  owner: string;
  currency: string;
  created: Garage | null;
  onCreated: (garage: Garage) => void;
}) {
  const first = owner.trim().split(/\s+/)[0] ?? '';
  const [name, setName] = useState(created?.name ?? (first ? `${first}'s garage` : 'My garage'));
  const trimmed = name.trim();

  const create = useMutation({
    mutationFn: () => api.garages.create({ name: trimmed, defaultCurrency: currency }),
    onSuccess: (garage) => {
      onCreated(garage);
    },
  });
  const failure =
    create.error && !planWall(create.error)
      ? /network|fetch/i.test((create.error as Error).message)
        ? 'A garage needs a connection to create. Check your signal and try again.'
        : (create.error as Error).message
      : null;

  return (
    <Page
      direction={direction}
      kicker="Your garage"
      lead="Name the place"
      rest="your vehicles live."
      line="Share it later with whoever drives them too."
      footer={
        created ? (
          <Button label="Continue" variant="primary" onPress={() => onCreated(created)} />
        ) : (
          <Button
            label="Open my garage"
            icon="key"
            variant="primary"

            loading={create.isPending}
            disabled={!trimmed}
            onPress={() => create.mutate()}
          />
        )
      }
    >
      <Rise index={1}>
        <GaragePreview
          name={trimmed || 'Your garage'}
          currency={currency}
          open={Boolean(created)}
        />
      </Rise>
      <Rise index={2} style={{ gap: spacing.sm }}>
        <Headline
          label="Garage name"
          value={name}
          onChangeText={setName}
          editable={!created && !create.isPending}
          selectTextOnFocus
          autoCapitalize="words"
          returnKeyType="done"
          onSubmitEditing={() => !created && trimmed && create.mutate()}
          maxLength={80}
          error={failure ?? undefined}
        />
        {created ? null : (
          <View style={styles.chips}>
            {SUGGESTIONS.map((suggestion) => (
              <Chip
                key={suggestion}
                compact
                label={suggestion}
                selected={trimmed === suggestion}
                onPress={() => setName(suggestion)}
              />
            ))}
          </View>
        )}
      </Rise>
    </Page>
  );
}

/**
 * The garage as it will be on Home, filling in as it is named: its floor of four numbered bays,
 * painted lines between them, the name and what it holds under it.
 */
function GaragePreview({
  name,
  currency,
  open,
}: {
  name: string;
  currency: string;
  open: boolean;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.garage, { backgroundColor: theme.cardRaised }, rimmed(theme)]}>
      <View style={[styles.floor, { backgroundColor: theme.muted }]}>
        {Array.from({ length: 4 }, (_, bay) => (
          <View
            key={bay}
            style={[
              styles.bay,
              bay > 0
                ? { borderLeftWidth: 2, borderLeftColor: theme.borderStrong, borderStyle: 'dashed' }
                : null,
            ]}
          >
            <Text style={[figure, styles.bayNumber, { color: theme.mutedForeground }]}>
              {String(bay + 1).padStart(2, '0')}
            </Text>
          </View>
        ))}
      </View>
      <View style={styles.garageFoot}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={[styles.garageName, { color: theme.foreground }]}>
            {name}
          </Text>
          <Text style={[figure, styles.garageMeta, { color: theme.mutedForeground }]}>
            0 vehicles · {currency}
          </Text>
        </View>
        {open ? (
          <View style={[styles.openTag, { backgroundColor: theme.successSoft }]}>
            <Pulse color={theme.success} size={6} />
            <Text style={[styles.openText, { color: theme.success }]}>Open</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

/* ---------------------------------------------------------------- the first vehicle */

function VehicleStep({
  direction,
  garage,
  onAdd,
  onNext,
}: {
  direction: 1 | -1;
  garage: Garage | null;
  onAdd: () => void;
  onNext: () => void;
}) {
  const vehicles = useQuery(vehiclesQuery(api));
  const parked = (vehicles.data?.data ?? []).filter(
    (vehicle) => !garage || vehicle.garageId === garage.id,
  );
  const first = parked[0];

  return (
    <Page
      direction={direction}
      kicker="First in"
      lead={first ? 'Parked.' : 'Park your'}
      rest={first ? 'Its record starts today.' : 'first vehicle.'}
      line={
        first
          ? 'Add more whenever you like — each gets a bay of its own.'
          : 'Make, model and a reading is all it takes. A photo makes it yours.'
      }
      footer={
        first ? (
          <Button label="Continue" variant="primary" onPress={onNext} />
        ) : (
          <>
            <Button label="Add a vehicle" icon="add" variant="primary" onPress={onAdd} />
            <Button label="I'll add one later" variant="ghost" onPress={onNext} />
          </>
        )
      }
    >
      <Rise index={1}>{first ? <ParkedBay vehicle={first} /> : <OpenBay onAdd={onAdd} />}</Rise>
    </Page>
  );
}

/** Bay 01 with the light on and nothing in it: the whole stage is the way to fill it. */
function OpenBay({ onAdd }: { onAdd: () => void }) {
  const theme = useTheme();
  const [width, setWidth] = useState(0);
  return (
    <PressableScale
      onPress={() => {
        onAdd();
      }}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      accessibilityRole="button"
      accessibilityLabel="Add a vehicle to bay one"
      scaleTo={0.98}
      style={[styles.openBay, { backgroundColor: theme.cardRaised }, rimmed(theme)]}
    >
      {width ? (
        <>
          <Room id="onboarding-open" width={width} height={OPEN_BAY} lit={1} />
          <Floor id="onboarding-open" width={width} height={OPEN_BAY} number={1} />
        </>
      ) : null}
      <View style={styles.openSpot}>
        <View
          style={[
            styles.openKey,
            { borderColor: theme.primary, backgroundColor: theme.primarySoft },
          ]}
        >
          <Ionicons name="add" size={22} color={theme.primary} />
        </View>
        <Text style={[styles.openLabel, { color: theme.foreground }]}>Tap to park</Text>
      </View>
    </PressableScale>
  );
}

const OPEN_BAY = 168;

/** The vehicle just added, in its lit bay, with its name under it. */
function ParkedBay({ vehicle }: { vehicle: Vehicle }) {
  const theme = useTheme();
  const [width, setWidth] = useState(0);
  return (
    <View
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      style={[styles.parked, { backgroundColor: theme.cardRaised }, rimmed(theme)]}
    >
      {width ? (
        <BayStage
          id={`onboarding-${vehicle.id}`}
          photo={vehicle.primaryPhoto}
          make={vehicle.make}
          vehicleType={vehicle.vehicleType}
          width={width - 12}
          height={Math.round((width - 12) * 0.56)}
          number={1}
          style={styles.parkedStage}
        />
      ) : null}
      <View style={styles.parkedFoot}>
        <Text numberOfLines={1} style={[styles.garageName, { color: theme.foreground }]}>
          {vehicle.displayName}
        </Text>
        <View style={[styles.openTag, { backgroundColor: theme.successSoft }]}>
          <Ionicons name="checkmark" size={12} color={theme.success} />
          <Text style={[styles.openText, { color: theme.success }]}>Parked</Text>
        </View>
      </View>
    </View>
  );
}

/* ---------------------------------------------------------------- reminders */

const NOTICES = [
  { emoji: '🛢️', title: 'Oil change due', line: 'in 12 days · or 480 km' },
  { emoji: '🛡️', title: 'Insurance renews', line: 'in 3 weeks' },
  { emoji: '🔧', title: 'Possible recall', line: 'Check with your dealer' },
] as const;

function RemindersStep({
  direction,
  onDone,
}: {
  direction: 1 | -1;
  onDone: (on: boolean) => void;
}) {
  const [asking, setAsking] = useState(false);

  // Already allowed: nothing to ask, nothing to show.
  useEffect(() => {
    void Notifications.getPermissionsAsync()
      .then((current) => {
        if (current.granted) onDone(true);
      })
      .catch(() => undefined);
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const turnOn = async () => {
    setAsking(true);
    await askForPush();
    const now = await Notifications.getPermissionsAsync().catch(() => null);
    setAsking(false);
    onDone(Boolean(now?.granted));
  };

  return (
    <Page
      direction={direction}
      kicker="Stay ahead"
      lead="Never miss"
      rest="what's due."
      line="A nudge before a service, a renewal or a recall — never ads, never noise."
      footer={
        <>
          <Button
            label="Turn on reminders"
            icon="notifications"
            variant="primary"

            loading={asking}
            onPress={() => void turnOn()}
          />
          <Button label="Not now" variant="ghost" onPress={() => onDone(false)} />
        </>
      }
    >
      <View style={styles.notices}>
        {NOTICES.map((notice, index) => (
          <Notice key={notice.title} index={index} {...notice} />
        ))}
      </View>
    </Page>
  );
}

/** A reminder as it will arrive: dropping in one after another, each a little behind the last. */
function Notice({
  index,
  emoji,
  title,
  line,
}: {
  index: number;
  emoji: string;
  title: string;
  line: string;
}) {
  const theme = useTheme();
  const reduce = useReduceMotion();
  const [drop] = useState(() => new Animated.Value(reduce ? 1 : 0));
  useEffect(() => {
    if (reduce) return;
    const run = Animated.sequence([
      Animated.delay(260 + index * 420),
      Animated.spring(drop, { toValue: 1, speed: 11, bounciness: 8, useNativeDriver: true }),
    ]);
    run.start();
    return () => {
      run.stop();
    };
  }, [drop, index, reduce]);
  return (
    <Animated.View
      style={[
        styles.notice,
        { backgroundColor: theme.cardRaised },
        rimmed(theme),
        {
          opacity: drop,
          transform: [
            { translateY: drop.interpolate({ inputRange: [0, 1], outputRange: [-36, 0] }) },
            {
              scale: drop.interpolate({
                inputRange: [0, 1],
                outputRange: [0.94, 1 - index * 0.02],
              }),
            },
          ],
        },
      ]}
    >
      <View style={[styles.noticeGlyph, { backgroundColor: theme.muted }]}>
        <Glyph size={22}>{emoji}</Glyph>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={[styles.noticeTitle, { color: theme.foreground }]}>
          {title}
        </Text>
        <Text numberOfLines={1} style={[styles.noticeLine, { color: theme.mutedForeground }]}>
          {line}
        </Text>
      </View>
      <Text style={[figure, styles.noticeWhen, { color: theme.mutedForeground }]}>
        {index === 0 ? 'now' : `${index * 2}d`}
      </Text>
    </Animated.View>
  );
}

/* ---------------------------------------------------------------- done */

function DoneStep({
  garage,
  kind,
  currency,
  distance,
  volume,
  reminders,
  onOpen,
}: {
  garage: Garage | null;
  kind: AccountKind;
  currency: string;
  distance: DistanceUnit;
  volume: VolumeUnit;
  reminders: boolean;
  onOpen: () => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const vehicles = useQuery(vehiclesQuery(api));
  const count = (vehicles.data?.data ?? []).filter(
    (vehicle) => !garage || vehicle.garageId === garage.id,
  ).length;
  const lines = [
    {
      done: true,
      text: kind === 'BUSINESS' ? 'Set up for a business' : 'Set up for you and yours',
    },
    {
      done: true,
      text: `${currency} · ${distance === 'KM' ? 'km' : 'mi'} · ${VOLUMES.find((option) => option.value === volume)!.label}`,
    },
    { done: Boolean(garage), text: garage ? `${garage.name} is open` : 'No garage yet' },
    {
      done: count > 0,
      text:
        count > 0
          ? `${count} ${count === 1 ? 'vehicle' : 'vehicles'} parked`
          : 'Add a vehicle any time with +',
    },
    { done: reminders, text: reminders ? 'Reminders on' : 'Reminders off — turn on in Settings' },
  ];

  return (
    <View style={[styles.done, { paddingTop: insets.top + spacing.xxl }]}>
      <View style={styles.doneBody}>
        <Rise>
          <View style={[styles.seal, { backgroundColor: theme.primarySoft }]}>
            <Glyph size={44}>✨</Glyph>
          </View>
        </Rise>
        <Rise index={1} style={{ gap: spacing.sm, alignItems: 'center' }}>
          <TwoTone size="xl" align="center" lead="You're in." rest="The garage is yours." />
        </Rise>
        <View style={[styles.summary, { backgroundColor: theme.cardRaised }, rimmed(theme)]}>
          {lines.map((line, index) => (
            <Rise key={line.text} index={index + 2} distance={8}>
              <View style={styles.summaryRow}>
                <View
                  style={[
                    styles.tick,
                    { backgroundColor: line.done ? theme.primary : theme.muted },
                  ]}
                >
                  <Ionicons
                    name={line.done ? 'checkmark' : 'remove'}
                    size={12}
                    color={line.done ? theme.primaryForeground : theme.mutedForeground}
                  />
                </View>
                <Text
                  style={[
                    styles.summaryText,
                    { color: line.done ? theme.foreground : theme.mutedForeground },
                  ]}
                >
                  {line.text}
                </Text>
              </View>
            </Rise>
          ))}
        </View>
      </View>
      <Footer>
        <Button
          label="Open my garage"
          icon="arrow-forward"
          variant="primary"

          onPress={onOpen}
        />
      </Footer>
    </View>
  );
}

const styles = StyleSheet.create({
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  count: { fontSize: 11, lineHeight: 14, fontWeight: '600', minWidth: 28, textAlign: 'right' },
  page: { flexGrow: 1, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, gap: spacing.lg },
  words: { gap: 6 },
  lede: { fontSize: 14, lineHeight: 20, fontWeight: '400' },
  openBay: { ...leaf('lg'), height: OPEN_BAY, overflow: 'hidden' },
  openSpot: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingBottom: 18,
  },
  openKey: {
    width: 46,
    height: 46,
    borderRadius: 23,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  openLabel: { fontSize: 13, lineHeight: 17, fontWeight: '600' },
  content: { gap: spacing.md },
  choices: { gap: spacing.md },

  receipt: { ...leaf('md'), padding: spacing.lg, gap: spacing.md },
  receiptHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  receiptTitle: { fontSize: 13.5, lineHeight: 18, fontWeight: '600' },
  receiptRow: { flexDirection: 'row', gap: spacing.md },
  reading: { flex: 1, minWidth: 0, gap: 3 },
  readingLabel: { fontSize: 9, lineHeight: 12, fontWeight: '600', letterSpacing: 0.8 },
  readingValue: { fontSize: 16, lineHeight: 21, fontWeight: '600', letterSpacing: 0 },
  settings: { ...leaf('md'), paddingVertical: spacing.sm, paddingHorizontal: spacing.lg },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    minHeight: 52,
  },
  settingLabel: { fontSize: 15, lineHeight: 20, fontWeight: '600' },
  currencyLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: -6,
    paddingBottom: spacing.sm,
  },
  rule: { height: StyleSheet.hairlineWidth },
  segment: { width: 140 },
  segmentWide: { width: 210 },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  garage: { ...leaf('md'), padding: 8, paddingBottom: 12, gap: 10 },
  floor: {
    ...leaf('md', 8),
    flexDirection: 'row',
    height: 92,
    paddingHorizontal: 4,
    paddingTop: 6,
    overflow: 'hidden',
  },
  bay: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 6 },
  bayNumber: { fontSize: 10, fontWeight: '600', letterSpacing: 1 },
  garageFoot: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: 6 },
  garageName: { fontSize: 17, lineHeight: 22, fontWeight: '700', letterSpacing: -0.35 },
  garageMeta: { fontSize: 11.5, lineHeight: 16, fontWeight: '500', letterSpacing: 0 },
  openTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 24,
    paddingHorizontal: 9,
    borderRadius: 12,
  },
  openText: { fontSize: 12, lineHeight: 16, fontWeight: '700' },

  parked: { ...leaf('lg'), padding: 6, gap: 2 },
  parkedStage: leaf('lg', 6),
  parkedFoot: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: 10,
    paddingTop: 10,
    paddingBottom: 8,
  },

  notices: { gap: spacing.sm, paddingTop: spacing.sm },
  notice: {
    ...leaf('md'),
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  noticeGlyph: {
    ...leaf('sm'),
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noticeTitle: { fontSize: 14.5, lineHeight: 19, fontWeight: '700' },
  noticeLine: { fontSize: 12.5, lineHeight: 17, fontWeight: '500' },
  noticeWhen: { fontSize: 10.5, lineHeight: 14, fontWeight: '600' },

  done: { flex: 1 },
  doneBody: { flex: 1, alignItems: 'center', paddingHorizontal: spacing.lg, gap: spacing.xl },
  seal: { ...leaf('lg'), width: 96, height: 96, alignItems: 'center', justifyContent: 'center' },
  summary: {
    ...leaf('md'),
    alignSelf: 'stretch',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 40 },
  tick: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  summaryText: { flex: 1, fontSize: 14.5, lineHeight: 19, fontWeight: '600' },
});
