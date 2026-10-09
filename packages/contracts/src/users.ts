import { Type, type Static } from '@sinclair/typebox';
import { ACCOUNT_KINDS, DISTANCE_UNITS, VOLUME_UNITS } from '@vehicle-os/domain';
import { CurrencyCode, IsoDateTime, Nullable, Uuid } from './common';

export const UserProfile = Type.Object({
  id: Uuid,
  email: Type.String({ format: 'email' }),
  name: Type.String(),
  image: Nullable(Type.String()),
  emailVerified: Type.Boolean(),
  locale: Type.String(),
  timezone: Type.String(),
  defaultCurrency: CurrencyCode,
  distanceUnit: Type.Union(DISTANCE_UNITS.map((unit) => Type.Literal(unit))),
  volumeUnit: Type.Union(VOLUME_UNITS.map((unit) => Type.Literal(unit))),
  accountKind: Type.Union(ACCOUNT_KINDS.map((kind) => Type.Literal(kind))),
  createdAt: IsoDateTime,
});
export type UserProfile = Static<typeof UserProfile>;

/**
 * Profile pictures are DiceBear's adventurer-neutral faces, chosen by seed. Only that one style's
 * URL is accepted, so a picture shown to garage members can never be an arbitrary third-party
 * image (a tracking pixel, say) — and an account that never picked one gets its id as the seed.
 */
const AVATAR_BASE = 'https://api.dicebear.com/9.x/adventurer-neutral/svg?seed=';
export const AVATAR_URL_PATTERN = String.raw`^https://api\.dicebear\.com/9\.x/adventurer-neutral/svg\?seed=[A-Za-z0-9_-]{1,64}$`;

export function avatarUrl(seed: string): string {
  return AVATAR_BASE + seed.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
}

/** The picture they chose, else the face their account id draws — the same on every device. */
export function avatarFor(user: { id: string; image?: string | null }): string {
  return user.image || avatarUrl(user.id);
}

/** Fresh seeds for a picker to offer. */
export function avatarSeeds(count: number): string[] {
  return Array.from({ length: count }, () => Math.random().toString(36).slice(2, 10));
}

/**
 * Every field optional, and a missing field means "leave alone" — never "reset to default".
 * A settings form that PATCHes only what the user touched must not wipe their currency.
 */
export const UpdateUserProfile = Type.Object(
  {
    name: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
    image: Type.Optional(Type.String({ pattern: AVATAR_URL_PATTERN, maxLength: 200 })),
    locale: Type.Optional(Type.String({ minLength: 2, maxLength: 20 })),
    timezone: Type.Optional(Type.String({ minLength: 1, maxLength: 60 })),
    defaultCurrency: Type.Optional(CurrencyCode),
    distanceUnit: Type.Optional(Type.Union(DISTANCE_UNITS.map((unit) => Type.Literal(unit)))),
    volumeUnit: Type.Optional(Type.Union(VOLUME_UNITS.map((unit) => Type.Literal(unit)))),
    accountKind: Type.Optional(Type.Union(ACCOUNT_KINDS.map((kind) => Type.Literal(kind)))),
  },
  { additionalProperties: false },
);
export type UpdateUserProfile = Static<typeof UpdateUserProfile>;

export const CapabilitiesResponse = Type.Object({
  /** Capability list per garage id, so a client can grey out what the server would refuse. */
  garages: Type.Record(Type.String(), Type.Array(Type.String())),
});
