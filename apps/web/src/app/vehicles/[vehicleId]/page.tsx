'use client';

import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useSearchParams } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { Plus } from 'lucide-react';
import type { VehicleEvent } from '@vehicle-os/contracts';
import {
  activityQuery,
  documentsQuery,
  photosQuery,
  queryKeys,
  vehicleQuery,
} from '@vehicle-os/api-client/react';
import { api } from '@/lib/api';
import { Icon } from '@/components/icons';
import { Button, EmptyState } from '@/components/ui/primitives';
import { ListSkeleton, Loading } from '@/components/ui/skeleton';
import { formatDate, formatDistance } from '@/lib/format';
import { cn } from '@/lib/utils';
import { afterFade, clearRequest } from '@/lib/open-add';
import {
  ENTRY_CARD,
  EntryHead,
  Fact,
  Facts,
  NotePreview,
  MonthHeading,
  TimelineRow,
  groupByMonth,
  startsDay,
} from '@/components/timeline';
import { fillQuantity } from '@vehicle-os/ui';
import { AddEntryDialog, isAddMode, type AddMode } from '@/components/vehicle/add-entry';
import {
  EntryDetails,
  attachmentsByEvent,
  type Attached,
} from '@/components/vehicle/entry-details';

/**
 * A vehicle's activity: everything about it, in one place.
 *
 * Every item is either planned — a one-off job or a repeating service, coming up — or done:
 * a service, a fill-up, a repair, a payment, a note. Spending is not a separate kind of thing;
 * a done item with a cost is filed as spending too. Completing a planned item makes it done.
 *
 * Read top to bottom it is a timeline: the record going back from today, month by month, to where
 * it starts. What is planned has its own tab, Reminders (`./reminders`).
 */
