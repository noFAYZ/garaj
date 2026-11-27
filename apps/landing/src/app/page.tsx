import type { CSSProperties, ReactNode } from 'react';
import {
  ArrowRight,
  BookOpen,
  Download,
  Droplet,
  Gauge,
  HeartPulse,
  Layers,
  Link2,
  Plus,
  Power,
  Receipt,
  Route,
  Sparkles,
  TrendingUp,
  Users,
  Wallet,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import {
  ENTITLEMENT_COPY,
  GARAGE_ROLES,
  PLAN_LIMITS,
  PLAN_NAMES,
  VEHICLE_TYPES,
} from '@vehicle-os/domain';
import { buttonClass } from '@/components/ui/button-class';
import { cn } from '@/lib/utils';
import { CROPS, Phone, SCREENS, Themed, type Screen } from '../components/phone';
import { SiteFooter } from '../components/site-footer';
import { SiteHeader } from '../components/site-header';
import { ThemeSplit } from '../components/theme-split';
import { BRAND, SIGN_IN, SIGN_UP, SITE_URL } from '../site';

/*
 * The front door: the app itself, in iPhone frames, with as few words as will do. Every phone is
 * a capture of the running app (components/phone.tsx), and every figure printed beside one is read
 * off that same screen. Facts about the product (types, limits, roles, entitlements) come from
 * `@vehicle-os/domain`, so the page cannot promise what the app does not do.
 */

const pad = (n: number) => String(n).padStart(2, '0');
const free = PLAN_LIMITS.FREE;

const STEPS: { screen: Screen; title: string; line: string }[] = [
  {
    screen: 'vehicles',
    title: 'Add vehicle',
    line: 'Car, bike, van or boat. A photo, the plate and the odometer.',
  },
  {
    screen: 'fill',
    title: 'Log everything',
    line: 'Type it the way you’d say it. The litres, price and odometer are read for you.',
  },
  {
    screen: 'due',
    title: 'Get notified',
    line: 'By date or by distance, before the service is due.',
  },
];

/** Each plan: who it is for, the plan it builds on, and what it adds, each with its mark. */
const PLANS: {
  tier: 'FREE' | 'PLUS' | 'BUSINESS';
  line: string;
  builds?: string;
  adds: [LucideIcon, string][];
}[] = [
  {
    tier: 'FREE',
    line: 'For your own',
    adds: [
      [BookOpen, 'Logbook and reminders'],
      [Receipt, 'Costs, parts and documents'],
      [Download, 'Export any time'],
    ],
  },
  {
    tier: 'PLUS',
    line: 'For the household',
    builds: 'Free',
    adds: [[Link2, ENTITLEMENT_COPY['passport.share'].name]],
  },
  {
    tier: 'BUSINESS',
    line: 'For a fleet',
    builds: 'Plus',
    adds: [
      [TrendingUp, ENTITLEMENT_COPY['income.track'].name],
      [Route, ENTITLEMENT_COPY['mileage.report'].name],
      [Users, ENTITLEMENT_COPY['driver.assign'].name],
    ],
  },
];

const FAQ = [
  {
    question: 'Is it actually free?',
    answer: `Yes. ${free.vehicles} vehicles, ${free.garages} garage and ${free.members} people, no card. Reminders and export are free on every plan.`,
  },
  {
    question: 'What can I keep in it?',
    answer: `Fill-ups and charging, services and repairs, parts and fluids, trips, costs, documents and photos, for ${VEHICLE_TYPES.length} kinds of vehicle.`,
  },
  {
    question: 'How do reminders reach me?',
    answer:
      'As a notification on your phone, by email and in the app, by date or by distance. Never at night.',
  },
  {
    question: 'Can my family see it too?',
    answer: `Invite them to your garage in one of ${GARAGE_ROLES.length} roles, or share one vehicle’s history as a link you can switch off (Plus).`,
  },
  {
    question: 'What if I want to leave?',
    answer:
      'Export everything as CSV, JSON or a PDF report, on any plan, then delete your account from the app.',
  },
];

const JSON_LD = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'MobileApplication',
      name: BRAND,
      url: SITE_URL,
      operatingSystem: 'Android, iOS, Web',
      applicationCategory: 'LifestyleApplication',
      description:
        'Log fill-ups, services, parts and costs for every vehicle you own, and get reminded before anything is due.',
      screenshot: (['vehicle', 'vehicles', 'stats', 'due'] as const).map(
        (screen) => new URL(SCREENS[screen].light.src, SITE_URL).href,
      ),
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    },
    {
      '@type': 'FAQPage',
      mainEntity: FAQ.map((item) => ({
        '@type': 'Question',
        name: item.question,
        acceptedAnswer: { '@type': 'Answer', text: item.answer },
      })),
    },
  ],
};

