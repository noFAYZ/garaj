'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { queryKeys, sharesQuery, vehicleQuery } from '@vehicle-os/api-client/react';
import { api } from '@/lib/api';
import { FormError } from '@/components/ui/modal';
import { Icon } from '@/components/icons';
import { Button, Field } from '@/components/ui/primitives';
import { LockedFeature } from '@/components/upgrade-dialog';
import { useOwnPlanGoverns, usePlan } from '@/lib/upgrade';
import { ListSkeleton, Loading } from '@/components/ui/skeleton';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { PassportSection } from '@vehicle-os/domain';

/** What each opt-in section adds, in the words the owner is choosing between. */
const SECTIONS: readonly { value: PassportSection; label: string }[] = [
  { value: 'MAINTENANCE', label: 'Service history' },
  { value: 'MAINTENANCE_COSTS', label: 'What services cost' },
  { value: 'CONDITION', label: 'Condition' },
  { value: 'DOCUMENTS', label: 'Document list' },
  { value: 'FINANCES', label: 'Price paid and value' },
  { value: 'IDENTIFICATION_NUMBER', label: 'VIN' },
];

const sectionLabel = (value: PassportSection) =>
  SECTIONS.find((section) => section.value === value)?.label ?? value;

/**
 * Share links for one vehicle.
 *
 * The token is shown once, when the link is created, and never again — the server keeps only
 * its hash. That is a deliberate constraint on this UI: it has to make the one-time nature
 * obvious rather than let someone assume they can come back for it.
 */
