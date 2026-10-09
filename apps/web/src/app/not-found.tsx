import Link from 'next/link';
import { buttonClass } from '@/components/ui/button-class';
import { EmptyState } from '@/components/ui/primitives';

/**
 * Any URL that matches no route, drawn inside the app shell rather than as Next's default.
 * The action is a styled link, not a `<Button>` inside a `<Link>`: a button nested in an
 * anchor is two interactive elements in one, and keyboard focus lands on both.
 */
export default function NotFound() {
  return (
    <EmptyState
      title="Page not found"
      description="The link may be out of date, or the page may have moved."
      action={
        <Link href="/" className={buttonClass('primary')}>
          Back to your garage
        </Link>
      }
    />
  );
}