/** A section's opening: a small copper word, then the heading, its second half quieter. */
function SectionTitle({
  id,
  eyebrow,
  title,
  quiet,
  className,
}: {
  id: string;
  eyebrow: string;
  title: string;
  quiet?: string;
  className?: string;
}) {
  return (
    <div className={cn('landing-reveal', className)}>
      <p className="text-label uppercase text-primary">{eyebrow}</p>
      <h2
        id={id}
        className="mt-3 max-w-3xl text-balance text-[clamp(2rem,4.4vw,3.4rem)] font-bold leading-[1.04] tracking-[-0.035em]"
      >
        {title}
        {quiet ? <span className="text-muted-foreground"> {quiet}</span> : null}
      </h2>
    </div>
  );
}

/** A card's question and its one-line answer. */
function CardText({
  question,
  line,
  className,
}: {
  question: string;
  line: string;
  className?: string;
}) {
  return (
    <div className={cn('relative z-10', className)}>
      <h3 className="text-balance text-[1.55rem] font-bold leading-tight tracking-[-0.025em]">
        {question}
      </h3>
      <p className="mt-2 text-pretty text-[15px] leading-relaxed text-muted-foreground">{line}</p>
    </div>
  );
}

/** A reading as the app's dash cells set it: a small tracked label over a mono figure. */
function Reading({
  icon,
  label,
  value,
  unit,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  unit?: string;
}) {
  return (
    <div className="leaf-sm bg-muted/80 px-4 py-3">
      <dt className="flex items-center gap-1.5 text-[0.625rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {icon}
        {label}
      </dt>
      <dd className="mt-1.5 font-mono text-[1.35rem] font-semibold leading-none tabular-nums">
        {value}
        {unit ? (
          <span className="ml-1 text-xs font-medium text-muted-foreground">{unit}</span>
        ) : null}
      </dd>
    </div>
  );
}

/** A figure read off a screen, floating beside it on a small card of the app's own. */
function Chip({
  icon,
  label,
  value,
  note,
  className,
  delay,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  note?: string;
  className?: string;
  delay?: string;
}) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'app-card leaf-md float-chip absolute z-30 items-center gap-3 py-2.5 pl-2.5 pr-4',
        className,
      )}
      style={delay ? ({ '--delay': delay } as CSSProperties) : undefined}
    >
      <span className="leaf-sm grid size-10 shrink-0 place-items-center bg-primary-soft text-primary">
        {icon}
      </span>
      <span className="flex flex-col text-left">
        <span className="text-[0.625rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {label}
        </span>
        <span className="text-[15px] font-bold leading-snug">{value}</span>
        {note ? <span className="font-mono text-[11px] text-muted-foreground">{note}</span> : null}
      </span>
    </div>
  );
}

