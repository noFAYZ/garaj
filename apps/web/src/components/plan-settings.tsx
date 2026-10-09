'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, ExternalLink, Minus, ShieldCheck } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { PlanState } from '@vehicle-os/contracts';
import { ENTITLEMENT_COPY, PLAN_NAMES, type AccountKind } from '@vehicle-os/domain';
import { queryKeys } from '@vehicle-os/api-client/react';
import { api } from '@/lib/api';
import { usePlan } from '@/lib/upgrade';
import { formatDate } from '@/lib/format';
import { Bays, gainedFeatures, PlanCompare, useVehicleMarks } from '@/components/upgrade-dialog';
import { LimitLedger, PassChip, PlanPass } from '@/components/plan-kit';
import { FormError, Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/primitives';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

const pad = (value: number) => String(value).padStart(2, '0');

/**
 * The plan (GAPS §10, §17): what you hold, how full it is, the way up, and the way down.
 *
 * The plan leads as a pass — ink when it is paid for — with its state on a badge and its dates
 * as figures. Usage is drawn as the bays the rest of the app parks vehicles in, the tiers below
 * list only what each adds, and cancelling sits apart at the bottom, two presses away.
 */
export function PlanSettings() {
  const { data, plan } = usePlan();
  const marks = useVehicleMarks(18);
  const queryClient = useQueryClient();
  // The smaller plan being confirmed; the dialog is mounted only while this is set.
  const [moving, setMoving] = useState<'FREE' | 'PLUS' | null>(null);

  const resume = useMutation({
    mutationFn: () => api.billing.resume(),
    meta: { toast: data ? `Keeping ${PLAN_NAMES[data.plan]}` : 'Plan kept' },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.plan() }),
  });

  const portal = useMutation({
    mutationFn: () => api.billing.portal({ returnPath: '/settings' }),
    meta: { toast: false },
    onSuccess: ({ url }) => window.location.assign(url),
  });

  if (plan.isError) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-2xl bg-muted/50 p-4">
        <p className="text-sm text-muted-foreground">Your plan could not be loaded.</p>
        <Button size="sm" onClick={() => void plan.refetch()}>
          Try again
        </Button>
      </div>
    );
  }

  // A customer exists once anyone has checked out; before that there is no portal to open.
  const hasBilling = Boolean(data && (data.plan !== 'FREE' || data.currentPeriodEnd));
  // Paid through the provider, so there is a subscription to end. A comped plan has no period.
  const cancellable = Boolean(data && data.plan !== 'FREE' && data.currentPeriodEnd);
  const paid = data?.plan !== 'FREE';

  return (
    <div className="flex flex-col gap-6">
      <section aria-label="Your plan" className="flex flex-col gap-3">
        {data ? (
          <PlanPass plan={data} className="animate-rise">
            {hasBilling ? (
              <button
                type="button"
                onClick={() => portal.mutate()}
                disabled={portal.isPending}
                aria-busy={portal.isPending || undefined}
                className={cn(
                  'inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold transition-colors disabled:opacity-60',
                  paid ? 'hover:bg-primary-foreground/10' : 'hover:bg-muted',
                )}
              >
                Card & invoices
                <ExternalLink className="size-3.5" aria-hidden="true" />
              </button>
            ) : null}
          </PlanPass>
        ) : (
          <Skeleton className="h-[11.5rem] rounded-2xl" />
        )}

        {data?.status === 'PAST_DUE' ? (
          <Notice
            tone="destructive"
            action={
              <Button
                size="sm"
                variant="danger"
                loading={portal.isPending}
                onClick={() => portal.mutate()}
              >
                Update card
              </Button>
            }
          >
            <span className="font-semibold">The last payment failed.</span> Update the card to keep{' '}
            {PLAN_NAMES[data.plan]}.
          </Notice>
        ) : data?.cancelAtPeriodEnd && data.currentPeriodEnd ? (
          <Notice
            tone="warning"
            action={
              <Button
                size="sm"
                variant="primary"
                loading={resume.isPending}
                onClick={() => resume.mutate()}
              >
                Keep {PLAN_NAMES[data.plan]}
              </Button>
            }
          >
            <span className="font-semibold">Cancelled.</span> {PLAN_NAMES[data.plan]} stays until{' '}
            {formatDate(data.currentPeriodEnd)}, then Free.
          </Notice>
        ) : null}
        {portal.isError ? <FormError>{portal.error.message}</FormError> : null}
      </section>

      <section aria-label="Usage" className="grid gap-5 rounded-2xl bg-muted/50 p-5 sm:grid-cols-2">
        <Usage
          label="Vehicles"
          icon="car"
          marks={marks}
          used={data?.usage.vehicles}
          allowed={data?.limits.vehicles}
        />
        <Usage
          label="Garages"
          icon="garage"
          used={data?.usage.garages}
          allowed={data?.limits.garages}
        />
      </section>

      <AccountKindSwitch value={data?.accountKind} />

      <section aria-label="Plans" className="flex flex-col gap-3">
        <p className="text-label uppercase text-muted-foreground">Plans</p>
        <PlanCompare current={data?.plan} onDowngrade={setMoving} />
      </section>

      {cancellable && data && !data.cancelAtPeriodEnd ? (
        // Kept apart from the plans: the destructive control is never the one beside the routine one.
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl bg-destructive-soft p-4">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">Cancel {PLAN_NAMES[data.plan]}</p>
            <p className="text-xs text-muted-foreground">
              Kept until {formatDate(data.currentPeriodEnd!)}, then Free. Every record stays.
            </p>
          </div>
          <Button variant="danger" onClick={() => setMoving('FREE')}>
            Cancel plan
          </Button>
        </div>
      ) : null}

      {moving && data ? (
        <DowngradeDialog plan={data} to={moving} onClose={() => setMoving(null)} />
      ) : null}
    </div>
  );
}

