'use client';

import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { passportQuery } from '@vehicle-os/api-client/react';
import { api } from '@/lib/api';
import { HealthDial } from '@/components/health-dial';
import { Icon } from '@/components/icons';
import { Button, EmptyState, SectionCard, Stat } from '@/components/ui/primitives';
import { ListSkeleton, Loading, Skeleton } from '@/components/ui/skeleton';
import { formatDate, formatDistance, formatMoney, humanise } from '@/lib/format';

/**
 * The public vehicle passport.
 *
 * Rendered for someone with no account, so it carries none of the app's chrome — no
 * navigation into pages they cannot open, no sign-out for a session they do not have. What
 * they get is the vehicle's history and a line saying where it came from.
 */
export default function PassportPage() {
  const { token } = useParams<{ token: string }>();
  const passport = useQuery(passportQuery(api, token));

  if (passport.isPending) {
    return (
      <Loading label="Loading the vehicle passport">
        {/*
         * What every passport says is drawn straight away — the eyebrow, the stat labels, the
         * section title. Only this vehicle's name, figures and history are placeholders.
         */}
        <div className="mx-auto flex max-w-3xl flex-col gap-6 p-4 sm:p-8">
          <header className="min-w-0">
            <p className="text-label uppercase text-muted-foreground">Vehicle passport</p>
            <Skeleton className="mt-2 h-8 w-64 max-w-full" />
            <Skeleton className="mt-2 h-4 w-40" />
          </header>
          <SectionCard>
            <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
              {['Odometer', 'Owned', 'Services', 'Condition'].map((label) => (
                <Stat key={label} label={label} value={undefined} />
              ))}
            </div>
          </SectionCard>
          <SectionCard title="Identity">
            <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
              {['Make', 'Model', 'Variant', 'VIN / frame no.', 'Owned since'].map((label) => (
                <div key={label} className="min-w-0">
                  <dt className="text-label uppercase text-muted-foreground">{label}</dt>
                  <dd className="mt-1">
                    <Skeleton className="h-5 w-32" />
                  </dd>
                </div>
              ))}
            </dl>
          </SectionCard>
          <ListSkeleton rows={4} />
        </div>
      </Loading>
    );
  }

  if (passport.isError || !passport.data) {
    return (
      <div className="mx-auto max-w-3xl p-4 sm:p-8">
        <EmptyState
          title="This link is not available"
          description="It may have been revoked by the owner, or it may have expired. Ask them for a new one."
        />
      </div>
    );
  }

  const data = passport.data;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 p-4 sm:p-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-label uppercase text-muted-foreground">Vehicle passport</p>
          <h1 className="mt-1 truncate text-2xl font-bold tracking-tight text-foreground">
            {data.vehicle.displayName}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {humanise(data.vehicle.vehicleType)}
            {data.vehicle.year ? ` · ${data.vehicle.year}` : ''}
            {data.vehicle.color ? ` · ${data.vehicle.color}` : ''}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-4">
          {/*
           * The browser's own print dialog, which every platform already routes to
           * "Save as PDF". `data-print="hide"` keeps the button out of the result.
           */}
          <Button data-print="hide" onClick={() => window.print()}>
            <Icon name="document" size={16} />
            Save as PDF
          </Button>
          <HealthDial score={data.health.overall} size={64} />
        </div>
      </header>

      <SectionCard>
        <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
          <Stat
            label="Odometer"
            value={formatDistance(data.vehicle.currentOdometer, data.vehicle.odometerUnit)}
          />
          <Stat
            label="Owned"
            value={
              data.ownership.months === null
                ? '—'
                : `${Math.floor(data.ownership.months / 12)}y ${data.ownership.months % 12}m`
            }
          />
          {/* A section the owner did not share is left out, not shown as zero. */}
          {data.maintenance ? (
            <Stat label="Services" value={String(data.maintenance.recordCount)} />
          ) : null}
          {data.condition ? (
            <Stat
              label="Condition"
              value={
                data.condition.overallScore === null ? '—' : String(data.condition.overallScore)
              }
            />
          ) : null}
        </div>

        <p className="mt-4 text-sm text-muted-foreground">{data.health.summary}</p>
      </SectionCard>

      <SectionCard title="Identity">
        <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
          <Row label="Make" value={data.vehicle.make} />
          <Row label="Model" value={data.vehicle.model} />
          <Row label="Variant" value={data.vehicle.variant} />
          {data.sections.includes('IDENTIFICATION_NUMBER') ? (
            <Row label="VIN / frame no." value={data.vehicle.identificationNumber} />
          ) : null}
          <Row
            label="Owned since"
            value={data.ownership.since ? formatDate(data.ownership.since) : null}
          />
        </dl>
      </SectionCard>

      {data.maintenance && data.maintenance.history.length > 0 ? (
        <SectionCard title="Service history" icon={<Icon name="maintenance" size={20} />}>
          <ol className="flex flex-col gap-2">
            {data.maintenance.history.map((entry, index) => (
              <li
                key={`${entry.performedAt}-${index}`}
                className="flex items-start gap-4 rounded-lg bg-card p-3"
              >
                <time
                  dateTime={entry.performedAt}
                  className="w-24 shrink-0 text-sm tabular-nums text-muted-foreground"
                >
                  {formatDate(entry.performedAt)}
                </time>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-foreground">{entry.title}</div>
                  {entry.provider ? (
                    <div className="truncate text-xs text-muted-foreground">{entry.provider}</div>
                  ) : null}
                </div>
                <div className="shrink-0 text-right">
                  {entry.totalCost ? (
                    <div className="text-sm tabular-nums text-foreground">
                      {formatMoney(entry.totalCost)}
                    </div>
                  ) : null}
                  {entry.odometer !== null ? (
                    <div className="text-xs tabular-nums text-muted-foreground">
                      {formatDistance(entry.odometer, data.vehicle.odometerUnit)}
                    </div>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        </SectionCard>
      ) : null}

      {data.condition && data.condition.categories.length > 0 ? (
        <SectionCard title="Condition" icon={<Icon name="wheel" size={20} />}>
          <ul className="flex flex-col gap-3">
            {data.condition.categories.map((row) => (
              <li key={row.category} className="flex items-center gap-3">
                <span className="w-28 shrink-0 truncate text-sm text-foreground">
                  {humanise(row.category)}
                </span>
                <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                  {row.score === null ? null : (
                    <span
                      className={`block h-full rounded-full ${
                        row.score >= 80
                          ? 'bg-success'
                          : row.score >= 55
                            ? 'bg-warning'
                            : 'bg-destructive'
                      }`}
                      style={{ width: `${Math.max(2, row.score)}%` }}
                    />
                  )}
                </span>
                <span className="w-10 shrink-0 text-right text-sm tabular-nums text-foreground">
                  {row.score ?? '—'}
                </span>
                <time
                  dateTime={row.assessedAt}
                  className="w-24 shrink-0 text-right text-xs text-muted-foreground"
                >
                  {formatDate(row.assessedAt)}
                </time>
              </li>
            ))}
          </ul>
        </SectionCard>
      ) : null}

      {data.documents && data.documents.length > 0 ? (
        <SectionCard
          title="Documents on file"
          description="Held by the owner. The files themselves are not shared through this link."
          icon={<Icon name="document" size={20} />}
        >
          <ul className="flex flex-col gap-2">
            {data.documents.map((document, index) => (
              <li
                key={`${document.title}-${index}`}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-card p-3"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm text-foreground">{document.title}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {humanise(document.documentType)}
                    {document.issuedOn ? ` · issued ${formatDate(document.issuedOn)}` : ''}
                  </div>
                </div>
                {document.expiresOn ? (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    expires {formatDate(document.expiresOn)}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </SectionCard>
      ) : null}

      {data.finances ? (
        <SectionCard title="Money" icon={<Icon name="money" size={20} />}>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
            <Stat label="Purchase" value={formatMoney(data.finances.purchasePrice)} />
            <Stat label="Total invested" value={formatMoney(data.finances.totalInvested)} />
            <Stat label="Current value" value={formatMoney(data.finances.currentValue)} />
          </div>
        </SectionCard>
      ) : null}

      <footer className="pb-8 text-center text-xs text-muted-foreground">
        <p>
          Generated {formatDate(data.generatedAt)} by Garaj. The owner can revoke this link at any
          time.
        </p>
      </footer>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="min-w-0">
      <dt className="text-label uppercase text-muted-foreground">{label}</dt>
      <dd className="mt-1 truncate text-sm text-foreground">{value}</dd>
    </div>
  );
}
