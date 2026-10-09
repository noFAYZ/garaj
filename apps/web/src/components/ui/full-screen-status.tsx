'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import logoMark from '@/public/Logo.png';

/**
 * The app taking over for a moment: signing in, signing out.
 *
 * Auth is the one place where the thing that was pressed disappears before the next screen
 * arrives — the form submits, the session changes, and for a second or two nothing on screen
 * belongs to either state. A full-screen status says which way it is going, and the mark turning
 * inside the ring makes the wait feel like the app working rather than the app stuck.
 *
 * Rendered into `body` rather than where it is written. `position: fixed` is measured from the
 * viewport only while no ancestor has a `filter`, `backdrop-filter`, `transform` or `contain` —
 * any of those becomes the containing block instead. The sign-out status is written inside the
 * account menu, which sits in the header, and the header blurs what is behind it as it scrolls:
 * so `inset-0` meant the header's own box, and the overlay covered a strip at the top of the
 * page instead of the page. A portal is immune to wherever it gets mounted next.
 */
export function FullScreenStatus({ message }: { message: string }) {
  /*
   * There is no `document` on the server, and an overlay is only ever a response to something
   * the user just did — so first paint has nothing to miss.
   */
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  return createPortal(
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-50 grid animate-pop place-items-center bg-background/90 backdrop-blur-sm"
    >
      <div className="flex flex-col items-center gap-5">
        <span className="relative grid size-16 place-items-center">
          {/* The ring is the spinner; the mark inside it stays still and readable. */}
          <span
            aria-hidden="true"
            className="absolute inset-0 animate-spin rounded-full border-2 border-muted border-t-foreground"
          />
          <Image src={logoMark} alt="" priority className="h-7 w-auto" />
        </span>
        <p className="text-sm font-semibold text-foreground">{message}</p>
      </div>
    </div>,
    document.body,
  );
}
