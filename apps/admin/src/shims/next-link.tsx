import type { AnchorHTMLAttributes } from 'react';

/** `next/link` for the web components the console reuses: here every link is a plain anchor. */
export default function Link({
  href,
  prefetch: _prefetch,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; prefetch?: boolean }) {
  return <a href={href} {...props} />;
}
