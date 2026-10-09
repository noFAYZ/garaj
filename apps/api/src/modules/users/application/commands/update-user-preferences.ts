import type { Database } from '@vehicle-os/database';
import { assertCurrency, MoneyError } from '@vehicle-os/domain';
import { ValidationError } from '../../../../infrastructure/errors';
import type { User, UserPreferencesPatch } from '../../domain/entities/user';
import { findById, upsertPreferences } from '../../infrastructure/repositories/user-repository';
import { getCurrentUser } from '../queries/get-current-user';

export async function updateUserPreferences(
  db: Database,
  userId: string,
  patch: UserPreferencesPatch,
): Promise<User> {
  if (patch.defaultCurrency !== undefined) {
    try {
      assertCurrency(patch.defaultCurrency);
    } catch (error) {
      if (error instanceof MoneyError) {
        throw new ValidationError('Invalid request', { defaultCurrency: error.message });
      }
      throw error;
    }
  }

  // Timezone is validated against the runtime's own IANA database rather than a bundled
  // list, which would go stale the next time a country changes its rules.
  if (patch.timezone !== undefined && !isValidTimezone(patch.timezone)) {
    throw new ValidationError('Invalid request', {
      timezone: `Unknown IANA time zone: ${patch.timezone}`,
    });
  }

  const existing = await findById(db, userId);
  if (!existing) throw new ValidationError('Unknown user');

  await upsertPreferences(db, userId, patch);
  return getCurrentUser(db, userId);
}

function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}
