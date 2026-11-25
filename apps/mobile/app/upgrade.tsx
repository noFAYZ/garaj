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
import { vehiclesQuery } from '@vehicle-os/api-client/react';
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
import { BrandLogo } from '@/components/brand-logo';
import { api } from '@/lib/api';
import { haptic, PressableScale, Rise, useReduceMotion } from '@/lib/motion';
import { PlanBadge, PlanPass, PlanTag } from '@/lib/plan-kit';
import {
  buy,
  CADENCE_LABEL,
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
import { FEATURE_ICON, usePlan } from '@/lib/upgrade';
import { useProfile } from '@/lib/vehicle-units';
import { figure, leaf, lift, radius, spacing, typeScale, useTheme } from '@/lib/theme';
import { RoundKey } from '@/components/onboarding-kit';
import { pad } from '@/lib/format';

type Limit = keyof PlanLimits;
/** Choosing; bought and waiting for the server to see it; waited too long; upgraded. */
type Phase = 'choose' | 'confirming' | 'slow' | 'done';

const LIMIT_TITLE: Record<Limit, string> = {
  vehicles: 'Your garage is full',
  garages: 'No room for another garage',
  members: 'No room for another person',
};

const LIMIT_NOUN: Record<Limit, [string, string]> = {
  vehicles: ['vehicle', 'vehicles'],
  garages: ['garage', 'garages'],
  members: ['person', 'people'],
};

const LIMIT_ICON: Record<Limit, keyof typeof Ionicons.glyphMap> = {
  vehicles: 'car-sport',
  garages: 'home',
  members: 'people',
};

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

/**
 * The upgrade (GAPS §10, §17): one screen that decides, instead of a pointer to settings.
 *
 * A picture of the reason, a headline, a choice of plan, what it adds, and one button that says
 * what happens next — compact enough to fit a small phone without scrolling. The picture is the
 * person's garage: their vehicles in the bays, and the dashed bays the next plan adds. The colour
 * is ink, because the logo is the only colour this product has.
 *
 * Opened from anywhere a plan refuses something — a full garage, a paid feature, the queue
 * replaying an offline write — with the reason in its params, so it leads with what was hit.
 * Opened from settings with no reason, it leads with room.
 *
 * It never decides a plan changed. The purchase happens in the phone's store (`lib/store`), the
 * server reads it from RevenueCat, and this screen waits for the plan in plain sight — the new bays
 * breathe until the plan is real, then settle. A plan paid for on the web is not sold or managed
 * here: the store's rules keep the app to its own billing, so it only says where that plan lives.
 */
export default function UpgradeScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const params = useLocalSearchParams<{
    reason?: string;
    limit?: string;
    entitlement?: string;
    plan?: string;
  }>();

  const { data, plan } = usePlan();
  const { refetch } = plan;
  const vehicles = useQuery(vehiclesQuery(api));
  const userId = useProfile().data?.id;
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
  // The ways the chosen tier is sold, and the one picked — monthly unless another was chosen.
  const ways = (offers.data ?? []).filter((offer) => offer.tier === chosen);
  const offer =
    ways.find((way) => way.cadence === pickedCadence) ??
    ways.find((way) => way.cadence === 'monthly') ??
    ways[0] ??
    null;
  const offersLoading = offers.isPending && offers.fetchStatus !== 'idle';
  // Nothing to sell in this build, or the store has no price for it: say so now, not on the press.
  const unavailable =
    !storeAvailable() || Boolean(chosen && (offers.isError || (offers.isSuccess && !offer)));
  /** The cheapest way to pay for a tier, for its row in the choice. */
  const fromPrice = (tier: PaidTier) => (offers.data ?? []).find((way) => way.tier === tier);

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
      haptic.success();
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

  const marks: ReactNode[] = (vehicles.data?.data ?? []).map((vehicle) => (
    <BrandLogo key={vehicle.id} make={vehicle.make} size={26} />
  ));
  // A generic open from settings leads with room for vehicles — the ceiling people meet first.
  const heroLimit: Limit | null = entitlement ? null : (limit ?? 'vehicles');
  const used = heroLimit
    ? heroLimit === 'members'
      ? limitsFor(current).members
      : (data?.usage[heroLimit] ?? 0)
    : 0;
  const room = heroLimit && chosen ? Math.max(0, limitsFor(chosen)[heroLimit] - used) : 0;
  const featuresGained = chosen ? gainedFeatures(current, chosen) : [];

  /*
   * One row of bays, always: the taken ones and the ones the plan adds, side by side, is the
   * whole picture — wrapped onto two lines it stops reading as a garage. So the bay shrinks to
   * fit the screen rather than the row breaking, down to a size a logo is still legible at.
   */
  const takenShown = Math.min(used, 5);
  const freshShown = Math.min(room, 3);
  const bayCount = Math.max(1, takenShown + freshShown);
  const bayGap = 8;
  const heroInner = width - spacing.md * 2 - spacing.md * 2;
  const bay = Math.max(
    34,
    Math.min(38, Math.floor((heroInner - bayGap * (bayCount - 1)) / bayCount)),
  );
  const baySize = { width: bay, height: bay, borderRadius: Math.round(bay * 0.3) };

  const allowed = limit ? limitsFor(current)[limit] : 0;
  const waiting = phase === 'confirming' || phase === 'slow';
  const [title, subtitle] =
    phase === 'done' && order
      ? [`You’re on ${PLAN_NAMES[order.to]}`, `${PLAN_NAMES[order.to]} is active on your account.`]
      : phase === 'confirming'
        ? ['Confirming your payment', 'Usually a few seconds.']
        : phase === 'slow'
          ? ['Payment received', 'Your plan hasn’t updated yet. It can take a minute.']
          : !chosen
            ? ['You’re on the largest plan', 'Everything Garaj does is already yours.']
            : entitlement
              ? [
                  `${ENTITLEMENT_COPY[entitlement].name} needs ${PLAN_NAMES[options[0] ?? chosen]}`,
                  ENTITLEMENT_COPY[entitlement].does,
                ]
              : limit === 'members'
                ? [LIMIT_TITLE.members, `${PLAN_NAMES[current]} garages hold ${allowed} people.`]
                : limit
                  ? [
                      LIMIT_TITLE[limit],
                      `${PLAN_NAMES[current]} holds ${allowed} ${noun(limit, allowed)}.`,
                    ]
                  : [
                      `Room for ${room} more ${noun('vehicles', room)}`,
                      `You’re on ${PLAN_NAMES[current]}.`,
                    ];

  const store = storeName(data?.store);
  const footnote = unavailable
    ? 'Upgrades aren’t available yet.'
    : offer?.cadence === 'lifetime'
      ? inStore
        ? `Paid once. Cancel your current subscription in ${store} so it stops renewing.`
        : 'Paid once. No renewals, nothing to cancel.'
      : switching
        ? `${store} credits the time left on your current plan.`
        : `Renews automatically, billed by ${store}. Cancel anytime in ${store}.`;

  // The stamp: the one number the upgrade is about, or a tick once it is yours.
  const stamp = chosen ? (
    <View
      style={[styles.badge, { backgroundColor: theme.background, borderColor: theme.primary }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {phase === 'done' ? (
        <Ionicons name="checkmark" size={30} color={theme.foreground} />
      ) : (
        <>
          <Text style={[figure, styles.badgeFigure, { color: theme.foreground }]}>
            +{heroLimit ? room : featuresGained.length}
          </Text>
          <Text style={[typeScale.caption, { color: theme.mutedForeground }]}>
            {heroLimit ? 'more' : featuresGained.length === 1 ? 'feature' : 'features'}
          </Text>
        </>
      )}
    </View>
  ) : null;

  return (
    <View style={[styles.screen, { backgroundColor: 'transparent' }]}>
      <ScrollView
        contentContainerStyle={[styles.page, { paddingTop: insets.top + spacing.sm }]}
        showsVerticalScrollIndicator={false}
      >
        <RoundKey icon="close" label="Close" onPress={() => router.back()} />

        {/*
         * --- the picture: what was hit, and what the plan adds — while it is being bought, and
         * once it is yours. While choosing, the stamp alone stands by the headline.
         */}
        {phase === 'choose' ? null : (
          <Rise style={[styles.hero, { backgroundColor: theme.card }]}>
            {heroLimit ? (
              <View
                style={styles.bays}
                accessible
                accessibilityRole="image"
                accessibilityLabel={
                  chosen
                    ? `${used} ${noun(heroLimit, used)} now; ${PLAN_NAMES[chosen]} has room for ${room} more`
                    : `${used} ${noun(heroLimit, used)}`
                }
              >
                {Array.from({ length: takenShown }, (_, index) => (
                  <View
                    key={`taken-${index}`}
                    style={[styles.bay, baySize, { backgroundColor: theme.muted }]}
                  >
                    {heroLimit === 'vehicles' && marks[index] ? (
                      marks[index]
                    ) : (
                      <Ionicons name={LIMIT_ICON[heroLimit]} size={20} color={theme.foreground} />
                    )}
                  </View>
                ))}
                {Array.from({ length: freshShown }, (_, index) => (
                  <Rise key={`fresh-${chosen}-${index}`} index={index + 2} distance={8}>
                    <Breathe active={phase === 'confirming'}>
                      {/* Dashed while bought-not-built; a solid outline once the plan is real. */}
                      <View
                        style={[
                          styles.bay,
                          baySize,
                          phase === 'done' ? styles.built : styles.fresh,
                          { borderColor: theme.borderStrong },
                        ]}
                      />
                    </Breathe>
                  </Rise>
                ))}
              </View>
            ) : entitlement ? (
              <View style={[styles.featureTile, { backgroundColor: theme.muted }]}>
                <Ionicons
                  name={`${FEATURE_ICON[entitlement]}-outline`}
                  size={44}
                  color={theme.foreground}
                />
                <View
                  style={[styles.lock, { backgroundColor: theme.primary, borderColor: theme.card }]}
                >
                  <Ionicons
                    name={phase === 'done' ? 'lock-open' : 'lock-closed'}
                    size={14}
                    color={theme.primaryForeground}
                  />
                </View>
              </View>
            ) : null}

            {stamp}
          </Rise>
        )}

        <Rise index={1} style={styles.titleRow}>
          <View style={{ flex: 1, minWidth: 0, gap: 6 }}>
            <Text accessibilityRole="header" style={[styles.title, { color: theme.foreground }]}>
              {title}
            </Text>
            <Text style={[styles.subtitle, { color: theme.mutedForeground }]}>{subtitle}</Text>
          </View>
          {phase === 'choose' ? stamp : null}
        </Rise>

        {plan.isPending ? (
          <ActivityIndicator color={theme.mutedForeground} style={{ marginTop: spacing.lg }} />
        ) : null}

        {/* --- the choice: only when there is one ------------------------------------------ */}
        {phase === 'choose' && options.length > 1 ? (
          <Rise index={2} style={{ gap: spacing.sm }}>
            <View accessibilityRole="radiogroup" style={{ gap: spacing.sm }}>
              {options.map((tier, index) => {
                const selected = tier === chosen;
                const tierPrice = fromPrice(tier);
                const limits = limitsFor(tier);
                return (
                  <PressableScale
                    key={tier}
                    onPress={() => {
                      if (selected) return;
                      haptic.selection();
                      setPicked(tier);
                    }}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                    accessibilityLabel={`${PLAN_NAMES[tier]}${tierPrice ? `, from ${tierPrice.price} ${CADENCE_LABEL[tierPrice.cadence].short}` : ''}`}
                    scaleTo={0.98}
                    style={[
                      styles.tier,
                      { backgroundColor: selected ? theme.primarySoft : theme.cardRaised },
                    ]}
                  >
                    <View
                      style={[
                        styles.radio,
                        { backgroundColor: selected ? theme.primary : theme.muted },
                      ]}
                    >
                      {selected ? (
                        <Ionicons name="checkmark" size={14} color={theme.primaryForeground} />
                      ) : null}
                    </View>
                    <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                      {/* The plan as Settings shows it: its own badge, and the tag the first wears. */}
                      <View style={styles.optionName}>
                        <PlanBadge tier={tier} />
                        {index === 0 ? (
                          <PlanTag
                            label="Recommended"
                            fill={theme.primarySoft}
                            ink={theme.primary}
                          />
                        ) : null}
                      </View>
                      <Text
                        numberOfLines={1}
                        style={[typeScale.caption, figure, { color: theme.mutedForeground }]}
                      >
                        {pad(limits.vehicles)} vehicles · {pad(limits.garages)} garages
                      </Text>
                    </View>
                    {offersLoading ? (
                      <ActivityIndicator size="small" color={theme.mutedForeground} />
                    ) : tierPrice ? (
                      <Text style={[typeScale.label, figure, { color: theme.foreground }]}>
                        {tierPrice.price} {CADENCE_LABEL[tierPrice.cadence].short}
                      </Text>
                    ) : null}
                  </PressableScale>
                );
              })}
            </View>
          </Rise>
        ) : null}

        {phase === 'choose' && !elsewhere && ways.length > 1 ? (
          <Rise index={2}>
            <View accessibilityRole="radiogroup" style={styles.cadences}>
              {ways.map((way) => {
                const selected = way === offer;
                return (
                  <PressableScale
                    key={way.cadence}
                    onPress={() => {
                      if (selected) return;
                      haptic.selection();
                      setPickedCadence(way.cadence);
                    }}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                    accessibilityLabel={`${CADENCE_LABEL[way.cadence].long}, ${way.price}`}
                    scaleTo={0.97}
                    style={[
                      styles.cadence,
                      { backgroundColor: selected ? theme.primarySoft : theme.cardRaised },
                    ]}
                  >
                    <Text style={[typeScale.caption, { color: theme.mutedForeground }]}>
                      {CADENCE_LABEL[way.cadence].long}
                    </Text>
                    <Text style={[typeScale.label, figure, { color: theme.foreground }]}>
                      {way.price}
                    </Text>
                  </PressableScale>
                );
              })}
            </View>
          </Rise>
        ) : null}

        {/* --- the order, or what is yours now --------------------------------------------- */}
        {phase === 'done' && order ? (
          <View style={{ gap: spacing.sm }} accessibilityLabel="Now included">
            {data ? (
              <Rise index={2}>
                <PlanPass plan={data} price={null} />
              </Rise>
            ) : null}
            {gainedFeatures(order.from, order.to).map((gain, index) => (
              <Rise
                key={gain}
                index={index + 3}
                style={[styles.included, { backgroundColor: theme.card }]}
              >
                <View style={[styles.includedIcon, { backgroundColor: theme.muted }]}>
                  <Ionicons
                    name={`${FEATURE_ICON[gain]}-outline`}
                    size={18}
                    color={theme.foreground}
                  />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[typeScale.label, { color: theme.foreground }]}>
                    {ENTITLEMENT_COPY[gain].name}
                  </Text>
                  <Text style={[typeScale.caption, { color: theme.mutedForeground }]}>
                    {ENTITLEMENT_COPY[gain].does}
                  </Text>
                </View>
              </Rise>
            ))}
          </View>
        ) : waiting && chosen ? (
          <Rise index={2}>
            <Steps tier={chosen} store={store} slow={phase === 'slow'} seconds={seconds} />
          </Rise>
        ) : chosen ? (
          // Keyed by the plan, so switching plans deals its tiles in again.
          <Perks key={chosen} from={current} to={chosen} />
        ) : null}
      </ScrollView>

      {/* --- the one action, pinned where the thumb is ------------------------------------ */}
      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
        {failureText ? (
          <Text
            accessibilityRole="alert"
            style={[typeScale.caption, { color: theme.destructive, textAlign: 'center' }]}
          >
            {failureText}
          </Text>
        ) : notice ? (
          <Text
            accessibilityLiveRegion="polite"
            style={[typeScale.caption, { color: theme.mutedForeground, textAlign: 'center' }]}
          >
            {notice}
          </Text>
        ) : null}

        {elsewhere && phase === 'choose' ? (
          <Text style={[typeScale.body, { color: theme.mutedForeground, textAlign: 'center' }]}>
            Your plan is billed through the Garaj website. Change it there, signed in to this
            account.
          </Text>
        ) : phase === 'done' ? (
          <Cta label="Done" onPress={() => router.back()} />
        ) : phase === 'confirming' ? (
          <View
            style={[styles.status, { backgroundColor: theme.card }]}
            accessibilityLiveRegion="polite"
          >
            <ActivityIndicator color={theme.foreground} />
            <Text style={[typeScale.label, { color: theme.foreground }]}>
              Confirming your purchase
            </Text>
          </View>
        ) : phase === 'slow' ? (
          <Cta label="Check again" busy={plan.isFetching} onPress={() => void refetch()} />
        ) : chosen ? (
          <Cta
            label={`${switching ? 'Switch' : 'Upgrade'} to ${PLAN_NAMES[chosen]}`}
            icon="arrow-forward"
            busy={purchase.isPending}
            disabled={unavailable || !offer || !userId}
            onPress={() => {
              if (!offer) return;
              haptic.selection();
              purchase.mutate(offer);
            }}
          />
        ) : null}

        {phase === 'choose' && chosen && !elsewhere ? (
          <Text style={[typeScale.caption, { color: theme.mutedForeground, textAlign: 'center' }]}>
            {footnote}
          </Text>
        ) : null}

        {phase !== 'done' ? (
          <View style={styles.links}>
            {waiting || elsewhere ? null : inStore ? (
              <PressableScale
                onPress={() => void openStoreManagement(data)}
                accessibilityRole="button"
                hitSlop={8}
              >
                <Text style={[typeScale.caption, { color: theme.mutedForeground }]}>
                  Manage in {store}
                </Text>
              </PressableScale>
            ) : storeAvailable() && userId ? (
              // A new phone or a reinstall: what this store account already bought.
              <PressableScale
                onPress={() => restoring.mutate()}
                disabled={restoring.isPending}
                accessibilityRole="button"
                hitSlop={8}
              >
                <Text style={[typeScale.caption, { color: theme.mutedForeground }]}>
                  {restoring.isPending ? 'Restoring…' : 'Restore purchases'}
                </Text>
              </PressableScale>
            ) : null}
          </View>
        ) : null}
      </View>
    </View>
  );
}

/**
 * What the plan adds, as tiles dealt in one after another: each limit it raises as a big copper
 * figure — "+3 more vehicles" — then each feature it unlocks, its icon beside its name and marked
 * new. Two columns.
 */
function Perks({ from, to }: { from: PlanTier; to: PaidTier }) {
  const theme = useTheme();
  const before = limitsFor(from);
  const after = limitsFor(to);
  const perks = [
    ...(['vehicles', 'garages', 'members'] as const)
      .filter((limit) => after[limit] > before[limit])
      .map((limit) => ({
        key: limit,
        icon: LIMIT_ICON[limit],
        figure: `+${after[limit] - before[limit]}`,
        label: `${noun(limit, after[limit] - before[limit])}${limit === 'members' ? ' per garage' : ''}`,
      })),
    ...gainedFeatures(from, to).map((gain) => ({
      key: gain,
      icon: `${FEATURE_ICON[gain]}-outline` as keyof typeof Ionicons.glyphMap,
      figure: null,
      label: ENTITLEMENT_COPY[gain].name,
    })),
  ];
  if (perks.length === 0) return null;
  return (
    <View style={{ gap: 6 }}>
      <Text style={[figure, styles.perksTitle, { color: theme.primary }]}>
        {PLAN_NAMES[to].toUpperCase()} ADDS
      </Text>
      <View
        accessible
        style={styles.perks}
        accessibilityLabel={`${PLAN_NAMES[to]} adds ${perks
          .map((perk) => (perk.figure ? `${perk.figure} ${perk.label}` : perk.label))
          .join(', ')}`}
      >
        {perks.map((perk, index) => (
          <Rise key={perk.key} index={index + 3} distance={10} style={styles.perkCell}>
            <View style={[styles.perk, { backgroundColor: theme.cardRaised }, lift(theme, 'low')]}>
              <View style={[styles.perkIcon, { backgroundColor: theme.primarySoft }]}>
                <Ionicons name={perk.icon} size={14} color={theme.primary} />
              </View>
              <View style={styles.perkWords}>
                {perk.figure ? (
                  <Text style={[figure, styles.perkFigure, { color: theme.foreground }]}>
                    {perk.figure}
                  </Text>
                ) : (
                  <Text style={[styles.perkNew, { color: theme.primary }]}>NEW</Text>
                )}
                <Text
                  numberOfLines={perk.figure ? 1 : 2}
                  style={[
                    perk.figure ? styles.perkLabel : styles.perkName,
                    { color: perk.figure ? theme.mutedForeground : theme.foreground },
                  ]}
                >
                  {perk.label}
                </Text>
              </View>
            </View>
          </Rise>
        ))}
      </View>
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
            (row.state === 'active' || row.state === 'waiting') && { backgroundColor: theme.card },
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
              typeScale.label,
              {
                flex: 1,
                color: row.state === 'pending' ? theme.mutedForeground : theme.foreground,
                fontWeight: row.state === 'pending' ? '400' : '600',
              },
            ]}
          >
            {row.label}
          </Text>
          {row.aside ? (
            <Text style={[typeScale.caption, figure, { color: theme.mutedForeground }]}>
              {row.aside}
            </Text>
          ) : null}
        </View>
      ))}
    </View>
  );
}

