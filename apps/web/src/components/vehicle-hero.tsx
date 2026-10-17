'use client';

import { useRef, useState, type ReactNode } from 'react';
import { Camera, Check, Copy } from 'lucide-react';
import type { CostSummary, MonthlySpend, Vehicle, VehiclePhoto } from '@vehicle-os/contracts';
import type { VehicleType } from '@vehicle-os/domain';
import { BrandLogo } from '@/components/brand-logo';
import { Icon, type IconName } from '@/components/icons';
import { Skeleton } from '@/components/ui/skeleton';
import { CockpitDisplay, type Reading } from '@/components/vehicle/cockpit';
import { humanise } from '@/lib/format';
import { cn } from '@/lib/utils';
import { vinTail } from '@vehicle-os/ui';

/**
 * Only the types with a glyph of their own are listed; everything else falls back rather
 * than being forced onto a car, which would label a trailer wrongly.
 */
const TYPE_ICONS: Partial<Record<VehicleType, IconName>> = {
  CAR: 'car',
  VAN: 'car',
  RV: 'car',
  MOTORCYCLE: 'motorcycle',
  SCOOTER: 'motorcycle',
  BICYCLE: 'bicycle',
  BOAT: 'boat',
};

export const typeIcon = (type: VehicleType): IconName => TYPE_ICONS[type] ?? 'vehicles';

/**
 * The shared-element name that lets a vehicle's card or garage hero grow into the hero on its
 * own page. Each page may carry a name once: a second element with it cancels the transition.
 */
export const vehicleTransitionName = (vehicleId: string) => `vehicle-${vehicleId}`;

const pad = (value: number) => String(value).padStart(2, '0');

/*
 * The hero is a device: a card with a thin bezel (`p-2`) and a screen set into it. The inner radius
 * is the outer one less the bezel — 24px card, 8px bezel, 16px screen — so the corners run
 * parallel instead of pinching.
 */
const FRAME = 'grid gap-2 rounded-3xl bg-card/60 p-2';
const HEADER =
  'grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2.5 px-1.5 pb-1 pt-1.5 sm:gap-x-4 sm:gap-y-1.5 sm:px-2 sm:pt-2';
// Under the name from `sm`; the whole width on a phone, where the name column is narrow.
const META = 'col-span-3 sm:col-span-2 sm:col-start-2';
const TILE =
  'relative grid size-12 shrink-0 place-items-center rounded-2xl bg-muted text-muted-foreground sm:row-span-2 sm:size-14';
const NAME =
  'line-clamp-2 text-xl font-bold leading-tight tracking-tight text-foreground sm:truncate sm:text-2xl';

/**
 * The hero before its vehicle arrives: the same frame and the same screen, with every label drawn
 * as real text. Only the name and the figures are placeholders, so nothing moves when the vehicle
 * lands.
 */
export function VehicleHeroSkeleton() {
  return (
    <section className={FRAME}>
      <div className={HEADER}>
        <Skeleton className="size-12 rounded-2xl sm:row-span-2 sm:size-14" />
        {/* The real type around the bar, so the line is the height it will be. */}
        <p className={NAME}>
          <Skeleton className="inline-block h-6 w-56 max-w-full align-middle sm:h-7" />
        </p>
        <span />
        <Skeleton className={cn(META, 'h-7 w-64 max-w-full')} />
      </div>
      <CockpitDisplay vehicle={undefined} cost={undefined} monthly={undefined} trail={undefined} />
    </section>
  );
}

/**
 * The vehicle, at the top of every one of its tabs: who it is, then one screen of what it reads.
 *
 * Identity is the mark, the name, and one line of what tells this one apart — variant, plate, VIN. The screen is the odometer and this month's spend, each opening onto its year. A photo, when
 * there is one, stands beside the two on a wide screen and above the figures on a phone.
 */
