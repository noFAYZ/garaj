import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Animated,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, {
  Circle,
  Defs,
  Ellipse,
  G,
  LinearGradient,
  Path,
  RadialGradient,
  Rect,
  Stop,
} from 'react-native-svg';
import {
  ENTITLEMENT_COPY,
  ENTITLEMENTS,
  entitlementsFor,
  limitsFor,
  PLAN_NAMES,
  PLAN_RANK,
  PLAN_TIERS,
  type Entitlement,
  type PlanLimits,
  type PlanTier,
} from '@vehicle-os/domain';
import { TwoWay } from '@/components/add-kit';
import { api } from '@/lib/api';
import { LegalLinks } from '@/lib/legal';
import { pad } from '@/lib/format';
import { PressableScale, Rise, useReduceMotion } from '@/lib/motion';
import { Bays, PlanCard, PlanCardGhost } from '@/components/plan-card';
import { PlanBadge, PlanPass } from '@/lib/plan-kit';
import {
  buy,
  isCancelled,
  isPending,
  loadOffers,
  openStoreManagement,
  restore,
  storeAvailable,
  storeBilled,
  storeName,
  webBilled,
  type Cadence,
  type PaidTier,
  type StoreOffer,
} from '@/lib/store';
import { usePlan } from '@/lib/upgrade';
import { useProfile } from '@/lib/vehicle-units';
import { figure, radius, spacing, useTheme, type Theme } from '@/lib/theme';

type Limit = keyof PlanLimits;
/** Choosing; bought and waiting for the server to see it; waited too long; upgraded. */
type Phase = 'choose' | 'confirming' | 'slow' | 'done';

const LIMIT_NOUN: Record<Limit, [string, string]> = {
  vehicles: ['vehicle', 'vehicles'],
  garages: ['garage', 'garages'],
  members: ['person', 'people'],
};

/** A report hue: the chart colours, the app's one use of hue for something other than a status. */
type Hue = 'chartRefuel' | 'chartService' | 'chartExpense' | 'chartIncome' | 'chartTrip';
type IconName = keyof typeof Ionicons.glyphMap;

/** Each gain as an icon on a tile of its own hue, so three lines read as three different things. */
const LIMIT_MARK: Record<Limit, { icon: IconName; hue: Hue }> = {
  vehicles: { icon: 'car-sport', hue: 'chartRefuel' },
  garages: { icon: 'home', hue: 'chartService' },
  members: { icon: 'people', hue: 'chartTrip' },
};
const FEATURE_MARK: Record<Entitlement, { icon: IconName; hue: Hue }> = {
  'passport.share': { icon: 'document-text', hue: 'chartIncome' },
  'income.track': { icon: 'cash', hue: 'chartIncome' },
  'mileage.report': { icon: 'speedometer', hue: 'chartService' },
  'driver.assign': { icon: 'people', hue: 'chartExpense' },
};

/** A way of paying, as its card names it. */
const CADENCE_NAME: Record<Cadence, string> = {
  monthly: 'Monthly',
  annual: 'Yearly',
  lifetime: 'Lifetime',
};

/** The cards' order: the yearly one, the best value, first. */
const SHOWN_ORDER: readonly Cadence[] = ['annual', 'monthly', 'lifetime'];

const POLL_MS = 2_000;
const PATIENCE_MS = 30_000;

const clock = (seconds: number) => `${pad(Math.floor(seconds / 60))}:${pad(seconds % 60)}`;
const noun = (limit: Limit, count: number) => LIMIT_NOUN[limit][count === 1 ? 0 : 1];
const isEntitlement = (value: string | undefined): value is Entitlement =>
  (ENTITLEMENTS as readonly string[]).includes(value ?? '');
const isLimit = (value: string | undefined): value is Limit =>
  value === 'vehicles' || value === 'garages' || value === 'members';
const gainedFeatures = (from: PlanTier, to: PlanTier) =>
  entitlementsFor(to).filter((entitlement) => !entitlementsFor(from).includes(entitlement));

interface Gain {
  readonly key: string;
  readonly icon: IconName;
  readonly hue: Hue;
  readonly title: string;
  readonly line: string;
}

/**
 * What a plan adds over the one held, a line each: room for vehicles first, then what the plan
 * unlocks, then its other room — what was hit leading — and three at most, so the plans stay in view.
 * Plus reads as more vehicles, the passport and more garages; Business as its reports.
 */
function gainsOf(
  from: PlanTier,
  to: PlanTier,
  lead: Entitlement | Limit | null,
  most = 3,
): readonly Gain[] {
  const before = limitsFor(from);
  const after = limitsFor(to);
  const room = (limit: Limit): Gain | null =>
    after[limit] > before[limit]
      ? {
          key: limit,
          ...LIMIT_MARK[limit],
          title:
            limit === 'members'
              ? `${after.members} people per garage`
              : `${after[limit]} ${noun(limit, after[limit])}`,
          line: `${after[limit] - before[limit]} more than ${PLAN_NAMES[from]}`,
        }
      : null;
  const rows = [
    room('vehicles'),
    // Not the passport (user, 2026-11-26): Plus still has it, the paywall does not sell with it.
    ...gainedFeatures(from, to)
      .filter((gain) => gain !== 'passport.share')
      .map((gain) => ({
        key: gain,
        ...FEATURE_MARK[gain],
        title: ENTITLEMENT_COPY[gain].name,
        line: ENTITLEMENT_COPY[gain].does,
      })),
    room('garages'),
    room('members'),
  ].filter((row): row is Gain => row !== null);
  // `sort` on the array `filter` made: Hermes has no `toSorted`.
  return rows.sort((a, b) => Number(b.key === lead) - Number(a.key === lead)).slice(0, most);
}

