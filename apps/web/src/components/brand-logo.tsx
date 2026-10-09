'use client';

import { useState } from 'react';
import { domainForMake } from '@vehicle-os/ui';

/**
 * A manufacturer's logo, from logo.dev.
 *
 * Fetched by domain rather than bundled. The previous version inlined 39 SVGs for 42 kB
 * gzipped and covered a fraction of the marques people actually own; this covers everything
 * in `@vehicle-os/ui`'s `vehicle-makes.ts` for the cost of a name-to-domain map, and the images are cached by
 * the browser like any other.
 *
 * `NEXT_PUBLIC_LOGO_DEV_TOKEN` is a publishable key — it is meant to be in the page, which
 * is why the URL is built on the client and there is no proxy route here.
 */
const TOKEN = process.env.NEXT_PUBLIC_LOGO_DEV_TOKEN;

export function logoUrlFor(make: string | null | undefined, size: number): string | null {
  const domain = domainForMake(make);
  if (!domain || !TOKEN) return null;
  return `https://img.logo.dev/${domain}?token=${TOKEN}&size=${size * 2}&format=png`;
}

/**
 * The logo, or the make's initial.
 *
 * Three things fall back to the letter, and all three are ordinary: a make not in the map, a
 * deployment with no token, and a request that fails at the CDN. None of them should leave a
 * hole in the layout, and none should show another company's mark — so the fallback is the
 * initial rather than a stand-in glyph.
 */
export function BrandLogo({
  make,
  size = 24,
  fill = false,
  className,
}: {
  make: string | null | undefined;
  size?: number;
  /**
   * Covers its box edge to edge rather than being drawn at `size`, which then only picks the
   * resolution fetched. For a tile that is the logo, not a logo sitting in a tile.
   */
  fill?: boolean;
  className?: string;
}) {
  const box = fill ? '100%' : size;
  const [failed, setFailed] = useState(false);
  const url = logoUrlFor(make, size);

  if (!url || failed) {
    return (
      <span
        aria-hidden="true"
        className={className}
        style={{
          width: box,
          height: box,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: size * 0.5,
          fontWeight: 600,
          flexShrink: 0,
        }}
      >
        {(make ?? '?').trim().slice(0, 1).toUpperCase()}
      </span>
    );
  }

  return (
    <img
      src={url}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      // A logo that 404s or is blocked falls back to the initial rather than the browser's
      // broken-image glyph, which is the one outcome that looks like a bug.
      onError={() => setFailed(true)}
      className={className}
      style={{ width: box, height: box, objectFit: fill ? 'cover' : 'contain', flexShrink: 0 }}
    />
  );
}
