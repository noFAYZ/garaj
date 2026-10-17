'use client';

import { useMutation } from '@tanstack/react-query';
import { ArrowUpRight, ChevronLeft, ChevronRight, ImagePlus, Maximize2 } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { VehicleDocument, VehicleEvent, VehiclePhoto } from '@vehicle-os/contracts';
import { uploadPhoto } from '@vehicle-os/api-client';
import { api } from '@/lib/api';
import { Icon } from '@/components/icons';
import { PHOTO_TYPES } from '@/components/onboard-uploads';
import { Amount, KindIcon } from '@/components/timeline';
import { Modal, MODAL_BAR } from '@/components/ui/modal';
import { Button } from '@/components/ui/primitives';
import { ConfirmDelete } from '@/components/ui/row-actions';
import { formatDistance, formatMoney, humanise } from '@/lib/format';
import { fillQuantity } from '@vehicle-os/ui';
import { cn } from '@/lib/utils';

/** What is filed against one entry: its photographs and its papers. */
export interface Attached {
  photos: VehiclePhoto[];
  documents: VehicleDocument[];
}

/** Photos and documents by the entry they were filed against; the rest belong to the vehicle. */
export function attachmentsByEvent(
  photos: readonly VehiclePhoto[] = [],
  documents: readonly VehicleDocument[] = [],
): Map<string, Attached> {
  const byEvent = new Map<string, Attached>();
  const slot = (eventId: string) => {
    if (!byEvent.has(eventId)) byEvent.set(eventId, { photos: [], documents: [] });
    return byEvent.get(eventId)!;
  };
  for (const photo of photos) {
    if (photo.eventId && photo.thumbnailUrl) slot(photo.eventId).photos.push(photo);
  }
  for (const document of documents) {
    if (document.eventId) slot(document.eventId).documents.push(document);
  }
  return byEvent;
}

/**
 * Opens a document. The signed URL is fetched on the press, not with the list: it lives about five
 * minutes, so one minted when the page loaded would be dead by the time anyone pressed it.
 */
export function useOpenDocument(vehicleId: string, documentId: string) {
  return useMutation({
    mutationFn: () => api.documents.download(vehicleId, documentId),
    onSuccess: (download) => window.open(download.url, '_blank', 'noopener,noreferrer'),
    // The new tab is the result.
    meta: { toast: false },
  });
}

const pad = (value: number) => String(value).padStart(2, '0');
const DAY = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});
const TIME = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' });
const LOGGED = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

/**
 * One entry of the record, opened from its card, set out like a receipt: what it was, then its
 * figures, its note, and what is filed against it — compact enough that most entries fit whole.
 *
 * The head is the card's own head grown up: the kind's tile, the kind and when, and the title.
 * The figures are the spec sheet's rounded tiles, the cost first and largest; a fill also says how
 * much went in and what it cost a litre. The record goes on either side of it: Newer and Older (or
 * ← and →) step through without closing, the dialog holding its size so the buttons stay under the
 * pointer. Deleting sits apart, and takes a second press.
 */
