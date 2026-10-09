import { cn } from '@/lib/utils';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon' | 'icon-sm';

const VARIANTS: Record<ButtonVariant, string> = {
  // The key utility (globals.css) owns the face, lip, shadow and every state; adding hover or
  // shadow utilities here would override it mid-press.
  primary: 'key',
  secondary:
    'border border-border/70 bg-muted text-foreground hover:bg-border hover:border-border hover:shadow-[0_4px_14px_-5px_var(--color-shadow)] aria-expanded:bg-border',
  ghost:
    'text-muted-foreground hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground',
  danger:
    'bg-destructive text-destructive-foreground hover:bg-destructive-hover hover:shadow-[0_4px_14px_-4px_var(--color-shadow)]',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 rounded-lg px-3 text-sm',
  md: 'h-10 rounded-xl px-4 text-sm',
  lg: 'h-12 rounded-2xl px-6 text-base',
  icon: 'size-9 rounded-xl',
  'icon-sm': 'size-8 rounded-lg',
};

export function buttonClass(
  variant: ButtonVariant = 'secondary',
  size: ButtonSize = 'md',
  className?: string,
) {
  return cn(
    /*
     * Base
     */
    'group relative isolate inline-flex select-none items-center justify-center',
    'gap-2 whitespace-nowrap font-semibold',
    'overflow-hidden',
    '[&_svg]:shrink-0',

    /*
     * Smooth material response
     */
    // `translate`/`scale`, not `transform`: Tailwind v4 moves with those properties.
    'transition-[background-color,border-color,color,box-shadow,translate,scale]',
    'duration-200 ease-out',

    /*
     * Subtle physical response
     */
    'hover:-translate-y-px',
    'active:translate-y-0 active:scale-[0.985]',

    /*
     * Keyboard focus: the base `:focus-visible` outline (globals.css), not a ring — a ring is a
     * box-shadow and would erase the key's lip.
     */

    /*
     * Disabled / busy
     */
    'disabled:pointer-events-none disabled:opacity-50',
    'aria-busy:opacity-100',

    /*
     * Directional icons
     */
    '[&_.lucide-arrow-right]:transition-transform [&_.lucide-arrow-right]:duration-200',
    'hover:[&_.lucide-arrow-right]:translate-x-0.5',
    '[&_.lucide-chevron-right]:transition-transform [&_.lucide-chevron-right]:duration-200',
    'hover:[&_.lucide-chevron-right]:translate-x-0.5',

    /*
     * Reduced motion
     */
    'motion-reduce:translate-none motion-reduce:scale-none motion-reduce:transition-none',
    'motion-reduce:[&_svg]:transition-none',

    SIZES[size],
    VARIANTS[variant],
    className,
  );
}
