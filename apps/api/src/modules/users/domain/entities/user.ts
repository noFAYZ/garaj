import type { AccountKind, DistanceUnit, VolumeUnit } from '@vehicle-os/domain';

/**
 * The application's view of a user: identity from the auth provider joined with the
 * preferences the product owns. Nothing here knows what a session or a password hash is.
 */
export interface User {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly image: string | null;
  readonly emailVerified: boolean;
  readonly locale: string;
  readonly timezone: string;
  readonly defaultCurrency: string;
  readonly distanceUnit: DistanceUnit;
  readonly volumeUnit: VolumeUnit;
  /** What they use the product for; see `plans.ts`. Never what they pay for. */
  readonly accountKind: AccountKind;
  readonly createdAt: Date;
}

export interface UserPreferencesPatch {
  readonly name?: string;
  /** A DiceBear URL; the contract refuses any other. */
  readonly image?: string;
  readonly locale?: string;
  readonly timezone?: string;
  readonly defaultCurrency?: string;
  readonly distanceUnit?: DistanceUnit;
  readonly volumeUnit?: VolumeUnit;
  readonly accountKind?: AccountKind;
}
