'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Car, Home, LogOut, Settings } from 'lucide-react';
import { motion } from 'motion/react';
import { unstable_ViewTransition as ViewTransition, useState, type ReactNode } from 'react';
import { avatarFor } from '@vehicle-os/contracts';
import { AskConsole } from '@/components/ask-console';
import { HeaderSearch } from '@/components/header-search';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/motion/popover';
import { NotificationBell } from '@/components/notification-bell';
import { SettingsButton, SettingsDialog } from '@/components/settings-dialog';
import { useProfile } from '@/components/settings-panel';
import { FullScreenStatus } from '@/components/ui/full-screen-status';
import { buttonClass } from '@/components/ui/button-class';
import { cn } from '@/lib/utils';
import { signOut, useSession, type SessionUser } from '@/lib/auth-client';
import { useHydrated } from '@/lib/hooks/use-hydrated';
import logoMark from '@/public/Logo.png';
import logoText from '@/public/logo-text.png';
import logoTextLight from '@/public/logo-text-light.png';

/**
 * Two places, not six.
 *
 * Search became the header's own control, so a link to it was a second way to reach what is
 * already on screen. Tasks and Ask are destinations you arrive at from what you are looking
 * at — the dashboard's task card, a vehicle's quick actions — rather than places you set out
 * for, and their routes are unchanged. Settings is a dialog now, because it is a detour from
 * whatever you were doing and a modal returns you to it.
 */
const NAV = [
  { href: '/', label: 'Garage', icon: Home },
  { href: '/vehicles', label: 'Vehicles', icon: Car },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { data: session, isPending } = useSession();

  /*
   * The session is not knowable on the server, but it often is on the client's first render —
   * better-auth resolves it from the cookie synchronously. The header then rendered three
   * more children than the server sent, and React reported a hydration mismatch against the
   * first stable element it found, which is the brand link.
   *
   * Deferring by one commit is the whole fix: the chrome appears a frame later, which nobody
   * perceives, and the server and client agree on the render that has to match.
   */
  const hydrated = useHydrated();
  const user = hydrated && !isPending ? (session?.user ?? null) : null;
  const [settingsOpen, setSettingsOpen] = useState(false);

  /*
   * The auth pages and the public passport are their own full-page layouts. Wrapping them in
   * the app chrome would show navigation to someone who cannot use any of it — and on `/p/`
   * the reader has no account at all, so a sign-out button and a link to "your garage" would
   * be worse than noise.
   */
  if (
    pathname.startsWith('/sign-in') ||
    pathname.startsWith('/sign-up') ||
    pathname.startsWith('/p/')
  ) {
    return <main className="min-h-dvh bg-background">{children}</main>;
  }

  return (
    <div className="min-h-dvh bg-background">
      
      <header className="header-scroll sticky top-0 z-20">
        {/* On a phone, open search takes the logo's and the navigation's place. */}
        <div className="group/header mx-auto flex h-16 max-w-7xl items-center gap-2 px-4 sm:gap-3">
          <Link
            href="/"
            aria-label="Garaj home"
            className="flex shrink-0 items-center rounded-xl max-sm:group-has-[[data-search=open]]/header:hidden"
          >
            {/*
             * The wordmark wherever it fits — with search folded into a button on phones, it does
             * from 360px. The black tyre alone was near invisible on the dark header.
             */}
            <Image src={logoMark} alt="" priority className="h-7 w-auto min-[22.5rem]:hidden" />
            {/* The wordmark per theme: black type on paper, white type on carbon. */}
            <Image
              src={logoText}
              alt=""
              priority
              className="hidden h-6 w-auto min-[22.5rem]:block md:h-7 dark:min-[22.5rem]:hidden"
            />
            <Image
              src={logoTextLight}
              alt=""
              priority
              className="hidden h-6 w-auto md:h-7 dark:min-[22.5rem]:block"
            />
          </Link>

          {/*
           * A segmented track, so the two destinations read as one control with one choice
           * made, rather than two loose links.
           */}
          <nav
            aria-label="Main"
            className="flex shrink-0 items-center gap-0.5 rounded-full bg-card/50 p-1 max-sm:group-has-[[data-search=open]]/header:hidden"
          >
            {NAV.map(({ href, label, icon: NavIcon }) => {
              // Exact match for the root, prefix elsewhere — otherwise "/" stays highlighted
              // on every page because every path starts with it.
              const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? 'page' : undefined}
                  // The label is hidden on phones, so the link names itself there.
                  aria-label={label}
                  className={cn(
                    'relative isolate flex h-8 items-center gap-2 rounded-full px-2.5 text-sm font-semibold transition-colors sm:px-3.5',
                    active
                      ? 'text-foreground'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                >
                  {/*
                   * One pill that slides between destinations instead of one that blinks out
                   * and another that blinks in, so the move reads as a change of place.
                   */}
                  {active ? (
                    <motion.span
                      layoutId="main-nav-active"
                      className="absolute inset-0 -z-10 rounded-full bg-primary-soft"
                      transition={{ type: 'spring', bounce: 0.18, duration: 0.32 }}
                      aria-hidden="true"
                    />
                  ) : null}
                  <NavIcon className="size-4" aria-hidden="true" />
                  <span className="hidden sm:inline">{label}</span>
                </Link>
              );
            })}
          </nav>

          {/* Only for a signed-in caller: search is scoped to the garages they belong to. */}
          {user ? <HeaderSearch /> : null}

          {/* On a phone the search button carries the `ml-auto`, so it sits with this group. */}
          <div className={cn('flex shrink-0 items-center gap-1', user ? 'sm:ml-auto' : 'ml-auto')}>
            {user ? (
              <>
                {/* Only for a signed-in caller: the endpoint is scoped to a user id. */}
                <NotificationBell />
                <AccountMenu user={user} onOpenSettings={() => setSettingsOpen(true)} />
              </>
            ) : (
              /* The theme toggle moved inside settings, where the other preferences are. */
              <SettingsButton onOpen={() => setSettingsOpen(true)} />
            )}
          </div>
        </div>
      </header>

      {/* Route changes cross-fade instead of cutting; the header above stays put. */}
      {/* The bottom padding keeps the last row clear of the GarajAI pill. */}
      <main className="mx-auto max-w-5xl px-4 pb-24 pt-8">
        <ViewTransition>{children}</ViewTransition>
      </main>

      {/* Signed in only (the endpoint is per person), and not on Ask's own page. */}
      {user && !pathname.startsWith('/ask') ? <AskConsole /> : null}

      {/* Mounted only when opened, so closing resets whatever was scrolled or expanded. */}
      {settingsOpen ? <SettingsDialog open onClose={() => setSettingsOpen(false)} /> : null}
    </div>
  );
}

