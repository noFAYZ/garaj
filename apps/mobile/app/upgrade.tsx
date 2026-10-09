import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Animated,
  AppState,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError } from '@vehicle-os/api-client';
import { pricesQuery, vehiclesQuery } from '@vehicle-os/api-client/react';
import type { PlanPrice } from '@vehicle-os/contracts';
import {
  ENTITLEMENT_COPY,
  ENTITLEMENTS,
  entitlementsFor,
  formatPlanPrice,
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
import { onBillingReturn } from '@/lib/billing-return';
import { haptic, PressableScale, Rise, useReduceMotion } from '@/lib/motion';
import { PlanPass, TierMark } from '@/lib/plan-kit';
import { BILLING_RETURN, FEATURE_ICON, priceLabel, usePlan } from '@/lib/upgrade';
import { figure, radius, spacing, typeScale, useTheme } from '@/lib/theme';

type PaidTier = 'PLUS' | 'BUSINESS';
type Limit = keyof PlanLimits;
/** Choosing; back from Stripe and waiting for the webhook; waited too long; upgraded. */
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

const LIMIT_ROWS = [
  ['Vehicles', 'vehicles'],
  ['Garages', 'garages'],
  ['People', 'members'],
] as const;

const CADENCE: Record<string, string> = {
  day: 'daily',
  week: 'weekly',
  month: 'monthly',
  year: 'yearly',
};

const POLL_MS = 2_000;
const PATIENCE_MS = 30_000;

const pad = (value: number) => String(value).padStart(2, '0');
const clock = (seconds: number) => `${pad(Math.floor(seconds / 60))}:${pad(seconds % 60)}`;
const noun = (limit: Limit, count: number) => LIMIT_NOUN[limit][count === 1 ? 0 : 1];
const isEntitlement = (value: string | undefined): value is Entitlement =>
  (ENTITLEMENTS as readonly string[]).includes(value ?? '');
const isLimit = (value: string | undefined): value is Limit =>
  value === 'vehicles' || value === 'garages' || value === 'members';
const gainedFeatures = (from: PlanTier, to: PlanTier) =>
  entitlementsFor(to).filter((entitlement) => !entitlementsFor(from).includes(entitlement));

function cadence(price: PlanPrice): string {
  return price.intervalCount === 1
    ? `Billed ${CADENCE[price.interval] ?? `every ${price.interval}`}`
    : `Billed every ${price.intervalCount} ${price.interval}s`;
}

/**
 * The upgrade (GAPS §10, §17): one screen that decides, instead of a pointer to settings.
 *
 * A picture of the reason, a headline, a choice of plan, the order as a ticket — price above the
 * tear, what changes below it — and one button that says what happens next. The picture is the
 * person's garage: their vehicles in the bays, and the dashed bays the next plan adds. The colour
 * is ink, because the logo is the only colour this product has.
 *
 * Opened from anywhere a plan refuses something — a full garage, a paid feature, the queue
 * replaying an offline write — with the reason in its params, so it leads with what was hit.
 * Opened from settings with no reason, it leads with room.
 *
 * It never decides a plan changed. Checkout happens in the browser and the webhook changes the
 * plan; Stripe's return link reaches this screen as an event (`lib/billing-return`), and it waits
 * for the plan in plain sight — the new bays breathe until the plan is real, then settle.
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
  const prices = useQuery(pricesQuery(api));
  const vehicles = useQuery(vehiclesQuery(api));

  const [phase, setPhase] = useState<Phase>('choose');
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (phase !== 'confirming' && phase !== 'slow') return;
    const tick = setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => clearInterval(tick);
  }, [phase]);
  const [notice, setNotice] = useState<string | null>(null);
  const [picked, setPicked] = useState<PaidTier | null>(null);
  /*
   * The order in flight: which plan, bought from which. Kept apart from the live plan so the
   * screen goes on describing the purchase after the plan itself has changed underneath it.
   */
  const [order, setOrder] = useState<{ from: PlanTier; to: PaidTier } | null>(null);
  const orderRef = useRef(order);
  orderRef.current = order;

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
  // Paying already: the button changes that subscription rather than starting another.
  const switching = current !== 'FREE';
  const price = chosen ? (prices.data?.[chosen] ?? null) : null;
  // Loaded, and Stripe has no price for it: say so now rather than fail on the press.
  const unavailable = Boolean(chosen && prices.isSuccess && !price);

  // Stripe's answer, heard through the return link.
  useEffect(
    () =>
      onBillingReturn((outcome) => {
        if (!orderRef.current) return;
        if (outcome === 'cancelled') {
          setOrder(null);
          setNotice('Checkout cancelled. Nothing was charged.');
        } else if (outcome === 'done') {
          setNotice(null);
          setPhase('confirming');
        }
      }),
    [],
  );

  // Back by the app switcher instead of the link: ask once, in case it already landed.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active' && orderRef.current) void refetch();
    });
    return () => subscription.remove();
  }, [refetch]);

  // While confirming, ask every two seconds for half a minute — then say so, and stop. The
  // first ask goes to the provider itself, not only to a webhook that may never arrive.
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

  const checkout = useMutation({
    mutationFn: async (tier: PaidTier) => {
      const { url } = await api.billing.checkout({ plan: tier, returnPath: BILLING_RETURN });
      setOrder({ from: data?.plan ?? 'FREE', to: tier });
      setNotice(null);
      await Linking.openURL(url);
    },
  });
  const portal = useMutation({
    mutationFn: async () => {
      const { url } = await api.billing.portal({ returnPath: BILLING_RETURN });
      await Linking.openURL(url);
    },
  });

  const failure = checkout.error ?? portal.error;
  const failureText =
    failure instanceof ApiError && failure.code === 'NO_BILLING'
      ? 'Upgrades aren’t available yet.'
      : failure instanceof ApiError && failure.code === 'NO_PRICE'
        ? 'This plan isn’t on sale yet.'
        : failure instanceof Error
          ? failure.message
          : null;

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
    Math.min(48, Math.floor((heroInner - bayGap * (bayCount - 1)) / bayCount)),
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

  const footnote = unavailable
    ? 'Upgrades aren’t available yet.'
    : switching
      ? 'Stripe shows the prorated charge before you confirm.'
      : 'You pay on Stripe’s page next. Cancel anytime from Billing.';

  const hasBilling = Boolean(data && (data.plan !== 'FREE' || data.currentPeriodEnd));

  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]}>
      <ScrollView
        contentContainerStyle={[styles.page, { paddingTop: insets.top + spacing.sm }]}
        showsVerticalScrollIndicator={false}
      >
        <PressableScale
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Close"
          hitSlop={8}
          scaleTo={0.9}
          style={[styles.close, { backgroundColor: theme.card }]}
        >
          <Ionicons name="close" size={22} color={theme.foreground} />
        </PressableScale>

        {/* --- the picture: what was hit, and what the plan adds ---------------------------- */}
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

          {/* The stamp: the one number the upgrade is about, or a tick once it is yours. */}
          {chosen ? (
            <View
              style={[
                styles.badge,
                { backgroundColor: theme.background, borderColor: theme.primary },
              ]}
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
          ) : null}
        </Rise>

        <Rise index={1} style={{ gap: 6 }}>
          <Text accessibilityRole="header" style={[typeScale.display, { color: theme.foreground }]}>
            {title}
          </Text>
          <Text style={[typeScale.body, { color: theme.mutedForeground }]}>{subtitle}</Text>
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
                const tierPrice = prices.data?.[tier] ?? null;
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
                    accessibilityLabel={`${PLAN_NAMES[tier]}${tierPrice ? `, ${priceLabel(tierPrice)}` : ''}`}
                    scaleTo={0.98}
                    style={[
                      styles.tier,
                      {
                        backgroundColor: selected ? theme.primarySoft : theme.card,
                        borderColor: selected ? theme.primary : theme.card,
                      },
                    ]}
                  >
                    {index === 0 ? (
                      <View style={[styles.tierBadge, { backgroundColor: theme.primary }]}>
                        <Text style={[typeScale.overline, { color: theme.primaryForeground }]}>
                          Cheapest
                        </Text>
                      </View>
                    ) : null}
                    <View
                      style={[
                        styles.radio,
                        { borderColor: selected ? theme.primary : theme.borderStrong },
                      ]}
                    >
                      {selected ? (
                        <View style={[styles.radioDot, { backgroundColor: theme.primary }]} />
                      ) : null}
                    </View>
                    <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                      <View style={styles.optionName}>
                        <TierMark tier={tier} color={theme.foreground} />
                        <Text style={[typeScale.headline, { color: theme.foreground }]}>
                          {PLAN_NAMES[tier]}
                        </Text>
                      </View>
                      <Text
                        numberOfLines={1}
                        style={[typeScale.caption, figure, { color: theme.mutedForeground }]}
                      >
                        {pad(limits.vehicles)} vehicles · {pad(limits.garages)} garages
                      </Text>
                    </View>
                    {prices.isPending ? (
                      <ActivityIndicator size="small" color={theme.mutedForeground} />
                    ) : tierPrice ? (
                      <Text style={[typeScale.label, figure, { color: theme.foreground }]}>
                        {priceLabel(tierPrice)}
                      </Text>
                    ) : null}
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
                <PlanPass plan={data} price={prices.data?.[order.to] ?? null} />
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
            <Steps tier={chosen} slow={phase === 'slow'} seconds={seconds} />
          </Rise>
        ) : chosen ? (
          <Rise index={3}>
            <Ticket
              from={current}
              to={chosen}
              price={price}
              loading={prices.isPending}
              switching={switching}
            />
          </Rise>
        ) : null}
      </ScrollView>

      {/* --- the one action, pinned where the thumb is ------------------------------------ */}
      <View
        style={[
          styles.footer,
          { paddingBottom: Math.max(insets.bottom, spacing.md), backgroundColor: theme.background },
        ]}
      >
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

        {phase === 'done' ? (
          <Cta label="Done" onPress={() => router.back()} />
        ) : phase === 'confirming' ? (
          <View
            style={[styles.status, { backgroundColor: theme.card }]}
            accessibilityLiveRegion="polite"
          >
            <ActivityIndicator color={theme.foreground} />
            <Text style={[typeScale.label, { color: theme.foreground }]}>
              Waiting for Stripe to confirm
            </Text>
          </View>
        ) : phase === 'slow' ? (
          <Cta label="Check again" busy={plan.isFetching} onPress={() => void refetch()} />
        ) : chosen ? (
          <Cta
            label={`${switching ? 'Switch' : 'Upgrade'} to ${PLAN_NAMES[chosen]}`}
            icon="arrow-forward"
            busy={checkout.isPending}
            disabled={unavailable}
            onPress={() => {
              haptic.selection();
              checkout.mutate(chosen);
            }}
          />
        ) : null}

        {phase === 'choose' && chosen ? (
          <Text style={[typeScale.caption, { color: theme.mutedForeground, textAlign: 'center' }]}>
            {footnote}
          </Text>
        ) : null}

        {phase !== 'done' ? (
          <View style={styles.links}>
            {hasBilling && !waiting ? (
              <PressableScale
                onPress={() => portal.mutate()}
                accessibilityRole="button"
                hitSlop={8}
              >
                <Text style={[typeScale.caption, { color: theme.mutedForeground }]}>
                  Manage billing
                </Text>
              </PressableScale>
            ) : (
              <View />
            )}
            <PressableScale onPress={() => router.back()} accessibilityRole="button" hitSlop={8}>
              <Text style={[typeScale.caption, { color: theme.mutedForeground }]}>
                {waiting || !chosen ? 'Close' : 'Not now'}
              </Text>
            </PressableScale>
          </View>
        ) : null}
      </View>
    </View>
  );
}

