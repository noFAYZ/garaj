import Image, { type StaticImageData } from 'next/image';
import { cn } from '@/lib/utils';
import homeLight from '../assets/app/home-light.webp';
import homeDark from '../assets/app/home-dark.webp';
import vehicleLight from '../assets/app/vehicle-light.webp';
import vehicleDark from '../assets/app/vehicle-dark.webp';
import vehiclesLight from '../assets/app/vehicles-light.webp';
import vehiclesDark from '../assets/app/vehicles-dark.webp';
import statsLight from '../assets/app/stats-light.webp';
import statsDark from '../assets/app/stats-dark.webp';
import dueLight from '../assets/app/due-light.webp';
import dueDark from '../assets/app/due-dark.webp';
import partsLight from '../assets/app/parts-light.webp';
import partsDark from '../assets/app/parts-dark.webp';
import fillLight from '../assets/app/fill-light.webp';
import fillDark from '../assets/app/fill-dark.webp';
import activityLight from '../assets/app/activity-light.webp';
import activityDark from '../assets/app/activity-dark.webp';
import cropStatsLight from '../assets/app/crop-stats-light.webp';
import cropStatsDark from '../assets/app/crop-stats-dark.webp';
import cropPartsLight from '../assets/app/crop-parts-light.webp';
import cropPartsDark from '../assets/app/crop-parts-dark.webp';
import cropAddLight from '../assets/app/crop-addsheet-light.webp';
import cropAddDark from '../assets/app/crop-addsheet-dark.webp';

/*
 * The Android app's own screens, captured from a running build in both themes and cut to an
 * iPhone's 393:852 screen: the Android status bar is replaced by iOS's taller status area (drawn
 * here, over the capture), so the frame below is the real proportions with the real app in it.
 * Recapture them when a screen changes, and update the figures the page quotes beside them.
 */
type Pair = { light: StaticImageData; dark: StaticImageData; alt: string };

export const SCREENS = {
  home: {
    light: homeLight,
    dark: homeDark,
    alt: 'Home: three vehicles worth $2.0k, $1.2k spent, nothing due, and the Isuzu Vehicross in its bay.',
  },
  vehicle: {
    light: vehicleLight,
    dark: vehicleDark,
    alt: 'The Isuzu Vehicross: 132,844 km, $372 spent in November, health 88, full service due in 27 days.',
  },
  vehicles: {
    light: vehiclesLight,
    dark: vehiclesDark,
    alt: 'Vehicles: a 1998 Toyota Corolla at 128,000 km and a 2012 Suzuki GSX-R 600.',
  },
  stats: {
    light: statsLight,
    dark: statsDark,
    alt: 'Running cost for a year: $1,049, mostly services, at $0.11 a kilometre.',
  },
  due: {
    light: dueLight,
    dark: dueDark,
    alt: 'Due: a full service in 27 days, oil and filter in 3 months, tyre rotation not yet started.',
  },
  parts: {
    light: partsLight,
    dark: partsDark,
    alt: 'Parts: oil filter, 6 L of 15W-40 engine oil and 3 L of gearbox oil, all fitted six days ago.',
  },
  fill: {
    light: fillLight,
    dark: fillDark,
    alt: 'Typing “42 L for $64 at Shell, 133100 km” fills in $64.00, 42 L, 133,100 km and Shell.',
  },
  activity: {
    light: activityLight,
    dark: activityDark,
    alt: 'Recent activity: trips, a fill-up, oil and filter, front shocks and a full service, each dated and costed.',
  },
} satisfies Record<string, Pair>;

/** Close-ups cut from the same captures, the app's own ground round them. */
export const CROPS = {
  stats: {
    light: cropStatsLight,
    dark: cropStatsDark,
    alt: 'Running cost: $1,049 over 12 months, by month, split into refuelling, services and expenses.',
  },
  parts: {
    light: cropPartsLight,
    dark: cropPartsDark,
    alt: 'Engine: oil filter (Toyota) and 6 L of 15W-40 engine oil. Drivetrain: 3 L of 75W-90 gearbox oil.',
  },
  add: {
    light: cropAddLight,
    dark: cropAddDark,
    alt: 'The add sheet: snap a photo, or pick fuel, odometer, service, reminder, document or other.',
  },
} satisfies Record<string, Pair>;

export type Screen = keyof typeof SCREENS;

/** A picture in the reader's theme: the other theme's copy is `display: none`, so never fetched. */
export function Themed({
  pair,
  sizes,
  priority,
  className,
}: {
  pair: Pair;
  sizes: string;
  priority?: boolean;
  className?: string;
}) {
  return (
    <>
      <Image
        src={pair.light}
        alt={pair.alt}
        sizes={sizes}
        priority={priority}
        placeholder="blur"
        className={cn('dark:hidden', className)}
      />
      <Image
        src={pair.dark}
        alt={pair.alt}
        sizes={sizes}
        priority={priority}
        placeholder="blur"
        className={cn('hidden dark:block', className)}
      />
    </>
  );
}

