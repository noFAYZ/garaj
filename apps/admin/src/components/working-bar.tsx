import { useIsFetching, useIsMutating } from '@tanstack/react-query';

/** A hairline across the top of the window while anything is loading or saving. */
export function WorkingBar() {
  const busy = useIsFetching() + useIsMutating() > 0;
  if (!busy) return null;
  return (
    <div
      role="progressbar"
      aria-label="Working"
      className="fixed inset-x-0 top-0 z-50 h-0.5 origin-left bg-primary [animation:pending-show_300ms_150ms_backwards,pending-sweep_1.2s_ease-in-out_infinite]"
    />
  );
}
