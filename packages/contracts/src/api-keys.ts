import { Type, type Static } from '@sinclair/typebox';
import { IsoDateTime, Nullable, Uuid } from './common';

/**
 * A personal API key, as its owner sees it: never the key itself after creation, only the start
 * of it (`prefix`) so one key can be told from another.
 */
export const ApiKey = Type.Object({
  id: Uuid,
  name: Type.String(),
  /** The key's first characters, e.g. `gk_3f9a1c`. */
  prefix: Type.String(),
  createdAt: IsoDateTime,
  /** Updated at most once a minute, not on every request. */
  lastUsedAt: Nullable(IsoDateTime),
  expiresAt: Nullable(IsoDateTime),
});
export type ApiKey = Static<typeof ApiKey>;

export const CreateApiKey = Type.Object(
  {
    /** What the key is for — "Claude Desktop", "Home Assistant". */
    name: Type.String({ minLength: 1, maxLength: 60 }),
    /** Omitted: the key lasts until revoked. */
    expiresInDays: Type.Optional(Type.Integer({ minimum: 1, maximum: 365 })),
  },
  { additionalProperties: false },
);
export type CreateApiKey = Static<typeof CreateApiKey>;

/** The one response that carries the key in full. It cannot be shown again. */
export const CreatedApiKey = Type.Intersect([ApiKey, Type.Object({ token: Type.String() })]);
export type CreatedApiKey = Static<typeof CreatedApiKey>;

export const ApiKeyIdParam = Type.Object({ keyId: Uuid });
