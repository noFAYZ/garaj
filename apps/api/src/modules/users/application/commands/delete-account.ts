/**
 * Deleting your own account (App Store 5.1.1(v), Google Play's account deletion policy).
 *
 * Three things, in this order:
 *
 * 1. A live subscription is cancelled at the provider, now. Deleting the row does not stop the
 *    card being charged, and a provider that refuses aborts the whole deletion — an account gone
 *    while billing goes on is the one outcome worse than an account that stays.
 * 2. Every garage the person owns goes, with everything in it (the schema cascades vehicles,
 *    entries, expenses and documents). A garage has one owner, and nobody else can own it.
 * 3. The user row goes; sessions, memberships of other people's garages, devices and API keys
 *    cascade with it. Their entries in garages they did not own stay, unattributed.
 */

import { eq } from 'drizzle-orm';
import type Stripe from 'stripe';
import { schema, type Database } from '@vehicle-os/database';
import { recordAudit } from '../../../../infrastructure/audit';
import { ServiceUnavailableError } from '../../../../infrastructure/errors';
import { stripe } from '../../../../infrastructure/stripe';
import { forgetMemberships } from '../../../../plugins/actor-context';
import { deleteGarage } from '../../../garages/infrastructure/repositories/garage-repository';

/** Still being billed: charging, trialling, or retrying a failed payment. */
const BILLED = new Set(['ACTIVE', 'TRIALING', 'PAST_DUE']);

export interface DeleteAccountMeta {
  readonly requestId: string;
  readonly ipAddress: string;
  readonly actorEmail: string | null;
}

export async function deleteAccount(
  db: Database,
  userId: string,
  meta: DeleteAccountMeta,
): Promise<void> {
  const [subscription] = await db
    .select({
      status: schema.subscriptions.status,
      stripeSubscriptionId: schema.subscriptions.stripeSubscriptionId,
    })
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.userId, userId))
    .limit(1);

  if (subscription?.stripeSubscriptionId && BILLED.has(subscription.status)) {
    const provider = stripe();
    if (!provider) {
      throw new ServiceUnavailableError(
        'Your subscription could not be cancelled right now. Try again later.',
        'NO_BILLING',
      );
    }
    try {
      await provider.subscriptions.cancel(subscription.stripeSubscriptionId);
    } catch (error) {
      // Already gone at the provider is what this step wanted.
      if ((error as Stripe.errors.StripeError).code !== 'resource_missing') throw error;
    }
  }

  await db.transaction(async (tx) => {
    const owned = await tx
      .select({ id: schema.garages.id })
      .from(schema.garages)
      .where(eq(schema.garages.ownerId, userId));
    for (const garage of owned) await deleteGarage(tx, garage.id);

    await recordAudit(tx, {
      actorId: userId,
      actorEmail: meta.actorEmail,
      action: 'user.deleted',
      resourceType: 'user',
      resourceId: userId,
      metadata: { self: true, garages: owned.length },
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
    });
    await tx.delete(schema.users).where(eq(schema.users.id, userId));
  });
  // Their memberships went with the row; so does the cached copy.
  forgetMemberships();
}
