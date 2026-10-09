import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { humanise } from '@/lib/format';
import { adminApi, type FlagState, type Plan } from './api';

/*
 * Every change the console makes, once: the row menus, the detail sheets and the palette all call
 * these, so a plan set from any of them refreshes the same lists and says the same thing. The
 * toast is written from the variables (see `main.tsx`), so it names who changed.
 */

interface Person {
  id: string;
  name: string;
  email: string;
}

const who = (person: Person) => person.name || person.email;

function refreshUser(queryClient: QueryClient, id: string) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ['admin', 'user', id] }),
    queryClient.invalidateQueries({ queryKey: ['admin', 'users'] }),
    queryClient.invalidateQueries({ queryKey: ['admin', 'overview'] }),
    queryClient.invalidateQueries({ queryKey: ['admin', 'palette'] }),
  ]);
}

export function useSetPlan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ person, plan }: { person: Person; plan: Plan }) =>
      adminApi('PATCH', `/users/${person.id}`, { plan }),
    onSuccess: (_data, { person }) => refreshUser(queryClient, person.id),
    meta: {
      toast: ({ person, plan }: { person: Person; plan: Plan }) =>
        `${who(person)} is on ${humanise(plan)} now`,
    },
  });
}

export function useVerifyEmail() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ person, verified }: { person: Person; verified: boolean }) =>
      adminApi('PATCH', `/users/${person.id}`, { emailVerified: verified }),
    onSuccess: (_data, { person }) => refreshUser(queryClient, person.id),
    meta: {
      toast: ({ person, verified }: { person: Person; verified: boolean }) =>
        `${person.email} marked ${verified ? 'verified' : 'unverified'}`,
    },
  });
}

export function useRevokeSessions() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ person }: { person: Person }) =>
      adminApi('DELETE', `/users/${person.id}/sessions`),
    onSuccess: (_data, { person }) => refreshUser(queryClient, person.id),
    meta: { toast: ({ person }: { person: Person }) => `Signed ${who(person)} out everywhere` },
  });
}

export function useDeleteUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ person }: { person: Person }) => adminApi('DELETE', `/users/${person.id}`),
    onSuccess: async (_data, { person }) => {
      queryClient.removeQueries({ queryKey: ['admin', 'user', person.id] });
      await queryClient.invalidateQueries({ queryKey: ['admin'] });
    },
    meta: { toast: ({ person }: { person: Person }) => `Deleted ${who(person)}` },
  });
}

export function useDeleteGarage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ garage }: { garage: { id: string; name: string } }) =>
      adminApi('DELETE', `/garages/${garage.id}`),
    onSuccess: async (_data, { garage }) => {
      queryClient.removeQueries({ queryKey: ['admin', 'garage', garage.id] });
      await queryClient.invalidateQueries({ queryKey: ['admin'] });
    },
    meta: {
      toast: ({ garage }: { garage: { id: string; name: string } }) => `Deleted ${garage.name}`,
    },
  });
}

/** `null` returns a flag to its default; `true`/`false` pins it there. */
export function useSetFlags() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: Record<string, boolean | null>) =>
      adminApi<FlagState[]>('PATCH', '/flags', patch),
    onSuccess: (next) => queryClient.setQueryData(['admin', 'flags'], next),
    meta: { toast: 'Feature updated' },
  });
}