export function VehicleHero({
  vehicle,
  cost,
  monthly,
  trail,
  action,
  photos,
  onEditPhotos,
  className,
}: {
  vehicle: Vehicle;
  /** The last twelve months' spend: `undefined` while it loads, `null` when it could not be had. */
  cost: CostSummary | null | undefined;
  /**
   * Spend per month over two years: this month on the screen, the columns and the change against
   * the year before in its dialog. `undefined` while it loads, `null` when it could not be had.
   */
  monthly: MonthlySpend | null | undefined;
  /** The odometer readings of the last year, for the line under the drums. */
  trail: readonly Reading[] | undefined;
  action?: ReactNode;
  /**
   * The vehicle's gallery. Passed in rather than fetched here: a component that quietly issues a
   * request per instance is how a list of six becomes six requests.
   */
  photos?: readonly VehiclePhoto[];
  /** Opens the photo manager. */
  onEditPhotos?: () => void;
  className?: string;
}) {
  const gallery = (photos ?? [])
    .filter((item) => item.thumbnailUrl)
    .toSorted((a, b) => {
      if (a.id === vehicle.primaryPhoto?.id) return -1;
      if (b.id === vehicle.primaryPhoto?.id) return 1;
      return 0;
    });
  /*
   * Decided from the vehicle's own primary photo until the gallery arrives, so the layout the page
   * paints first is the layout it keeps.
   */
  const staged = gallery.length > 0 || Boolean(vehicle.primaryPhoto?.thumbnailUrl);

  // The logo is the tile, edge to edge; only the type glyph sits inside one.
  const mark = vehicle.make ? (
    <BrandLogo make={vehicle.make} size={56} fill className="rounded-2xl text-lg text-foreground" />
  ) : (
    <Icon name={typeIcon(vehicle.vehicleType)} size={26} />
  );

  return (
    <section
      className={cn(
        FRAME,
        // Wide, the photo takes a column of its own beside the name and the screen.
        staged && 'lg:grid-cols-[16rem_minmax(0,1fr)]',
        className,
      )}
    >
      <div className={cn(HEADER, staged && 'lg:col-start-2')}>
        {/*
         * Without a photo the mark is also the way to add one: a camera on its corner rather than
         * a button of its own in a row that already holds the menu.
         */}
        {!staged && onEditPhotos ? (
          <button
            type="button"
            onClick={onEditPhotos}
            aria-label="Add photos"
            title="Add photos"
            className={cn(
              TILE,
              'group/tile transition-[background-color,scale] hover:bg-border active:scale-95',
            )}
          >
            {mark}
            <span
              aria-hidden="true"
              className="absolute -bottom-1 -right-1 grid size-6 place-items-center rounded-full bg-primary text-primary-foreground shadow-float transition-transform group-hover/tile:scale-110"
            >
              <Camera className="size-3.5" strokeWidth={2.25} />
            </span>
          </button>
        ) : (
          <span aria-hidden="true" className={TILE}>
            {mark}
          </span>
        )}

        <h2 className={NAME}>{vehicle.displayName}</h2>

        <div className="flex items-center gap-1 self-start">
          {/*
           * Active is the normal state and asks for nothing, so it is not drawn; only a vehicle
           * that has left (sold, archived) says so.
           */}
          {vehicle.status !== 'ACTIVE' ? (
            <span className="mr-1 inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs font-semibold text-muted-foreground">
              <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
              {humanise(vehicle.status)}
            </span>
          ) : null}
          {action}
        </div>

        {/* What tells this one apart from another of the same model, on one line. */}
        {vehicle.variant || vehicle.registrationIdentifier || vehicle.identificationNumber ? (
          <div className={cn(META, 'flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2')}>
            {vehicle.variant ? (
              <span className="truncate text-sm text-muted-foreground">{vehicle.variant}</span>
            ) : null}
            {vehicle.registrationIdentifier ? (
              <Plate value={vehicle.registrationIdentifier} />
            ) : null}
            {vehicle.identificationNumber ? <VinChip vin={vehicle.identificationNumber} /> : null}
          </div>
        ) : null}
      </div>

      {staged ? (
        /*
         * Wide, the photo is as tall as the name and the screen beside it — never taller. It had a
         * minimum of its own, and once the screen grew shorter than that, the row grew to the photo
         * and the screen stretched with an empty band along its bottom.
         */
        <Stage
          vehicle={vehicle}
          gallery={gallery}
          onEditPhotos={onEditPhotos}
          className="h-40 sm:h-44 lg:col-start-1 lg:row-span-2 lg:row-start-1 lg:h-auto"
        />
      ) : null}

      <CockpitDisplay
        vehicle={vehicle}
        cost={cost}
        monthly={monthly}
        trail={trail}
        className={staged ? 'lg:col-start-2' : undefined}
      />
    </section>
  );
}

/**
 * The vehicle as a bar, above every tab but Logs: its picture — the featured photo, or the make's
 * badge without one — its name and its plate, and its menu. The hero shrunk to what says which
 * vehicle this is, so the tab's own content starts near the top. `undefined` while it loads.
 */
