import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MotionConfig } from 'motion/react';
import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { raise, Toaster } from '@/components/ui/toaster';
import { useReduceMotion } from '@/lib/settings/motion';
import { syncTheme, useTheme } from '@/lib/settings/theme';
import { ApiError } from './lib/api';
import { App } from './app';
import './index.css';

/**
 * What a mutation says when it lands: a fixed line, one written from its variables (so it can name
 * who changed), or `false` for a mutation that reports itself some other way.
 */
type ToastMeta = { toast?: string | false | ((variables: never) => string) } | undefined;

/** The web app's query client, minus the upgrade wall: every mutation reports itself. */
const queryClient = new QueryClient({
  mutationCache: new MutationCache({
    onSuccess: (_data, variables, _context, mutation) => {
      const toast = (mutation.options.meta as ToastMeta)?.toast;
      if (toast === false) return;
      raise(
        'success',
        typeof toast === 'function' ? toast(variables as never) : (toast ?? 'Saved'),
      );
    },
    onError: (error, _variables, _context, mutation) => {
      if ((mutation.options.meta as ToastMeta)?.toast !== false)
        raise('error', error instanceof Error ? error.message : 'Something went wrong');
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 2,
    },
    mutations: { retry: false },
  },
});

function Root() {
  const reduceMotion = useReduceMotion();
  const theme = useTheme();
  useEffect(() => {
    document.documentElement.toggleAttribute('data-reduce-motion', reduceMotion);
  }, [reduceMotion]);
  useEffect(() => syncTheme(), [theme]);

  return (
    <QueryClientProvider client={queryClient}>
      <MotionConfig reducedMotion={reduceMotion ? 'always' : 'user'}>
        <App />
        <Toaster />
      </MotionConfig>
    </QueryClientProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
