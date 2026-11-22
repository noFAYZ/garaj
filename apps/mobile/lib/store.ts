/**
 * Plans bought in the phone's store — Google Play, and the App Store once there is an iOS build —
 * through RevenueCat (`react-native-purchases`).
 *
 * The app only ever *starts* a purchase. What the account has is the API's answer: after the store
 * says yes, `/billing/sync` asks RevenueCat on the server and writes the plan, and the plan query
 * is what the screens believe. A receipt on the phone is never taken on its word.
 *
 * RevenueCat's setup this reads (dashboard, project → Product catalog):
 * - entitlements `plus` and `business`, one per paid tier, attached to their store products;
 * - one current offering whose packages are named `<tier>_<cadence>` — `plus_monthly`,
 *   `plus_annual`, `plus_lifetime`, `business_monthly`, `business_annual`, … A package missing from
 *   the offering is simply not offered.
 *
 * The SDK key is the *public* one for the platform (`goog_…`, `appl_…`), set in `app.json` under
 * `extra.revenuecat`. Never the secret `sk_…` key, which belongs to the API alone.
 */

import Constants from 'expo-constants';
import { Linking, Platform } from 'react-native';
import Purchases, {
  PURCHASES_ERROR_CODE,
  STORE_REPLACEMENT_MODE,
  type PurchasesPackage,
} from 'react-native-purchases';
import type { PlanState } from '@vehicle-os/contracts';
import { api } from './api';

export type PaidTier = 'PLUS' | 'BUSINESS';
export type Cadence = 'monthly' | 'annual' | 'lifetime';

/** One thing the store sells: a tier, how it is paid for, and the price the store shows. */
export interface StoreOffer {
  readonly tier: PaidTier;
  readonly cadence: Cadence;
  /** The store's own localised price — what Play requires the app to show. */
  readonly price: string;
  readonly productId: string;
  readonly pkg: PurchasesPackage;
}

const PACKAGE = /^(plus|business)_(monthly|annual|lifetime)$/;
const CADENCE_ORDER: readonly Cadence[] = ['monthly', 'annual', 'lifetime'];

/** The platform's public SDK key, or null in a build that has none (purchases are then off). */
function sdkKey(): string | null {
  const keys = Constants.expoConfig?.extra?.revenuecat as
    { android?: unknown; ios?: unknown } | undefined;
  const key = Platform.OS === 'ios' ? keys?.ios : keys?.android;
  return typeof key === 'string' && key.length > 0 ? key : null;
}

/** Whether this build can sell anything at all. */
export const storeAvailable = () => sdkKey() !== null;

/** A purchase the person backed out of — not a failure, so nothing is said. */
export const isCancelled = (error: unknown) =>
  Boolean((error as { userCancelled?: boolean } | null)?.userCancelled);

/**
 * A purchase the store took but has not been paid yet — cash at a shop, a bank transfer. Not a
 * failure: once it clears, Play tells RevenueCat, RevenueCat tells the webhook, and the plan starts.
 */
export const isPending = (error: unknown) =>
  (error as { code?: string } | null)?.code === PURCHASES_ERROR_CODE.PAYMENT_PENDING_ERROR;

/** The account RevenueCat currently knows the phone as. */
let identified: string | null = null;
/** The set-up in flight, so sign-in and a store screen opening together configure once. */
let readying: { userId: string; done: Promise<void> } | null = null;

/**
 * RevenueCat, set up for this account. The account's own id is RevenueCat's app user id, so a
 * purchase is the account's — on any phone it signs in on — and the server can look it up by it.
 */
function ready(userId: string): Promise<void> {
  if (readying?.userId !== userId) {
    const attempt = {
      userId,
      done: setUp(userId).catch((error: unknown) => {
        if (readying === attempt) readying = null;
        throw error;
      }),
    };
    readying = attempt;
  }
  return readying.done;
}

async function setUp(userId: string): Promise<void> {
  const key = sdkKey();
  if (!key) throw new StoreUnavailableError();
  if (identified === userId) return;
  try {
    if (identified === null && !(await Purchases.isConfigured())) {
      Purchases.configure({ apiKey: key, appUserID: userId });
    } else {
      await Purchases.logIn(userId);
    }
    identified = userId;
  } catch (error) {
    // A build made before the native module was added: say so rather than crash.
    throw new StoreUnavailableError(error);
  }
}

/**
 * RevenueCat, started as soon as someone is signed in rather than on the first store screen. A
 * purchase cut off mid-way (the app killed on the store's sheet) or paid later (pending) is only
 * finished — acknowledged to Play — by a running SDK, and Play refunds one left unacknowledged
 * for three days. A build that cannot sell simply does nothing.
 */
