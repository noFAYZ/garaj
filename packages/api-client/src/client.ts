/**
 * Typed API client, shared by web and mobile (Architecture.md §65).
 *
 * Types come from `@vehicle-os/contracts` — the same TypeBox schemas the server validates
 * against — so a contract change is a compile error in both clients rather than a runtime
 * surprise in one of them.
 */

import type {
  ApiKey,
  CreateApiKey,
  CreatedApiKey,
  CheckoutSession,
  PlanPrices,
  PlanState,
  StartCheckout,
  Downgrade,
  AiAnswer,
  AiModels,
  AddGarageMember,
  AskQuestion,
  DraftVehicle,
  LookUpVehicle,
  CompleteMaintenance,
  ConditionAssessment,
  ConditionSummary,
  CostSummary,
  CostTrends,
  MonthlySpend,
  CreateConditionAssessment,
  CreateShareLink,
  CreateValuation,
  Dashboard,
  CreateEvent,
  CreateExpense,
  CreateGarage,
  CreateMaintenancePlan,
  CreateTask,
  CreateVehicle,
  DocumentDownload,
  DocumentUploadTicket,
  DueItem,
  DueStatus,
  EventWithWarnings,
  Expense,
  Income,
  CreateIncome,
  ExportQuery,
  FuelPrices,
  ImportReport,
  ImportRequest,
  ExpiringDocument,
  FinalizeDocumentUpload,
  FinalizePhotoUpload,
  UpdateConditionAssessment,
  Garage,
  GarageMember,
  LogMaintenance,
  MaintenanceCompletion,
  MaintenancePlan,
  MaintenanceRecord,
  MileageReport,
  Notification,
  NotificationPreference,
  PhotoUploadTicket,
  RegisterDevice,
  SearchResponse,
  Task,
  TaskBuckets,
  UpdateDocument,
  UpdateEvent,
  UpdateExpense,
  UpdateGarage,
  UpdateMaintenancePlan,
  UpdateTask,
  UpdateUserProfile,
  UpdateVehicle,
  UserProfile,
  ShareLink,
  Valuation,
  ValuationSummary,
  Vehicle,
  VehicleActivity,
  VehicleDocument,
  VehicleDraft,
  VehicleLookup,
  VehicleHealth,
  VehiclePassport,
  VehicleEvent,
  VehiclePhoto,
  VehicleTypeDescriptor,
  VinDecodeResult,
} from '@vehicle-os/contracts';

export interface Page<T> {
  data: T[];
  pagination: { nextCursor: string | null; hasMore: boolean };
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    requestId: string;
    fields?: Record<string, string>;
  };
}

/**
 * A failed request, carrying the server's structured error.
 *
 * `fields` is what lets a form put "Must be greater than or equal to 0" next to the input
 * that caused it, instead of showing one generic banner for every kind of failure.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  static async fromResponse(response: Response): Promise<ApiError> {
    let body: ApiErrorBody | undefined;
    try {
      body = (await response.json()) as ApiErrorBody;
    } catch {
      // A proxy timeout or a crash before the error handler ran returns HTML or nothing.
      // Still an error worth reporting, just without the structured detail.
    }
    return new ApiError(
      response.status,
      body?.error.code ?? 'UNKNOWN_ERROR',
      body?.error.message ?? response.statusText ?? 'Request failed',
      body?.error.requestId ?? '',
      body?.error.fields,
    );
  }
}

export interface ClientOptions {
  readonly baseUrl: string;
  /**
   * Mobile passes a bearer token from secure storage; the web app relies on the session
   * cookie and passes nothing.
   */
  readonly getAuthHeader?: () => Promise<Record<string, string>> | Record<string, string>;
  readonly fetch?: typeof fetch;
}