/** Made-up prices a dev build lays the cards out against, in the person's own currency. */
const DEMO_PRICES: Record<string, readonly [plus: number, business: number]> = {
  PKR: [1200, 4500],
  INR: [249, 899],
  default: [2.99, 9.99],
};

/**
 * Sample offers — Plus and Business, monthly (the store sells no yearly) — for a build whose store has nothing
 * to sell (Expo Go, no RevenueCat keys, an empty offering). Never in a release: a price on this
 * screen is the store's or none. They cannot be bought; the screen keeps its button off.
 */
function demoOffers(currency: string): StoreOffer[] {
  const [plusMonth, businessMonth] = DEMO_PRICES[currency] ?? DEMO_PRICES.default!;
  let format = (amount: number) => `${currency} ${Math.round(amount)}`;
  try {
    const whole = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    });
    const cents = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    format = (amount) => (amount >= 100 ? whole : cents).format(amount);
  } catch {
    // An unknown code: the plain fallback above.
  }
  const make = (tier: PaidTier, cadence: Cadence, amount: number): StoreOffer => ({
    tier,
    cadence,
    amount,
    price: format(amount),
    perMonth: format(cadence === 'annual' ? amount / 12 : amount),
    trial: null,
    productId: `demo_${tier}_${cadence}`,
    pkg: null as unknown as StoreOffer['pkg'],
  });
  return [make('PLUS', 'monthly', plusMonth), make('BUSINESS', 'monthly', businessMonth)];
}

/** What a way of paying comes to, as a card's figure says it: a month where it can. */
function priceOf(way: StoreOffer): { figure: string; unit: string } {
  if (way.cadence === 'lifetime') return { figure: way.price, unit: 'once' };
  if (way.cadence === 'annual' && way.perMonth) return { figure: way.perMonth, unit: 'per month' };
  return { figure: way.price, unit: way.cadence === 'annual' ? 'per year' : 'per month' };
}

/** How a way of paying is billed, in a few words, its trial first. */
function billedOf(way: StoreOffer): string {
  if (way.cadence === 'lifetime') return 'Pay once, keep it';
  const per = way.cadence === 'annual' ? 'yr' : 'mo';
  if (way.trial) return `${way.trial} free, then ${way.price}/${per}`;
  return way.cadence === 'annual' ? `${way.price} a year` : 'Billed monthly';
}

/**
 * The upgrade (GAPS §10, §17): one screen that decides, instead of a pointer to settings.
 *
 * Laid out as a store paywall reads: the brand's mark on a copper sky across the top, with the
 * close and Restore over it; under it, on a sheet, why it opened (small, in copper), "Get Garajj
 * Plus" and its trial, what the plan adds a line each, the ways to pay as cards — the chosen one
 * ringed in copper, the yearly one flagged with what it saves — and one copper button that says
 * what happens next, with the terms under it.
 *
 * Opened from anywhere a plan refuses something — a full garage, a paid feature, the queue
 * replaying an offline write — with the reason in its params, so it leads with what was hit.
 *
 * It never decides a plan changed. The purchase happens in the phone's store (`lib/store`), the
 * server reads it from RevenueCat, and this screen waits for the plan in plain sight — the mark
 * breathes until the plan is real. A plan paid for on the web is not sold or managed here: the
 * store's rules keep the app to its own billing, so it only says where that plan lives.
 */
