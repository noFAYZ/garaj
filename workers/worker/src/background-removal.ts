/**
 * Background removal for vehicle thumbnails, against Pixelcut.
 *
 * The photo is handed over as a signed storage URL rather than uploaded: object storage
 * already mints one, so the worker never moves the original's bytes at all. The URL is
 * short-lived and unguessable, but it is still a private photo reaching a third party —
 * that is inherent to using a hosted remover, and the only way to avoid it is a local one.
 */

import { env } from '@vehicle-os/config';

export class BackgroundRemovalError extends Error {
  /**
   * True when retrying cannot help: the image is too small, the wrong format, rejected.
   * A 429 or a 5xx is the opposite — the same request later is exactly what fixes it.
   */
  readonly permanent: boolean;

  constructor(message: string, permanent = false) {
    super(message);
    this.permanent = permanent;
  }
}

/** False when no key is configured, which is how the caller knows to leave the photo alone. */
export function backgroundRemovalConfigured(): boolean {
  return Boolean(env().BG_REMOVAL_API_KEY);
}

/** The cutout's bytes. PNG, because a cutout without an alpha channel is just a photo. */
export async function removeBackground(imageUrl: string): Promise<Blob> {
  const config = env();
  const apiKey = config.BG_REMOVAL_API_KEY;
  if (!apiKey) throw new BackgroundRemovalError('No background removal key configured');

  const response = await fetch(config.BG_REMOVAL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-API-KEY': apiKey,
    },
    /*
     * `crop` trims the transparent canvas back to the subject. Without it the cutout keeps
     * the original photo's frame, so a car that filled a third of a wide shot is a third of
     * the tile with nothing around it — the thumbnail reads as zoomed out. Cropped, the
     * card's `object-contain` has the car itself to fit rather than its empty margins.
     */
    body: JSON.stringify({ image_url: imageUrl, format: 'png', crop: true }),
  });

  if (!response.ok) {
    // The body carries the provider's reason — a quota, a rejected image — and losing it
    // leaves a failed job saying only "402".
    const detail = await response.text().catch(() => '');
    const permanent = response.status >= 400 && response.status < 500 && response.status !== 429;
    throw new BackgroundRemovalError(
      `Background removal failed: ${response.status} ${detail.slice(0, 200)}`,
      permanent,
    );
  }

  // The answer is a URL to the result, not the result: one more fetch, and it is the only
  // place the cutout's bytes exist before they reach the bucket.
  const body = (await response.json()) as { result_url?: string };
  if (!body.result_url) {
    throw new BackgroundRemovalError('Background removal returned no result_url');
  }

  const result = await fetch(body.result_url);
  if (!result.ok) {
    throw new BackgroundRemovalError(`Could not read the cutout: ${result.status}`);
  }
  return result.blob();
}