/** The plan drawn as the floor it buys: numbered bays, or for a fleet, a lot. */
function Floor({ count }: { count: number }) {
  const lot = count > 12;
  return (
    <div aria-hidden="true" className="leaf-md mt-5 flex h-[6.5rem] items-center bg-muted/70 p-3">
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
              className="bay aspect-square rounded-[3px] bg-border"
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

const card = 'app-card leaf-lg landing-reveal relative overflow-hidden';

export default function LandingPage() {
  return (
    <div className="grain-page min-h-dvh overflow-x-clip bg-background text-foreground">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
      />

      <SiteHeader />

      <main>
        {/* ── Hero ─────────────────────────────────────────────────────────────── */}
        <section aria-labelledby="hero-title" className="relative isolate overflow-hidden">
          <div aria-hidden="true" className="copper-ground absolute inset-0 -z-10" />
          <div className="mx-auto flex max-w-6xl animate-rise flex-col items-center px-4 pt-32 text-center sm:px-6 sm:pt-[9.5rem]">
            <p className="app-card inline-flex items-center gap-2.5 rounded-full py-1.5 pl-3 pr-3.5 text-xs font-semibold">
              <span className="relative grid size-2 place-items-center" aria-hidden="true">
                <span className="status-ping absolute inset-0 rounded-full bg-success" />
                <span className="size-2 rounded-full bg-success" />
              </span>
              Free for {free.vehicles} vehicles · No card
            </p>
            <h1
              id="hero-title"
              className="mt-7 max-w-[15ch] text-balance text-[clamp(2.6rem,7vw,5.4rem)] font-bold leading-[0.98] tracking-[-0.045em]"
            >
              When did you last change the oil?
            </h1>
            <p className="mt-6 max-w-xl text-pretty text-lg text-muted-foreground sm:text-xl">
              {BRAND} remembers. Fill-ups, services and parts for every vehicle you own, and a nudge
              before the next one is due.
            </p>
            <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
              <a href={SIGN_UP} className={buttonClass('primary', 'lg')}>
                Start free
                <ArrowRight className="size-4" aria-hidden="true" />
              </a>
              <a href="#how" className={buttonClass('ghost', 'lg')}>
                How it works
              </a>
            </div>
          </div>

          {/*
           * The answer, on three phones: the vehicle in front; what went into it and what it needs
           * next either side. Cut off at the foot, as if standing behind the page's edge.
           */}
          <div className="relative mx-auto mt-14 aspect-square max-w-5xl [mask-image:linear-gradient(to_bottom,#000_62%,transparent)] sm:mt-16 sm:aspect-[2/1]">
            <Phone
              screen="parts"
              priority
              sizes="(min-width: 1024px) 250px, 44vw"
              className="deal-left absolute left-[9%] top-[12%] hidden w-[25%] sm:block"
            />
            <Phone
              screen="due"
              priority
              sizes="(min-width: 1024px) 250px, 44vw"
              className="deal-right absolute right-[9%] top-[12%] hidden w-[25%] sm:block"
            />
            <div
              className="deal-center absolute left-[18%] top-0 z-20 w-[64%] sm:left-[35%] sm:w-[30%]"
              style={{ '--delay': '150ms' } as CSSProperties}
            >
              <Phone screen="vehicle" priority sizes="(min-width: 1024px) 300px, 64vw" />
            </div>
            <Chip
              icon={<Droplet className="size-[18px]" aria-hidden="true" />}
              label="Engine oil"
              value="Changed 6 days ago"
              note="6 L · 15W-40"
              delay="0ms"
              className="hidden sm:left-[1%] sm:top-[52%] sm:flex"
            />
            <Chip
              icon={<Wrench className="size-[18px]" aria-hidden="true" />}
              label="Full service"
              value="Due in 27 days"
              note="Dec 24"
              delay="300ms"
              className="hidden sm:right-[1%] sm:top-[30%] sm:flex"
            />
          </div>
        </section>

        {/* ── How it works ─────────────────────────────────────────────────────── */}
        <section
          id="how"
          aria-labelledby="how-title"
          className="mx-auto mt-16 max-w-6xl scroll-mt-20 px-4 sm:mt-24 sm:px-6"
        >
          <SectionTitle id="how-title" eyebrow="How it works" title="Set up in a minute." />
          <ol className="scrollbar-slim -mx-4 mt-14 flex snap-x snap-mandatory gap-6 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6 md:mx-0 md:grid md:grid-cols-3 md:gap-10 md:overflow-visible md:px-0">
            {STEPS.map((step, i) => (
              <li
                key={step.screen}
                className="landing-reveal flex w-[74vw] max-w-[20rem] shrink-0 snap-center flex-col md:w-auto md:max-w-none"
              >
                <Phone
                  screen={step.screen}
                  sizes="(min-width: 768px) 240px, 60vw"
                  className="mx-auto w-[78%] max-w-[15rem]"
                />
                <div className="mt-9 flex items-center gap-3">
                  <span className="font-mono text-sm font-semibold text-primary">{pad(i + 1)}</span>
                  <span aria-hidden="true" className="bay-line flex-1" />
                </div>
                <h3 className="mt-4 text-[1.4rem] font-bold tracking-[-0.025em]">{step.title}</h3>
                <p className="mt-1.5 text-pretty text-[15px] leading-relaxed text-muted-foreground">
                  {step.line}
                </p>
              </li>
            ))}
          </ol>
        </section>

        {/* ── Features ─────────────────────────────────────────────────────────── */}
        <section
          id="features"
          aria-labelledby="features-title"
          className="mx-auto mt-28 max-w-6xl scroll-mt-20 px-4 sm:mt-36 sm:px-6"
        >
          <SectionTitle
            id="features-title"
            eyebrow="Inside the app"
            title="Answers, not paperwork."
          />
          <div className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-6">
            {/* The vehicle's own page: its readings set out the way its dash sets them. */}
            <article className={cn(card, 'p-7 sm:col-span-2 sm:h-[34rem] sm:p-9 lg:col-span-4')}>
              <CardText
                question="Health at a glance"
                line="Odometer, spend, health and the next job, on one screen."
                className="sm:max-w-[16.5rem]"
              />
              <dl className="relative z-10 mt-7 grid grid-cols-2 gap-2 sm:max-w-[16.5rem] sm:grid-cols-1">
                <Reading
                  icon={<Gauge className="size-3" aria-hidden="true" />}
                  label="Odometer"
                  value="132,844"
                  unit="km"
                />
                <Reading
                  icon={<Wallet className="size-3" aria-hidden="true" />}
                  label="Spent · Nov"
                  value="$372"
                />
                <Reading
                  icon={<HeartPulse className="size-3" aria-hidden="true" />}
                  label="Health"
                  value="88"
                  unit="/ 100"
                />
              </dl>
              <Phone
                screen="vehicle"
                sizes="(min-width: 1024px) 270px, 60vw"
                className="tile-rise relative mx-auto -mb-[62%] mt-10 w-[72%] rotate-[3deg] sm:absolute sm:right-[8%] sm:top-12 sm:mb-0 sm:mt-0 sm:w-[40%] sm:max-w-[17rem]"
              />
            </article>

            {/* The add sheet, rising from the card's floor as it rises from the phone's. */}
            <article className={cn(card, 'h-[31rem] sm:h-[34rem] lg:col-span-2')}>
              <CardText
                question="Snap a receipt"
                line="Or pick fuel, a service, the odometer or a reminder."
                className="p-7"
              />
              {/* The sheet's own top corners, 84px of its 1080: as shares, so they match at any size. */}
              <div className="shot-panel tile-rise absolute inset-x-4 bottom-0 rounded-tl-[7.8%_8%] rounded-tr-[7.8%_8%]">
                <Themed
                  pair={CROPS.add}
                  sizes="(min-width: 1024px) 340px, 90vw"
                  className="h-auto w-full"
                />
              </div>
            </article>

            {/* The year's cost: the card itself, lifted off the screen. */}
            <article className={cn(card, 'h-[32rem] lg:col-span-3')}>
              <CardText
                question="True running cost"
                line="Fuel, services and repairs by month, and per kilometre."
                className="p-7 sm:max-w-sm"
              />
              <div className="shot-panel leaf-lg tile-rise absolute -bottom-[3%] -right-[4%] w-[80%] rotate-[-2deg]">
                <Themed
                  pair={CROPS.stats}
                  sizes="(min-width: 1024px) 440px, 80vw"
                  className="h-auto w-full"
                />
              </div>
              <Chip
                icon={<Gauge className="size-[18px]" aria-hidden="true" />}
                label="Per km"
                value="$0.11"
                note="12 months"
                delay="200ms"
                className="bottom-10 left-5 flex"
              />
            </article>

            {/* What went in, by part and by fluid. */}
            <article className={cn(card, 'h-[32rem] lg:col-span-3')}>
              <CardText
                question="Every part, logged"
                line="The brand, the amount and the day it went in."
                className="p-7 sm:max-w-sm"
              />
              <div className="shot-panel leaf-lg tile-rise absolute -right-[5%] bottom-[7%] w-[86%] rotate-[2deg]">
                <Themed
                  pair={CROPS.parts}
                  sizes="(min-width: 1024px) 470px, 86vw"
                  className="h-auto w-full"
                />
              </div>
            </article>

            {/* The logbook, the phone coming in from the side. */}
            <article className={cn(card, 'h-[34rem] lg:col-span-3')}>
              <div className="relative z-10 flex flex-col gap-6 p-7 sm:max-w-[15rem]">
                <CardText
                  question="Full service history"
                  line="Dated and costed. Export it as a PDF when you sell."
                />
                <ul className="flex gap-2">
                  {['PDF', 'CSV', 'JSON'].map((format) => (
                    <li
                      key={format}
                      className="leaf-sm bg-muted/80 px-3 py-1.5 font-mono text-xs font-semibold text-muted-foreground"
                    >
                      {format}
                    </li>
                  ))}
                </ul>
              </div>
              <Phone
                screen="activity"
                sizes="(min-width: 1024px) 250px, 56vw"
                className="tile-rise absolute -bottom-[26%] right-[6%] w-[56%] rotate-[-4deg] sm:-bottom-[34%] sm:w-[46%]"
              />
            </article>

            {/* Both themes on one phone. */}
            <article className={cn(card, 'h-[34rem] lg:col-span-3')}>
              <ThemeSplit
                text={
                  <CardText question="Light or dark" line="Follows your phone. Drag to compare." />
                }
              >
                <Phone screen="home" split sizes="(min-width: 1024px) 250px, 56vw" />
              </ThemeSplit>
            </article>
          </div>
        </section>

        {/* ── Pricing ──────────────────────────────────────────────────────────── */}
        <section
          id="pricing"
          aria-labelledby="plans-title"
          className="mx-auto mt-28 max-w-6xl scroll-mt-20 px-4 sm:mt-36 sm:px-6"
        >
          <SectionTitle id="plans-title" eyebrow="Pricing" title="Free to start." />
          <div className="mt-14 grid grid-cols-1 gap-x-4 gap-y-12 md:grid-cols-3">
            {PLANS.map((plan) => {
              const limits = PLAN_LIMITS[plan.tier];
              return (
                <article
                  key={plan.tier}
                  className={cn(
                    'app-card leaf-lg landing-reveal group relative flex flex-col p-6',
                    plan.tier === 'PLUS' && 'plan-pick',
                  )}
                >
                  {plan.tier === 'PLUS' ? (
                    <p className="plan-tab text-[0.625rem] font-bold uppercase tracking-[0.14em]">
                      <Sparkles className="size-3" aria-hidden="true" />
                      Recommended
                    </p>
                  ) : null}
                  <div className="flex items-baseline justify-between gap-3">
                    <h3 className="text-xl font-bold tracking-tight">{PLAN_NAMES[plan.tier]}</h3>
                    <p className="text-label uppercase text-muted-foreground">{plan.line}</p>
                  </div>
                  <Floor count={limits.vehicles} />
                  <dl className="mt-3 grid grid-cols-3 gap-2">
                    {(
                      [
                        ['Vehicles', limits.vehicles],
                        ['Garages', limits.garages],
                        ['People', limits.members],
                      ] as const
                    ).map(([label, value]) => (
                      <div key={label} className="leaf-sm bg-muted/70 p-3">
                        <dt className="text-[0.625rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                          {label}
                        </dt>
                        <dd className="mt-1 font-mono text-2xl font-semibold tabular-nums">
                          {pad(value)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  <div className="mt-5 flex flex-col items-start gap-2">
                    {plan.builds ? (
                      <p className="flex items-center gap-2 rounded-full border border-dashed border-border-strong px-3 py-1 text-xs font-semibold text-muted-foreground">
                        <Layers className="size-3.5" aria-hidden="true" />
                        Everything in {plan.builds}, plus
                      </p>
                    ) : null}
                    <ul className="flex w-full flex-col gap-1.5">
                      {plan.adds.map(([Icon, label]) => (
                        <li
                          key={label}
                          className="leaf-sm flex items-center gap-3 bg-muted/60 py-1.5 pl-1.5 pr-3 text-[15px] font-semibold"
                        >
                          <span className="leaf-sm grid size-8 shrink-0 place-items-center bg-primary-soft text-primary">
                            <Icon className="size-4" aria-hidden="true" />
                          </span>
                          {label}
                        </li>
                      ))}
                    </ul>
                  </div>
                </article>
              );
            })}
          </div>
          <p className="landing-reveal mt-6 text-center text-sm text-muted-foreground">
            Prices are shown in the app and on the web, in your currency. Cancel any time.
          </p>
        </section>

        {/* ── FAQ ──────────────────────────────────────────────────────────────── */}
        <section
          id="faq"
          aria-labelledby="faq-title"
          className="mx-auto mt-28 max-w-6xl scroll-mt-20 px-4 sm:mt-36 sm:px-6"
        >
          <div className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)] lg:gap-16">
            <SectionTitle id="faq-title" eyebrow="FAQ" title="Fair questions." />
            <div className="faq landing-reveal flex flex-col gap-2">
              {FAQ.map((item) => (
                <details key={item.question} className="faq-item app-card leaf-md">
                  <summary className="flex cursor-pointer items-center justify-between gap-4 px-5 py-4 text-md font-semibold">
                    {item.question}
                    <span className="faq-plus grid size-8 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
                      <Plus className="size-4" aria-hidden="true" />
                    </span>
                  </summary>
                  <p className="text-pretty px-5 pb-5 text-[15px] leading-relaxed text-muted-foreground">
                    {item.answer}
                  </p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* ── Push to start ────────────────────────────────────────────────────── */}
        <section
          aria-labelledby="start-title"
          className="mx-auto mt-28 max-w-6xl px-4 sm:mt-36 sm:px-6"
        >
          <div className="app-card leaf-lg landing-reveal relative isolate flex flex-col items-center overflow-hidden px-6 py-16 text-center sm:py-20">
            <div aria-hidden="true" className="copper-ground absolute inset-0 -z-10" />
            <h2
              id="start-title"
              className="text-balance text-[clamp(2.2rem,5.4vw,4.2rem)] font-bold leading-[1.02] tracking-[-0.04em]"
            >
              Start your garage.
            </h2>
            <a
              href={SIGN_UP}
              aria-label="Start your garage, free"
              className="start group relative mt-10 grid size-64 place-items-center rounded-full"
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
                      <span className="font-mono text-sm font-semibold tracking-[0.3em]">
                        START
                      </span>
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
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
