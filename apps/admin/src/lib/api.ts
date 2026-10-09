import { createAuthClient } from 'better-auth/react';
import { ApiError } from '@vehicle-os/api-client';
import type { UserProfile } from '@vehicle-os/contracts';

export const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';

/** Better Auth against the API, like the web app. The API lists this origin as trusted. */
export const authClient = createAuthClient({ baseURL: `${API_URL}/api/auth` });

/**
 * `/api/v1/admin/*`. A dozen lines rather than an `admin` namespace in the shared client: web
 * and mobile never call these, and the shared client stays the product's surface.
 */
export async function adminApi<T>(
  method: 'GET' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(`${API_URL}/api/v1/admin${path}`, {
    method,
    credentials: 'include',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw await ApiError.fromResponse(response);
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

export const get = <T>(path: string) => adminApi<T>('GET', path);

/** A path with its query, leaving out what is empty: `withQuery('/users', { q: '' })` is `/users`. */
export const withQuery = (path: string, query: Record<string, string | number | undefined>) => {
  const params = new URLSearchParams(
    Object.entries(query)
      .filter(
        (entry): entry is [string, string | number] => entry[1] !== undefined && entry[1] !== '',
      )
      .map(([key, value]) => [key, String(value)]),
  ).toString();
  return params ? `${path}?${params}` : path;
};

export { ApiError };

export interface Page<T> {
  data: T[];
  hasMore: boolean;
}

export type Plan = 'FREE' | 'PLUS' | 'BUSINESS';

export interface Overview {
  counts: {
    users: number;
    newUsers: number;
    unverified: number;
    garages: number;
    vehicles: number;
    /** Distinct people with a signed-in request in the last five minutes. */
    online: number;
  };
  /** People at each step of setting up: in a garage, with a vehicle, with a record written. */
  funnel: { garage: number; vehicle: number; record: number };
  vehicleTypes: { type: string; count: number }[];
  plans: Partial<Record<'PLUS' | 'BUSINESS', number>>;
  environment: string;
  integrations: { name: string; detail: string; on: boolean }[];
}

export interface UserRow {
  id: string;
  name: string;
  email: string;
  image: string | null;
  emailVerified: boolean;
  createdAt: string;
  plan: Plan;
  garages: number;
  lastSeenAt: string | null;
  isAdmin: boolean;
}

export interface AdminAccount {
  id: string;
  /** All null for an id in `ADMIN_USER_IDS` that matches no account. */
  name: string | null;
  email: string | null;
  image: string | null;
  lastSeenAt: string | null;
}

export interface ErrorEntry {
  id: string;
  at: string;
  source: 'ai' | 'email' | 'push' | 'outbox';
  /** The feature, the reminder type, or `queue · job`. */
  kind: string;
  message: string | null;
  userId: string | null;
  email: string | null;
  attempts: number | null;
}

export interface UserDetail extends UserProfile {
  /** The last 30 days. */
  usage: {
    aiRequests: number;
    aiTokens: number;
    emails: number;
    pushes: number;
    notifications: number;
  };
  devices: { platform: string; createdAt: string }[];
  emailVerified: boolean;
  createdAt: string;
  isAdmin: boolean;
  subscription: {
    plan: Plan;
    status: string;
    stripeCustomerId: string | null;
    stripeSubscriptionId: string | null;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
  } | null;
  memberships: { garageId: string; name: string; role: string; vehicles: number }[];
  sessions: {
    id: string;
    ipAddress: string | null;
    userAgent: string | null;
    createdAt: string;
    updatedAt: string;
    expiresAt: string;
  }[];
}

export interface GarageRow {
  id: string;
  name: string;
  description: string | null;
  defaultCurrency: string;
  createdAt: string;
  ownerId: string;
  ownerEmail: string;
  ownerName: string;
  ownerImage: string | null;
  members: number;
  vehicles: number;
}

export interface VehicleRow {
  id: string;
  nickname: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  vehicleType: string;
  status: string;
  registrationIdentifier: string | null;
  currentOdometer: number | null;
  odometerUnit: string;
  createdAt: string;
  garageId?: string;
  garageName?: string;
}

export interface VehicleDetail extends VehicleRow {
  variant: string | null;
  color: string | null;
  identificationNumber: string | null;
  currentEngineHours: number | null;
  purchaseDate: string | null;
  purchasePriceAmountMinor: number | null;
  purchasePriceCurrency: string | null;
  garageId: string;
  /** A signed link to the primary photo — the cutout when one has been made. */
  photoUrl: string | null;
  isCutout: boolean;
  garage: { id: string; name: string; defaultCurrency: string };
  owner: { id: string; name: string; email: string; image: string | null } | null;
  addedBy: { id: string; name: string; email: string; image: string | null } | null;
  counts: { events: number; documents: number; photos: number; openTasks: number; plans: number };
  /** Totals by currency and category, in minor units. */
  spending: { currency: string; category: string; amountMinor: number }[];
  recentEvents: {
    id: string;
    eventType: string;
    title: string;
    occurredAt: string;
    odometer: number | null;
    costAmountMinor: number | null;
    costCurrency: string | null;
    provider: string | null;
  }[];
  maintenance: {
    id: string;
    title: string;
    nextDueDate: string | null;
    nextDueOdometer: number | null;
    lastPerformedAt: string | null;
  }[];
}

export interface GarageDetail extends Omit<
  GarageRow,
  'ownerEmail' | 'ownerName' | 'ownerImage' | 'members' | 'vehicles'
> {
  costReporting: string;
  members: { userId: string; name: string; email: string; image: string | null; role: string }[];
  vehicles: VehicleRow[];
}

export interface AuditEntry {
  id: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  actorEmail: string | null;
  garageId: string | null;
  metadata: Record<string, unknown>;
  /** Ties the entry to the request in the API's structured logs. */
  requestId: string | null;
  ipAddress: string | null;
  createdAt: string;
}

export interface FlagState {
  flag: string;
  enabled: boolean;
  default: boolean;
  override: boolean | null;
  available: boolean;
}

export interface ActivityDay {
  day: string;
  signups: number;
  garages: number;
  vehicles: number;
  records: number;
  aiRequests: number;
  aiTokens: number;
  emails: number;
  pushes: number;
  deliveryFailures: number;
  emailFailures: number;
  pushFailures: number;
}

export interface Activity {
  activeUsers: { day: number; week: number; month: number };
  days: ActivityDay[];
}

export interface Usage {
  ai: {
    configured: boolean;
    model: string;
    requests: number;
    errors: number;
    turns: number;
    inputTokens: number;
    outputTokens: number;
    avgLatencyMs: number | null;
    p95LatencyMs: number | null;
    topUsers: {
      userId: string | null;
      email: string | null;
      name: string | null;
      requests: number;
      tokens: number;
    }[];
    recentErrors: { createdAt: string; error: string | null; email: string | null }[];
  };
  email: { configured: boolean; from: string; sent: number; failed: number };
  push: { sent: number; failed: number; devices: { platform: string; count: number }[] };
  notifications: {
    created: number;
    read: number;
    byType: { type: string; channel: string; count: number }[];
  };
  recentFailures: {
    createdAt: string;
    channel: string;
    type: string;
    error: string | null;
    email: string | null;
  }[];
}

export interface QueueState {
  name: string;
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  completed: number;
  recentFailures: {
    id: string;
    name: string | null;
    reason: string | null;
    at: string | null;
    attempts: number | null;
  }[];
}

export type RedisState =
  | { configured: false }
  | { configured: true; provider: string; error: string }
  | {
      configured: true;
      provider: string;
      error?: undefined;
      pingMs: number;
      version: string | null;
      uptimeSeconds: number | null;
      usedMemory: number | null;
      peakMemory: number | null;
      maxMemory: number | null;
      clients: number | null;
      opsPerSecond: number | null;
      totalCommands: number | null;
      hitRate: number | null;
      evictedKeys: number | null;
      keys: number;
      queues: QueueState[];
    };

export interface SystemState {
  redis: RedisState;
  outbox: {
    pending: number;
    oldestPendingAt: string | null;
    deadLettered: number;
    processedLastDay: number;
    recentDeadLetters: {
      id: string;
      queue: string;
      jobName: string;
      attempts: number;
      lastError: string | null;
      deadLetteredAt: string;
    }[];
  };
}