export default function UpgradeScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const params = useLocalSearchParams<{
    reason?: string;
    limit?: string;
    entitlement?: string;
    plan?: string;
  }>();

  const { data, plan } = usePlan();
  const { refetch } = plan;
  const profile = useProfile().data;
  const userId = profile?.id;
  // Not persisted (its root is not in the cache's list): store packages are live objects.
  const offers = useQuery({
    queryKey: ['store', 'offers', userId],
    queryFn: () => loadOffers(userId!),
    enabled: Boolean(userId) && storeAvailable(),
    staleTime: 10 * 60_000,
  });
  const elsewhere = webBilled(data);
  const inStore = storeBilled(data);

  const [phase, setPhase] = useState<Phase>('choose');
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (phase !== 'confirming' && phase !== 'slow') return;
    const tick = setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => clearInterval(tick);
  }, [phase]);
  const [notice, setNotice] = useState<string | null>(null);
  const [picked, setPicked] = useState<PaidTier | null>(null);
  const [pickedCadence, setPickedCadence] = useState<Cadence | null>(null);
  /*
   * The order in flight: which plan, bought from which. Kept apart from the live plan so the
   * screen goes on describing the purchase after the plan itself has changed underneath it.
   */
  const [order, setOrder] = useState<{ from: PlanTier; to: PaidTier } | null>(null);

  const current: PlanTier = order?.from ?? data?.plan ?? 'FREE';
  const required: PaidTier | null =
    params.plan === 'PLUS' || params.plan === 'BUSINESS' ? params.plan : null;
  const limit = params.reason === 'limit' && isLimit(params.limit) ? params.limit : null;
  const entitlement =
    params.reason === 'feature' && isEntitlement(params.entitlement) ? params.entitlement : null;

  // Only tiers above the current one that would actually remove the wall.
  const floor = required ? PLAN_RANK[required] : 1;
  const options = PLAN_TIERS.filter(
    (tier): tier is PaidTier =>
      tier !== 'FREE' && PLAN_RANK[tier] > PLAN_RANK[current] && PLAN_RANK[tier] >= floor,
  );
  const chosen = order?.to ?? options.find((tier) => tier === picked) ?? options[0] ?? null;
  // Paying already: the store replaces that subscription rather than starting another.
  const switching = current !== 'FREE';
  const offersLoading = offers.isPending && offers.fetchStatus !== 'idle';
  // A dev build with nothing from the store prices its cards with samples; a release never does.
  const demo = __DEV__ && !offersLoading && (offers.data ?? []).length === 0;
  const catalogue = demo ? demoOffers(profile?.defaultCurrency ?? 'USD') : (offers.data ?? []);
  // The ways the chosen tier is sold, best value first, and the one picked — yearly by default.
  const ways = catalogue
    .filter((offer) => offer.tier === chosen)
    .sort((a, b) => SHOWN_ORDER.indexOf(a.cadence) - SHOWN_ORDER.indexOf(b.cadence));
  const offer =
    ways.find((way) => way.cadence === pickedCadence) ??
    ways.find((way) => way.cadence === 'annual') ??
    ways.find((way) => way.cadence === 'monthly') ??
    ways[0] ??
    null;
  // Nothing to sell in this build, or the store has no price for it: say so now, not on the press.
  const unavailable =
    demo ||
    !storeAvailable() ||
    Boolean(chosen && (offers.isError || (offers.isSuccess && !offer)));

  // While confirming, ask every two seconds for half a minute — then say so, and stop. The
  // first ask goes to RevenueCat through the server, not only to a webhook that may never arrive.
  useEffect(() => {
    if (phase !== 'confirming') return;
    void api.billing
      .sync()
      .catch(() => undefined)
      .then(() => refetch());
    const tick = setInterval(() => void refetch(), POLL_MS);
    const giveUp = setTimeout(() => setPhase('slow'), PATIENCE_MS);
    return () => {
      clearInterval(tick);
      clearTimeout(giveUp);
    };
  }, [phase, refetch]);

  // The only thing that says "upgraded": the plan, from the server.
  useEffect(() => {
    if (order && data?.plan === order.to && phase !== 'done') {
      setPhase('done');
    }
  }, [data?.plan, order, phase]);

  /*
   * The store's sheet does the paying. Backing out of it is not a failure — nothing was charged —
   * so it says so quietly; a purchase that went through waits for the server to see it.
   */
  const purchase = useMutation({
    mutationFn: async (way: StoreOffer) => {
      setNotice(null);
      setOrder({ from: data?.plan ?? 'FREE', to: way.tier });
      try {
        await buy(userId!, way);
      } catch (error) {
        setOrder(null);
        if (isCancelled(error)) {
          setNotice('Purchase cancelled. Nothing was charged.');
          return;
        }
        if (isPending(error)) {
          setNotice(
            `Payment pending. Your plan starts once ${storeName(data?.store)} confirms the payment.`,
          );
          return;
        }
        throw error;
      }
      setPhase('confirming');
    },
  });
  const restoring = useMutation({
    mutationFn: async () => {
      await restore(userId!);
      await refetch();
      setNotice('Purchases restored.');
    },
  });

  const failure = purchase.error ?? restoring.error;
  const failureText = failure instanceof Error ? failure.message : null;

  const waiting = phase === 'confirming' || phase === 'slow';
  const choosing = phase === 'choose' && chosen !== null;

  const [title, subtitle] =
    phase === 'done' && order
      ? [`You’re on ${PLAN_NAMES[order.to]}`, `${PLAN_NAMES[order.to]} is active on your account.`]
      : phase === 'confirming'
        ? ['Confirming your payment', 'Usually a few seconds.']
        : phase === 'slow'
          ? ['Payment received', 'Your plan hasn’t updated yet. It can take a minute.']
          : !chosen
            ? ['You’re on the largest plan', 'Everything Garajj does is already yours.']
            : [`Get Garajj ${PLAN_NAMES[chosen]}`, null];

  // The trial the store gives on the chosen way: its flag, its button and its promise.
  const trial = choosing && !elsewhere ? (offer?.trial ?? null) : null;
  /*
   * Two paid plans to choose between: each is a card, priced in the billing the switch over them
   * says — yearly unless monthly was chosen. One plan: its ways to pay are the cards instead.
   */
  const billing: Cadence = pickedCadence ?? 'annual';
  const sold = (tier: PaidTier) => catalogue.filter((way) => way.tier === tier);
  const wayFor = (tier: PaidTier) =>
    sold(tier).find((way) => way.cadence === billing) ??
    sold(tier).find((way) => way.cadence === 'annual') ??
    sold(tier).find((way) => way.cadence === 'monthly') ??
    sold(tier)[0] ??
    null;
  const tiered = options.length > 1;
  const bothBillings =
    catalogue.some((way) => way.cadence === 'monthly') &&
    catalogue.some((way) => way.cadence === 'annual');
  // Three points, or two on a short phone, so the whole sheet fits without scrolling.
  const gains = choosing
    ? gainsOf(current, chosen, entitlement ?? limit, height < 720 ? 2 : 3)
    : [];

  const store = storeName(data?.store);
  const footnote = demo
    ? 'Sample prices · The store isn’t connected in this build'
    : unavailable
      ? 'Upgrades aren’t available yet.'
      : trial
        ? `No charge today · Cancel anytime in ${store}`
        : offer?.cadence === 'annual' && !switching
          ? `${offer.price} a year · Cancel anytime in ${store}`
          : offer?.cadence === 'lifetime'
            ? inStore
              ? `Paid once. Cancel your subscription in ${store} so it stops renewing.`
              : 'Paid once. Nothing to cancel.'
            : switching
              ? `${store} credits the time left on your plan.`
              : `Renews automatically · Cancel anytime in ${store}`;

  /*
   * The picture takes whatever height the sheet and the button leave, so the screen fits without
   * scrolling: both are measured, the picture is the rest (the sheet rises over its foot), between
   * a strip and a third of a tall phone. Too short a phone for even the strip scrolls the rest.
   */
  const [sheetHeight, setSheetHeight] = useState(0);
  const [footHeight, setFootHeight] = useState(0);
  const rest =
    sheetHeight && footHeight ? height - sheetHeight - footHeight + radius.xxxl : height * 0.3;
  const picture = Math.round(Math.min(300 + insets.top, Math.max(140 + insets.top / 2, rest)));

  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]}>
      <ScrollView
        bounces={false}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
      >
        <Art height={picture} breathe={phase === 'confirming'} />

        {/* The sheet, risen over the picture's foot. */}
        <View
          onLayout={(event) => setSheetHeight(Math.ceil(event.nativeEvent.layout.height))}
          style={[styles.sheet, { backgroundColor: theme.background }]}
        >
          <Rise style={styles.heading}>
            <View style={styles.titleRow}>
              <Text accessibilityRole="header" style={[styles.title, { color: theme.foreground }]}>
                {title}
              </Text>
              {trial ? (
                // A sticker: the picture's sun yellow, ink-edged, the same in either scheme.
                <View style={styles.flag}>
                  <Text style={styles.flagText}>{`${trial} free`.toUpperCase()}</Text>
                </View>
              ) : null}
            </View>
            {subtitle ? (
              <Text style={[styles.subtitle, { color: theme.mutedForeground }]}>{subtitle}</Text>
            ) : null}
          </Rise>

          {plan.isPending ? <ActivityIndicator color={theme.mutedForeground} /> : null}

          {gains.length > 0 ? (
            // Keyed by the plan, so switching plans deals its lines in again.
            <View key={chosen} style={styles.gains}>
              {gains.map((gain, index) => (
                <Rise key={gain.key} index={index + 2} style={styles.gain}>
                  <GainMark gain={gain} theme={theme} />
                  <View style={styles.gainWords}>
                    <Text style={[styles.gainTitle, { color: theme.foreground }]}>
                      {gain.title}
                    </Text>
                    <Text
                      numberOfLines={2}
                      style={[styles.gainLine, { color: theme.mutedForeground }]}
                    >
                      {gain.line}
                    </Text>
                  </View>
                </Rise>
              ))}
            </View>
          ) : null}

          {/* --- the ways to pay ---------------------------------------------------------- */}
          {choosing && !elsewhere ? (
            offersLoading ? (
              <View style={styles.plans}>
                <PlanCardGhost />
                <PlanCardGhost />
              </View>
            ) : tiered || ways.length === 0 ? (
              /*
               * The plans as radio cards — always, priced or not. A build or a store with nothing
               * to sell (no RevenueCat keys, Expo Go, an empty offering) still shows what each
               * plan is; the prices, the flags and the billing switch arrive with the store's offers.
               */
              <Rise index={5} style={styles.plans}>
                {bothBillings ? (
                  <View style={styles.billing}>
                    <TwoWay
                      left="Monthly"
                      right="Yearly"
                      on={billing === 'annual'}
                      onChange={(on) => setPickedCadence(on ? 'annual' : 'monthly')}
                      said="Pay yearly"
                    />
                  </View>
                ) : null}
                <View accessibilityRole="radiogroup" style={styles.plans}>
                  {options.map((tier, index) => {
                    const way = wayFor(tier);
                    const room = limitsFor(tier).vehicles;
                    const selected = tier === chosen;
                    // Yearly, against twelve months of monthly: the month it would have cost, struck.
                    const month = sold(tier).find((each) => each.cadence === 'monthly');
                    return (
                      <PlanCard
                        key={tier}
                        head={
                          <View style={styles.planHead}>
                            <PlanBadge tier={tier} size="md" />
                          </View>
                        }
                        sub={
                          <View style={styles.planSub}>
                            <Bays room={room} used={data?.usage.vehicles ?? 0} />
                          </View>
                        }
                        price={way ? priceOf(way) : null}
                        compare={way?.cadence === 'annual' && month ? month.price : null}
                        said={`${PLAN_NAMES[tier]}, room for ${room} vehicles${
                          way ? `, ${priceOf(way).figure} ${priceOf(way).unit}` : ''
                        }`}
                        selected={selected}
                        tab={index === 0 ? 'Recommended' : undefined}
                        onPress={() => {
                          if (tier === chosen) return;
                          setPicked(tier);
                        }}
                      />
                    );
                  })}
                </View>
              </Rise>
            ) : (
              <Rise index={5}>
                <View accessibilityRole="radiogroup" style={styles.plans}>
                  {ways.map((way) => (
                    <PlanCard
                      key={way.cadence}
                      head={
                        <Text style={[styles.planName, { color: theme.foreground }]}>
                          {CADENCE_NAME[way.cadence]}
                        </Text>
                      }
                      sub={
                        <Text
                          numberOfLines={1}
                          style={[styles.planLine, { color: theme.mutedForeground }]}
                        >
                          {billedOf(way)}
                        </Text>
                      }
                      price={priceOf(way)}
                      compare={null}
                      said={`${CADENCE_NAME[way.cadence]}, ${billedOf(way)}, ${priceOf(way).figure} ${
                        priceOf(way).unit
                      }`}
                      selected={way === offer}
                      onPress={() => {
                        if (way === offer) return;
                        setPickedCadence(way.cadence);
                      }}
                    />
                  ))}
                </View>
              </Rise>
            )
          ) : null}

          {/* --- the order, or what is yours now ------------------------------------------ */}
          {phase === 'done' && order ? (
            <View style={styles.gains} accessibilityLabel="Now included">
              {data ? (
                <Rise index={1}>
                  <PlanPass plan={data} price={null} />
                </Rise>
              ) : null}
              {gainsOf(order.from, order.to, null).map((gain, index) => (
                <Rise key={gain.key} index={index + 2} style={styles.gain}>
                  <GainMark gain={gain} theme={theme} />
                  <View style={styles.gainWords}>
                    <Text style={[styles.gainTitle, { color: theme.foreground }]}>
                      {gain.title}
                    </Text>
                    <Text style={[styles.gainLine, { color: theme.mutedForeground }]}>
                      {gain.line}
                    </Text>
                  </View>
                  <Ionicons name="checkmark-circle" size={20} color={theme.success} />
                </Rise>
              ))}
            </View>
          ) : waiting && chosen ? (
            <Rise index={1}>
              <Steps tier={chosen} store={store} slow={phase === 'slow'} seconds={seconds} />
            </Rise>
          ) : null}

          {elsewhere && phase === 'choose' ? (
            <Text style={[styles.subtitle, { color: theme.mutedForeground }]}>
              Your plan is billed through the Garajj website. Change it there, signed in to this
              account.
            </Text>
          ) : null}
        </View>
      </ScrollView>

      {/* --- the one action, pinned where the thumb is, the terms under it ---------------- */}
      <View
        onLayout={(event) => setFootHeight(Math.ceil(event.nativeEvent.layout.height))}
        style={[
          styles.footer,
          { paddingBottom: Math.max(insets.bottom, spacing.md), backgroundColor: theme.background },
        ]}
      >
        {failureText ? (
          <Text accessibilityRole="alert" style={[styles.fine, { color: theme.destructive }]}>
            {failureText}
          </Text>
        ) : notice ? (
          <Text
            accessibilityLiveRegion="polite"
            style={[styles.fine, { color: theme.mutedForeground }]}
          >
            {notice}
          </Text>
        ) : null}

        {elsewhere && phase === 'choose' ? null : phase === 'done' ? (
          <Cta label="Done" onPress={() => router.back()} />
        ) : phase === 'confirming' ? (
          <View
            style={[styles.status, { backgroundColor: theme.muted }]}
            accessibilityLiveRegion="polite"
          >
            <ActivityIndicator color={theme.foreground} />
            <Text style={[styles.statusText, { color: theme.foreground }]}>
              Confirming your purchase
            </Text>
          </View>
        ) : phase === 'slow' ? (
          <Cta label="Check again" busy={plan.isFetching} onPress={() => void refetch()} />
        ) : chosen ? (
          <Cta
            label={
              trial
                ? `Try ${trial} free`
                : `${switching ? 'Switch' : 'Upgrade'} to ${PLAN_NAMES[chosen]}`
            }
            busy={purchase.isPending}
            disabled={unavailable || !offer || !userId}
            onPress={() => {
              if (!offer) return;
              purchase.mutate(offer);
            }}
          />
        ) : null}

        {choosing && !elsewhere ? (
          <>
            <Text style={[styles.fine, { color: theme.mutedForeground }]}>{footnote}</Text>
            {/* Beside every purchase, as the stores ask (Apple 3.1.2). */}
            <LegalLinks pages={['terms', 'privacy']} />
          </>
        ) : null}
      </View>

      {/* Over the picture and staying there: the way out, and what the store already holds. */}
      <View pointerEvents="box-none" style={[styles.top, { top: insets.top + spacing.sm }]}>
        <OverKey icon="close" label="Close" onPress={() => router.back()} />
        {phase === 'done' || waiting || elsewhere ? null : inStore ? (
          <OverKey text="Manage" label="Manage" onPress={() => void openStoreManagement(data)} />
        ) : storeAvailable() && userId ? (
          // A new phone or a reinstall: what this store account already bought.
          <OverKey
            text={restoring.isPending ? 'Restoring…' : 'Restore'}
            label="Restore purchases"
            disabled={restoring.isPending}
            onPress={() => restoring.mutate()}
          />
        ) : null}
      </View>
    </View>
  );
}

