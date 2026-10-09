import Image, { type StaticImageData } from 'next/image';
import type { CSSProperties } from 'react';
import { ArrowRight, Check, Plus, Power } from 'lucide-react';
import {
  ENTITLEMENT_COPY,
  GARAGE_ROLES,
  NOTIFICATION_CHANNELS,
  PLAN_LIMITS,
  PLAN_NAMES,
  VEHICLE_TYPES,
} from '@vehicle-os/domain';
import { buttonClass } from '@/components/ui/button-class';
import { cn } from '@/lib/utils';
import logoMark from '@/public/Logo.png';
import logoText from '@/public/logo-text.png';
import logoTextLight from '@/public/logo-text-light.png';
import { AskDemo } from '../components/ask-demo';
import { Features } from '../components/features';
import { Logbook } from '../components/logbook';
import { Story, type StoryStep } from '../components/story';
import { ThemeToggle } from '../components/theme-toggle';
import heroVehicleDark from '../assets/hero-vehicle-dark.webp';
import heroVehicleLight from '../assets/hero-vehicle-light.webp';
import heroPhoneDark from '../assets/hero-phone-dark.webp';
import heroPhoneLight from '../assets/hero-phone-light.webp';
import storyDueDark from '../assets/story-due-dark.webp';
import storyDueLight from '../assets/story-due-light.webp';
import storyMoneyDark from '../assets/story-money-dark.webp';
import storyMoneyLight from '../assets/story-money-light.webp';
import storyWorthDark from '../assets/story-worth-dark.webp';
import storyWorthLight from '../assets/story-worth-light.webp';

/*
 * garaj.app's front door — a separate app from the product at NEXT_PUBLIC_APP_URL.
 *
 * Shown, not told: the product itself in the hero, a heap of receipts that files itself into the
 * logbook, one window answering three questions, features that demonstrate themselves, each plan
 * drawn as the floor it buys, and a push-start button to end on. Each section opens on a numbered
 * bay line, the way a garage floor is painted. Words are kept to headings and figures.
 *
 * Every screenshot is a real capture of the current app (src/assets) — the seeded demo account's
 * garage, in both themes — and every reading on the page is that garage's: the Daily Driver, the
 * Weekend Bike, the Gravel Bike and the Project Vehicle. Every fact about the product (types, limits,
 * roles, channels, entitlements) comes from `@vehicle-os/domain` — the page cannot promise what the
 * app does not do.
 */

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3003';
const DOCS_URL = process.env.NEXT_PUBLIC_DOCS_URL ?? 'http://localhost:3004';
const SIGN_UP = `${APP_URL}/sign-up`;
const SIGN_IN = `${APP_URL}/sign-in`;

const pad = (n: number) => String(n).padStart(2, '0');
const free = PLAN_LIMITS.FREE;

const NAV = [
  { href: '#how', label: 'How it works' },
  { href: '#features', label: 'Features' },
  { href: '#pricing', label: 'Pricing' },
  { href: '#faq', label: 'FAQ' },
];

/** Every type the drum rolls through before it rests on "vehicle". */
const DRUM_WORDS = [
  'car',
  'motorcycle',
  'scooter',
  'bicycle',
  'boat',
  'ATV',
  'trailer',
  'van',
  'RV',
];

/** The product in four figures, all from the domain. */
const FIGURES = [
  [pad(VEHICLE_TYPES.length), 'Vehicle types'],
  [pad(NOTIFICATION_CHANNELS.length), 'Ways to remind'],
  [pad(GARAGE_ROLES.length), 'Roles to share'],
  [pad(free.vehicles), 'Vehicles, free'],
] as const;

/** The Daily Driver's last 12 months, as its Stats tab reads them. */
const READINGS = [
  ['Per km', '$0.18'],
  ['12 months', '$1,041'],
  ['Driven', '5,910 km'],
] as const;

/* The spotlight windows are percentages of the frame, measured from the captures' own layout. */
const STEPS: StoryStep[] = [
  {
    question: 'What’s due?',
    figure: '3 months',
    caption: 'past the brake fluid change',
    tone: 'over',
    url: 'garaj.app',
    focus: { x: 13.1, y: 42.5, w: 49.5, h: 16.7, label: 'Needs you' },
  },
  {
    question: 'Where did the money go?',
    figure: '$1,041',
    caption: 'in 12 months',
    url: 'garaj.app/vehicles/01a0a62f…/statistics',
    focus: { x: 12.9, y: 61.3, w: 74.6, h: 29.5, label: 'Fuel · services' },
  },
  {
    question: 'What’s it worth?',
    figure: '+78.6%',
    caption: 'since it was bought',
    tone: 'good',
    url: 'garaj.app/vehicles/01a0a632…/statistics',
    focus: { x: 12.7, y: 73.6, w: 74.6, h: 11.4, label: '+$3,300' },
  },
];

