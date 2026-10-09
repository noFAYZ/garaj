/**
 * Environment configuration (Architecture.md §93).
 *
 * Validated once at startup, then read from the frozen result. The point is that a missing
 * DATABASE_URL kills the process during boot with the key name in the message, rather than
 * surfacing three hours later as `connect ECONNREFUSED undefined:5432` inside a request.
 */

import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

const EnvSchema = Type.Object({
  NODE_ENV: Type.Union(
    [Type.Literal('development'), Type.Literal('test'), Type.Literal('production')],
    { default: 'development' },
  ),
  LOG_LEVEL: Type.Union(
    [
      Type.Literal('fatal'),
      Type.Literal('error'),
      Type.Literal('warn'),
      Type.Literal('info'),
      Type.Literal('debug'),
      Type.Literal('trace'),
      // Pino's off switch. Used by the integration suite so a failing assertion is not
      // buried under a thousand request log lines.
      Type.Literal('silent'),
    ],
    { default: 'info' },
  ),

  API_HOST: Type.String({ default: '0.0.0.0' }),
  API_PORT: Type.Integer({ default: 3001, minimum: 1, maximum: 65535 }),

  DATABASE_URL: Type.String({ minLength: 1 }),
  DATABASE_POOL_MAX: Type.Integer({ default: 10, minimum: 1 }),

  /*
   * Optional. Redis backs the API's shared rate-limit counter in production, and nothing
   * else — background jobs run from the Postgres outbox. Without it rate limiting is a
   * per-process counter, which is the correct trade for a single instance.
   */
  REDIS_URL: Type.Optional(Type.String()),

  /*
   * Upstash Blob, which is S3-compatible but hands out short-lived credentials through its
   * own SDK rather than static keys. When set it takes precedence over the raw S3 variables
   * below — one token replaces all four.
   */
  UPSTASH_BLOB_TOKEN: Type.Optional(Type.String()),

  /*
   * Raw S3 credentials, for R2, MinIO or S3 itself. Optional as a group: photos and
   * documents need object storage, nothing else does, so a deployment without it boots fine
   * and the file endpoints return a clear 503 rather than the whole API refusing to start.
   * Partial configuration is rejected below — three of four keys set is a typo, not a choice.
   */
  OBJECT_STORAGE_ENDPOINT: Type.Optional(Type.String()),
  OBJECT_STORAGE_REGION: Type.String({ default: 'auto' }),
  OBJECT_STORAGE_BUCKET: Type.Optional(Type.String()),
  OBJECT_STORAGE_ACCESS_KEY: Type.Optional(Type.String()),
  OBJECT_STORAGE_SECRET_KEY: Type.Optional(Type.String()),
  // MinIO serves buckets as a path segment; R2 and S3 use a virtual host. Getting this
  // wrong produces signed URLs that 404 with no other symptom.
  OBJECT_STORAGE_FORCE_PATH_STYLE: Type.Boolean({ default: false }),

  /*
   * Background removal for vehicle thumbnails, Pixelcut by default. Optional: without a key
   * the worker leaves the photo alone and the thumbnail is the original, which is a plainer
   * card, not a broken one. The URL is here for a different Pixelcut region or a proxy in
   * front of it — another vendor means a different request shape, which is an adapter
   * change, not a variable.
   */
  BG_REMOVAL_URL: Type.String({
    default: 'https://api.developer.pixelcut.ai/v1/remove-background',
  }),
  BG_REMOVAL_API_KEY: Type.Optional(Type.String()),

  AUTH_SECRET: Type.String({ minLength: 32 }),
  AUTH_URL: Type.String({ default: 'http://localhost:3001' }),
  WEB_URL: Type.String({ default: 'http://localhost:3000' }),
  /** The admin console (apps/admin). Trusted for CORS and auth like the web app. */
  ADMIN_URL: Type.String({ default: 'http://localhost:3002' }),
  /*
   * Who may use the admin console: comma-separated user ids. Ids rather than emails because
   * sign-up does not verify email — an allowlisted address nobody has registered yet would be
   * an admin account anyone could claim. An id only exists once the account does.
   */
  ADMIN_USER_IDS: Type.String({ default: '' }),

  // Optional integrations. Absent means the matching feature flag stays off; a blank
  // string is treated as absent because that is what an unset CI secret expands to.
  STRIPE_SECRET_KEY: Type.Optional(Type.String()),
  STRIPE_WEBHOOK_SECRET: Type.Optional(Type.String()),
  /*
   * The price each paid tier checks out against (GAPS §17). On the server, never in a request
   * body: a price id that arrives from a client is a price the client chose, and the cheapest
   * one on the account would work just as well as the right one.
   */
  STRIPE_PRICE_PLUS: Type.Optional(Type.String()),
  STRIPE_PRICE_BUSINESS: Type.Optional(Type.String()),
  /*
   * The billing portal configuration (`bpc_…`) that allows switching between the two prices
   * above. Unset, the account's default is used — which usually has plan changes switched off,
   * and then a subscriber cannot move from Plus to Business at all.
   */
  STRIPE_PORTAL_CONFIGURATION: Type.Optional(Type.String()),
  /*
   * The AI provider (Architecture.md §41). Named by role rather than by vendor: the model
   * is reached through a port, and the concrete adapter is one file — so a key from a
   * different provider is a base URL and a model id, not a rename across the codebase.
   * Gemini today, on its free tier.
   */
  AI_API_KEY: Type.Optional(Type.String()),
  AI_BASE_URL: Type.String({ default: 'https://generativelanguage.googleapis.com/v1beta' }),
  AI_MODEL: Type.String({ default: 'gemini-3.1-flash-lite' }),
  /** Asked when `AI_MODEL` fails (retired, overloaded, unreachable). Empty turns it off. */
  AI_FALLBACK_MODEL: Type.String({ default: 'gemini-3.5-flash-lite' }),
  /** Comma-separated: the models a person may choose in Co-driver settings, besides `AI_MODEL`. */
  AI_MODEL_CHOICES: Type.String({
    default: 'gemini-3.1-flash-lite,gemini-3.5-flash-lite,gemini-3.8-flash',
  }),
  /*
   * Exchange rates, for the converted aside on a cost summary (§27). No key: the endpoint is
   * public on the free tier, and the URL is here for a mirror or a proxy rather than for a
   * different vendor — another provider is a different response shape, which is an adapter.
   */
  FX_RATES_URL: Type.String({ default: 'https://api.fxratesapi.com/latest' }),

  /*
   * Notification delivery. Both optional: without them the channel is skipped and logged, and
   * the in-app notification — which is written before delivery is attempted — still lands.
   */
  RESEND_API_KEY: Type.Optional(Type.String()),
  EMAIL_FROM: Type.String({ default: 'Garaj <reminders@garaj.app>' }),
  /** Only needed once push security is enabled on the Expo project; sends work without it. */
  EXPO_ACCESS_TOKEN: Type.Optional(Type.String()),

  /** NHTSA vPIC, for VIN decoding and recalls. Free and unauthenticated; overridable for tests. */
  VPIC_URL: Type.String({ default: 'https://vpic.nhtsa.dot.gov/api' }),
  RECALLS_URL: Type.String({ default: 'https://api.nhtsa.gov/recalls/recallsByVehicle' }),
  POSTHOG_KEY: Type.Optional(Type.String()),
  SENTRY_DSN: Type.Optional(Type.String()),
});

