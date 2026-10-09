import type { CSSProperties, ComponentType, ReactNode } from 'react';
import { Bell, Check, Link2, Mail, Minus, Moon, Smartphone } from 'lucide-react';
import { GARAGE_ROLES, ROLE_CAPABILITIES, type Capability } from '@vehicle-os/domain';
import { Icon, type IconName } from '@/components/icons';
import { cn } from '@/lib/utils';

/*
 * The features, each card a small working demonstration of its one idea rather than an icon and a
 * sentence: the reminders arrive, the intervals race, the score shows its working, the roles are
 * read from the real permission table. Every figure is the demo garage's. All motion is CSS
 * (landing.css) and every card has a still state that says the same thing.
 */

const humanise = (word: string) => word.charAt(0) + word.slice(1).toLowerCase();

function Card({
  title,
  text,
  badge,
  wide,
  className,
  children,
}: {
  title: string;
  text: string;
  badge?: string;
  /** Text beside the demonstration rather than under it, from `lg`. */
  wide?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <article
      className={cn(
        'landing-reveal flex flex-col gap-6 rounded-3xl bg-card/50 p-5 sm:p-6',
        wide && 'lg:flex-row-reverse lg:items-center lg:gap-10',
        className,
      )}
    >
      <div className={cn('flex flex-1 flex-col justify-center', wide && 'lg:min-w-0 lg:basis-3/5')}>
        {children}
      </div>
      <div className={cn(wide && 'lg:basis-2/5')}>
        <h3 className="flex flex-wrap items-center gap-2 text-lg font-semibold tracking-tight">
          {title}
          {badge ? (
            <span className="rounded-full bg-muted px-2 py-0.5 font-mono text-[0.6875rem] uppercase tracking-[0.12em] text-muted-foreground">
              {badge}
            </span>
          ) : null}
        </h3>
        <p className="mt-1.5 text-pretty text-sm text-muted-foreground">{text}</p>
      </div>
    </article>
  );
}

/* ── Reminders ──────────────────────────────────────────────────────────────────────────────── */

const NOTIFICATIONS: {
  channel: string;
  icon: ComponentType<{ className?: string }>;
  title: string;
  body: string;
  time: string;
  tone: 'soon' | 'over';
}[] = [
  {
    channel: 'Push',
    icon: Smartphone,
    title: 'Brake fluid change is overdue',
    body: 'Daily Driver · by 3 months',
    time: 'now',
    tone: 'over',
  },
  {
    channel: 'Email',
    icon: Mail,
    title: 'Rotate tyres',
    body: 'Daily Driver · due in 490 km',
    // Due overnight, held for the morning.
    time: '08:00',
    tone: 'soon',
  },
  {
    channel: 'In-app',
    icon: Bell,
    title: 'Clean and lube chain',
    body: 'Weekend Bike · due in 90 km',
    time: 'Mon',
    tone: 'soon',
  },
  {
    channel: 'Push',
    icon: Smartphone,
    title: 'Engine oil and filter is overdue',
    body: 'Project Vehicle · by 2 months',
    time: 'Sun',
    tone: 'over',
  },
];

function Reminders() {
  return (
    <Card
      className="lg:col-span-3"
      title="It tells you first."
      text="Push, email or in-app — never overnight."
    >
      <div
        aria-hidden="true"
        className="relative h-[14.5rem] overflow-hidden [mask-image:linear-gradient(#000_75%,transparent)]"
      >
        {NOTIFICATIONS.map((item, i) => (
          <div
            key={item.title}
            data-slot={i}
            className="notif absolute inset-x-0 top-0 flex h-[4.5rem] items-center gap-3 rounded-2xl bg-card px-3.5"
            style={{ '--slot': i } as CSSProperties}
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-muted">
              <item.icon className="size-[18px]" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                Garaj · {item.channel}
                <span className="ml-auto font-mono normal-case tracking-normal">{item.time}</span>
              </span>
              <span className="block truncate text-sm font-semibold">{item.title}</span>
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span
                  className={cn(
                    'size-1.5 shrink-0 rounded-full',
                    item.tone === 'over' ? 'bg-destructive' : 'bg-warning',
                  )}
                />
                <span className="truncate">{item.body}</span>
              </span>
            </span>
          </div>
        ))}
      </div>
      <div className="mt-1 flex items-center justify-between gap-3 rounded-xl bg-muted/60 px-3.5 py-2.5 text-xs">
        <span className="flex items-center gap-2 font-semibold">
          <Moon className="size-4 text-muted-foreground" aria-hidden="true" />
          Quiet hours
        </span>
        <span className="font-mono tabular-nums text-muted-foreground">21:00 – 08:00</span>
      </div>
    </Card>
  );
}