/** One screenshot per theme: the page shows whichever matches the reader's. */
function Shot({
  light: lightSrc,
  dark,
  alt,
  sizes,
  priority,
  className,
}: {
  light: StaticImageData;
  dark: StaticImageData;
  alt: string;
  sizes: string;
  priority?: boolean;
  className?: string;
}) {
  return (
    <>
      <Image
        src={lightSrc}
        alt={alt}
        sizes={sizes}
        priority={priority}
        placeholder="blur"
        className={cn('dark:hidden', className)}
      />
      <Image
        src={dark}
        alt={alt}
        sizes={sizes}
        priority={priority}
        placeholder="blur"
        className={cn('hidden dark:block', className)}
      />
    </>
  );
}

const STAGE = '(min-width: 1024px) 700px, 92vw';
const FRAME = 'h-full w-full object-cover object-top';

/* The story's three slides, rendered here so the client component never ships next/image's inputs. */
const SLIDES = [
  <Shot
    key="due"
    light={storyDueLight}
    dark={storyDueDark}
    sizes={STAGE}
    className={FRAME}
    alt="Garaj's home screen: ten things need you, led by the Daily Driver's brake fluid change, three months overdue."
  />,
  <Shot
    key="money"
    light={storyMoneyLight}
    dark={storyMoneyDark}
    sizes={STAGE}
    className={FRAME}
    alt="Where the Daily Driver's money went in the last 12 months: $1,041 — $673 on services and $368 on fuel."
  />,
  <Shot
    key="worth"
    light={storyWorthLight}
    dark={storyWorthDark}
    sizes={STAGE}
    className={FRAME}
    alt="A 1991 Mazda MX-5 bought for $4,200 and appraised at $7,500: up $3,300, or 78.6%."
  />,
];

/** A sample of the MCP server's tools, as an MCP client lists them. */
const TOOLS = [
  'list_vehicles',
  'get_due_work',
  'log_expense',
  'get_costs',
  'schedule_maintenance',
  'complete_maintenance',
  'get_valuation',
  'list_expiring_documents',
  'get_mileage_report',
  'get_fuel_prices',
  'create_task',
  'search',
];

const PLANS = [
  {
    tier: 'FREE',
    line: 'Tracks and reminds',
    includes: ['Logbook and reminders', 'Costs and documents', 'Ask Garaj and export'],
  },
  {
    tier: 'PLUS',
    line: 'Hands it over',
    includes: ['Everything in Free', ENTITLEMENT_COPY['passport.share'].name],
  },
  {
    tier: 'BUSINESS',
    line: 'Runs a fleet',
    includes: [
      'Everything in Plus',
      ENTITLEMENT_COPY['income.track'].name,
      ENTITLEMENT_COPY['mileage.report'].name,
      ENTITLEMENT_COPY['driver.assign'].name,
    ],
  },
] as const;

const FAQ: { question: string; answer: string }[] = [
  {
    question: 'Is it really free?',
    answer: `Yes — ${free.vehicles} vehicles, ${free.garages} garage, ${free.members} people. The logbook, reminders and export are free on every plan.`,
  },
  {
    question: 'How do reminders reach me?',
    answer: 'In the app, by email and by push. Never between 21:00 and 08:00.',
  },
  {
    question: 'Can I share a vehicle?',
    answer: `Invite people to a garage in one of ${GARAGE_ROLES.length} roles, or share one vehicle’s history as a link you can revoke (Plus).`,
  },
  {
    question: 'Can I get my data out?',
    answer: 'Any time, on any plan: CSV, JSON or a PDF report.',
  },
  {
    question: 'Does it work with my AI?',
    answer: 'Ask Garaj in plain words, or connect any MCP client with a personal key.',
  },
];

const JSON_LD = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'Garaj',
  url: SITE_URL,
  applicationCategory: 'LifestyleApplication',
  operatingSystem: 'Web',
  description:
    'Services, costs, paperwork and value for every car, bike and boat you own, in one garage you can share.',
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
};

