'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { unstable_ViewTransition as ViewTransition, useState, type ReactNode } from 'react';
import type { Vehicle } from '@vehicle-os/contracts';
import {
  costQuery,
  monthlySpendQuery,
  photosQuery,
  readingsQuery,
  vehicleQuery,
} from '@vehicle-os/api-client/react';
import { api } from '@/lib/api';
import { EmptyState } from '@/components/ui/primitives';
import { Modal } from '@/components/ui/modal';
import { VehicleTabs } from '@/components/vehicle-tabs';
import { PhotoManager } from '@/components/vehicle/photo-manager';
import { VehicleMenu } from '@/components/vehicle/vehicle-menu';
import { VehicleHero, VehicleHeroSkeleton, vehicleTransitionName } from '@/components/vehicle-hero';
import { Loading } from '@/components/ui/skeleton';
import { windowStart } from '@/components/vehicle/spending-panel';

export default function VehicleLayout({ children }: { children: ReactNode }) {
  const params = useParams<{ vehicleId: string }>();
  const vehicleId = params.vehicleId;

  const queryClient = useQueryClient();

  /*
   * The list the card was clicked from already holds this vehicle. Drawing the hero from it
   * straight away skips the skeleton, and is what lets the card grow into the hero: a
   * skeleton in the hero's place has no shared element to morph into. The detail request
   * still runs and replaces it.
   *
   * `['vehicles', {filters}]` is a list; `['vehicles', id]` is a single vehicle.
   */
  const vehicle = useQuery({
    ...vehicleQuery(api, vehicleId),
    placeholderData: () =>
      queryClient
        .getQueriesData<{ data: Vehicle[] }>({
          predicate: ({ queryKey }) =>
            queryKey[0] === 'vehicles' && typeof queryKey[1] === 'object',
        })
        .flatMap(([, page]) => page?.data ?? [])
        .find((item) => item.id === vehicleId),
  });
  // The hero's gallery. Its own query so a slow photo list never holds up the name.
  const photos = useQuery(photosQuery(api, vehicleId));

  /*
   * The screen's spend, on its own query so it never holds up the rest — the same entry the
   * statistics tab reads, so moving to it refetches nothing.
   */
  const spend = useQuery(costQuery(api, vehicleId, { from: windowStart(12) }));
  // The screen's two traces, off the entries Statistics reads, for the same reason.
  const monthly = useQuery(monthlySpendQuery(api, vehicleId, 24));
  const trail = useQuery(readingsQuery(api, vehicleId, windowStart(12)));
  const [photosOpen, setPhotosOpen] = useState(false);

  if (vehicle.isError) {
    return (
      <EmptyState
        title="Vehicle not found"
        description="It may have been archived, or you may no longer have access to its garage."
      />
    );
  }

  /*
   * The frame is drawn before the vehicle arrives, not after it.
   *
   * Everything that does not depend on the response — the layout, the tab strip, the tab
   * body's own chrome — is correct the moment the route changes, so moving between tabs
   * never blanks the page back to a sentence about loading. Only what is genuinely unknown
   * is drawn as a placeholder, in the shape it will take.
   */
  const data = vehicle.data;

  return (
    <div className="flex flex-col gap-6">
      {/*
       * The vehicle itself, at the top of every one of its tabs. Same hero as the garage
       * screen, so moving between the two is the same object staying still rather than two
       * different presentations of it.
       */}
      {data ? (
        <ViewTransition name={vehicleTransitionName(data.id)}>
          <VehicleHero
            vehicle={data}
            action={<VehicleMenu vehicle={data} />}
            photos={photos.data}
            onEditPhotos={() => setPhotosOpen(true)}
            cost={spend.isPending ? undefined : (spend.data ?? null)}
            monthly={monthly.isPending ? undefined : (monthly.data ?? null)}
            trail={trail.data}
          />
        </ViewTransition>
      ) : (
        // The hero's own frame and figure labels, so the tab strip below does not jump when
        // the vehicle lands and nothing that is already known is drawn as a placeholder.
        <Loading label="Loading vehicle">
          <VehicleHeroSkeleton />
        </Loading>
      )}

      <VehicleTabs vehicleId={vehicleId} />

      <div>{children}</div>

      {/* Mounted only while open, so closing it drops any half-finished upload state. */}
      {photosOpen ? (
        <Modal
          title="Photos"
          description="The featured photo leads the gallery and the vehicle's card."
          icon="gallery"
          size="lg"
          onClose={() => setPhotosOpen(false)}
        >
          <PhotoManager vehicleId={vehicleId} />
        </Modal>
      ) : null}
    </div>
  );
}
