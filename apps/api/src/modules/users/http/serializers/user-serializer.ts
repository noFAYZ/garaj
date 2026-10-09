import type { UserProfile } from '@vehicle-os/contracts';
import type { User } from '../../domain/entities/user';

/**
 * Domain entity to wire DTO. Explicit field-by-field rather than spreading the entity:
 * a column added to the domain type should not silently start appearing in API responses.
 */
export function serializeUser(user: User): UserProfile {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    image: user.image,
    emailVerified: user.emailVerified,
    locale: user.locale,
    timezone: user.timezone,
    defaultCurrency: user.defaultCurrency,
    distanceUnit: user.distanceUnit,
    volumeUnit: user.volumeUnit,
    accountKind: user.accountKind,
    createdAt: user.createdAt.toISOString(),
  };
}