/** Fades a child in and out while `active` — the bays a payment is still confirming. */
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
  return <Animated.View style={{ opacity }}>{children}</Animated.View>;
}

/** The one button: ink, full width, a spinner in place of the label while it works. */
function Cta({
  label,
  icon,
  busy = false,
  disabled = false,
  onPress,
}: {
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
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
      style={[
        styles.cta,
        {
          backgroundColor: theme.primary,
          borderTopColor: theme.primarySheen,
          borderBottomColor: theme.primaryEdge,
          opacity: disabled ? 0.45 : 1,
        },
      ]}
    >
      {busy ? (
        <ActivityIndicator color={theme.primaryForeground} />
      ) : (
        <>
          <Text style={[typeScale.headline, { color: theme.primaryForeground }]}>{label}</Text>
          {icon ? <Ionicons name={icon} size={18} color={theme.primaryForeground} /> : null}
        </>
      )}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  page: { paddingHorizontal: spacing.md, paddingBottom: spacing.md, gap: 10 },
  title: { fontSize: 22, lineHeight: 27, fontWeight: '700', letterSpacing: -0.6 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  subtitle: { fontSize: 14, lineHeight: 20, fontWeight: '400' },
  // The bays and the stamp side by side, the stamp on the hero's own edge rather than over it.
  hero: {
    ...leaf('lg'),
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
  },
  bays: { flexDirection: 'row', justifyContent: 'center', gap: 8 },
  bay: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  fresh: { borderWidth: 1.5, borderStyle: 'dashed' },
  built: { borderWidth: 1.5 },
  featureTile: {
    width: 64,
    height: 64,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lock: {
    position: 'absolute',
    right: -8,
    bottom: -8,
    width: 32,
    height: 32,
    borderRadius: 999,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    width: 50,
    height: 50,
    borderRadius: 999,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ rotate: '-8deg' }],
  },
  badgeFigure: { fontSize: 15, lineHeight: 18, fontWeight: '700' },
  tier: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    ...leaf('md'),
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
  },
  cadences: { flexDirection: 'row', gap: spacing.sm },
  cadence: {
    flex: 1,
    gap: 2,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    ...leaf('sm'),
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionName: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  perksTitle: { fontSize: 10.5, lineHeight: 13, fontWeight: '600', letterSpacing: 1.4 },
  perks: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 8 },
  perkCell: { width: '48.5%' },
  perk: {
    ...leaf('sm'),
    flexGrow: 1,
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  perkWords: { flex: 1, minWidth: 0 },
  perkIcon: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  perkNew: { fontSize: 9, lineHeight: 12, fontWeight: '800', letterSpacing: 0.8 },
  perkFigure: { fontSize: 17, lineHeight: 20, fontWeight: '700', letterSpacing: -0.4 },
  perkLabel: { fontSize: 11.5, lineHeight: 15, fontWeight: '500' },
  perkName: { fontSize: 12, lineHeight: 15, fontWeight: '700' },
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
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  included: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: radius.lg,
    padding: 12,
  },
  includedIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, gap: spacing.sm },
  status: {
    height: 48,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  cta: {
    height: 48,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderTopWidth: 1,
    borderBottomWidth: 1.5,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  links: { flexDirection: 'row', justifyContent: 'center' },
});