export function createApiClient(options: ClientOptions) {
  const doFetch = options.fetch ?? globalThis.fetch;
  const base = options.baseUrl.replace(/\/$/, '');

  async function request<T>(
    method: string,
    path: string,
    body?: unknown,
    query?: Record<string, string | number | undefined | string[]>,
  ): Promise<T> {
    const url = new URL(`${base}/api/v1${path}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value === undefined) continue;
      // Repeated keys, not a comma-joined string: the API reads `?eventType=A&eventType=B`.
      if (Array.isArray(value)) value.forEach((entry) => url.searchParams.append(key, entry));
      else url.searchParams.set(key, String(value));
    }

    const response = await doFetch(url.toString(), {
      method,
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(await options.getAuthHeader?.()),
      },
      // Session cookies are cross-origin from the web app (:3000 to :3001), so they only
      // travel with credentials included — and the API's CORS config names that origin.
      credentials: 'include',
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (!response.ok) throw await ApiError.fromResponse(response);
    // 204 has no body; parsing it would throw on a perfectly successful delete.
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  /**
   * A response that is a file rather than a record.
   *
   * Fetched rather than linked to: the session cookie is cross-origin from the web app, so
   * a plain `<a href>` navigation would arrive unauthenticated and download the login page.
   * The filename comes back in `Content-Disposition` — the server already decided it, and a
   * second opinion in the client is how the two end up disagreeing.
   */
  async function download(
    path: string,
    query?: Record<string, string | number | undefined>,
  ): Promise<{ blob: Blob; filename: string }> {
    const url = new URL(`${base}/api/v1${path}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    const response = await doFetch(url.toString(), {
      headers: { ...(await options.getAuthHeader?.()) },
      credentials: 'include',
    });
    if (!response.ok) throw await ApiError.fromResponse(response);

    const disposition = response.headers.get('content-disposition') ?? '';
    const named = /filename="([^"]+)"/.exec(disposition);
    return { blob: await response.blob(), filename: named?.[1] ?? 'export' };
  }

  return {
    request,
    download,

    users: {
      me: () => request<UserProfile>('GET', '/users/me'),
      updateMe: (body: UpdateUserProfile) => request<UserProfile>('PATCH', '/users/me', body),
      capabilities: () =>
        request<{ garages: Record<string, string[]> }>('GET', '/users/me/capabilities'),
      /** Plan, entitlements, ceilings and usage — what the upgrade walls and settings read. */
      plan: () => request<PlanState>('GET', '/users/me/plan'),
    },

    /**
     * Subscriptions. Both return a provider URL to send the person to; neither changes the
     * plan — only the provider's webhook does, so a client never has to reconcile a plan it
     * guessed at with the one that was paid for.
     */
    billing: {
      prices: () => request<PlanPrices>('GET', '/billing/prices'),
      checkout: (body: StartCheckout) =>
        request<CheckoutSession>('POST', '/billing/checkout', body),
      portal: (body: { returnPath?: string } = {}) =>
        request<CheckoutSession>('POST', '/billing/portal', body),
      /** Ask the provider what the caller now has; for the return from checkout. */
      sync: () => request<void>('POST', '/billing/sync'),
      /** Down to a smaller plan: Free cancels at the period's end, a paid tier switches now. */
      downgrade: (plan: Downgrade['plan']) => request<void>('POST', '/billing/downgrade', { plan }),
      /** Withdraw a pending cancellation. */
      resume: () => request<void>('POST', '/billing/resume'),
    },

    garages: {
      list: () => request<Garage[]>('GET', '/garages'),
      get: (garageId: string) => request<Garage>('GET', `/garages/${garageId}`),
      create: (body: CreateGarage) => request<Garage>('POST', '/garages', body),
      update: (garageId: string, body: UpdateGarage) =>
        request<Garage>('PATCH', `/garages/${garageId}`, body),
      remove: (garageId: string) => request<void>('DELETE', `/garages/${garageId}`),
      members: (garageId: string) => request<GarageMember[]>('GET', `/garages/${garageId}/members`),
      addMember: (garageId: string, body: AddGarageMember) =>
        request<GarageMember>('POST', `/garages/${garageId}/members`, body),
      updateMember: (garageId: string, memberId: string, role: GarageMember['role']) =>
        request<GarageMember>('PATCH', `/garages/${garageId}/members/${memberId}`, { role }),
      assignDrivers: (garageId: string, vehicleId: string, memberIds: string[]) =>
        request<GarageMember[]>('PUT', `/garages/${garageId}/vehicles/${vehicleId}/drivers`, {
          memberIds,
        }),
      assignVehicles: (garageId: string, memberId: string, vehicleIds: string[]) =>
        request<GarageMember>('PUT', `/garages/${garageId}/members/${memberId}/vehicles`, {
          vehicleIds,
        }),
      removeMember: (garageId: string, memberId: string) =>
        request<void>('DELETE', `/garages/${garageId}/members/${memberId}`),
    },

    vehicles: {
      types: () => request<VehicleTypeDescriptor[]>('GET', '/vehicles/types'),
      list: (query?: { garageId?: string; status?: string; limit?: number; cursor?: string }) =>
        request<Page<Vehicle>>('GET', '/vehicles', undefined, query),
      get: (vehicleId: string) => request<Vehicle>('GET', `/vehicles/${vehicleId}`),
      create: (body: CreateVehicle) => request<Vehicle>('POST', '/vehicles', body),
      update: (vehicleId: string, body: UpdateVehicle) =>
        request<Vehicle>('PATCH', `/vehicles/${vehicleId}`, body),
      archive: (vehicleId: string) => request<void>('DELETE', `/vehicles/${vehicleId}`),
      /** Candidates for the add form from the VIN; nothing is stored. */
      decodeVin: (vin: string) => request<VinDecodeResult>('POST', '/vehicles/decode-vin', { vin }),
    },

    events: {
      list: (
        vehicleId: string,
        query?: {
          eventType?: string[];
          from?: string;
          to?: string;
          limit?: number;
          cursor?: string;
        },
      ) => request<Page<VehicleEvent>>('GET', `/vehicles/${vehicleId}/events`, undefined, query),
      get: (vehicleId: string, eventId: string) =>
        request<VehicleEvent>('GET', `/vehicles/${vehicleId}/events/${eventId}`),
      create: (vehicleId: string, body: CreateEvent) =>
        request<EventWithWarnings>('POST', `/vehicles/${vehicleId}/events`, body),
      update: (vehicleId: string, eventId: string, body: UpdateEvent) =>
        request<EventWithWarnings>('PATCH', `/vehicles/${vehicleId}/events/${eventId}`, body),
      remove: (vehicleId: string, eventId: string) =>
        request<void>('DELETE', `/vehicles/${vehicleId}/events/${eventId}`),
      /** Trips in a period by purpose, with deductions at each trip's own rate. */
      mileageReport: (vehicleId: string, query: { from: string; to: string }) =>
        request<MileageReport>('GET', `/vehicles/${vehicleId}/mileage-report`, undefined, query),
      mileageReportCsv: (vehicleId: string, query: { from: string; to: string }) =>
        download(`/vehicles/${vehicleId}/mileage-report`, { ...query, format: 'csv' }),
    },

    /**
     * Everything about a vehicle as one feed: planned items (schedules and open tasks) on the
     * first page, and done items (events — every expense among them) paginated.
     */
    activity: (
      vehicleId: string,
      query?: { eventType?: string[]; limit?: number; cursor?: string },
    ) => request<VehicleActivity>('GET', `/vehicles/${vehicleId}/activity`, undefined, query),

    maintenance: {
      /** Due work across every garage — the dashboard's "attention required" list. */
      due: () => request<DueItem[]>('GET', '/vehicles/due'),
      plans: (vehicleId: string, query?: { status?: DueStatus; includeInactive?: boolean }) =>
        request<MaintenancePlan[]>('GET', `/vehicles/${vehicleId}/maintenance`, undefined, {
          status: query?.status,
          includeInactive:
            query?.includeInactive === undefined ? undefined : String(query.includeInactive),
        }),
      plan: (vehicleId: string, planId: string) =>
        request<MaintenancePlan>('GET', `/vehicles/${vehicleId}/maintenance/${planId}`),
      createPlan: (vehicleId: string, body: CreateMaintenancePlan) =>
        request<MaintenancePlan>('POST', `/vehicles/${vehicleId}/maintenance`, body),
      updatePlan: (vehicleId: string, planId: string, body: UpdateMaintenancePlan) =>
        request<MaintenancePlan>('PATCH', `/vehicles/${vehicleId}/maintenance/${planId}`, body),
      removePlan: (vehicleId: string, planId: string) =>
        request<void>('DELETE', `/vehicles/${vehicleId}/maintenance/${planId}`),
      /*
       * One call writes the record, the timeline event and the expense. The response carries
       * the plan with its clock already reset, so the list updates from it without a refetch.
       */
      complete: (vehicleId: string, planId: string, body: CompleteMaintenance) =>
        request<MaintenanceCompletion>(
          'POST',
          `/vehicles/${vehicleId}/maintenance/${planId}/complete`,
          body,
        ),
      /** An unscheduled repair — history with no plan behind it. */
      log: (vehicleId: string, body: LogMaintenance) =>
        request<MaintenanceCompletion>('POST', `/vehicles/${vehicleId}/maintenance/records`, body),
      records: (vehicleId: string) =>
        request<MaintenanceRecord[]>('GET', `/vehicles/${vehicleId}/maintenance/records`),
    },

    expenses: {
      list: (
        vehicleId: string,
        query?: { category?: string; from?: string; to?: string; limit?: number; cursor?: string },
      ) => request<Page<Expense>>('GET', `/vehicles/${vehicleId}/expenses`, undefined, query),
      get: (vehicleId: string, expenseId: string) =>
        request<Expense>('GET', `/vehicles/${vehicleId}/expenses/${expenseId}`),
      create: (vehicleId: string, body: CreateExpense) =>
        request<Expense>('POST', `/vehicles/${vehicleId}/expenses`, body),
      update: (vehicleId: string, expenseId: string, body: UpdateExpense) =>
        request<Expense>('PATCH', `/vehicles/${vehicleId}/expenses/${expenseId}`, body),
      remove: (vehicleId: string, expenseId: string) =>
        request<void>('DELETE', `/vehicles/${vehicleId}/expenses/${expenseId}`),
      /** Every figure computed server-side, in one currency (§27). */
      cost: (vehicleId: string, query?: { from?: string; to?: string }) =>
        request<CostSummary>('GET', `/vehicles/${vehicleId}/cost`, undefined, query),
      /**
       * Consumption over time, the ownership curve and distance per year — the shapes behind
       * the figures in `cost`, in the same currency and unit.
       */
      trends: (vehicleId: string) =>
        request<CostTrends>('GET', `/vehicles/${vehicleId}/cost/trends`),
      /**
       * Price per unit per fill and per place, in the same currency as `cost` — one series
       * per fuel the vehicle takes, so a plug-in hybrid answers with litres and kWh.
       */
      fuelPrices: (vehicleId: string) =>
        request<FuelPrices[]>('GET', `/vehicles/${vehicleId}/cost/fuel-prices`),
      /** Spend per month, zeros included, in the same currency as `cost`. */
      monthly: (vehicleId: string, query?: { months?: number }) =>
        request<MonthlySpend>('GET', `/vehicles/${vehicleId}/cost/monthly`, undefined, {
          months: query?.months === undefined ? undefined : String(query.months),
        }),
    },

    /** What a vehicle earned (GAPS §14). A plan feature: a free garage answers 402. */
    income: {
      list: (
        vehicleId: string,
        query?: { category?: string; from?: string; to?: string; limit?: number; cursor?: string },
      ) => request<Page<Income>>('GET', `/vehicles/${vehicleId}/income`, undefined, query),
      create: (vehicleId: string, body: CreateIncome) =>
        request<Income>('POST', `/vehicles/${vehicleId}/income`, body),
    },

    documents: {
      list: (
        vehicleId: string,
        query?: { documentType?: string; expiringOnly?: boolean; limit?: number; cursor?: string },
      ) =>
        request<Page<VehicleDocument>>('GET', `/vehicles/${vehicleId}/documents`, undefined, {
          documentType: query?.documentType,
          limit: query?.limit,
          cursor: query?.cursor,
          expiringOnly: query?.expiringOnly === undefined ? undefined : String(query.expiringOnly),
        }),
      requestUpload: (vehicleId: string, file: { name: string; type: string; size: number }) =>
        request<DocumentUploadTicket>('POST', `/vehicles/${vehicleId}/documents/upload-url`, {
          filename: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
        }),
      finalize: (vehicleId: string, documentId: string, body: FinalizeDocumentUpload) =>
        request<VehicleDocument>(
          'POST',
          `/vehicles/${vehicleId}/documents/${documentId}/finalize`,
          body,
        ),
      /** A short-lived signed URL, minted per request after the authorization check. */
      download: (vehicleId: string, documentId: string) =>
        request<DocumentDownload>('GET', `/vehicles/${vehicleId}/documents/${documentId}/download`),
      update: (vehicleId: string, documentId: string, body: UpdateDocument) =>
        request<VehicleDocument>('PATCH', `/vehicles/${vehicleId}/documents/${documentId}`, body),
      remove: (vehicleId: string, documentId: string) =>
        request<void>('DELETE', `/vehicles/${vehicleId}/documents/${documentId}`),
      expiring: () => request<ExpiringDocument[]>('GET', '/documents/expiring'),
    },

    tasks: {
      list: (query?: {
        garageId?: string;
        vehicleId?: string;
        status?: string[];
        priority?: string;
        assigneeId?: string;
        openOnly?: boolean;
      }) =>
        request<Task[]>('GET', '/tasks', undefined, {
          ...query,
          openOnly: query?.openOnly === undefined ? undefined : String(query.openOnly),
        }),
      buckets: () => request<TaskBuckets>('GET', '/tasks/buckets'),
      get: (taskId: string) => request<Task>('GET', `/tasks/${taskId}`),
      create: (body: CreateTask) => request<Task>('POST', '/tasks', body),
      update: (taskId: string, body: UpdateTask) =>
        request<Task>('PATCH', `/tasks/${taskId}`, body),
      remove: (taskId: string) => request<void>('DELETE', `/tasks/${taskId}`),
    },

    condition: {
      list: (vehicleId: string, query?: { limit?: number; cursor?: string }) =>
        request<Page<ConditionAssessment>>(
          'GET',
          `/vehicles/${vehicleId}/condition`,
          undefined,
          query,
        ),
      /** The latest score per category, which is not the same as the newest assessment. */
      summary: (vehicleId: string) =>
        request<ConditionSummary>('GET', `/vehicles/${vehicleId}/condition/summary`),
      create: (vehicleId: string, body: CreateConditionAssessment) =>
        request<ConditionAssessment>('POST', `/vehicles/${vehicleId}/condition`, body),
      update: (vehicleId: string, assessmentId: string, body: UpdateConditionAssessment) =>
        request<ConditionAssessment>(
          'PATCH',
          `/vehicles/${vehicleId}/condition/${assessmentId}`,
          body,
        ),
      remove: (vehicleId: string, assessmentId: string) =>
        request<void>('DELETE', `/vehicles/${vehicleId}/condition/${assessmentId}`),
    },

    valuations: {
      summary: (vehicleId: string) =>
        request<ValuationSummary>('GET', `/vehicles/${vehicleId}/valuations`),
      create: (vehicleId: string, body: CreateValuation) =>
        request<Valuation>('POST', `/vehicles/${vehicleId}/valuations`, body),
      remove: (vehicleId: string, valuationId: string) =>
        request<void>('DELETE', `/vehicles/${vehicleId}/valuations/${valuationId}`),
    },

    shares: {
      list: (vehicleId: string) => request<ShareLink[]>('GET', `/vehicles/${vehicleId}/shares`),
      /** The token comes back only here; it cannot be recovered afterwards. */
      create: (vehicleId: string, body: CreateShareLink) =>
        request<ShareLink>('POST', `/vehicles/${vehicleId}/shares`, body),
      revoke: (vehicleId: string, shareId: string) =>
        request<void>('DELETE', `/vehicles/${vehicleId}/shares/${shareId}`),
    },

    /** No session required — the token is the credential. */
    passport: (token: string) =>
      request<VehiclePassport>('GET', `/public/passport/${encodeURIComponent(token)}`),

    /** Everything the home screen shows, in one request (PRD §25). */
    dashboard: () => request<Dashboard>('GET', '/dashboard'),

    search: (query: { q: string; type?: string; limit?: number }) =>
      request<SearchResponse>('GET', '/search', undefined, query),

    health: (vehicleId: string) => request<VehicleHealth>('GET', `/vehicles/${vehicleId}/health`),

    /**
     * The model answers from read-only domain tools scoped to the caller's garages, so this
     * is a normal authenticated call — there is no separate AI credential on the client.
     */
    ai: {
      ask: (body: AskQuestion) => request<AiAnswer>('POST', '/ai/ask', body),
      models: () => request<AiModels>('GET', '/ai/models'),
      /** Reads a description of a vehicle into the add form's fields. Writes nothing. */
      draftVehicle: (body: DraftVehicle) =>
        request<VehicleDraft>('POST', '/ai/vehicle-draft', body),
      /** Searches for the factory specs of a vehicle already identified. Writes nothing. */
      lookUpVehicle: (body: LookUpVehicle) =>
        request<VehicleLookup>('POST', '/ai/vehicle-lookup', body),
    },

    /** Personal API keys for scripts and AI clients. Creating and revoking need a session. */
    apiKeys: {
      list: () => request<ApiKey[]>('GET', '/api-keys'),
      /** The one response that carries the key in full. */
      create: (body: CreateApiKey) => request<CreatedApiKey>('POST', '/api-keys', body),
      revoke: (keyId: string) => request<void>('DELETE', `/api-keys/${keyId}`),
    },
    notifications: {
      list: (query?: { unreadOnly?: boolean; limit?: number }) =>
        request<Notification[]>('GET', '/notifications', undefined, {
          limit: query?.limit,
          unreadOnly: query?.unreadOnly === undefined ? undefined : String(query.unreadOnly),
        }),
      unreadCount: () => request<{ unread: number }>('GET', '/notifications/unread-count'),
      markRead: (notificationId: string) =>
        request<void>('POST', `/notifications/${notificationId}/read`),
      markAllRead: () => request<void>('POST', '/notifications/read-all'),
      /** The whole type × channel grid, defaults included. */
      preferences: () => request<NotificationPreference[]>('GET', '/notifications/preferences'),
      updatePreferences: (preferences: NotificationPreference[]) =>
        request<void>('PUT', '/notifications/preferences', { preferences }),
      registerDevice: (body: RegisterDevice) =>
        request<void>('POST', '/notifications/devices', body),
      unregisterDevice: (token: string) =>
        request<void>('DELETE', '/notifications/devices', { token }),
    },

    /**
     * Data out and data in (PRD §6.5).
     *
     * Import defaults to a dry run on the server; the client does not default it here too,
     * because two places deciding what "unspecified" means is how one of them gets it wrong.
     */
    transfer: {
      exportVehicle: (vehicleId: string, query?: ExportQuery) =>
        download(`/vehicles/${vehicleId}/export`, query),
      exportGarage: (garageId: string, query?: ExportQuery) =>
        download(`/garages/${garageId}/export`, query),
      import: (vehicleId: string, body: ImportRequest) =>
        request<ImportReport>('POST', `/vehicles/${vehicleId}/import`, body),
    },

    photos: {
      list: (vehicleId: string) => request<VehiclePhoto[]>('GET', `/vehicles/${vehicleId}/photos`),
      requestUpload: (vehicleId: string, file: { name: string; type: string; size: number }) =>
        request<PhotoUploadTicket>('POST', `/vehicles/${vehicleId}/photos/upload-url`, {
          filename: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
        }),
      finalize: (vehicleId: string, photoId: string, body: FinalizePhotoUpload) =>
        request<void>('POST', `/vehicles/${vehicleId}/photos/${photoId}/finalize`, body),
      remove: (vehicleId: string, photoId: string) =>
        request<void>('DELETE', `/vehicles/${vehicleId}/photos/${photoId}`),
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;

/**
 * Uploads a document, then tells the API the object landed.
 *
 * Same three steps as `uploadPhoto`: the PUT goes straight to object storage, so a 20 MB
 * scanned service book never occupies a request worker for the length of the upload.
 */
export async function uploadDocument(
  client: ApiClient,
  vehicleId: string,
  file: File,
  metadata: FinalizeDocumentUpload,
): Promise<VehicleDocument> {
  const ticket = await client.documents.requestUpload(vehicleId, file);

  const uploaded = await fetch(ticket.uploadUrl, {
    method: 'PUT',
    // Both are signed into the URL, so they have to match what was requested.
    headers: { 'content-type': file.type, 'content-length': String(file.size) },
    body: file,
  });
  if (!uploaded.ok) throw new Error(`Upload failed with status ${uploaded.status}`);

  return client.documents.finalize(vehicleId, ticket.documentId, metadata);
}

/**
 * Uploads the file itself, then tells the API the object landed.
 *
 * The PUT goes straight to object storage and never touches the API, so a slow upload on a
 * phone does not occupy a request worker for its duration (§29).
 */
export async function uploadPhoto(
  client: ApiClient,
  vehicleId: string,
  file: File,
  options: FinalizePhotoUpload = {},
): Promise<string> {
  const ticket = await client.photos.requestUpload(vehicleId, file);

  const uploaded = await fetch(ticket.uploadUrl, {
    method: 'PUT',
    // Both are signed into the URL, so they have to match what was requested or the store
    // rejects the PUT outright.
    headers: { 'content-type': file.type, 'content-length': String(file.size) },
    body: file,
  });
  if (!uploaded.ok) throw new Error(`Upload failed with status ${uploaded.status}`);

  await client.photos.finalize(vehicleId, ticket.photoId, options);
  return ticket.photoId;
}

/**
 * What an upgrade wall needs to know about a refusal (GAPS §10).
 *
 * Two server answers mean "this costs more", and only these two: `PLAN_REQUIRED` (402) — a
 * feature the plan does not include — and `PLAN_LIMIT` (409) — one more of something than it
 * holds. Everything else is an ordinary error and stays one; a wall on a 403 would offer to
 * sell someone a permission their garage's owner withheld.
 *
 * Shared by both clients, so the web and the phone agree about which failures are walls.
 */
export interface PlanWall {
  readonly reason: 'feature' | 'limit';
  /** The cheapest tier that removes the wall; null when no tier holds more. */
  readonly requiredPlan: 'PLUS' | 'BUSINESS' | null;
  /** The server's own sentence, which names the number or the feature. */
  readonly message: string;
  readonly limit?: 'vehicles' | 'garages' | 'members';
  /** The feature a `feature` wall is for, so the wall can show it rather than describe it. */
  readonly entitlement?: string;
}

export function planWall(error: unknown): PlanWall | null {
  if (!(error instanceof ApiError)) return null;
  const tier = error.fields?.requiredPlan;
  const requiredPlan = tier === 'PLUS' || tier === 'BUSINESS' ? tier : null;

  if (error.code === 'PLAN_REQUIRED') {
    return {
      reason: 'feature',
      requiredPlan,
      message: error.message,
      entitlement: error.fields?.entitlement,
    };
  }
  if (error.code === 'PLAN_LIMIT') {
    const limit = error.fields?.limit;
    return {
      reason: 'limit',
      requiredPlan,
      message: error.message,
      limit: limit === 'vehicles' || limit === 'garages' || limit === 'members' ? limit : undefined,
    };
  }
  return null;
}