export function SharePanel({ vehicleId }: { vehicleId: string }) {
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [label, setLabel] = useState('');
  const [expiresInDays, setExpiresInDays] = useState('30');
  // Nothing preselected: what a stranger sees is the owner's call, made here (PRD §1531).
  const [sections, setSections] = useState<PassportSection[]>([]);
  const [freshLink, setFreshLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const shares = useQuery(sharesQuery(api, vehicleId));
  const vehicle = useQuery(vehicleQuery(api, vehicleId));
  const governs = useOwnPlanGoverns(vehicle.data?.garageId);
  /*
   * Only the *new link* is walled. Links made before a downgrade keep working and stay listed
   * below with their revoke buttons — taking away someone's ability to withdraw a link they
   * already handed out would make the downgrade a privacy problem, not a pricing one.
   */
  const { featureWall } = usePlan();
  const locked = governs ? featureWall('passport.share', 'Sharing a vehicle passport') : null;
  const invalidate = () => queryClient.invalidateQueries({ queryKey: queryKeys.shares(vehicleId) });

  const create = useMutation({
    mutationFn: () =>
      api.shares.create(vehicleId, {
        ...(label.trim() ? { label: label.trim() } : {}),
        ...(expiresInDays ? { expiresInDays: Number(expiresInDays) } : {}),
        sections,
      }),
    onSuccess: (link) => {
      // Held in state deliberately: this is the only moment the token exists outside the
      // reader's clipboard.
      setFreshLink(`${window.location.origin}/p/${link.token}`);
      setLabel('');
      setSections([]);
      setCreating(false);
      void invalidate();
    },
  });

  const revoke = useMutation({
    mutationFn: (shareId: string) => api.shares.revoke(vehicleId, shareId),
    onSuccess: invalidate,
  });

  const list = shares.data ?? [];

  return (
    <div className="flex flex-col">
      {locked ? (
        <div className="mb-4">
          <LockedFeature wall={locked} />
        </div>
      ) : (
        <div className="mb-4 flex justify-end">
          <Button
            size="sm"
            variant="primary"
            aria-expanded={creating}
            onClick={() => setCreating((open) => !open)}
          >
            <Plus className="size-4" aria-hidden="true" />
            New link
          </Button>
        </div>
      )}
      {creating && !locked ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate();
          }}
          className="mb-4 flex animate-pop flex-col gap-4 rounded-2xl bg-card p-4"
        >
          {/*
           * Said plainly before the link exists, not in a tooltip afterwards — and built from
           * the choices below, so the sentence is always what the link will actually show.
           */}
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-medium text-foreground">
              What should the link show?
            </legend>
            <div role="group" aria-label="Sections to share" className="flex flex-wrap gap-2">
              {SECTIONS.map((section) => {
                const on = sections.includes(section.value);
                return (
                  <button
                    key={section.value}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      setSections((current) =>
                        on
                          ? current.filter((value) => value !== section.value)
                          : [...current, section.value],
                      )
                    }
                    className={cn(
                      'h-9 rounded-full px-3.5 text-sm font-semibold transition-colors',
                      on
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-muted-foreground hover:bg-border',
                    )}
                  >
                    {section.label}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <Icon name="info" size={14} className="mt-0.5" />
            <span>
              Anyone with the link sees the make, model, mileage and health score
              {sections.length > 0
                ? `, plus: ${sections.map(sectionLabel).join(', ').toLowerCase()}.`
                : ', and nothing else.'}{' '}
              Never names, email addresses or document files. You can revoke it at any time.
            </span>
          </p>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label="What is it for"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="For the buyer"
            />
            <Field
              label="Expires in"
              type="number"
              inputMode="numeric"
              min={1}
              max={365}
              suffix="days"
              value={expiresInDays}
              onChange={(event) => setExpiresInDays(event.target.value)}
              hint="Leave empty for a link that lasts until you revoke it."
            />
          </div>

          {create.isError ? <FormError>{(create.error as Error).message}</FormError> : null}

          <div className="flex gap-2">
            <Button type="submit" variant="primary" loading={create.isPending}>
              Create link
            </Button>
            <Button onClick={() => setCreating(false)}>Cancel</Button>
          </div>
        </form>
      ) : null}

      {freshLink ? (
        <div className="mb-4 flex animate-pop flex-col gap-2 rounded-2xl bg-primary-soft p-4">
          <p className="text-sm font-medium text-foreground">
            Copy this now — it is not shown again.
          </p>
          <p className="text-xs text-muted-foreground">
            Only a hash of it is stored, so it cannot be looked up later. If you lose it, revoke
            this link and make another.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 select-all truncate rounded-lg bg-card px-3 py-2 text-xs text-foreground">
              {freshLink}
            </code>
            <Button
              size="sm"
              variant="primary"
              /*
               * "Copied" only once the clipboard says so. It was set unconditionally, and without
               * clipboard permission it confirmed a copy that never happened — for a link that
               * cannot be shown again. The link text is `select-all`, so if this fails one click
               * on it selects the whole thing for a manual copy.
               */
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(freshLink);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                } catch {
                  setCopied(false);
                }
              }}
            >
              {copied ? <Icon name="check" size={14} /> : null}
              {copied ? 'Copied' : 'Copy'}
            </Button>
            <Button size="sm" onClick={() => setFreshLink(null)}>
              Done
            </Button>
          </div>
        </div>
      ) : null}

      {shares.isPending ? (
        <Loading label="Loading share links">
          <ListSkeleton rows={1} />
        </Loading>
      ) : list.length === 0 ? (
        <p className="text-sm text-muted-foreground">No links yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {list.map((link) => {
            const expired = link.expiresAt !== null && new Date(link.expiresAt) <= new Date();
            const dead = link.revokedAt !== null || expired;
            return (
              <li
                key={link.id}
                className="flex flex-wrap items-center gap-3 rounded-xl bg-card p-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-foreground">
                    {link.label ?? 'Untitled link'}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {link.revokedAt
                      ? `Revoked ${formatDate(link.revokedAt)}`
                      : expired
                        ? `Expired ${formatDate(link.expiresAt!)}`
                        : link.expiresAt
                          ? `Expires ${formatDate(link.expiresAt)}`
                          : 'No expiry'}
                    {' · '}
                    {link.viewCount === 0
                      ? 'never opened'
                      : `opened ${link.viewCount} ${link.viewCount === 1 ? 'time' : 'times'}`}
                    {link.lastViewedAt ? `, last ${formatDate(link.lastViewedAt)}` : ''}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {link.sections.length > 0
                      ? `Shows ${link.sections.map(sectionLabel).join(', ').toLowerCase()}`
                      : 'Identity, mileage and health only'}
                  </div>
                </div>

                {dead ? (
                  <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
                    Closed
                  </span>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="hover:bg-destructive-soft hover:text-destructive"
                    // Only the row being revoked spins; the others just wait.
                    loading={revoke.isPending && revoke.variables === link.id}
                    onClick={() => {
                      // Whoever holds the link loses it at once, and it cannot be reissued.
                      const name = link.label ?? 'Untitled link';
                      if (window.confirm(`Revoke "${name}"? It stops working immediately.`)) {
                        revoke.mutate(link.id);
                      }
                    }}
                  >
                    Revoke
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