/*
 * The face from the profile rather than the session: the session's copy of the user is cached in
 * its cookie for five minutes, and a picture just changed in settings should show at once.
 */
function Avatar({ user, size }: { user: SessionUser; size: 'sm' | 'lg' }) {
  const profile = useProfile();
  return (
    <img
      src={avatarFor({ id: user.id, image: profile.data?.image ?? user.image })}
      alt=""
      className={cn(
        'shrink-0 rounded-full bg-primary-soft object-cover',
        size === 'sm' ? 'size-8' : 'size-10',
      )}
    />
  );
}

/**
 * Who you are, settings, and the way out — behind your own avatar.
 *
 * Settings and sign-out were two loose glyphs beside the bell: three unlabelled icons in a row
 * nobody can tell apart at a glance, and a sign-out one mis-tap away. Behind the avatar they
 * get words, and leaving takes a deliberate second click.
 *
 * Plain buttons, not `role="menu"`: a menu role promises arrow-key roving focus, and a role
 * that promises behaviour the element lacks is worse for a screen reader than no role.
 */
function AccountMenu({ user, onOpenSettings }: { user: SessionUser; onOpenSettings: () => void }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  /*
   * Awaited, then navigated. It used to be fire-and-forget: the menu closed, the cookie cleared
   * somewhere, and the page stayed put until something happened to notice — which read as the
   * button not working.
   */
  const leave = async () => {
    setOpen(false);
    setSigningOut(true);
    try {
      await signOut();
    } finally {
      router.replace('/sign-in');
    }
  };
  const choose = (action: () => void) => () => {
    setOpen(false);
    action();
  };

  const item =
    'flex h-10 w-full items-center gap-3 rounded-xl px-2.5 text-left text-sm font-semibold transition-colors [&_svg]:size-4 [&_svg]:shrink-0';

  return (
    <>
      {signingOut ? <FullScreenStatus message="Signing you out…" /> : null}
      <Popover open={open} onOpenChange={setOpen} side="bottom" align="end" sideOffset={10}>
        <PopoverTrigger>
          <button
            type="button"
            aria-label={`Account: ${user.name || user.email}`}
            className={buttonClass('ghost', 'icon', 'rounded-full')}
          >
            <Avatar user={user} size="sm" />
          </button>
        </PopoverTrigger>

        <PopoverContent className="w-64 max-w-[90vw] p-1.5">
          <div className="flex min-w-0 items-center gap-3 px-2.5 pb-3 pt-2">
            <Avatar user={user} size="lg" />
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-foreground">
                {user.name || 'Your account'}
              </div>
              <div className="truncate text-xs text-muted-foreground">{user.email}</div>
            </div>
          </div>

          <button
            type="button"
            onClick={choose(onOpenSettings)}
            className={cn(item, 'text-foreground hover:bg-muted')}
          >
            <Settings aria-hidden="true" className="text-muted-foreground" />
            Settings
          </button>
          <button
            type="button"
            onClick={() => void leave()}
            className={cn(item, 'text-destructive hover:bg-destructive-soft')}
          >
            <LogOut aria-hidden="true" />
            Sign out
          </button>
        </PopoverContent>
      </Popover>
    </>
  );
}
