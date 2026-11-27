import Image from 'next/image';
import { buttonClass } from '@/components/ui/button-class';
import { BRAND, NAV, SIGN_UP } from '../site';
import logoText from '../assets/logo-text.png';
import logoTextLight from '../assets/logo-text-light.png';
import { ThemeToggle } from './theme-toggle';

/**
 * The site's bar, on every page: a glass slab in the app's leaf shape, floating a little below
 * the top and as wide as the content. It sits over the page rather than above it (the negative
 * margin), so the hero's copper runs up behind it; scrolling frosts and tightens it (landing.css).
 */
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 -mb-[4.5rem] h-[4.5rem] px-3 pt-3 sm:px-4">
      <div className="site-bar relative mx-auto flex h-[3.25rem] max-w-3xl items-center gap-1 pl-4 pr-1.5 sm:pl-5">
        <a href="/" aria-label={BRAND} className="mr-auto flex shrink-0 items-center rounded-xl">
          <Image src={logoText} alt="" priority className="h-6 w-auto dark:hidden" />
          <Image src={logoTextLight} alt="" priority className="hidden h-6 w-auto dark:block" />
        </a>
        <nav
          aria-label="Sections"
          className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-0.5 lg:flex"
        >
          {NAV.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="rounded-full px-3.5 py-2 text-sm font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {item.label}
            </a>
          ))}
        </nav>
        <ThemeToggle />

        <a href={SIGN_UP} className={buttonClass('primary', 'md')}>
          Start free
        </a>
      </div>
    </header>
  );
}