/** iOS's status bar at 9:41, in the ink of the screen under it. */
export function StatusBar({ ink }: { ink: 'black' | 'white' }) {
  return (
    <div aria-hidden="true" className="iphone-status" style={{ color: ink }}>
      <span className="iphone-time">9:41</span>
      <svg className="iphone-icons" viewBox="0 0 78 13" fill="currentColor">
        {/* Cellular */}
        <rect x="0" y="8" width="3.2" height="4.5" rx="1" />
        <rect x="4.8" y="5.8" width="3.2" height="6.7" rx="1" />
        <rect x="9.6" y="3.4" width="3.2" height="9.1" rx="1" />
        <rect x="14.4" y="1" width="3.2" height="11.5" rx="1" />
        {/* Wi-Fi */}
        <path d="M30.4 2.6c2.6 0 5 1 6.8 2.7l1.3-1.3A11.4 11.4 0 0 0 30.4.8c-3.1 0-6 1.2-8.1 3.2l1.3 1.3a9.5 9.5 0 0 1 6.8-2.7Zm0 3.6c1.6 0 3.1.6 4.2 1.6l1.3-1.3a7.8 7.8 0 0 0-11 0l1.3 1.3c1.1-1 2.6-1.6 4.2-1.6Zm0 3.6c.7 0 1.3.3 1.7.7l-1.7 1.7-1.7-1.7c.4-.4 1-.7 1.7-.7Z" />
        {/* Battery */}
        <rect
          x="49.5"
          y="0.5"
          width="24"
          height="12"
          rx="3.8"
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.35"
        />
        <rect x="51.5" y="2.5" width="20" height="8" rx="2.2" />
        <path d="M75 4.4v4.2a2.2 2.2 0 0 0 0-4.2Z" fillOpacity="0.4" />
      </svg>
    </div>
  );
}

/** One theme's screen inside the glass: the capture, its status bar and its home indicator. */
function Layer({
  src,
  ink,
  alt,
  sizes,
  priority,
}: {
  src: StaticImageData;
  ink: 'black' | 'white';
  alt: string;
  sizes: string;
  priority?: boolean;
}) {
  return (
    <>
      <Image
        src={src}
        alt={alt}
        sizes={sizes}
        priority={priority}
        placeholder="blur"
        className="iphone-shot"
      />
      <StatusBar ink={ink} />
      <span aria-hidden="true" className="iphone-home" style={{ background: ink }} />
    </>
  );
}

/**
 * An iPhone 15 Pro round a screen, in natural titanium: the ring, the black border, the glass with
 * the Dynamic Island, and the buttons on its sides. Every measure is a share of its width, so it
 * is the same phone at any size. `split` lays the dark screen over the light, cut at `--split`.
 */
export function Phone({
  screen,
  sizes,
  priority,
  split,
  className,
}: {
  screen: Screen;
  sizes: string;
  priority?: boolean;
  /** Both themes at once, the dark cut at the `--split` line (the theme comparison). */
  split?: boolean;
  className?: string;
}) {
  const { light, dark, alt } = SCREENS[screen];
  return (
    <div className={cn('iphone', className)}>
      <span aria-hidden="true" className="iphone-btn iphone-action" />
      <span aria-hidden="true" className="iphone-btn iphone-vol-up" />
      <span aria-hidden="true" className="iphone-btn iphone-vol-down" />
      <span aria-hidden="true" className="iphone-btn iphone-power" />
      <div className="iphone-body">
        <div className="iphone-bezel">
          <div className="iphone-screen">
            {split ? (
              <>
                <div className="iphone-layer">
                  <Layer src={light} ink="black" alt={`${alt} Light theme.`} sizes={sizes} />
                </div>
                <div className="iphone-layer split-dark">
                  <Layer src={dark} ink="white" alt={`${alt} Dark theme.`} sizes={sizes} />
                </div>
                <span aria-hidden="true" className="split-line" />
              </>
            ) : (
              <>
                <div className="iphone-layer dark:hidden">
                  <Layer src={light} ink="black" alt={alt} sizes={sizes} priority={priority} />
                </div>
                <div className="iphone-layer hidden dark:block">
                  <Layer src={dark} ink="white" alt={alt} sizes={sizes} priority={priority} />
                </div>
              </>
            )}
            <span aria-hidden="true" className="iphone-island" />
          </div>
        </div>
      </div>
    </div>
  );
}