/** A section's opening: its number and name on a painted bay line. The heading carries the meaning. */
function BayLine({ n, label }: { n: string; label: string }) {
  return (
    <div
      aria-hidden="true"
      className="flex items-center gap-4 font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground"
    >
      <span className="text-foreground">{n}</span>
      <span className="bay-line flex-1" />
      <span>{label}</span>
    </div>
  );
}

function Heading({
  id,
  title,
  quiet,
  className,
}: {
  id: string;
  title: string;
  quiet?: string;
  className?: string;
}) {
  return (
    <h2
      id={id}
      className={cn(
        'landing-reveal text-balance text-[clamp(2.25rem,5.2vw,4rem)] font-bold leading-[1.02] tracking-[-0.03em]',
        className,
      )}
    >
      {title}
      {quiet ? (
        <>
          <br />
          <span className="text-muted-foreground">{quiet}</span>
        </>
      ) : null}
    </h2>
  );
}

/** The plan drawn as the floor it buys: numbered bays, or for a fleet, a lot. */
function Floor({ count }: { count: number }) {
  const lot = count > 12;
  return (
    <div
      aria-hidden="true"
      className="mt-5 flex h-[6.5rem] items-center rounded-2xl bg-background p-3"
    >
      <div
        className={cn('grid w-full', lot && 'gap-1')}
        style={
          {
            gridTemplateColumns: `repeat(${lot ? 20 : count}, minmax(0, 1fr))`,
            '--n': count,
            '--step': lot ? '7ms' : '45ms',
          } as CSSProperties
        }
      >
        {Array.from({ length: count }, (_, i) =>
          lot ? (
            <span
              key={i}
              className="bay aspect-square rounded-[3px] bg-muted"
              style={{ '--i': i } as CSSProperties}
            />
          ) : (
            <span
              key={i}
              className="bay flex h-20 items-end justify-center border-l-2 border-dashed border-border-strong pb-1.5 font-mono text-[0.625rem] text-muted-foreground last:border-r-2"
              style={{ '--i': i } as CSSProperties}
            >
              {pad(i + 1)}
            </span>
          ),
        )}
      </div>
    </div>
  );
}

/** A tach round the start button: 41 ticks over 270°, the last seven in the redline. */
const TACH = Array.from({ length: 41 }, (_, i) => {
  const rad = ((135 + (270 * i) / 40) * Math.PI) / 180;
  const major = i % 5 === 0;
  const at = (r: number) => [
    (128 + r * Math.cos(rad)).toFixed(2),
    (128 + r * Math.sin(rad)).toFixed(2),
  ];
  const [x1, y1] = at(major ? 110 : 115);
  const [x2, y2] = at(123);
  return { x1, y1, x2, y2, major, redline: i >= 34 };
});

