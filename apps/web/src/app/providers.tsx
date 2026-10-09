'use client';

import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MotionConfig } from 'motion/react';
import { useEffect, useState, type ReactNode } from 'react';
import { ApiError, planWall } from '@vehicle-os/api-client';
import { CheckoutReturn, UpgradeDialog } from '@/components/upgrade-dialog';
import { openUpgrade } from '@/lib/upgrade';
import { raise, Toaster } from '@/components/ui/toaster';
import { useReduceMotion } from '@/lib/settings/motion';
import { syncTheme, useGlass, useTheme } from '@/lib/settings/theme';

function createQueryClient() {
  return new QueryClient({
    /*
     * Every create, update and delete says what happened, wired once here rather than at two
     * hundred call sites. A mutation that is its own feedback — one whose result is the screen
     * changing under you — opts out with `meta: { toast: false }`.
     */
    mutationCache: new MutationCache({
      onSuccess: (_data, _variables, _context, mutation) => {
        const meta = mutation.options.meta as { toast?: string | false } | undefined;
        if (meta?.toast === false) return;
        raise('success', meta?.toast ?? 'Saved');
      },
      onError: (error, _variables, _context, mutation) => {
        /*
         * A refusal that costs money opens the upgrade wall, wherever it came from — adding a
         * vehicle, inviting someone, sharing a passport, or a feature added next year. One
         * branch here instead of a wall per screen, so no gated action can forget to have one.
         * It runs before the opt-out: a mutation that toasts nothing still hit a wall.
         */
        const wall = planWall(error);
        if (wall) {
          openUpgrade(wall);
          return;
        }
        const meta = mutation.options.meta as { toast?: string | false } | undefined;
        if (meta?.toast === false) return;
        raise('error', error instanceof Error ? error.message : 'Something went wrong');
      },
    }),
    defaultOptions: {
      queries: {
        // Vehicle data changes on human timescales, not machine ones. A minute of staleness
        // avoids a refetch storm every time someone tabs back to the window.
        staleTime: 60_000,
        retry(failureCount, error) {
          /*
           * Retrying a 4xx is pointless and actively harmful: a 401 retried three times
           * is three more chances to trip the rate limiter, and a 404 will not become a
           * 200 on the second attempt.
           */
          if (error instanceof ApiError && error.status < 500) return false;
          return failureCount < 2;
        },
      },
      mutations: { retry: false },
    },
  });
}

export function Providers({ children }: { children: ReactNode }) {
  // Created in state, not at module scope: a module-level client is shared across requests
  // on the server and would leak one user's cached data into another's render.
  const [queryClient] = useState(createQueryClient);
  const reduceMotion = useReduceMotion();

  // View transitions are CSS pseudo-elements that `MotionConfig` cannot reach; globals.css
  // reads this attribute to switch them off.
  useEffect(() => {
    document.documentElement.toggleAttribute('data-reduce-motion', reduceMotion);
  }, [reduceMotion]);

  /*
   * The device switching theme, or a choice made in another tab, re-renders this through the
   * store; the effect brings the document along. It reads the live preference rather than the
   * rendered value: on the hydration render the store reports the server's guess, and applying
   * that would flash the wrong theme over the one the head script already set.
   */
  const theme = useTheme();
  const glass = useGlass();
  useEffect(() => {
    syncTheme();
  }, [theme, glass]);

  return (
    <QueryClientProvider client={queryClient}>
      {/*
       * The bridge that makes the in-app reduce-motion setting real. beUI components read
       * `useReducedMotion` from `motion`, which only sees the OS media query — without this
       * the app's own toggle governs hand-written CSS animation and nothing else, while
       * every vendored component keeps moving.
       */}
      <MotionConfig reducedMotion={reduceMotion ? 'always' : 'user'}>
        {children}
        {/* Mounted once, above everything: a save reports itself from whatever screen raised it. */}
        <Toaster />
        {/* Likewise the upgrade wall — opened by the error handler above, from any screen. */}
        <UpgradeDialog />
        {/* And the return from Stripe: checkout comes back to whichever page it left. */}
        <CheckoutReturn />
      </MotionConfig>
    </QueryClientProvider>
  );
}