/** The ink the picture's keys are drawn in: theirs is the picture's light, the same either way. */
const PICTURE_INK = '#1C1712';

/**
 * The paywall's picture, drawn: a warm evening over the hills, trees and two birds, and on the road a
 * chunky copper car with its lights on and speed behind it, coins in the air and sparks in the sky —
 * what Plus buys a garage, as a storybook frame. Authored on a 390×300 board and cut to fill from the bottom up, so
 * the road and the car always show and a tall screen gets more sky. One picture in both schemes, as
 * an illustration is. Shapes and gradients only: react-native-svg filters crash Android.
 */
function Art({ height, breathe }: { height: number; breathe: boolean }) {
  const { width } = useWindowDimensions();
  return (
    <View
      style={{ height, overflow: 'hidden' }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Breathe active={breathe}>
        <Svg
          width={width}
          height={height}
          viewBox="0 0 390 300"
          preserveAspectRatio="xMidYMax slice"
        >
          <Defs>
            <LinearGradient id="pw-sky" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#E7845A" />
              <Stop offset="0.55" stopColor="#F6BC8A" />
              <Stop offset="1" stopColor="#FCE3B8" />
            </LinearGradient>
            <RadialGradient id="pw-sun" cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor="#FFF3C9" stopOpacity={0.95} />
              <Stop offset="1" stopColor="#FFF3C9" stopOpacity={0} />
            </RadialGradient>
            <LinearGradient id="pw-body" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#F79A5B" />
              <Stop offset="1" stopColor="#C4531A" />
            </LinearGradient>
            <LinearGradient id="pw-road" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#4A3A33" />
              <Stop offset="1" stopColor="#2E2420" />
            </LinearGradient>
          </Defs>
          <Rect width="390" height="300" fill="url(#pw-sky)" />
          {/* The sun, low, and its glow. */}
          <Circle cx="292" cy="130" r="96" fill="url(#pw-sun)" />
          <Circle cx="292" cy="130" r="40" fill="#FFE9A8" />
          <Path
            d="M36 80 C36 68 52 62 62 68 C68 56 90 56 96 70 C108 68 116 76 112 86 L40 86 C34 86 32 82 36 80 Z"
            fill="#FFF6EC"
            opacity={0.85}
          />
          <Path
            d="M298 52 C300 44 312 42 318 47 C324 39 340 41 342 51 C350 51 354 58 349 62 L302 62 C296 62 294 56 298 52 Z"
            fill="#FFF6EC"
            opacity={0.7}
          />
          {/* Hills, far then near. */}
          <Path
            d="M0 194 C52 166 112 168 170 184 C228 200 292 164 390 178 L390 300 L0 300 Z"
            fill="#EAA172"
          />
          <Path
            d="M0 220 C70 200 140 208 204 216 C270 224 328 202 390 210 L390 300 L0 300 Z"
            fill="#D8854F"
          />
          {/* The road, its edge and its dashes. */}
          <Rect y="234" width="390" height="66" fill="url(#pw-road)" />
          <Rect y="234" width="390" height="3" fill="#6B544A" />
          {[16, 80, 144, 208, 272, 336].map((x) => (
            <Rect
              key={x}
              x={x}
              y="262"
              width="34"
              height="5"
              rx="2.5"
              fill="#F7CF6A"
              opacity={0.85}
            />
          ))}
          {/* Trees along the near hills, and two birds over them. */}
          {[
            [26, 207, 1],
            [48, 203, 0.8],
            [344, 203, 0.85],
            [368, 207, 1],
          ].map(([x, y, k]) => (
            <G key={x} transform={`translate(${x} ${y}) scale(${k})`}>
              <Rect x="-1.5" y="0" width="3" height="10" rx="1.5" fill="#8A4A2A" />
              <Circle cx="0" cy="-3" r="9" fill="#B4683A" />
              <Circle cx="-3" cy="-6" r="4" fill="#C97B49" />
            </G>
          ))}
          <Path
            d="M150 48 q5 -5 10 0 q5 -5 10 0 M176 38 q4 -4 8 0 q4 -4 8 0"
            stroke="#8A4A2A"
            strokeWidth={1.6}
            strokeLinecap="round"
            fill="none"
          />
          {/* The car's headlight on the road ahead, its speed behind it, and its shadow. */}
          <Path
            d="M278 198 Q312 190 336 192 Q340 202 336 212 Q312 212 278 205 Z"
            fill="#FFF3B0"
            opacity={0.3}
          />
          {[
            [56, 180, 100],
            [38, 194, 96],
            [62, 208, 102],
          ].map(([x0, y, x1]) => (
            <Path
              key={y}
              d={`M${x0} ${y} L${x1} ${y}`}
              stroke="#FFFFFF"
              strokeOpacity={0.75}
              strokeWidth={4}
              strokeLinecap="round"
            />
          ))}
          <Ellipse cx="199" cy="250" rx="94" ry="7" fill="#000000" opacity={0.28} />
          <G transform="translate(102 146) scale(0.92)">
            <Car />
          </G>
          {/* Coins and sparks in the air. */}
          <Coin x={60} y={150} r={13} />
          <Coin x={334} y={186} r={11} />
          <Coin x={98} y={106} r={9} tilt />
          <Spark x={34} y={118} s={7} fill="#FFFFFF" />
          <Spark x={238} y={86} s={6} fill="#FFFFFF" />
          <Spark x={368} y={156} s={5} fill="#FFE07A" />
          <Spark x={146} y={78} s={4.5} fill="#FFFFFF" />
        </Svg>
      </Breathe>
    </View>
  );
}

/**
 * The picture's car, side on: a glossy copper body and cabin, dark glass, a mirror, big round
 * wheels in their arches.
 */
function Car() {
  return (
    <>
      <Path
        d="M14 64 C14 52 24 46 38 45 L160 42 C178 41 194 50 196 64 L196 82 C196 88 192 92 186 92 L22 92 C17 92 14 88 14 82 Z"
        fill="url(#pw-body)"
      />
      <Path d="M54 46 C62 24 76 16 98 16 L126 16 C144 16 156 26 166 44 Z" fill="url(#pw-body)" />
      <Path d="M68 44 C74 29 84 23 98 23 L106 23 L106 44 Z" fill="#2E2A3A" />
      <Path d="M112 23 L126 23 C139 23 148 31 155 44 L112 44 Z" fill="#2E2A3A" />
      <Path d="M80 42 L92 25 L98 25 L86 42 Z" fill="#FFFFFF" opacity={0.3} />
      <Path d="M122 42 L134 25 L139 26 L128 42 Z" fill="#FFFFFF" opacity={0.3} />
      <Path
        d="M30 54 C70 49 130 48 180 50"
        stroke="#FFFFFF"
        strokeOpacity={0.5}
        strokeWidth={3}
        strokeLinecap="round"
        fill="none"
      />
      <Path d="M108 47 L108 84" stroke="#A8481A" strokeOpacity={0.55} strokeWidth={1.6} />
      <Rect x="118" y="56" width="13" height="3.5" rx="1.75" fill="#A8481A" />
      <Path d="M150 45 L158 40 L163 43 L157 48 Z" fill="#C4531A" />
      <Ellipse cx="190" cy="60" rx="5" ry="4" fill="#FFF3B0" />
      <Rect x="13" y="56" width="6" height="9" rx="2" fill="#E2453C" />
      <Rect x="12" y="80" width="186" height="7" rx="3.5" fill="#3B2E2A" opacity={0.35} />
      {[54, 154].map((cx) => (
        <G key={cx}>
          {/* The arch the wheel sits in, darker than the body round it. */}
          <Path d={`M${cx - 24} 90 A24 24 0 0 1 ${cx + 24} 90 Z`} fill="#8E3A12" />
          <Circle cx={cx} cy="92" r="20" fill="#2B2238" />
          <Circle cx={cx} cy="92" r="10.5" fill="#E4DED8" />
          <Circle cx={cx} cy="92" r="7" fill="none" stroke="#BFB6AE" strokeWidth={1.5} />
          <Circle cx={cx} cy="92" r="3.5" fill="#8C837D" />
        </G>
      ))}
    </>
  );
}

/** A gold coin in the air, face on or turned away. */
function Coin({ x, y, r, tilt = false }: { x: number; y: number; r: number; tilt?: boolean }) {
  const rx = tilt ? r * 0.55 : r;
  return (
    <G transform={`translate(${x} ${y})${tilt ? ' rotate(-25)' : ''}`}>
      <Ellipse rx={rx} ry={r} fill="#FFC83D" stroke="#E39A12" strokeWidth={2} />
      <Ellipse rx={rx * 0.6} ry={r * 0.6} fill="none" stroke="#E39A12" strokeWidth={1.4} />
      <Path
        d={`M ${-rx * 0.35} ${-r * 0.55} Q ${-rx * 0.1} ${-r * 0.75} ${rx * 0.2} ${-r * 0.6}`}
        stroke="#FFF6D6"
        strokeWidth={1.6}
        strokeLinecap="round"
        fill="none"
      />
    </G>
  );
}

/** A four-pointed spark. */
function Spark({ x, y, s, fill }: { x: number; y: number; s: number; fill: string }) {
  const k = s * 0.18;
  return (
    <Path
      d={`M${x} ${y - s} Q${x + k} ${y - k} ${x + s} ${y} Q${x + k} ${y + k} ${x} ${y + s} Q${x - k} ${y + k} ${x - s} ${y} Q${x - k} ${y - k} ${x} ${y - s} Z`}
      fill={fill}
    />
  );
}

/** A key over the picture: white with ink, as the picture is the same in either scheme. */
function OverKey({
  label,
  icon,
  text,
  disabled = false,
  onPress,
}: {
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  text?: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <PressableScale
      onPress={() => {
        onPress();
      }}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      scaleTo={0.92}
      style={[styles.overKey, text ? styles.overPill : styles.overRound]}
    >
      {icon ? (
        <Ionicons name={icon} size={20} color={PICTURE_INK} />
      ) : (
        <Text style={styles.overText}>{text}</Text>
      )}
    </PressableScale>
  );
}

/** A gain's icon on a tile of its own hue. */
function GainMark({ gain, theme }: { gain: Gain; theme: Theme }) {
  const color = theme[gain.hue];
  return (
    <View style={styles.gainArt}>
      <Ionicons name={gain.icon} size={22} color={color} />
    </View>
  );
}

/**
 * What has happened so far, as the web's confirmation draws it: paid, confirming (with how long
 * it has been), unlocked. Real states only — the first is true because the store said yes.
 */
function Steps({
  tier,
  store,
  slow,
  seconds,
}: {
  tier: PaidTier;
  store: string;
  slow: boolean;
  seconds: number;
}) {
  const theme = useTheme();
  const rows: {
    state: 'done' | 'active' | 'waiting' | 'pending';
    label: string;
    aside?: string;
  }[] = [
    { state: 'done', label: `Paid in ${store}` },
    {
      state: slow ? 'waiting' : 'active',
      label: slow ? 'Still confirming' : 'Confirming your purchase',
      aside: clock(seconds),
    },
    { state: 'pending', label: `${PLAN_NAMES[tier]} unlocked` },
  ];
  return (
    <View style={{ gap: 4 }} accessibilityLabel="Payment progress">
      {rows.map((row) => (
        <View
          key={row.state}
          style={[
            styles.step,
            (row.state === 'active' || row.state === 'waiting') && { backgroundColor: theme.muted },
          ]}
        >
          <View style={styles.stepGlyph}>
            {row.state === 'done' ? (
              <View style={[styles.stepDot, { backgroundColor: theme.successSoft }]}>
                <Ionicons name="checkmark" size={13} color={theme.success} />
              </View>
            ) : row.state === 'active' ? (
              <ActivityIndicator size="small" color={theme.foreground} />
            ) : row.state === 'waiting' ? (
              <View style={[styles.stepDot, { backgroundColor: theme.warningSoft }]}>
                <Ionicons name="time-outline" size={13} color={theme.warning} />
              </View>
            ) : (
              <View style={[styles.stepRing, { borderColor: theme.borderStrong }]} />
            )}
          </View>
          <Text
            style={[
              styles.stepText,
              {
                color: row.state === 'pending' ? theme.mutedForeground : theme.foreground,
                fontWeight: row.state === 'pending' ? '400' : '600',
              },
            ]}
          >
            {row.label}
          </Text>
          {row.aside ? (
            <Text style={[figure, styles.stepAside, { color: theme.mutedForeground }]}>
              {row.aside}
            </Text>
          ) : null}
        </View>
      ))}
    </View>
  );
}

/** Fades a child in and out while `active` — the mark, while a payment is still confirming. */
function Breathe({ active, children }: { active: boolean; children: ReactNode }) {
  const reduce = useReduceMotion();
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!active || reduce) {
      opacity.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.35, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [active, reduce, opacity]);
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity }]}>
      {children}
    </Animated.View>
  );
}

