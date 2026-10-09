import type { MouseEvent } from 'react';
import type { useRouter } from 'next/navigation';

/*
 * Dialogs a page opens from its own URL (`?add=…`): Activity's add dialog, Documents' upload.
 *
 * Every navigation runs the app's route cross-fade, and a dialog that opens during one is drawn
 * under the fade's snapshots of the page — the hero over the form. So a link to a dialog on the
 * page already showing changes the URL in place (`history.replaceState`, which `useSearchParams`
 * follows) rather than navigating, and a page that arrives with one opens it once the fade is over.
 */

type Router = ReturnType<typeof useRouter>;

/** Goes to `href`: in place when its page is the one showing, by a navigation otherwise. */
export function openHere(router: Router, href: string) {
  if (window.location.pathname === href.split('?')[0]) window.history.replaceState(null, '', href);
  else router.push(href, { scroll: false });
}

/**
 * The props of a link that opens a page's dialog: a real `href`, so a new tab or a copied link
 * still works, and a plain click handled by `openHere`. `before` runs first — closing a dialog
 * the link sits in.
 */
export function addLinkProps(router: Router, href: string, before?: () => void) {
  return {
    href,
    onClick: (event: MouseEvent<HTMLAnchorElement>) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }
      event.preventDefault();
      before?.();
      openHere(router, href);
    },
  };
}

/** Whether a view transition is running. A browser without the pseudo-class runs none. */
function fading(): boolean {
  try {
    return document.documentElement.matches(':active-view-transition');
  } catch {
    return false;
  }
}

/** Runs `open` on the first frame no cross-fade is running. Returns the cancel, for an effect. */
export function afterFade(open: () => void): () => void {
  let frame = 0;
  const tick = () => {
    if (fading()) frame = requestAnimationFrame(tick);
    else open();
  };
  frame = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(frame);
}

/** Drops `?add=…` once its dialog closes, in place, so a reload does not reopen it. */
export function clearRequest() {
  window.history.replaceState(null, '', window.location.pathname);
}
