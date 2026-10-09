import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { authClient } from './api';

/** Signing out, with a flag for the status screen and every cached answer dropped after. */
export function useSignOut() {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);
  const signOut = async () => {
    setPending(true);
    try {
      await authClient.signOut();
    } finally {
      queryClient.clear();
      setPending(false);
    }
  };
  return { pending, signOut };
}