export const startStore = (userId: string): void => void ready(userId).catch(() => undefined);

export class StoreUnavailableError extends Error {
  constructor(cause?: unknown) {
    super('Purchases aren’t available in this version of the app.', { cause });
    this.name = 'StoreUnavailableError';
  }
}

/** What the store sells right now, best tier last and cadences in a fixed order. */
export async function loadOffers(userId: string): Promise<StoreOffer[]> {
  await ready(userId);
  const offerings = await Purchases.getOfferings();
  const offers: StoreOffer[] = [];
  for (const pkg of offerings.current?.availablePackages ?? []) {
    const match = PACKAGE.exec(pkg.identifier);
    if (!match) continue;
    offers.push({
      tier: match[1] === 'plus' ? 'PLUS' : 'BUSINESS',
      cadence: match[2] as Cadence,
      price: pkg.product.priceString,
      productId: pkg.product.identifier,
      pkg,
    });
  }
  return offers.sort(
    (a, b) =>
      Number(a.tier === 'BUSINESS') - Number(b.tier === 'BUSINESS') ||
      CADENCE_ORDER.indexOf(a.cadence) - CADENCE_ORDER.indexOf(b.cadence),
  );
}

/**
 * Buy an offer, then have the server read what was bought.
 *
 * Moving between two subscriptions on Google Play replaces the old one rather than billing both.
 * Going up happens now, the unused part of the old plan paying towards the new one; going down
 * (`at-renewal`) waits for the period already paid for to end. The product being replaced is the
 * one this phone holds; with none here (bought on another phone), Play starts a new subscription
 * and RevenueCat follows the newest.
 */
export async function buy(
  userId: string,
  offer: StoreOffer,
  when: 'now' | 'at-renewal' = 'now',
): Promise<void> {
  await ready(userId);
  let replacing: string | null = null;
  if (Platform.OS === 'android' && offer.cadence !== 'lifetime') {
    const info = await Purchases.getCustomerInfo();
    const held = info.activeSubscriptions.find((product) => product !== offer.productId);
    // Play ids read `subscription:base-plan`; the product being replaced is the subscription.
    replacing = held?.split(':')[0] ?? null;
  }
  await Purchases.purchasePackage(
    offer.pkg,
    null,
    replacing
      ? {
          oldProductIdentifier: replacing,
          replacementMode:
            when === 'now'
              ? STORE_REPLACEMENT_MODE.WITH_TIME_PRORATION
              : STORE_REPLACEMENT_MODE.DEFERRED,
        }
      : null,
  );
  // Paid by now: a failed sync is not a failed purchase. The screens keep asking for the plan,
  // and RevenueCat's webhook writes it either way.
  await api.billing.sync().catch(() => undefined);
}

/** Purchases made with this store account before — a new phone, a reinstall. */
export async function restore(userId: string): Promise<void> {
  await ready(userId);
  await Purchases.restorePurchases();
  await api.billing.sync();
}

/** Forget the account on this phone, so the next person to sign in does not inherit it. */
export async function forgetStoreAccount(): Promise<void> {
  readying = null;
  if (identified === null) return;
  identified = null;
  await Purchases.logOut().catch(() => undefined);
}

/** The store's own page for a plan bought there: cancel, change, fix a card. */
export function openStoreManagement(plan: PlanState | undefined): Promise<void> {
  const url =
    plan?.managementUrl ??
    (Platform.OS === 'ios'
      ? 'https://apps.apple.com/account/subscriptions'
      : `https://play.google.com/store/account/subscriptions?package=${Constants.expoConfig?.android?.package ?? ''}`);
  return Linking.openURL(url);
}

/** "Google Play", "the App Store": where a store plan was bought, in a sentence. */
export function storeName(store: string | null | undefined): string {
  if (store === 'APP_STORE' || store === 'MAC_APP_STORE') return 'the App Store';
  if (store === 'PLAY_STORE') return 'Google Play';
  return Platform.OS === 'ios' ? 'the App Store' : 'Google Play';
}

/** The plan is billed through a phone's store, and still running. */
export const storeBilled = (plan: PlanState | undefined) =>
  plan?.provider === 'REVENUECAT' && plan.status !== 'CANCELED';

/** The plan is billed on the web (Stripe), which the app may show but must not sell or manage. */
export const webBilled = (plan: PlanState | undefined) =>
  plan?.provider === 'STRIPE' && plan.status !== 'CANCELED';

/** "/ mo", "/ yr", "once" — the cadence after a store price. */
export const CADENCE_LABEL: Record<Cadence, { short: string; long: string }> = {
  monthly: { short: '/ mo', long: 'Monthly' },
  annual: { short: '/ yr', long: 'Yearly' },
  lifetime: { short: 'once', long: 'Once' },
};