export function EntryDetails({
  vehicleId,
  events,
  openId,
  deltas,
  attachments,
  onStep,
  onClose,
  onChanged,
}: {
  vehicleId: string;
  /** The record as loaded, newest first: what Newer and Older step through. */
  events: readonly VehicleEvent[];
  openId: string;
  deltas: ReadonlyMap<string, number>;
  attachments: ReadonlyMap<string, Attached>;
  onStep: (eventId: string) => void;
  onClose: () => void;
  /** After the entry is deleted or something is added to it. */
  onChanged: () => void;
}) {
  const index = events.findIndex((item) => item.id === openId);
  const event = index >= 0 ? events[index]! : null;
  const newer = index > 0 ? events[index - 1]! : null;
  const older = index >= 0 ? (events[index + 1] ?? null) : null;
  // Which way the last step went, so the entry slides in from that side.
  const [direction, setDirection] = useState<1 | -1>(1);
  const [deleting, setDeleting] = useState(false);

  const step = (to: VehicleEvent | null, way: 1 | -1) => {
    if (!to) return;
    setDirection(way);
    onStep(to.id);
  };

  // An entry deleted elsewhere, or filtered out of the record, closes its dialog.
  useEffect(() => {
    if (index < 0) onClose();
  }, [index, onClose]);

  useEffect(() => {
    function onKeyDown(key: KeyboardEvent) {
      if (deleting || key.metaKey || key.ctrlKey || key.altKey) return;
      if ((key.target as HTMLElement).closest('input, textarea, select')) return;
      if (key.key === 'ArrowLeft' && newer) {
        key.preventDefault();
        setDirection(-1);
        onStep(newer.id);
      } else if (key.key === 'ArrowRight' && older) {
        key.preventDefault();
        setDirection(1);
        onStep(older.id);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [deleting, newer, older, onStep]);

  const remove = useMutation({
    mutationFn: () => api.events.remove(vehicleId, openId),
    meta: { toast: 'Entry deleted' },
    onSuccess: () => {
      setDeleting(false);
      onClose();
      onChanged();
    },
  });

  if (!event) return null;

  const kind = humanise(event.eventType);
  // As on the card: a title that only repeats the kind is said once.
  const titled =
    event.title.trim() !== '' && event.title.trim().toLowerCase() !== kind.toLowerCase();
  const heading = titled ? event.title.trim() : kind;
  const { quantity, rest: note } = fillQuantity(event.eventType, event.description);
  const occurred = new Date(event.occurredAt);
  const slide = { '--step-dir': direction } as CSSProperties;

  return (
    <Modal
      title={heading}
      size="lg"
      fill
      onClose={onClose}
      header={(titleId) => (
        <div key={event.id} className="flex animate-step items-center gap-3.5" style={slide}>
          <KindIcon eventType={event.eventType} size={30} className="size-14 rounded-2xl" />
          <div className="min-w-0 flex-1">
            <p className="truncate font-mono text-xs uppercase tracking-wider text-muted-foreground">
              {titled ? (
                // The heading says the kind to a screen reader.
                <span aria-hidden="true">
                  <span className="font-bold text-foreground">{kind}</span> ·{' '}
                </span>
              ) : null}
              <time dateTime={event.occurredAt}>{DAY.format(occurred)}</time>
              <span aria-hidden="true"> · </span>
              {TIME.format(occurred)}
            </p>
            <h2
              id={titleId}
              className="mt-1 line-clamp-2 text-xl font-semibold leading-tight tracking-tight text-foreground [text-wrap:balance]"
            >
              {titled ? <span className="sr-only">{kind}: </span> : null}
              {heading}
            </h2>
          </div>
        </div>
      )}
    >
      <div className="-mx-6 -mb-6 flex min-h-0 flex-1 flex-col">
        <div
          key={event.id}
          className="scrollbar-slim flex min-h-0 flex-1 animate-step flex-col gap-4 overflow-y-auto px-6 pb-6 pt-1 [&>*]:shrink-0"
          style={slide}
        >
          <Figures event={event} delta={deltas.get(event.id) ?? null} quantity={quantity} />

          {event.trip ? <TripFigures event={event} /> : null}

          {note ? (
            <section aria-label="Note" className={TILE}>
              <h3 className="text-label uppercase text-muted-foreground">Note</h3>
              <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-foreground">
                {note}
              </p>
            </section>
          ) : null}

          <Attachments
            vehicleId={vehicleId}
            eventId={event.id}
            photos={attachments.get(event.id)?.photos ?? []}
            documents={attachments.get(event.id)?.documents ?? []}
            onAdded={onChanged}
          />
        </div>

        {/*
         * The foot holds still while the entry above it changes: delete on its own at the left,
         * the record's direction at the right, and when this was written down between them.
         */}
        <div className={cn(MODAL_BAR, 'py-3')}>
          <button
            type="button"
            aria-haspopup="dialog"
            aria-label="Delete entry"
            title="Delete entry"
            onClick={() => setDeleting(true)}
            className="grid size-9 place-items-center rounded-xl bg-destructive-soft text-destructive transition-[background-color,color,scale] hover:bg-destructive hover:text-destructive-foreground active:scale-95"
          >
            <Icon name="trash" size={16} />
          </button>
          <span className="ml-auto hidden font-mono text-xs uppercase tracking-wider text-muted-foreground sm:inline">
            Logged {LOGGED.format(new Date(event.createdAt))}
          </span>
          {/* One segmented control: the two directions are one decision. */}
          <div className="ml-auto flex items-center rounded-xl bg-muted/60 p-0.5 sm:ml-3">
            <Button
              size="sm"
              variant="ghost"
              disabled={!newer}
              onClick={() => step(newer, -1)}
              aria-label="Newer entry"
              title="Newer (←)"
            >
              <ChevronLeft className="size-4" aria-hidden="true" />
              <span className="hidden sm:inline">Newer</span>
            </Button>
            <span aria-hidden="true" className="h-4 w-px bg-border" />
            <Button
              size="sm"
              variant="ghost"
              disabled={!older}
              onClick={() => step(older, 1)}
              aria-label="Older entry"
              title="Older (→)"
            >
              <span className="hidden sm:inline">Older</span>
              <ChevronRight className="size-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
      </div>

      {deleting ? (
        <ConfirmDelete
          title={`Delete “${heading}”?`}
          description={
            event.cost
              ? 'It leaves the record, and its cost leaves the spending totals.'
              : 'It leaves the record for good.'
          }
          confirmLabel="Delete entry"
          pending={remove.isPending}
          error={remove.isError ? (remove.error as Error).message : null}
          onConfirm={() => remove.mutate()}
          onClose={() => setDeleting(false)}
        />
      ) : null}
    </Modal>
  );
}

/** A tile of the spec sheet, the house's surface for one labelled thing inside a dialog. */
const TILE = 'min-w-0 rounded-xl bg-muted/60 px-3.5 py-2.5';

interface Figure {
  label: string;
  value: ReactNode;
  caption?: ReactNode;
}

/**
 * Figures as rounded tiles, as many across as fit at 9rem — four in the dialog, two on a phone —
 * wrapping, with the tiles of a short last row stretching across it rather than leaving a hole.
 */
function Tiles({ figures, label }: { figures: Figure[]; label: string }) {
  if (figures.length === 0) return null;
  return (
    <dl aria-label={label} className="flex flex-wrap gap-1.5">
      {figures.map((figure) => (
        <div key={figure.label} className={cn(TILE, 'flex-[1_1_9rem]')}>
          <dt className="text-label uppercase text-muted-foreground">{figure.label}</dt>
          <dd className="mt-1 truncate font-mono text-lg font-semibold tabular-nums tracking-tight text-foreground">
            {figure.value}
          </dd>
          {figure.caption ? (
            <dd className="mt-0.5 truncate text-xs text-muted-foreground">{figure.caption}</dd>
          ) : null}
        </div>
      ))}
    </dl>
  );
}

function Figures({
  event,
  delta,
  quantity,
}: {
  event: VehicleEvent;
  delta: number | null;
  /** A fill's quantity, lifted off the front of its note ("42 L"). */
  quantity: string | null;
}) {
  const figures: Figure[] = [];
  if (event.cost) figures.push({ label: 'Cost', value: <Amount money={event.cost} large /> });
  if (event.odometer !== null) {
    figures.push({
      label: 'Odometer',
      value: formatDistance(event.odometer, event.odometerUnit),
      caption:
        delta !== null ? (
          <>
            <span className="font-mono font-semibold tabular-nums text-foreground">
              +{formatDistance(delta, event.odometerUnit)}
            </span>{' '}
            since last
          </>
        ) : undefined,
    });
  }
  if (quantity) {
    // What a litre (or kWh) cost, worked out the way a person would off the receipt.
    const amount = Number.parseFloat(quantity.replace(',', '.'));
    const unit = quantity.replace(/^[\d.,\s]+/, '');
    figures.push({
      label: event.eventType === 'CHARGE' ? 'Energy' : 'Fuel',
      value: quantity,
      caption:
        event.cost && amount > 0 ? (
          <>
            <span className="font-mono tabular-nums text-foreground">
              {formatMoney({
                amountMinor: Math.round(event.cost.amountMinor / amount),
                currency: event.cost.currency,
              })}
            </span>{' '}
            / {unit}
          </>
        ) : undefined,
    });
  }
  if (event.engineHours !== null) {
    figures.push({ label: 'Engine', value: `${event.engineHours.toLocaleString()} h` });
  }
  if (event.provider) {
    figures.push({
      label: 'Where',
      // A name, not a figure: set in the reading face, not mono.
      value: (
        <span title={event.provider} className="font-sans text-base tracking-normal">
          {event.provider}
        </span>
      ),
    });
  }
  return <Tiles label="Figures" figures={figures} />;
}

/** The mileage-log half of a trip, at the rate stored on it. */
function TripFigures({ event }: { event: VehicleEvent }) {
  const trip = event.trip!;
  const unit = event.odometerUnit === 'MI' ? 'mi' : 'km';
  return (
    <section aria-label="Mileage log" className="flex flex-col gap-2">
      <h3 className="text-label uppercase text-muted-foreground">Mileage log</h3>
      <Tiles
        label="Mileage log"
        figures={[
          {
            label: 'Purpose',
            value: (
              <span className="font-sans text-base tracking-normal">{humanise(trip.purpose)}</span>
            ),
          },
          {
            label: 'Distance',
            value: formatDistance(trip.distance, event.odometerUnit),
            caption:
              trip.startOdometer !== null
                ? `from ${formatDistance(trip.startOdometer, event.odometerUnit)}`
                : undefined,
          },
          ...(trip.rate ? [{ label: `Per ${unit}`, value: formatMoney(trip.rate) }] : []),
          ...(trip.deduction ? [{ label: 'Deduction', value: formatMoney(trip.deduction) }] : []),
        ]}
      />
    </section>
  );
}

/**
 * What is filed against the entry, under one heading: the photograph in view large, shown whole
 * over a soft copy of itself as the vehicle's hero shows its own, the rest as a strip to choose
 * from, then the papers. A receipt or the worn part is most often photographed after the fact, so
 * with nothing filed the rest of the frame is a place to drop one (or press to choose); once there
 * is something, adding more is the heading's own action.
 */
function Attachments({
  vehicleId,
  eventId,
  photos,
  documents,
  onAdded,
}: {
  vehicleId: string;
  eventId: string;
  photos: readonly VehiclePhoto[];
  documents: readonly VehicleDocument[];
  onAdded: () => void;
}) {
  const [at, setAt] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const position = Math.min(at, Math.max(photos.length - 1, 0));
  const photo = photos[position] ?? null;
  const count = photos.length + documents.length;
  const [dragging, setDragging] = useState(false);

  const add = useMutation({
    // One after another: a phone uploading five at once times them all out.
    mutationFn: async (files: File[]) => {
      for (const file of files) await uploadPhoto(api, vehicleId, file, { eventId });
    },
    meta: { toast: 'Photo added' },
    // Refreshed on failure too: the files before the one that failed did land.
    onSettled: onAdded,
  });

  const pick = () => input.current?.click();

  return (
    <section aria-label="Attachments" className={cn('flex flex-col gap-2', !count && 'grow')}>
      <div className="flex items-center gap-2">
        <h3 className="text-label uppercase text-muted-foreground">Attachments</h3>
        <span className="font-mono text-xs tabular-nums text-muted-foreground">
          {count ? pad(count) : 'None'}
        </span>
        {count ? (
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto"
            loading={add.isPending}
            onClick={pick}
          >
            <ImagePlus className="size-4" aria-hidden="true" />
            Add photo
          </Button>
        ) : null}
        <input
          ref={input}
          type="file"
          accept={PHOTO_TYPES}
          multiple
          hidden
          onChange={(change) => {
            const files = [...(change.target.files ?? [])];
            change.target.value = '';
            if (files.length) add.mutate(files);
          }}
        />
      </div>

      {!count ? (
        <button
          type="button"
          onClick={pick}
          aria-busy={add.isPending || undefined}
          onDragOver={(drag) => {
            if (!drag.dataTransfer.types.includes('Files')) return;
            drag.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(drop) => {
            drop.preventDefault();
            setDragging(false);
            const files = [...drop.dataTransfer.files].filter((file) =>
              file.type.startsWith('image/'),
            );
            if (files.length) add.mutate(files);
          }}
          className={cn(
            'flex min-h-28 grow flex-col items-center justify-center gap-2 rounded-2xl border border-dashed text-sm text-muted-foreground transition-colors aria-busy:animate-pulse',
            dragging
              ? 'border-foreground bg-muted text-foreground'
              : 'border-border-strong hover:bg-muted/60 hover:text-foreground',
          )}
        >
          <span className="grid size-10 place-items-center rounded-xl bg-muted">
            <ImagePlus className="size-5" aria-hidden="true" />
          </span>
          <span>
            <span className="font-semibold text-foreground">
              {add.isPending ? 'Adding…' : 'Drop a photo'}
            </span>{' '}
            or press to choose
          </span>
        </button>
      ) : null}

      {photo ? (
        <figure className="relative aspect-video overflow-hidden rounded-2xl bg-muted">
          <img
            aria-hidden="true"
            src={photo.thumbnailUrl!}
            alt=""
            className="absolute inset-0 size-full scale-110 object-cover opacity-50 blur-2xl"
          />
          <img
            key={photo.id}
            src={photo.url ?? photo.thumbnailUrl!}
            alt={photo.caption ?? 'Photo'}
            className="absolute inset-0 size-full animate-pop object-contain"
          />
          {photo.caption ? (
            <figcaption className="absolute bottom-3 left-3 max-w-[70%] truncate rounded-full bg-background/80 px-3 py-1 text-xs font-semibold text-foreground backdrop-blur">
              {photo.caption}
            </figcaption>
          ) : null}
          {photos.length > 1 ? (
            <span
              aria-live="polite"
              className="absolute bottom-3 right-3 rounded-full bg-background/80 px-2.5 py-1 font-mono text-xs font-semibold tabular-nums text-foreground backdrop-blur"
            >
              {pad(position + 1)} / {pad(photos.length)}
            </span>
          ) : null}
          <a
            href={photo.url ?? photo.thumbnailUrl!}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Open the full photo"
            title="Open the full photo"
            className="absolute right-3 top-3 grid size-9 place-items-center rounded-full bg-background/80 text-foreground shadow-float backdrop-blur transition-[background-color,scale] hover:bg-background active:scale-95"
          >
            <Maximize2 className="size-4" aria-hidden="true" />
          </a>
        </figure>
      ) : null}

      {photos.length > 1 ? (
        <div className="scroll-fade-x -mx-1 flex gap-1.5 overflow-x-auto px-1 py-1 [scrollbar-width:none]">
          {photos.map((item, i) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={i === position}
              aria-label={`Photo ${i + 1}${item.caption ? `, ${item.caption}` : ''}`}
              onClick={() => setAt(i)}
              className={cn(
                'relative size-12 shrink-0 overflow-hidden rounded-xl bg-muted transition-[opacity,box-shadow,scale] active:scale-95',
                i === position
                  ? 'ring-2 ring-foreground ring-offset-2 ring-offset-card'
                  : 'opacity-60 hover:opacity-100',
              )}
            >
              <img
                src={item.thumbnailUrl!}
                alt=""
                loading="lazy"
                className="absolute inset-0 size-full object-cover"
              />
            </button>
          ))}
        </div>
      ) : null}

      {documents.length ? (
        <ul className="flex flex-col gap-1.5">
          {documents.map((document) => (
            <li key={document.id}>
              <DocumentLine vehicleId={vehicleId} document={document} />
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** A paper filed against the entry: its picture or its type, what it is, and the way to open it. */
function DocumentLine({ vehicleId, document }: { vehicleId: string; document: VehicleDocument }) {
  const open = useOpenDocument(vehicleId, document.id);
  const extension = document.filename.includes('.') ? document.filename.split('.').at(-1)! : '';
  return (
    <button
      type="button"
      onClick={() => open.mutate()}
      aria-busy={open.isPending || undefined}
      className="group flex w-full items-center gap-3 rounded-xl bg-muted/60 p-1.5 pr-3.5 text-left transition-colors hover:bg-muted aria-busy:animate-pulse"
    >
      <span className="relative grid size-10 shrink-0 place-items-center overflow-hidden rounded-lg bg-card text-muted-foreground">
        {document.thumbnailUrl ? (
          <img
            src={document.thumbnailUrl}
            alt=""
            loading="lazy"
            className="absolute inset-0 size-full object-cover"
          />
        ) : (
          <Icon name="document" size={22} />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-foreground">
          {document.title}
        </span>
        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
          {humanise(document.documentType)}
          {extension ? (
            <>
              {' · '}
              <span className="font-mono uppercase">{extension}</span>
            </>
          ) : null}
          {' · '}
          <span className="font-mono tabular-nums">{formatBytes(document.sizeBytes)}</span>
        </span>
      </span>
      <ArrowUpRight
        className="size-4 shrink-0 text-muted-foreground transition-[color,translate] group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-foreground"
        aria-hidden="true"
      />
    </button>
  );
}
