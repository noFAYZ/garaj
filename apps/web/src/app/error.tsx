'use client';

import { Button, EmptyState } from '@/components/ui/primitives';

/**
 * A render error in any page, caught inside the app shell so the header and navigation
 * survive it. Without this file Next draws its bare default screen, and the only way back is
 * the browser's back button.
 */
export default function RouteError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <EmptyState
      title="Something went wrong"
      description="This page hit an error. Trying again usually clears it."
      action={
        <Button variant="primary" onClick={reset}>
          Try again
        </Button>
      }
    />
  );
}