/**
 * The order, as a ticket: the plan and its price above the tear, what it changes below it.
 *
 * A garage hands you a ticket on the way in; this is that, for the bigger garage. The notches are
 * cut in the screen's own colour, so the tear reads as a tear and not as a rule.
 */
function Ticket({
  from,
  to,
  price,
  loading,
  switching,
}: {
  from: PlanTier;
  to: PaidTier;
  price: PlanPrice | null;
  loading: boolean;
  switching: boolean;
}) {
  const theme = useTheme();
  const before = limitsFor(from);
  const after = limitsFor(to);
  const gained = gainedFeatures(from, to);
  const reading = price ? formatPlanPrice(price) : null;

  return (
    <View
      style={[styles.ticket, { backgroundColor: theme.card }]}
      accessible
      accessibilityLabel={`${switching ? 'Switch' : 'Upgrade'} to ${PLAN_NAMES[to]}${
        price ? `, ${priceLabel(price)}, ${cadence(price).toLowerCase()}` : ''
      }. ${LIMIT_ROWS.map(([label, key]) => `${after[key]} ${label.toLowerCase()}`).join(', ')}${
        gained.length
          ? `. Adds ${gained.map((gain) => ENTITLEMENT_COPY[gain].name).join(', ')}`
          : ''
      }`}
    >
      <View style={styles.ticketTop}>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text
            style={[
              typeScale.overline,
              { color: theme.mutedForeground, textTransform: 'uppercase' },
            ]}
          >
            {switching ? 'Switch' : 'Upgrade'} from {PLAN_NAMES[from]}
          </Text>
          <View style={styles.optionName}>
            <Text style={[styles.ticketName, { color: theme.foreground }]}>{PLAN_NAMES[to]}</Text>
            <TierMark tier={to} color={theme.foreground} />
          </View>
          {price ? (
            <Text style={[typeScale.caption, { color: theme.mutedForeground }]}>
              {cadence(price)}
              {switching ? ' · prorated today' : ''}
            </Text>
          ) : null}
        </View>
        {loading ? (
          <ActivityIndicator color={theme.mutedForeground} />
        ) : reading ? (
          <Text style={[figure, { color: theme.foreground }]}>
            <Text style={styles.priceAmount}>{reading.amount}</Text>
            <Text style={[typeScale.caption, { color: theme.mutedForeground }]}>
              /{reading.per}
            </Text>
          </Text>
        ) : (
          <Text style={[typeScale.caption, { color: theme.mutedForeground }]}>No price yet</Text>
        )}
      </View>

      <View style={styles.tear}>
        <View style={[styles.notch, { left: -10, backgroundColor: theme.background }]} />
        <View style={styles.dashes}>
          {Array.from({ length: 26 }, (_, index) => (
            <View key={index} style={[styles.dash, { backgroundColor: theme.border }]} />
          ))}
        </View>
        <View style={[styles.notch, { right: -10, backgroundColor: theme.background }]} />
      </View>

      <View style={styles.ticketBottom}>
        <View style={styles.figures}>
          {LIMIT_ROWS.map(([label, key]) => {
            const more = after[key] - before[key];
            return (
              <View key={key} style={{ flex: 1, gap: 2 }}>
                <Text style={[typeScale.overline, { color: theme.mutedForeground }]}>{label}</Text>
                <View style={styles.figureRow}>
                  <Text
                    style={[
                      figure,
                      styles.figureValue,
                      { color: more > 0 ? theme.foreground : theme.mutedForeground },
                    ]}
                  >
                    {pad(after[key])}
                  </Text>
                  {more > 0 ? (
                    <Text style={[typeScale.caption, figure, { color: theme.mutedForeground }]}>
                      +{more}
                    </Text>
                  ) : null}
                </View>
              </View>
            );
          })}
        </View>
        {gained.length > 0 ? (
          <View style={styles.chips}>
            {gained.map((gain) => (
              <View key={gain} style={[styles.chip, { backgroundColor: theme.muted }]}>
                <Ionicons name="checkmark" size={13} color={theme.success} />
                <Text style={[typeScale.caption, { color: theme.foreground }]}>
                  {ENTITLEMENT_COPY[gain].name}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
}

/**
 * What has happened so far, as the web's confirmation draws it: paid, confirming (with how long
 * it has been), unlocked. Real states only — the first is true because Stripe sent us back.
 */
function Steps({ tier, slow, seconds }: { tier: PaidTier; slow: boolean; seconds: number }) {
  const theme = useTheme();
  const rows: {
    state: 'done' | 'active' | 'waiting' | 'pending';
    label: string;
    aside?: string;
  }[] = [
    { state: 'done', label: 'Paid at Stripe' },
    {
      state: slow ? 'waiting' : 'active',
      label: slow ? 'Still confirming' : 'Confirming with Stripe',
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
  page: { paddingHorizontal: spacing.md, paddingBottom: spacing.lg, gap: spacing.md + 2 },
  close: {
    width: 40,
    height: 40,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hero: {
    borderRadius: radius.xl + 6,
    // Room above the bays for the badge to hang into, so it never sits on one.
    paddingTop: 58,
    paddingBottom: spacing.lg,
    paddingHorizontal: spacing.md,
    marginTop: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
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
    width: 92,
    height: 92,
    borderRadius: 26,
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
    position: 'absolute',
    top: -22,
    right: 10,
    width: 76,
    height: 76,
    borderRadius: 999,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ rotate: '-8deg' }],
  },
  badgeFigure: { fontSize: 20, lineHeight: 24, fontWeight: '700' },
  tier: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: radius.xl,
    borderWidth: 2,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
  },
  tierBadge: {
    position: 'absolute',
    top: -10,
    left: spacing.md,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 2,
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 999,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioDot: { width: 10, height: 10, borderRadius: 999 },
  optionName: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  ticketName: { fontSize: 24, lineHeight: 29, fontWeight: '700', letterSpacing: -0.5 },
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
  ticket: { borderRadius: radius.xl },
  ticketTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: 12,
  },
  priceAmount: { fontSize: 30, lineHeight: 36, fontWeight: '700' },
  tear: { height: 20, justifyContent: 'center' },
  notch: { position: 'absolute', top: 0, width: 20, height: 20, borderRadius: 10 },
  dashes: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginHorizontal: spacing.md,
    overflow: 'hidden',
  },
  dash: { width: 6, height: 2, borderRadius: 1 },
  ticketBottom: {
    gap: 12,
    paddingHorizontal: spacing.md,
    paddingTop: 12,
    paddingBottom: spacing.md,
  },
  figures: { flexDirection: 'row', gap: 12 },
  figureRow: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  figureValue: { fontSize: 18, lineHeight: 22, fontWeight: '700' },
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
    height: 56,
    borderRadius: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  cta: {
    height: 56,
    borderRadius: 18,
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
  links: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 4 },
});