export function VehicleBar({
  vehicle,
  action,
  onEditPhotos,
}: {
  vehicle: Vehicle | undefined;
  action?: ReactNode;
  onEditPhotos?: () => void;
}) {
  if (!vehicle) {
    return (
      <section className="flex h-12 items-center gap-3">
        <Skeleton className="size-11 rounded-xl" />
        <Skeleton className="h-5 w-48 max-w-full" />
      </section>
    );
  }
  const photo = vehicle.primaryPhoto?.thumbnailUrl ? vehicle.primaryPhoto : null;
  const plate = vehicle.registrationIdentifier;
  const picture = photo ? (
    <img
      src={photo.thumbnailUrl!}
      alt=""
      className={cn('size-full', photo.isCutout ? 'object-contain p-0.5' : 'object-cover')}
    />
  ) : vehicle.make ? (
    <BrandLogo make={vehicle.make} size={44} fill className="rounded-xl text-sm text-foreground" />
  ) : (
    <Icon name={typeIcon(vehicle.vehicleType)} size={20} />
  );
  const tile =
    'grid size-11 shrink-0 place-items-center overflow-hidden rounded-xl bg-muted text-muted-foreground';

  return (
    <section className="flex h-12 min-w-0 items-center gap-3">
      {onEditPhotos ? (
        <button
          type="button"
          onClick={onEditPhotos}
          aria-label="Photos"
          title="Photos"
          className={cn(tile, 'transition-[scale] active:scale-95')}
        >
          {picture}
        </button>
      ) : (
        <span aria-hidden="true" className={tile}>
          {picture}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-lg font-semibold leading-tight tracking-tight text-foreground">
          {vehicle.displayName}
        </h2>
        {plate || vehicle.status !== 'ACTIVE' ? (
          <p className="truncate font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            {plate ? (
              <>
                <span className="sr-only">Number plate </span>
                {plate}
              </>
            ) : null}
            {plate && vehicle.status !== 'ACTIVE' ? ' · ' : null}
            {vehicle.status !== 'ACTIVE' ? humanise(vehicle.status) : null}
          </p>
        ) : null}
      </div>
      {action}
    </section>
  );
}

/**
 * The photo stage. A region that takes the arrow keys once focused and a swipe under a finger, so
 * the gallery moves the way every other gallery does, not only by its buttons.
 *
 * A background-removed cutout stands on the stage with a floor shadow under it — the object, not a
 * picture of it. An ordinary photo is shown whole over a soft copy of itself, so the composition
 * holds at any shape the stage takes: a band on a phone, a column beside the screen when wide.
 */