export default function LandingPage() {
  return (
    <div className="min-h-dvh overflow-x-clip bg-background text-foreground">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
      />

      <header className="header-scroll sticky top-0 z-40">
        <div className="relative mx-auto flex h-16 max-w-6xl items-center gap-1 px-4 sm:px-6">
          <a href="/" aria-label="Garaj" className="mr-auto flex shrink-0 items-center rounded-xl">
            <Image src={logoText} alt="" priority className="h-7 w-auto dark:hidden" />
            <Image src={logoTextLight} alt="" priority className="hidden h-7 w-auto dark:block" />
          </a>
          <nav
            aria-label="Sections"
            className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-0.5 lg:flex"
          >
            {NAV.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="rounded-full px-3.5 py-2 text-sm font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                {item.label}
              </a>
            ))}
          </nav>
          {/* How far down the page you have driven. */}
          <span
            aria-hidden="true"
            className="trip mr-1 items-baseline gap-1.5 rounded-full px-3 py-1.5 font-mono text-xs text-muted-foreground"
          >
            <span className="text-[0.625rem] tracking-[0.16em]">TRIP</span>
            <span className="trip-reading font-semibold tabular-nums text-foreground" />
            km
          </span>
          <ThemeToggle />
          <a href={SIGN_IN} className={buttonClass('ghost', 'md', 'hidden sm:inline-flex')}>
            Sign in
          </a>
          <a href={SIGN_UP} className={buttonClass('primary', 'md')}>
            Start free
          </a>
        </div>
      </header>

      <main>
        {/* ── Hero ─────────────────────────────────────────────────────────────── */}
        <section aria-labelledby="hero-title" className="relative isolate">
          <div
            aria-hidden="true"
            className="landing-ground absolute inset-x-0 top-0 -z-10 h-[44rem]"
          />
          <div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-12 px-4 pt-10 sm:px-6 sm:pt-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.12fr)] lg:gap-10 lg:pt-12">
            <div className="animate-rise">
              <p className="inline-flex items-center gap-2.5 rounded-full bg-card/60 py-1.5 pl-3 pr-3.5 text-xs font-semibold">
                <span className="relative grid size-2 place-items-center" aria-hidden="true">
                  <span className="status-ping absolute inset-0 rounded-full bg-success" />
                  <span className="size-2 rounded-full bg-success" />
                </span>
                Free for {free.vehicles} vehicles · No card
              </p>
              {/*
               * Three lines: the drum on a line of its own, as wide as its longest word, so a short
               * word leaves its spare width after it where nobody sees it.
               */}
              <h1
                id="hero-title"
                className="mt-6 text-[clamp(2.5rem,4.6vw,4rem)] font-bold leading-[0.98] tracking-[-0.04em]"
              >
                Every
                <br />
                <span className="drum">
                  <span className="drum-home">vehicle.</span>
                  {DRUM_WORDS.map((word, i) => (
                    <span
                      key={word}
                      data-word={`${word}.`}
                      aria-hidden="true"
                      style={{ '--i': i + 1 } as CSSProperties}
                    />
                  ))}
                </span>
                <br />
                <span className="text-muted-foreground">Its whole story.</span>
              </h1>
              <p className="mt-6 max-w-sm text-pretty text-lg text-muted-foreground">
                Services, costs and reminders for everything you drive.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <a href={SIGN_UP} className={buttonClass('primary', 'lg')}>
                  Start free
                  <ArrowRight className="size-4" aria-hidden="true" />
                </a>
                <a href="#how" className={buttonClass('ghost', 'lg')}>
                  See how it works
                </a>
              </div>
            </div>

            {/*
             * The product as it is today: a vehicle's page in the web app, and the same page on a
             * phone — real captures, in the reader's theme. Turned a little toward the headline; it
             * faces you under the pointer.
             */}
            <div className="hero-stage relative pb-14 sm:pb-20">
              <div className="rounded-[1.5rem] bg-card p-1.5 shadow-float ring-1 ring-border sm:p-2">
                <div className="flex items-center gap-3 px-2.5 pb-2 pt-1" aria-hidden="true">
                  <span className="flex gap-1.5">
                    <span className="size-2.5 rounded-full bg-border-strong" />
                    <span className="size-2.5 rounded-full bg-border-strong" />
                    <span className="size-2.5 rounded-full bg-border-strong" />
                  </span>
                  <span className="mx-auto truncate rounded-full bg-muted px-3 py-0.5 font-mono text-[0.6875rem] text-muted-foreground">
                    garaj.app/vehicles/01a0a62f…
                  </span>
                  <span className="w-10" />
                </div>
                <div className="overflow-hidden rounded-[1.1rem] bg-background">
                  <Shot
                    light={heroVehicleLight}
                    dark={heroVehicleDark}
                    priority
                    sizes="(min-width: 1024px) 620px, 94vw"
                    className="h-auto w-full"
                    alt="A vehicle's page in Garaj: a 2019 Toyota, 92,310 km on its odometer, its brake fluid change three months overdue, the tyre rotation due in 490 km and the oil in seven months."
                  />
                </div>
              </div>
              <div
                className="hero-drift absolute -right-3 bottom-0 z-10 w-[29%] max-w-[12.5rem] sm:-right-6"
                style={{ '--drift': '-40px' } as CSSProperties}
              >
                <div className="hero-pop" style={{ '--delay': '650ms' } as CSSProperties}>
                  <div className="rounded-[clamp(1.1rem,2.6vw,2.2rem)] bg-card p-[clamp(0.3rem,0.6vw,0.5rem)] shadow-float ring-1 ring-border">
                    <div className="overflow-hidden rounded-[clamp(0.85rem,2.1vw,1.75rem)]">
                      <Shot
                        light={heroPhoneLight}
                        dark={heroPhoneDark}
                        priority
                        sizes="(min-width: 1024px) 200px, 29vw"
                        className="h-auto w-full"
                        alt="The same page on a phone."
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── The product in four figures ──────────────────────────────────────── */}
        <section
          aria-label="Garaj in figures"
          className="mx-auto mt-12 max-w-6xl px-4 sm:mt-16 sm:px-6"
        >
          <dl className="landing-reveal grid grid-cols-2 gap-px overflow-hidden rounded-3xl bg-border/60 md:grid-cols-4">
            {FIGURES.map(([value, label]) => (
              <div key={label} className="bg-card px-5 py-5 sm:px-7 sm:py-7">
                <dt className="text-label uppercase text-muted-foreground">{label}</dt>
                <dd className="mt-2 font-mono text-4xl font-semibold tabular-nums tracking-tight sm:text-5xl">
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        {/* ── 01 · The logbook ────────────────────────────────────────────────── */}
        <section
          id="how"
          aria-labelledby="logbook-title"
          className="mx-auto mt-28 max-w-6xl scroll-mt-20 px-4 sm:mt-36 sm:px-6"
        >
          <BayLine n="01" label="The logbook" />
          <div className="mt-10 grid grid-cols-1 gap-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
            <div className="flex flex-col gap-8 lg:sticky lg:top-28 lg:self-start">
              <Heading id="logbook-title" title="Receipts fade." quiet="The logbook doesn’t." />
              <dl className="landing-reveal grid grid-cols-3 gap-px overflow-hidden rounded-2xl bg-border/60">
                {READINGS.map(([label, value]) => (
                  <div key={label} className="bg-card px-3 py-3 sm:px-4">
                    <dt className="text-label uppercase text-muted-foreground">{label}</dt>
                    <dd className="mt-1 font-mono text-base font-semibold tabular-nums sm:text-lg">
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
            <Logbook />
          </div>
        </section>

        {/* ── 02 · Answers ───────────────────────────────────────────────────── */}
        <section
          id="story"
          aria-label="What Garaj answers"
          className="mx-auto mt-28 max-w-6xl scroll-mt-20 px-4 sm:mt-36 sm:px-6"
        >
          <BayLine n="02" label="Answers" />
          <Story steps={STEPS} slides={SLIDES} />
        </section>

        {/* ── 03 · Features ──────────────────────────────────────────────────── */}
        <section
          id="features"
          aria-labelledby="features-title"
          className="mx-auto mt-20 max-w-6xl scroll-mt-20 px-4 sm:mt-28 sm:px-6"
        >
          <BayLine n="03" label="Features" />
          <Heading
            id="features-title"
            title="Everything it needs."
            quiet="Nothing it doesn’t."
            className="mt-10"
          />
          <div className="mt-12">
            <Features />
          </div>
        </section>

        {/* ── 04 · Ask ───────────────────────────────────────────────────────── */}
        <section
          id="ask"
          aria-labelledby="ask-title"
          className="mx-auto mt-28 max-w-6xl scroll-mt-20 px-4 sm:mt-36 sm:px-6"
        >
          <BayLine n="04" label="Ask Garaj" />
          <Heading id="ask-title" title="Or just ask." className="mt-10" />
          <div className="mt-12 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
            <div className="landing-reveal flex flex-col gap-3 rounded-3xl bg-card/50 p-3 sm:p-4">
              <AskDemo />
              <p className="px-1 text-xs text-muted-foreground">
                Answered from the demo garage above.
              </p>
            </div>

            <article className="landing-reveal flex min-w-0 flex-col rounded-3xl bg-card/50 p-5 sm:p-6">
              <p className="text-label uppercase text-muted-foreground">MCP server</p>
              <h3 className="mt-2 text-2xl font-semibold tracking-tight">Bring your own AI.</h3>
              <pre className="scrollbar-slim mt-5 overflow-x-auto rounded-2xl bg-background p-4 font-mono text-xs leading-relaxed">
                <code>
                  <span className="text-muted-foreground">POST</span> /api/v1/mcp{'\n'}
                  <span className="text-muted-foreground">Authorization:</span> Bearer gk_••••••••
                  {'\n\n'}
                  {'{ '}
                  <span className="text-muted-foreground">&quot;method&quot;:</span>{' '}
                  &quot;tools/call&quot;,{'\n  '}
                  <span className="text-muted-foreground">&quot;params&quot;:</span>
                  {' { '}
                  <span className="text-muted-foreground">&quot;name&quot;:</span>{' '}
                  &quot;get_due_work&quot;
                  {' } }'}
                </code>
              </pre>
              <div aria-hidden="true" className="marquee mt-5 overflow-hidden">
                <div className="marquee-track flex w-max gap-2">
                  {[...TOOLS, ...TOOLS].map((tool, i) => (
                    <span
                      key={i}
                      className="rounded-full bg-muted px-2.5 py-1 font-mono text-[0.6875rem] text-muted-foreground"
                    >
                      {tool}
                    </span>
                  ))}
                </div>
              </div>
              <a
                href={`${DOCS_URL}/mcp`}
                className="mt-auto inline-flex items-center gap-1.5 self-start pt-6 text-sm font-semibold underline-offset-4 hover:underline"
              >
                Read the docs
                <ArrowRight className="size-4" aria-hidden="true" />
              </a>
            </article>
          </div>
        </section>

        {/* ── 05 · Plans ─────────────────────────────────────────────────────── */}
        <section
          id="pricing"
          aria-labelledby="plans-title"
          className="mx-auto mt-28 max-w-6xl scroll-mt-20 px-4 sm:mt-36 sm:px-6"
        >
          <BayLine n="05" label="Pricing" />
          <Heading id="plans-title" title="Pick a garage size." className="mt-10" />
          <div className="mt-12 grid grid-cols-1 gap-4 md:grid-cols-3">
            {PLANS.map((plan) => {
              const limits = PLAN_LIMITS[plan.tier];
              return (
                <article
                  key={plan.tier}
                  className="landing-reveal group flex flex-col rounded-3xl bg-card/50 p-5 sm:p-6"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <h3 className="text-xl font-semibold tracking-tight">
                      {PLAN_NAMES[plan.tier]}
                    </h3>
                    <p className="font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-muted-foreground">
                      {plan.line}
                    </p>
                  </div>
                  <Floor count={limits.vehicles} />
                  <dl className="mt-3 grid grid-cols-3 gap-px overflow-hidden rounded-2xl bg-border/60">
                    {(
                      [
                        ['Vehicles', limits.vehicles],
                        ['Garages', limits.garages],
                        ['People', limits.members],
                      ] as const
                    ).map(([label, value]) => (
                      <div key={label} className="bg-card p-3">
                        <dt className="text-label uppercase text-muted-foreground">{label}</dt>
                        <dd className="mt-1 font-mono text-2xl font-semibold tabular-nums">
                          {pad(value)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  <ul className="mt-5 flex flex-col gap-2 text-sm">
                    {plan.includes.map((item) => (
                      <li key={item} className="flex items-start gap-2.5">
                        <Check
                          className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                          aria-hidden="true"
                        />
                        {item}
                      </li>
                    ))}
                  </ul>
                </article>
              );
            })}
          </div>
          <div className="landing-reveal mt-6 flex flex-wrap items-center justify-between gap-4 rounded-3xl bg-card/50 p-5 sm:p-6">
            <p className="text-sm font-semibold">Every plan starts free.</p>
            <a href={SIGN_UP} className={buttonClass('primary', 'md')}>
              Start free
              <ArrowRight className="size-4" aria-hidden="true" />
            </a>
          </div>
        </section>

        {/* ── 06 · FAQ ───────────────────────────────────────────────────────── */}
        <section
          id="faq"
          aria-labelledby="faq-title"
          className="mx-auto mt-28 max-w-6xl scroll-mt-20 px-4 sm:mt-36 sm:px-6"
        >
          <BayLine n="06" label="FAQ" />
          <div className="mt-10 grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)] lg:gap-16">
            <Heading id="faq-title" title="Questions," quiet="answered." />
            <div className="faq landing-reveal flex flex-col gap-2">
              {FAQ.map((item) => (
                <details
                  key={item.question}
                  className="faq-item rounded-2xl bg-card/50 transition-colors duration-300 open:bg-card"
                >
                  <summary className="flex cursor-pointer items-center justify-between gap-4 rounded-2xl px-5 py-4 text-md font-semibold">
                    {item.question}
                    <span className="faq-plus grid size-8 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
                      <Plus className="size-4" aria-hidden="true" />
                    </span>
                  </summary>
                  <p className="text-pretty px-5 pb-5 text-sm leading-relaxed text-muted-foreground">
                    {item.answer}
                  </p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* ── Push to start ──────────────────────────────────────────────────── */}
        <section
          aria-labelledby="start-title"
          className="mx-auto mt-32 flex max-w-6xl flex-col items-center px-4 text-center sm:mt-44 sm:px-6"
        >
          <h2
            id="start-title"
            className="landing-reveal text-balance text-[clamp(2.75rem,7vw,5.5rem)] font-bold leading-[0.98] tracking-[-0.035em]"
          >
            Ready when you are.
          </h2>
          <a
            href={SIGN_UP}
            aria-label="Start your garage — free"
            className="start group relative mt-12 grid size-64 place-items-center rounded-full"
          >
            <svg viewBox="0 0 256 256" aria-hidden="true" className="absolute inset-0 size-full">
              {TACH.map((tick, i) => (
                <line
                  key={i}
                  x1={tick.x1}
                  y1={tick.y1}
                  x2={tick.x2}
                  y2={tick.y2}
                  strokeWidth={tick.major ? 2.5 : 1.5}
                  strokeLinecap="round"
                  className={cn(
                    'tach-tick',
                    tick.redline ? 'redline stroke-destructive-soft' : 'stroke-border-strong',
                  )}
                  style={{ '--i': i } as CSSProperties}
                />
              ))}
            </svg>
            <span className="grid size-44 place-items-center rounded-full bg-card shadow-float ring-1 ring-border transition-transform duration-300 ease-out-quint group-hover:scale-[1.03] group-active:scale-[0.98]">
              <span className="grid size-36 place-items-center rounded-full bg-muted ring-1 ring-border-strong">
                <span className="key grid size-28 place-items-center rounded-full bg-primary text-primary-foreground transition-colors group-hover:bg-primary-hover">
                  <span className="flex flex-col items-center gap-1.5">
                    <Power className="size-5" aria-hidden="true" />
                    <span className="font-mono text-sm font-semibold tracking-[0.3em]">START</span>
                  </span>
                </span>
              </span>
            </span>
          </a>
          <p className="mt-8 text-sm text-muted-foreground">
            Free for {free.vehicles} vehicles. No card.{' '}
            <a
              href={SIGN_IN}
              className="font-semibold text-foreground underline-offset-4 hover:underline"
            >
              Sign in
            </a>
          </p>
        </section>
      </main>

      <footer className="mt-32 overflow-hidden sm:mt-44">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div aria-hidden="true" className="bay-line" />
          <div className="grid grid-cols-2 gap-10 py-12 sm:grid-cols-4">
            <div className="col-span-2 flex flex-col gap-3 sm:col-span-1">
              <Image src={logoMark} alt="Garaj" className="h-7 w-auto self-start" />
              <p className="font-mono text-xs uppercase tracking-[0.16em] text-muted-foreground">
                Every vehicle.
                <br />
                Its whole story.
              </p>
            </div>
            {(
              [
                ['Product', NAV],
                [
                  'Developers',
                  [
                    { href: DOCS_URL, label: 'API reference' },
                    { href: `${DOCS_URL}/mcp`, label: 'MCP server' },
                  ],
                ],
                [
                  'Account',
                  [
                    { href: SIGN_UP, label: 'Start free' },
                    { href: SIGN_IN, label: 'Sign in' },
                  ],
                ],
              ] as const
            ).map(([title, links]) => (
              <nav key={title} aria-label={title} className="flex flex-col gap-2.5 text-sm">
                <p className="text-label uppercase text-muted-foreground">{title}</p>
                {links.map((link) => (
                  <a
                    key={link.href}
                    href={link.href}
                    className="self-start font-semibold underline-offset-4 hover:underline"
                  >
                    {link.label}
                  </a>
                ))}
              </nav>
            ))}
          </div>
        </div>
        <p
          aria-hidden="true"
          className="wordmark -mb-[0.18em] select-none text-center text-[clamp(6rem,30vw,24rem)] font-bold leading-[0.8] tracking-[-0.06em] text-border"
        >
          {[...'Garaj'].map((letter, i) => (
            <span key={i} className="inline-block" style={{ '--i': i } as CSSProperties}>
              {letter}
            </span>
          ))}
        </p>
        <div className="relative mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 pb-8 pt-4 font-mono text-xs text-muted-foreground sm:px-6">
          <span>© {new Date().getFullYear()} Garaj</span>
          <span className="uppercase tracking-[0.16em]">Made for the long haul</span>
        </div>
      </footer>
    </div>
  );
}
