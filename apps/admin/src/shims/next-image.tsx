import type { ImgHTMLAttributes } from 'react';

/** `next/image` for the reused web components. Vite imports an image as its URL string. */
export default function Image({
  src,
  priority: _priority,
  ...props
}: Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> & {
  src: string | { src: string };
  priority?: boolean;
}) {
  return <img src={typeof src === 'string' ? src : src.src} {...props} />;
}