function Stage({
  vehicle,
  gallery,
  onEditPhotos,
  className,
}: {
  vehicle: Vehicle;
  gallery: readonly VehiclePhoto[];
  onEditPhotos?: () => void;
  className?: string;
}) {
  const [index, setIndex] = useState(0);
  // Photos whose image would not load: skipped to the type glyph rather than a broken-image box.
  const [broken, setBroken] = useState<ReadonlySet<string>>(new Set());
  const swipeStart = useRef<number | null>(null);

  // Clamped here rather than reset in an effect: a deleted photo never leaves the index past the end.
  const position = Math.min(index, Math.max(gallery.length - 1, 0));
  const photo = gallery[position] ?? vehicle.primaryPhoto;
  const shown = photo?.thumbnailUrl && !broken.has(photo.id) ? photo : null;
  const many = gallery.length > 1;
  const step = (delta: number) => setIndex((position + delta + gallery.length) % gallery.length);

  return (
    <div
      role={many ? 'region' : undefined}
      aria-roledescription={many ? 'carousel' : undefined}
      aria-label={many ? 'Photos' : undefined}
      tabIndex={many ? 0 : undefined}
      onKeyDown={(event) => {
        if (!many) return;
        if (event.key === 'ArrowLeft') step(-1);
        else if (event.key === 'ArrowRight') step(1);
        else return;
        event.preventDefault();
      }}
      onPointerDown={(event) => {
        if (event.pointerType !== 'mouse') swipeStart.current = event.clientX;
      }}
      onPointerUp={(event) => {
        const start = swipeStart.current;
        swipeStart.current = null;
        if (start === null || !many) return;
        const distance = event.clientX - start;
        if (Math.abs(distance) > 40) step(distance < 0 ? 1 : -1);
      }}
      className={cn(
        'group/gallery relative flex touch-pan-y items-center justify-center overflow-hidden rounded-2xl',
        shown?.isCutout || !shown ? 'bg-muted/50' : 'bg-muted',
        className,
      )}
    >
      {shown ? (
        shown.isCutout ? (
          <>
            {/* The floor: a soft contact shadow, so the cutout stands on something. */}
            <span
              aria-hidden="true"
              className="absolute bottom-[14%] left-1/2 h-5 w-3/5 -translate-x-1/2 rounded-[100%] bg-foreground opacity-15 blur-xl"
            />
            <img
              key={shown.id}
              src={shown.thumbnailUrl!}
              alt={shown.caption ?? vehicle.displayName}
              onError={() => setBroken((set) => new Set(set).add(shown.id))}
              className="absolute inset-0 m-auto max-h-[80%] max-w-[84%] animate-pop object-contain"
            />
          </>
        ) : (
          /*
           * The stage is rarely the photo's shape, and cropping one to fit takes the roof, the
           * wheels or the bumpers off. So the whole photo is shown, over a soft, dimmed copy of
           * itself filling the rest.
           */
          <>
            <img
              aria-hidden="true"
              src={shown.thumbnailUrl!}
              alt=""
              className="absolute inset-0 size-full scale-110 object-cover opacity-50 blur-2xl"
            />
            <img
              key={shown.id}
              src={shown.thumbnailUrl!}
              alt={shown.caption ?? vehicle.displayName}
              onError={() => setBroken((set) => new Set(set).add(shown.id))}
              className="absolute inset-0 size-full animate-pop object-contain"
            />
          </>
        )
      ) : (
        // A photo that exists but would not load says so, rather than offering to add one.
        <span className="flex flex-col items-center gap-2 text-muted-foreground">
          <span className="opacity-30">
            <Icon name="gallery" size={48} />
          </span>
          <span className="text-sm font-semibold">This photo could not be loaded</span>
        </span>
      )}

      {many ? (
        <span
          aria-live="polite"
          className="absolute bottom-3 left-3 rounded-full bg-background/80 px-2.5 py-1 font-mono text-xs font-semibold tabular-nums text-foreground backdrop-blur"
        >
          {pad(position + 1)} / {pad(gallery.length)}
        </span>
      ) : null}

      {/*
       * Revealed on hover, shown outright on touch and on keyboard focus — a control that exists
       * only under a pointer does not exist on a phone.
       */}
      {onEditPhotos ? (
        <StageButton
          label="Edit photos"
          className="right-3 top-3"
          onClick={onEditPhotos}
          icon={<Icon name="edit" size={16} />}
        />
      ) : null}
      {many ? (
        <>
          <StageButton
            label="Previous photo"
            className="left-3 top-1/2 -translate-y-1/2"
            onClick={() => step(-1)}
            icon={<Icon name="chevronRight" size={18} className="rotate-180" />}
          />
          <StageButton
            label="Next photo"
            className="right-3 top-1/2 -translate-y-1/2"
            onClick={() => step(1)}
            icon={<Icon name="chevronRight" size={18} />}
          />
        </>
      ) : null}
    </div>
  );
}

/** The number plate, drawn as one: a dark band, then the registration in wide mono. */
function Plate({ value }: { value: string }) {
  return (
    <span className="flex h-7 max-w-full items-stretch overflow-hidden bg-card ring-1 ring-inset ring-foreground/20">
      <span
        aria-hidden="true"
        className="grid w-5 shrink-0 place-items-center bg-foreground font-mono text-[0.5rem] font-bold text-background [writing-mode:vertical-rl]"
      >
        REG
      </span>
      <span className="truncate px-2.5 font-mono text-sm font-semibold uppercase leading-7 tracking-[0.18em] text-foreground">
        <span className="sr-only">Number plate </span>
        {value}
      </span>
    </span>
  );
}

/** The VIN by its tail, copied whole on a press — the one thing people ever do with it. */
function VinChip({ vin }: { vin: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(vin);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        } catch {
          // ponytail: clipboard refused (insecure context or permission); the chip simply stays put.
        }
      }}
      aria-label={copied ? 'VIN copied' : `Copy VIN ${vin}`}
      title={vin}
      className="inline-flex h-7 items-center gap-2 rounded-full bg-muted px-3 font-mono text-xs font-semibold uppercase tabular-nums text-muted-foreground transition-colors hover:bg-border hover:text-foreground"
    >
      <span className="text-foreground">VIN</span>
      {vinTail(vin)}
      <span aria-live="polite" className={cn(copied ? 'text-success' : 'text-muted-foreground')}>
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </span>
    </button>
  );
}

function StageButton({
  label,
  icon,
  onClick,
  className,
}: {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  className: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn(
        'absolute z-10 grid size-9 place-items-center rounded-full bg-background/80 text-foreground opacity-0 shadow-float backdrop-blur transition-[opacity,background-color,scale] hover:bg-background focus-visible:opacity-100 active:scale-95 group-hover/gallery:opacity-100 group-focus-within/gallery:opacity-100 [@media(hover:none)]:opacity-100',
        className,
      )}
    >
      {icon}
    </button>
  );
}
