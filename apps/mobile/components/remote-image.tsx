import { useQueryClient } from '@tanstack/react-query';
import { Image, type ImageProps } from 'expo-image';
import { useState, type ReactNode } from 'react';

/*
 * When each image last asked for fresh links, so one that stays broken — an object deleted from
 * storage — asks once a minute rather than on every render of every card showing it.
 * ponytail: module-level map, never pruned; it holds one number per image seen this session.
 */
const lastRefresh = new Map<string, number>();
const REFRESH_EVERY_MS = 60_000;

/**
 * A private, signed image — a vehicle photo, a document preview — drawn so it caches and heals.
 *
 * Two things went wrong with a plain `<Image source={{ uri }}>`:
 *
 * - **Nothing was ever a cache hit.** Every API response signs its links afresh, so the same photo
 *   arrived under a new URL each time, and the image cache is keyed by URL. `cacheKey` keys it by
 *   what the picture *is* instead, so a photo downloads once and is read from disk after that.
 * - **An expired link stayed broken.** The query cache is restored from disk on launch, links and
 *   all, and a link past its life fails. Here a failure asks for fresh links (the vehicle queries
 *   are refetched) instead of settling on the fallback; the new URL arrives with the same
 *   `cacheKey` and loads.
 *
 * Until it loads, or when it cannot, `fallback` holds the space.
 */
export function RemoteImage({
  uri,
  cacheKey,
  fallback = null,
  refreshKey = ['vehicles'],
  ...props
}: Omit<ImageProps, 'source'> & {
  uri: string | null | undefined;
  /** Stable for the picture itself, e.g. `photo:<id>:cutout`. */
  cacheKey: string;
  fallback?: ReactNode;
  /** The query whose refetch mints fresh links. */
  refreshKey?: readonly unknown[];
}) {
  const queryClient = useQueryClient();
  const [failedUri, setFailedUri] = useState<string | null>(null);

  if (!uri || failedUri === uri) return <>{fallback}</>;

  return (
    <Image
      {...props}
      source={{ uri, cacheKey }}
      // Memory for scrolling back to it, disk for the next launch.
      cachePolicy="memory-disk"
      // Lists recycle views; without this a reused cell flashes the previous vehicle's photo.
      recyclingKey={cacheKey}
      onError={(event) => {
        setFailedUri(uri);
        const last = lastRefresh.get(cacheKey) ?? 0;
        if (Date.now() - last > REFRESH_EVERY_MS) {
          lastRefresh.set(cacheKey, Date.now());
          void queryClient.invalidateQueries({ queryKey: refreshKey });
        }
        props.onError?.(event);
      }}
    />
  );
}

/** The cache key for a vehicle photo: the cutout and the original are different pictures. */
export const photoKey = (photo: { id: string; isCutout?: boolean }, variant: 'thumb' | 'full') =>
  `photo:${photo.id}:${variant === 'thumb' && photo.isCutout ? 'cutout' : 'original'}`;
