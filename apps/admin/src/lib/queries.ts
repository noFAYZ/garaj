import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  API_URL,
  get,
  type Activity,
  type AdminAccount,
  type FlagState,
  type Overview,
  type SystemState,
  type Usage,
} from './api';

/*
 * The reads more than one screen shares, with one key and one set of options each: the sidebar,
 * the palette and the pages ask for the same data and get the one cached answer.
 */

export interface Health {
  status: 'ok' | 'degraded';
  uptimeSeconds: number;
  checks: { database: 'up' | 'down'; redis: 'up' | 'down' | 'disabled' };
}

export const useOverview = () =>
  useQuery({ queryKey: ['admin', 'overview'], queryFn: () => get<Overview>('/overview') });

/**
 * Always the longest window, sliced by whoever reads it: one request serves every range, and the
 * window before this one — what a delta compares against — is already in it for 7 and 30 days.
 */
export const useActivity = () =>
  useQuery({
    queryKey: ['admin', 'activity', 90],
    queryFn: () => get<Activity>('/activity?days=90'),
  });

export const useUsage = (days: number) =>
  useQuery({
    queryKey: ['admin', 'usage', days],
    queryFn: () => get<Usage>(`/usage?days=${days}`),
    placeholderData: keepPreviousData,
  });

/*
 * Read on open and on Refresh only — never on an interval. Each read is a couple of dozen Redis
 * commands, and on a per-request plan a polling dashboard would be Redis's biggest user.
 */
export const useSystem = () =>
  useQuery({
    queryKey: ['admin', 'system'],
    queryFn: () => get<SystemState>('/system'),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

/** The public health check: cheap, so it is the one thing that keeps itself fresh. */
export const useHealth = () =>
  useQuery({
    queryKey: ['admin', 'health'],
    queryFn: async () => {
      const response = await fetch(`${API_URL}/api/v1/health`, { cache: 'no-store' });
      return (await response.json()) as Health;
    },
    refetchInterval: 30_000,
  });

export const useFlags = () =>
  useQuery({ queryKey: ['admin', 'flags'], queryFn: () => get<FlagState[]>('/flags') });

export const useAdmins = () =>
  useQuery({ queryKey: ['admin', 'admins'], queryFn: () => get<AdminAccount[]>('/admins') });