export default function ActivityPage() {
  const { vehicleId } = useParams<{ vehicleId: string }>();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();

  /*
   * `?add=done` or `?add=planned` opens the add dialog — Add in the section strip, the reminders'
   * tile, the cockpit and the dashboard all link here. Not until the route's cross-fade is over:
   * arriving from another tab runs one, and a dialog opened during it is drawn under the fade's
   * snapshots of the page — the hero over the form. On Activity itself the links change the URL in
   * place (`openHere`), so there is no fade and it opens on the next frame.
   */
  const requested = searchParams.get('add');
  const [adding, setAdding] = useState<AddMode | null>(null);
  useEffect(() => {
    if (isAddMode(requested)) return afterFade(() => setAdding(requested));
  }, [requested]);

  // The entry open in its dialog, by id: it stays the same entry while the record refetches.
  const [openId, setOpenId] = useState<string | null>(null);
  const [showOlder, setShowOlder] = useState(false);

  // `N` adds, from anywhere on the page that is not already taking typing.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'n' || event.metaKey || event.ctrlKey || event.altKey || event.repeat) {
        return;
      }
      const target = event.target as HTMLElement;
      if (target.closest('input, textarea, select, [contenteditable="true"], dialog')) return;
      event.preventDefault();
      setAdding('done');
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const vehicle = useQuery(vehicleQuery(api, vehicleId));
  const activity = useQuery(activityQuery(api, vehicleId));

  /*
   * Older entries, page by page, after the first. The first page's cursor is in the key: when an
   * entry is added the first page shifts by one, and older pages fetched from the old cursor would
   * skip the entry that crossed the boundary — a new cursor starts them again instead.
   */
  const firstCursor = activity.data?.done.pagination.nextCursor ?? null;
  const older = useInfiniteQuery({
    queryKey: [...queryKeys.activity(vehicleId, {}), 'older', firstCursor],
    queryFn: ({ pageParam }) => api.activity(vehicleId, { cursor: pageParam }),
    initialPageParam: firstCursor ?? '',
    getNextPageParam: (page) => page.done.pagination.nextCursor ?? undefined,
    enabled: showOlder && firstCursor !== null,
  });

  const planned = activity.data?.planned ?? [];
  const done = [
    ...(activity.data?.done.data ?? []),
    ...(showOlder ? (older.data?.pages.flatMap((page) => page.done.data) ?? []) : []),
  ];
  const hasMore = showOlder
    ? firstCursor !== null && (older.isPending || older.hasNextPage)
    : (activity.data?.done.pagination.hasMore ?? false);

  /*
   * What is filed against each entry. The same entries the hero's gallery and the Documents tab
   * read, so the timeline asks for nothing new.
   * ponytail: documents are the first page (25); one filed against an old entry past it is not drawn.
   */
  const photos = useQuery(photosQuery(api, vehicleId));
  const documents = useQuery(documentsQuery(api, vehicleId));
  const attachments = attachmentsByEvent(photos.data, documents.data?.data);

  const schedules = planned.flatMap((item) => (item.kind === 'SCHEDULE' ? [item.schedule] : []));
  const deltas = odometerDeltas(done);
  const groups = groupByMonth(done);

  function close() {
    setAdding(null);
    if (requested) clearRequest();
  }

  function refresh() {
    /*
     * An item can move the odometer, restart a schedule's clock and change the spending
     * totals, so the whole vehicle subtree goes — plus the task centre and the cross-garage
     * due list, which live outside it.
     */
    void queryClient.invalidateQueries({ queryKey: queryKeys.vehicle(vehicleId) });
    void queryClient.invalidateQueries({ queryKey: ['tasks'] });
    void queryClient.invalidateQueries({ queryKey: queryKeys.due() });
  }

  return (
    <div className="flex flex-col gap-8">
      {/*
       * A dialog rather than a form pushed into the page: opening it moved the whole activity
       * down under the pointer, and closing it moved it back. The feed stays exactly where it
       * was, and Escape or the backdrop dismisses it like any other dialog.
       */}
      {adding ? (
        <AddEntryDialog
          vehicleId={vehicleId}
          garageId={vehicle.data?.garageId}
          mode={adding}
          onModeChange={setAdding}
          schedules={schedules}
          onDone={() => {
            close();
            refresh();
          }}
          onClose={close}
          // `?say=` is a line typed on the home screen's add menu, handed over to check here.
          initialLine={searchParams.get('say') ?? ''}
        />
      ) : null}

      {openId ? (
        <EntryDetails
          vehicleId={vehicleId}
          events={done}
          openId={openId}
          deltas={deltas}
          attachments={attachments}
          onStep={setOpenId}
          onClose={() => setOpenId(null)}
          onChanged={refresh}
        />
      ) : null}

      <section aria-label="Record" className="flex flex-col gap-4">
        {activity.isPending ? (
          <Loading label="Loading activity">
            <ListSkeleton rows={5} />
          </Loading>
        ) : done.length === 0 ? (
          <EmptyState
            title="Nothing recorded yet"
            description="Every service, fill-up, repair, payment and note you add becomes part of this vehicle's activity."
            action={
              <Button variant="primary" aria-haspopup="dialog" onClick={() => setAdding('done')}>
                <Plus className="size-4" aria-hidden="true" />
                Log the first entry
              </Button>
            }
          />
        ) : (
          <>
            <div className="flex flex-col gap-6">
              {groups.map((group) => (
                <section
                  key={group.key}
                  id={`month-${group.key}`}
                  aria-label={`${group.month} ${group.year}`}
                  className="scroll-mt-36"
                >
                  {/*
                   * The month is a chapter heading that sticks under the section strip, not a row
                   * in the list: scrolling a long record, "which month am I in" is the question
                   * the page has to keep answering.
                   */}
                  <MonthHeading group={group} className="sticky top-32" />
                  <ol className="mt-2">
                    {group.items.map((event, index) => (
                      <DoneRow
                        key={event.id}
                        event={event}
                        attached={attachments.get(event.id)}
                        delta={deltas.get(event.id) ?? null}
                        onOpen={() => setOpenId(event.id)}
                        last={index === group.items.length - 1}
                        firstOfDay={startsDay(group.items, index)}
                        index={index}
                      />
                    ))}
                  </ol>
                </section>
              ))}
            </div>

            {hasMore ? (
              <Button
                className="self-center"
                loading={older.isFetching}
                onClick={() => (showOlder ? void older.fetchNextPage() : setShowOlder(true))}
              >
                Load older entries
              </Button>
            ) : (
              <Marker>
                Start of the record
                {done.length > 0 ? ` · ${formatDate(done.at(-1)!.occurredAt)}` : ''}
              </Marker>
            )}
            {older.isError ? (
              <p role="alert" className="text-center text-sm text-destructive">
                {(older.error as Error).message}
              </p>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}

/** A labelled hairline across the timeline. */
function Marker({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 text-muted-foreground">
      <span aria-hidden="true" className="h-px flex-1 bg-border" />
      <span className="font-mono text-xs uppercase tabular-nums tracking-wider">{children}</span>
      <span aria-hidden="true" className="h-px flex-1 bg-border" />
    </div>
  );
}

/**
 * One done item, as the logbook draws every entry (`components/timeline`), with what only a
 * vehicle's own record knows: where the odometer stood, who did it, the note, and the photos and
 * papers filed against it. The whole card opens the entry in full (`EntryDetails`).
 *
 * The distance since the previous reading is shown beside the reading itself. For fill-ups that is
 * the range of the last tank, and for services the distance since the one before; either is what a
 * person works out in their head when they read a logbook.
 */
function DoneRow({
  event,
  attached,
  delta,
  last,
  firstOfDay,
  index,
  onOpen,
}: {
  event: VehicleEvent;
  attached: Attached | undefined;
  onOpen: () => void;
  /** Distance since the previous entry with a reading, in the same unit; null when there is none. */
  delta: number | null;
  last: boolean;
  firstOfDay: boolean;
  /** Position in its month, for the entrance stagger. */
  index: number;
}) {
  const { quantity, rest: note } = fillQuantity(event.eventType, event.description);
  const facts = event.odometer !== null || quantity || event.provider;
  return (
    <TimelineRow occurredAt={event.occurredAt} firstOfDay={firstOfDay} last={last} index={index}>
      <article className={ENTRY_CARD}>
        {/*
         * Laid over the card rather than wrapping it, so the card's text stays plain text for a
         * screen reader and the button's name says what it opens.
         */}
        <button
          type="button"
          onClick={onOpen}
          aria-haspopup="dialog"
          aria-label={`Open ${event.title}, ${formatDate(event.occurredAt)}`}
          className="absolute inset-0 cursor-pointer rounded-2xl"
        />
        <EntryHead
          eventType={event.eventType}
          title={event.title}
          occurredAt={event.occurredAt}
          cost={event.cost}
        >
          {note ? <NotePreview text={note} /> : null}
          {attached ? <Attachments attached={attached} /> : null}
          {facts ? (
            <Facts>
              {event.odometer !== null ? (
                <Fact icon="odometer">
                  <span className="font-mono tabular-nums">
                    {formatDistance(event.odometer, event.odometerUnit)}
                    {delta !== null ? (
                      <span className="ml-1.5 text-foreground">
                        <span className="sr-only">, </span>+
                        {formatDistance(delta, event.odometerUnit)}
                      </span>
                    ) : null}
                  </span>
                </Fact>
              ) : null}
              {quantity ? (
                <Fact icon={event.eventType === 'CHARGE' ? 'battery' : 'fuel'}>
                  <span className="font-mono tabular-nums">{quantity}</span>
                </Fact>
              ) : null}
              {event.provider ? <Fact icon="garage">{event.provider}</Fact> : null}
            </Facts>
          ) : null}
        </EntryHead>
      </article>
    </TimelineRow>
  );
}

/**
 * An entry's photos and papers, as previews along its foot. Not each a way in of its own: the card
 * opens the entry, where each one is large and opens on a press. A paper with no picture of itself
 * shows its file type.
 */
function Attachments({ attached }: { attached: Attached }) {
  return (
    <ul aria-label="Attachments" className="flex flex-wrap gap-2">
      {attached.photos.map((photo) => (
        <li
          key={photo.id}
          className="relative size-16 shrink-0 overflow-hidden rounded-xl bg-muted"
        >
          <img
            src={photo.thumbnailUrl!}
            alt={photo.caption ?? 'Photo'}
            loading="lazy"
            className={cn(
              'absolute inset-0 size-full',
              photo.isCutout ? 'object-contain p-1' : 'object-cover',
            )}
          />
        </li>
      ))}
      {attached.documents.map((document) => {
        const extension = document.filename.includes('.')
          ? document.filename.split('.').at(-1)!
          : '';
        return (
          <li
            key={document.id}
            className="relative grid size-16 shrink-0 place-items-center overflow-hidden rounded-xl bg-muted text-muted-foreground"
          >
            {document.thumbnailUrl ? (
              <img
                src={document.thumbnailUrl}
                alt={document.title}
                loading="lazy"
                className="absolute inset-0 size-full object-cover"
              />
            ) : (
              <span className="flex flex-col items-center gap-1">
                <Icon name="document" size={22} />
                <span className="max-w-14 truncate font-mono text-[0.625rem] font-semibold uppercase tracking-wider">
                  {extension}
                </span>
                <span className="sr-only">{document.title}</span>
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Distance since the previous entry with a reading, keyed by event.
 *
 * Walked oldest to newest, because the list arrives newest first. Only a rise in the same unit
 * counts: a lower reading is a correction or a cluster swap, and a mixed pair is not comparable.
 */
function odometerDeltas(events: readonly VehicleEvent[]): Map<string, number> {
  const deltas = new Map<string, number>();
  let previous: VehicleEvent | null = null;

  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]!;
    if (event.odometer === null) continue;
    if (
      previous?.odometer != null &&
      previous.odometerUnit === event.odometerUnit &&
      event.odometer > previous.odometer
    ) {
      deltas.set(event.id, event.odometer - previous.odometer);
    }
    previous = event;
  }

  return deltas;
}