/** The one button: an ink pill, full width, a spinner in place of the label while it works. */
function Cta({
  label,
  busy = false,
  disabled = false,
  onPress,
}: {
  label: string;
  busy?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <PressableScale
      onPress={onPress}
      disabled={busy || disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ busy, disabled }}
      scaleTo={0.98}
      style={[styles.cta, { backgroundColor: theme.foreground, opacity: disabled ? 0.45 : 1 }]}
    >
      {busy ? (
        <ActivityIndicator color={theme.background} />
      ) : (
        <Text style={[styles.ctaText, { color: theme.background }]}>{label}</Text>
      )}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  scroll: { flexGrow: 1 },
  sheet: {
    marginTop: -radius.xxxl,
    borderTopLeftRadius: radius.xxxl + 4,
    borderTopRightRadius: radius.xxxl + 4,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg + 2,
    paddingBottom: spacing.md,
    gap: spacing.md + 2,
  },
  heading: { gap: 6 },
  titleRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10 },
  title: { fontSize: 24, lineHeight: 29, fontWeight: '800', letterSpacing: -0.7 },
  subtitle: { fontSize: 14, lineHeight: 20 },
  flag: {
    height: 24,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: PICTURE_INK,
    backgroundColor: '#FFE9A8',
    paddingHorizontal: 9,
    justifyContent: 'center',
  },
  flagText: {
    fontSize: 10.5,
    lineHeight: 13,
    fontWeight: '800',
    letterSpacing: 0.6,
    color: PICTURE_INK,
  },
  billing: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  gains: { gap: 12 },
  gain: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  gainArt: { width: 26, alignItems: 'center', justifyContent: 'center' },
  gainWords: { flex: 1, minWidth: 0, gap: 1 },
  gainTitle: { fontSize: 15, lineHeight: 19, fontWeight: '700', letterSpacing: -0.2 },
  gainLine: { fontSize: 12.5, lineHeight: 17 },
  plans: { gap: 10 },
  planHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  planSub: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  planName: { fontSize: 16, lineHeight: 20, fontWeight: '700', letterSpacing: -0.3 },
  planLine: { fontSize: 12, lineHeight: 16 },
  step: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: radius.lg,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  stepGlyph: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  stepDot: {
    width: 24,
    height: 24,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepRing: { width: 12, height: 12, borderRadius: 999, borderWidth: 2 },
  stepText: { flex: 1, fontSize: 14, lineHeight: 19 },
  stepAside: { fontSize: 12, lineHeight: 16 },
  footer: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, gap: spacing.sm },
  fine: { fontSize: 12, lineHeight: 16, textAlign: 'center' },
  status: {
    height: 52,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  statusText: { fontSize: 15, lineHeight: 20, fontWeight: '600' },
  cta: {
    height: 54,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  ctaText: { fontSize: 16, lineHeight: 21, fontWeight: '700', letterSpacing: -0.2 },
  top: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  overKey: {
    backgroundColor: 'rgba(255,255,255,0.94)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  overRound: { width: 40, height: 40, borderRadius: 20 },
  overPill: { height: 38, borderRadius: 19, paddingHorizontal: 16 },
  overText: { fontSize: 14, lineHeight: 18, fontWeight: '600', color: PICTURE_INK },
});
