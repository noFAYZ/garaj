import type { AccountKind, DistanceUnit, VolumeUnit } from '@vehicle-os/domain';
import type { User } from '../../domain/entities/user';

interface UserRow {
  id: string;
  email: string;
  name: string;
  image: string | null;
  emailVerified: boolean;
  createdAt: Date;
}

interface ProfileRow {
  locale: string;
  timezone: string;
  defaultCurrency: string;
  distanceUnit: DistanceUnit;
  volumeUnit: VolumeUnit;
  accountKind: AccountKind;
}

/**
 * A user can exist without a profile row: Better Auth writes `users` during sign-up, and
 * the profile is created on first read. Defaults here keep that window from being a 500.
 */
export function toUser(user: UserRow, profile: ProfileRow | null): User {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    image: user.image,
    emailVerified: user.emailVerified,
    locale: profile?.locale ?? 'en-US',
    timezone: profile?.timezone ?? 'UTC',
    defaultCurrency: profile?.defaultCurrency ?? 'USD',
    distanceUnit: profile?.distanceUnit ?? 'KM',
    volumeUnit: profile?.volumeUnit ?? 'LITER',
    accountKind: profile?.accountKind ?? 'PERSONAL',
    createdAt: user.createdAt,
  };
}