/** Something about the subscription that wants doing, on the tint of what it means. */
function Notice({
  tone,
  action,
  children,
}: {
  tone: 'warning' | 'destructive';
  action: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      role={tone === 'destructive' ? 'alert' : undefined}
      className={cn(
        'flex animate-rise flex-wrap items-center justify-between gap-3 rounded-xl p-3 pl-4',
        tone === 'warning' ? 'bg-warning-soft' : 'bg-destructive-soft',
      )}
    >
      <p className="min-w-0 text-sm text-foreground">{children}</p>
      {action}
    </div>
  );
}

/**
 * The second press, as a diff: from this pass to that one, every ceiling old → new with any the
 * account is already over flagged in place, and the features that stop. Over a ceiling is not a
 * refusal — nothing is deleted, adding more just waits — but it is never found out afterwards.
 */
function DowngradeDialog({
  plan,
  to,
  onClose,
}: {
  plan: PlanState;
  to: 'FREE' | 'PLUS';
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const from = plan.plan;
  const cancel = to === 'FREE';
  const lost = gainedFeatures(to, from);
  const until = plan.currentPeriodEnd ? formatDate(plan.currentPeriodEnd) : null;

  const change = useMutation({
    mutationFn: () => api.billing.downgrade(to),
    meta: { toast: cancel ? `${PLAN_NAMES[from]} cancelled` : `Switched to ${PLAN_NAMES[to]}` },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.plan() });
      onClose();
    },
  });

  return (
    <Modal
      title={cancel ? `Cancel ${PLAN_NAMES[from]}?` : `Switch to ${PLAN_NAMES[to]}?`}
      description={
        cancel
          ? `You keep ${PLAN_NAMES[from]} until ${until ?? 'the end of the period'}. Then it moves to Free, and nothing is charged again.`
          : `Switches now. What is left of ${PLAN_NAMES[from]} is credited to your next bill.`
      }
      onClose={onClose}
    >
      <div className="flex flex-col gap-5">
        <div
          role="img"
          aria-label={`${PLAN_NAMES[from]} to ${PLAN_NAMES[to]}, ${cancel ? `on ${until ?? 'the period end'}` : 'now'}`}
          className="flex items-center justify-center gap-3 rounded-2xl bg-muted/40 px-4 py-5"
        >
          <PassChip tier={from} />
          <span className="flex flex-col items-center gap-1 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
            <ArrowRight className="size-4" aria-hidden="true" />
            {cancel ? (until ?? 'later') : 'now'}
          </span>
          <PassChip tier={to} />
        </div>

        <LimitLedger from={from} to={to} usage={plan.usage} />

        {lost.length > 0 ? (
          <div className="flex flex-col gap-2">
            <p className="text-label uppercase text-muted-foreground">
              {cancel ? `Stops ${until ? `on ${until}` : 'at the period end'}` : 'Stops now'}
            </p>
            <ul className="flex flex-wrap gap-1.5">
              {lost.map((entitlement) => (
                <li
                  key={entitlement}
                  className="flex items-center gap-1.5 rounded-full bg-muted/60 py-1 pl-1 pr-3 text-sm font-medium text-foreground"
                >
                  <span className="grid size-5 place-items-center rounded-full bg-destructive-soft text-destructive">
                    <Minus className="size-3" strokeWidth={3} aria-hidden="true" />
                  </span>
                  {ENTITLEMENT_COPY[entitlement].name}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <ShieldCheck className="size-4 shrink-0" aria-hidden="true" />
          Every vehicle, record and document stays. Nothing is deleted.
        </p>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={onClose} disabled={change.isPending}>
            Keep {PLAN_NAMES[from]}
          </Button>
          <Button
            variant={cancel ? 'danger' : 'primary'}
            loading={change.isPending}
            onClick={() => change.mutate()}
          >
            {cancel ? 'Cancel plan' : `Switch to ${PLAN_NAMES[to]}`}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * One ceiling, drawn as bays with the count beside it.
 *
 * A dot turns amber at the last free bay and red when there are none — so the warning arrives
 * while there is still room to act on it, not at the refusal.
 */
function Usage({
  label,
  icon,
  marks,
  used,
  allowed,
}: {
  label: string;
  icon: 'car' | 'garage';
  marks?: readonly ReactNode[];
  used: number | undefined;
  allowed: number | undefined;
}) {
  if (used === undefined || allowed === undefined) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-label uppercase text-muted-foreground">{label}</p>
        <Skeleton className="h-7 w-40" />
      </div>
    );
  }

  const left = allowed - used;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-label uppercase text-muted-foreground">{label}</p>
        <p className="flex items-center gap-1.5 font-mono text-sm font-semibold tabular-nums text-foreground">
          {/*
           * The state on a dot, not on the digits: amber text is only contrast-tested on its own
           * soft tint, and these sit on a card.
           */}
          {left <= 1 ? (
            <span
              aria-hidden="true"
              className={cn('size-1.5 rounded-full', left <= 0 ? 'bg-destructive' : 'bg-warning')}
            />
          ) : null}
          {/* One item, so the dot's gap never lands between the two halves of the count. */}
          <span>
            {pad(used)}
            <span className="text-muted-foreground">/{pad(allowed)}</span>
          </span>
        </p>
      </div>
      <Bays
        filled={used}
        open={Math.max(0, left)}
        icon={icon}
        marks={marks}
        size="sm"
        label={`${label}: ${used} of ${allowed} used`}
      />
    </div>
  );
}

/**
 * Personal or business: what the account is for, which changes the fields someone sees and
 * never what they pay. A two-way switch, because it is a choice between two, not a list.
 */
function AccountKindSwitch({ value }: { value: AccountKind | undefined }) {
  const queryClient = useQueryClient();
  const setKind = useMutation({
    mutationFn: (accountKind: AccountKind) => api.users.updateMe({ accountKind }),
    meta: { toast: false },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.plan() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.me() });
    },
  });
  // The press shows at once; the server confirms behind it.
  const shown = setKind.isPending ? setKind.variables : value;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <p id="account-kind-label" className="text-sm font-semibold text-foreground">
          Use Garaj for
        </p>
        <p className="text-xs text-muted-foreground">Business adds trips, income and drivers.</p>
      </div>
      <div
        role="radiogroup"
        aria-labelledby="account-kind-label"
        className="inline-flex rounded-full bg-muted p-1"
      >
        {(['PERSONAL', 'BUSINESS'] as const).map((kind) => (
          <button
            key={kind}
            type="button"
            role="radio"
            aria-checked={shown === kind}
            disabled={value === undefined}
            onClick={() => kind !== shown && setKind.mutate(kind)}
            className={cn(
              'h-8 rounded-full px-4 text-sm font-semibold transition-[background-color,color] duration-200',
              shown === kind
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {kind === 'PERSONAL' ? 'Personal' : 'Business'}
          </button>
        ))}
      </div>
    </div>
  );
}