export type Env = Static<typeof EnvSchema>;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

function stripBlanks(source: NodeJS.ProcessEnv): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined && value !== '') result[key] = value;
  }
  return result;
}

export function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  // Env values are always strings; Convert coerces "3001" -> 3001 and "true" -> true
  // against the schema, and Default fills in anything the deployment left out.
  const withDefaults = Value.Default(EnvSchema, stripBlanks(source));
  const converted = Value.Convert(EnvSchema, withDefaults);

  if (!Value.Check(EnvSchema, converted)) {
    const problems = [...Value.Errors(EnvSchema, converted)].map(
      (error) => `  ${error.path.replace(/^\//, '') || '(root)'}: ${error.message}`,
    );
    throw new ConfigError(
      `Invalid environment configuration:\n${problems.join('\n')}\n\n` +
        'Copy .env.example to .env and fill in the missing values.',
    );
  }

  return Object.freeze(converted);
}

let cached: Env | undefined;

/** Parsed once per process. Call `parseEnv` directly in tests to avoid the cache. */
export function env(): Env {
  cached ??= parseEnv();
  return cached;
}

export function isProduction(value: Env = env()): boolean {
  return value.NODE_ENV === 'production';
}

export interface S3StorageConfig {
  readonly provider: 's3';
  readonly endpoint: string;
  readonly region: string;
  readonly bucket: string;
  readonly accessKey: string;
  readonly secretKey: string;
  readonly forcePathStyle: boolean;
}

export interface UpstashBlobConfig {
  readonly provider: 'upstash-blob';
  readonly token: string;
}

/** A discriminated union so the plugin switches once and no adapter sees the other's keys. */
export type ObjectStorageConfig = S3StorageConfig | UpstashBlobConfig;

/**
 * The object-storage configuration, or `null` when it was deliberately left out.
 *
 * Partial configuration throws instead of returning null: someone who set three of the four
 * S3 keys meant to enable storage and has a typo, and silently disabling file uploads would
 * hide that until the first upload failed in an unrelated way.
 */
export function objectStorage(value: Env = env()): ObjectStorageConfig | null {
  // One token beats four keys, so it wins when both are present rather than making the
  // precedence depend on which the deployment happened to set first.
  if (value.UPSTASH_BLOB_TOKEN) {
    return { provider: 'upstash-blob', token: value.UPSTASH_BLOB_TOKEN };
  }

  const required = [
    ['OBJECT_STORAGE_ENDPOINT', value.OBJECT_STORAGE_ENDPOINT],
    ['OBJECT_STORAGE_BUCKET', value.OBJECT_STORAGE_BUCKET],
    ['OBJECT_STORAGE_ACCESS_KEY', value.OBJECT_STORAGE_ACCESS_KEY],
    ['OBJECT_STORAGE_SECRET_KEY', value.OBJECT_STORAGE_SECRET_KEY],
  ] as const;

  const missing = required.filter(([, part]) => !part).map(([name]) => name);
  if (missing.length === required.length) return null;
  if (missing.length > 0) {
    throw new ConfigError(
      `Object storage is partially configured. Missing: ${missing.join(', ')}.
` + 'Set all four keys to enable file uploads, or none to disable them.',
    );
  }

  return {
    provider: 's3',
    endpoint: value.OBJECT_STORAGE_ENDPOINT!,
    region: value.OBJECT_STORAGE_REGION,
    bucket: value.OBJECT_STORAGE_BUCKET!,
    accessKey: value.OBJECT_STORAGE_ACCESS_KEY!,
    secretKey: value.OBJECT_STORAGE_SECRET_KEY!,
    forcePathStyle: value.OBJECT_STORAGE_FORCE_PATH_STYLE,
  };
}
