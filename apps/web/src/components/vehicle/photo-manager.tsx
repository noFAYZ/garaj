'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { ImagePlus, Star, Trash2 } from 'lucide-react';
import { photosQuery, vehicleQuery } from '@vehicle-os/api-client/react';
import { uploadPhoto } from '@vehicle-os/api-client';
import { api } from '@/lib/api';
import { FormError } from '@/components/ui/modal';
import { DropTile, isImage, PHOTO_TYPES } from '@/components/onboard-uploads';
import { Button, StatusRegion } from '@/components/ui/primitives';
import { Loading, Skeleton } from '@/components/ui/skeleton';

/**
 * A vehicle's photos: add, choose the featured one, delete.
 *
 * One component for the photos route and the dialog the hero's edit button opens, so the two
 * cannot drift into offering different things.
 */
export function PhotoManager({ vehicleId }: { vehicleId: string }) {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const photos = useQuery(photosQuery(api, vehicleId));
  // Already cached by the vehicle layout; it says which photo is featured.
  const vehicle = useQuery(vehicleQuery(api, vehicleId));
  const featuredId = vehicle.data?.primaryPhoto?.id ?? null;

  // The whole `vehicles` root: the hero's gallery, this grid and the garage cards' thumbnails
  // all show these photos.
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['vehicles'] });

  const upload = useMutation({
    // One at a time: three round trips per file, and ten in parallel is how a phone on a slow
    // connection times them all out.
    mutationFn: async (files: File[]) => {
      for (const file of files) await uploadPhoto(api, vehicleId, file);
    },
    onSuccess: refresh,
    // Refreshed on failure too: the files before the one that failed did land.
    onError: (uploadError: Error) => {
      setError(uploadError.message);
      refresh();
    },
  });

  const setFeatured = useMutation({
    mutationFn: (photoId: string) => api.vehicles.update(vehicleId, { primaryPhotoId: photoId }),
    onSuccess: refresh,
  });

  const remove = useMutation({
    mutationFn: (photoId: string) => api.photos.remove(vehicleId, photoId),
    onSuccess: refresh,
  });

  // A drop bypasses the picker's `accept`, so its filter is applied here as well.
  const take = (files: File[]) => {
    const images = files.filter(isImage);
    setError(images.length === files.length ? null : 'Only images can be added as photos.');
    if (images.length) upload.mutate(images);
  };
  const pick = () => inputRef.current?.click();

  const list = photos.data ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        {/* The noun is known; only the count waits. */}
        <StatusRegion>
          {photos.isPending ? (
            <Skeleton className="inline-block h-3.5 w-4 align-middle" />
          ) : (
            list.length
          )}{' '}
          {list.length === 1 ? 'photo' : 'photos'}
        </StatusRegion>

        <Button variant="primary" size="sm" loading={upload.isPending} onClick={pick}>
          <ImagePlus className="size-4" aria-hidden="true" />
          Add photos
        </Button>
      </div>

      <input
        ref={inputRef}
        type="file"
        multiple
        accept={PHOTO_TYPES}
        // The button is the control; the input only opens the picker.
        tabIndex={-1}
        aria-hidden="true"
        className="sr-only"
        onChange={(event) => {
          take(Array.from(event.target.files ?? []));
          // Reset so choosing the same file twice fires change again.
          event.target.value = '';
        }}
      />

      {error ? <FormError>{error}</FormError> : null}

      {photos.isPending ? (
        <Loading label="Loading photos">
          {/* The same square grid, so the thumbnails land where the placeholders were. */}
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {Array.from({ length: 6 }, (_, index) => (
              <li key={index}>
                <Skeleton className="aspect-square w-full rounded-xl" />
              </li>
            ))}
          </ul>
        </Loading>
      ) : list.length === 0 ? (
        <DropTile
          icon="camera"
          label="Add photos"
          hint="or drop them here — the first becomes the featured photo"
          busy={upload.isPending}
          blocked={upload.isPending}
          onPick={pick}
          onFiles={take}
          className="h-44"
        />
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {list.map((photo) => {
            const featured = photo.id === featuredId;
            return (
              <li
                key={photo.id}
                className="group relative aspect-square animate-pop overflow-hidden rounded-xl bg-muted"
              >
                {photo.thumbnailUrl || photo.url ? (
                  <img
                    src={photo.thumbnailUrl ?? photo.url ?? undefined}
                    alt={photo.caption ?? ''}
                    className="size-full object-cover"
                    loading="lazy"
                  />
                ) : null}

                {featured ? (
                  <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground">
                    <Star className="size-3 fill-current" aria-hidden="true" />
                    Featured
                  </span>
                ) : null}

                {/*
                 * Always in the DOM and always focusable — revealed on hover as decoration, but
                 * shown outright on touch and whenever one of them has keyboard focus.
                 */}
                <div className="absolute bottom-2 right-2 flex gap-0.5 rounded-xl bg-background/80 p-1 opacity-0 backdrop-blur transition-opacity focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
                  {featured ? null : (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => setFeatured.mutate(photo.id)}
                      // Only the photo being changed spins; the rest of the grid carries on.
                      loading={setFeatured.isPending && setFeatured.variables === photo.id}
                      aria-label="Make this the featured photo"
                    >
                      <Star className="size-4" aria-hidden="true" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => {
                      if (window.confirm('Delete this photo? This cannot be undone.')) {
                        remove.mutate(photo.id);
                      }
                    }}
                    loading={remove.isPending && remove.variables === photo.id}
                    aria-label="Delete this photo"
                    className="hover:bg-destructive-soft hover:text-destructive"
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </Button>
                </div>
              </li>
            );
          })}
          <li>
            <DropTile
              icon="add"
              label="Add more"
              busy={upload.isPending}
              blocked={upload.isPending}
              onPick={pick}
              onFiles={take}
              className="aspect-square w-full"
            />
          </li>
        </ul>
      )}
    </div>
  );
}
