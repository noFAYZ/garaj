/**
 * Bring a row into view and mark it — where a warning light in the cockpit sends you.
 *
 * Centred rather than scrolled to the top, so the sticky header and tab strip never cover it; a
 * ring drawn once (`row-flash`) says which row you were sent to; and focus moves there too, so a
 * keyboard or a screen reader lands where the eye does. Returns false when the row is not on the
 * page, so the caller can navigate to where it is instead.
 */
export function revealRow(id: string): boolean {
  const row = document.getElementById(id);
  if (!row) return false;

  const reduce =
    document.documentElement.hasAttribute('data-reduce-motion') ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  row.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });

  if (!row.hasAttribute('tabindex')) row.setAttribute('tabindex', '-1');
  row.focus({ preventScroll: true });

  // Restarted, not stacked: a second press on the same light draws the ring again.
  row.classList.remove('row-flash');
  void row.offsetWidth;
  row.classList.add('row-flash');
  window.setTimeout(() => row.classList.remove('row-flash'), 1700);
  return true;
}