/* ── Whichever comes first ──────────────────────────────────────────────────────────────────── */

const TRACKS: { icon: IconName; label: string; every: string; to: number; wins?: boolean }[] = [
  { icon: 'odometer', label: 'Distance', every: '15,000 km', to: 1, wins: true },
  { icon: 'calendar', label: 'Time', every: '12 months', to: 0.82 },
  { icon: 'stopwatch', label: 'Engine hours', every: '250 h', to: 0.57 },
];

function Intervals() {
  return (
    <Card
      className="lg:col-span-3"
      title="Whichever comes first."
      text="Distance, time or engine hours."
    >
      <div aria-hidden="true" className="rounded-2xl bg-card p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <p className="flex items-center gap-2.5 text-sm font-semibold">
            <Icon name="maintenance" size={18} className="text-muted-foreground" />
            Engine oil &amp; filter
          </p>
          <span className="race-due-chip rounded-full bg-warning-soft px-2.5 py-0.5 text-xs font-semibold text-warning">
            Due
          </span>
        </div>
        <div className="mt-5 flex flex-col gap-4">
          {TRACKS.map((track) => (
            <div key={track.label}>
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="flex items-center gap-1.5 font-semibold text-muted-foreground">
                  <Icon name={track.icon} size={16} />
                  {track.label}
                </span>
                <span className="font-mono tabular-nums text-muted-foreground">
                  every {track.every}
                </span>
              </div>
              <div className="mt-2 h-2 rounded-full bg-muted">
                <div
                  className="race-bar h-full bg-foreground"
                  style={{ '--to': track.to } as CSSProperties}
                >
                  {track.wins ? <div className="race-due size-full bg-warning" /> : null}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

/* ── Health ─────────────────────────────────────────────────────────────────────────────────── */

function Health() {
  return (
    <Card
      className="lg:col-span-2"
      title="A score that shows its working."
      text="Every lost point, with its reason."
    >
      <div className="flex items-center gap-5 rounded-2xl bg-card p-4 sm:p-5">
        <div className="relative size-24 shrink-0">
          <svg viewBox="0 0 100 100" className="size-full -rotate-90" aria-hidden="true">
            <circle cx="50" cy="50" r="42" fill="none" strokeWidth="8" className="stroke-muted" />
            <circle
              cx="50"
              cy="50"
              r="42"
              fill="none"
              strokeWidth="8"
              strokeLinecap="round"
              pathLength={100}
              strokeDasharray="100"
              strokeDashoffset={25}
              className="scrub-ring stroke-warning"
            />
          </svg>
          <span className="absolute inset-0 grid place-items-center font-mono text-2xl font-semibold tabular-nums text-warning">
            75
          </span>
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">Daily Driver</p>
          <dl className="mt-2 flex gap-4">
            {(
              [
                ['Maintenance', '67'],
                ['Condition', '83'],
              ] as const
            ).map(([label, value]) => (
              <div key={label}>
                <dt className="text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  {label}
                </dt>
                <dd className="font-mono text-lg font-semibold tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
      <ul className="mt-2 flex flex-col gap-1.5 text-xs">
        {(
          [
            ['Brake fluid change — overdue', '−25'],
            ['Brakes — lowest of five, at 70', '−17'],
          ] as const
        ).map(([reason, points], i) => (
          <li
            key={reason}
            className="scrub-in flex items-center justify-between gap-3 rounded-xl bg-muted/60 px-3.5 py-2.5"
            style={{ '--i': i } as CSSProperties}
          >
            <span className="truncate">{reason}</span>
            <span className="font-mono font-semibold tabular-nums text-destructive">{points}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/* ── Value ──────────────────────────────────────────────────────────────────────────────────── */

function Value() {
  return (
    <Card className="lg:col-span-2" title="Up or down, you'll know." text="Bought for, worth now.">
      <div className="rounded-2xl bg-card p-4 sm:p-5">
        <div className="flex items-baseline justify-between gap-3">
          <p className="font-mono text-2xl font-semibold tabular-nums text-success">+$3,300</p>
          <span className="rounded-full bg-success-soft px-2 py-0.5 font-mono text-xs font-semibold tabular-nums text-success">
            ↗ 78.6%
          </span>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">Project Vehicle, since it was bought</p>
        <svg
          viewBox="0 0 200 60"
          className="mt-4 h-auto w-full overflow-visible"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id="value-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" style={{ stopColor: 'var(--color-success)', stopOpacity: 0.22 }} />
              <stop offset="1" style={{ stopColor: 'var(--color-success)', stopOpacity: 0 }} />
            </linearGradient>
          </defs>
          <path d="M 6 50 L 194 10 L 194 60 L 6 60 Z" fill="url(#value-fill)" />
          <path
            d="M 6 50 L 194 10"
            fill="none"
            strokeWidth="2"
            strokeLinecap="round"
            pathLength={1}
            strokeDasharray="1"
            className="scrub-line stroke-success"
          />
          <circle
            cx="6"
            cy="50"
            r="4"
            strokeWidth="2"
            className="fill-card stroke-muted-foreground"
          />
          <circle cx="194" cy="10" r="4" className="fill-success" />
        </svg>
        <div className="mt-2 flex justify-between gap-3 font-mono text-[0.6875rem] tabular-nums text-muted-foreground">
          <span>$4,200 · bought</span>
          <span>$7,500 · Aug 2026</span>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between gap-3 rounded-xl bg-muted/60 px-3.5 py-2.5 text-xs">
        <span className="font-semibold">Daily Driver</span>
        <span className="flex items-center gap-2">
          <span className="font-mono tabular-nums">$14,200</span>
          <span className="rounded-full bg-destructive-soft px-2 py-0.5 font-mono font-semibold tabular-nums text-destructive">
            ↘ 18.9%
          </span>
        </span>
      </div>
    </Card>
  );
}

/* ── Roles ──────────────────────────────────────────────────────────────────────────────────── */

/** One capability stands for each column; the dots are read from the real permission table. */
const POWERS: { label: string; capability: Capability }[] = [
  { label: 'Read', capability: 'vehicle.read' },
  { label: 'Log', capability: 'event.write' },
  { label: 'Edit', capability: 'vehicle.write' },
  { label: 'Invite', capability: 'garage.manage_members' },
  { label: 'Billing', capability: 'billing.manage' },
];

function Roles() {
  return (
    <Card
      className="lg:col-span-2"
      title="Share the garage, not the keys."
      text={`${GARAGE_ROLES.length} roles, owner to viewer.`}
    >
      <div className="rounded-2xl bg-card p-4 sm:p-5">
        <table className="w-full text-xs">
          <caption className="sr-only">What each role in a garage can do</caption>
          <thead>
            <tr>
              <th scope="col" className="sr-only">
                Role
              </th>
              {POWERS.map((power) => (
                <th
                  key={power.label}
                  scope="col"
                  className="pb-2 text-center font-mono text-[0.625rem] font-semibold uppercase tracking-[0.06em] text-muted-foreground"
                >
                  {power.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {GARAGE_ROLES.map((role, row) => (
              <tr key={role}>
                <th scope="row" className="py-1.5 pr-2 text-left font-semibold">
                  {humanise(role)}
                </th>
                {POWERS.map((power) => {
                  const allowed = ROLE_CAPABILITIES[role].has(power.capability);
                  return (
                    <td key={power.label} className="text-center">
                      <span
                        aria-hidden="true"
                        className={cn(
                          'scrub-dot inline-block size-2.5 rounded-full align-middle',
                          allowed ? 'bg-foreground' : 'ring-1 ring-inset ring-border-strong',
                        )}
                        style={{ '--i': row } as CSSProperties}
                      />
                      <span className="sr-only">{allowed ? 'Yes' : 'No'}</span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/* ── Passport ───────────────────────────────────────────────────────────────────────────────── */

const SECTIONS: { label: string; shared: boolean }[] = [
  { label: 'Service history', shared: true },
  { label: 'Service costs', shared: true },
  { label: 'Condition', shared: true },
  { label: 'Documents', shared: false },
  { label: 'Finances', shared: false },
  { label: 'VIN', shared: false },
];

function Passport() {
  return (
    <Card
      wide
      className="md:col-span-1 lg:col-span-4"
      badge="Plus"
      title="Hand over the history."
      text="One link. Your sections. Revocable."
    >
      <div aria-hidden="true" className="stamp-shadow mx-auto max-w-md">
        <div className="stamp-edge bg-card">
          <div className="relative p-5">
            <p className="text-label uppercase text-muted-foreground">Vehicle passport</p>
            <p className="mt-2 text-xl font-semibold tracking-tight">1991 Mazda MX-5</p>
            <p className="mt-1 font-mono text-xs tabular-nums text-muted-foreground">
              186,020 km · health 79
            </p>
            <ul className="mt-4 flex flex-wrap gap-1.5">
              {SECTIONS.map((section) => (
                <li
                  key={section.label}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-full py-1 pl-2 pr-2.5 text-xs font-semibold',
                    section.shared
                      ? 'bg-primary-soft text-foreground'
                      : 'bg-muted/60 text-muted-foreground',
                  )}
                >
                  {section.shared ? <Check className="size-3.5" /> : <Minus className="size-3.5" />}
                  {section.label}
                </li>
              ))}
            </ul>
            <div className="mt-4 flex items-center gap-2 rounded-xl bg-muted/60 p-1.5 pl-3">
              <Link2 className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate font-mono text-xs">garaj.app/p/k7Qz…</span>
              <span className="rounded-lg bg-destructive-soft px-2.5 py-1.5 text-xs font-semibold text-destructive">
                Revoke
              </span>
            </div>
            <span className="stamp-thump absolute right-5 top-5 rotate-[-10deg] rounded-md px-2 py-0.5 font-mono text-xs font-bold uppercase tracking-[0.22em] text-muted-foreground ring-2 ring-current">
              Shared
            </span>
          </div>
        </div>
      </div>
    </Card>
  );
}

/* ── Your data ──────────────────────────────────────────────────────────────────────────────── */

function YourData() {
  return (
    <Card
      className="group md:col-span-2 lg:col-span-2"
      title="Yours to take."
      text="CSV in. CSV, JSON and PDF out."
    >
      <div aria-hidden="true" className="file-fan flex items-end justify-center py-3">
        {['CSV', 'JSON', 'PDF'].map((type, i) => (
          <span key={type} className={cn('stamp-shadow -mx-1.5', i === 1 && 'z-10 -mb-1.5')}>
            <span className="relative flex h-28 w-[5.5rem] flex-col justify-between rounded-xl bg-card p-2.5 [clip-path:polygon(0_0,calc(100%-1.25rem)_0,100%_1.25rem,100%_100%,0_100%)]">
              <span className="absolute right-0 top-0 size-5 rounded-bl-md bg-border-strong" />
              <span className="flex flex-col gap-1 pt-1">
                <span className="h-1 w-8 rounded-full bg-muted" />
                <span className="h-1 w-11 rounded-full bg-muted" />
                <span className="h-1 w-6 rounded-full bg-muted" />
              </span>
              <span className="font-mono text-sm font-semibold">{type}</span>
            </span>
          </span>
        ))}
      </div>
    </Card>
  );
}

export function Features() {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-6">
      <Reminders />
      <Intervals />
      <Health />
      <Value />
      <Roles />
      <Passport />
      <YourData />
    </div>
  );
}
