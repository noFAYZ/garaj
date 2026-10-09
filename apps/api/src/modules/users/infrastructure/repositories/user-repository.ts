import { eq } from 'drizzle-orm';
import { schema, type Executor } from '@vehicle-os/database';
import type { User, UserPreferencesPatch } from '../../domain/entities/user';
import { toUser } from '../mappers/user-mapper';

export async function findById(db: Executor, userId: string): Promise<User | null> {
  const [row] = await db
    .select({
      user: {
        id: schema.users.id,
        email: schema.users.email,
        name: schema.users.name,
        image: schema.users.image,
        emailVerified: schema.users.emailVerified,
        createdAt: schema.users.createdAt,
      },
      profile: {
        locale: schema.userProfiles.locale,
        timezone: schema.userProfiles.timezone,
        defaultCurrency: schema.userProfiles.defaultCurrency,
        distanceUnit: schema.userProfiles.distanceUnit,
        volumeUnit: schema.userProfiles.volumeUnit,
        accountKind: schema.userProfiles.accountKind,
      },
    })
    .from(schema.users)
    // Left join: the profile row may not exist yet for a just-registered user.
    .leftJoin(schema.userProfiles, eq(schema.userProfiles.userId, schema.users.id))
    .where(eq(schema.users.id, userId))
    .limit(1);

  return row ? toUser(row.user, row.profile) : null;
}

/**
 * Upsert rather than update: the profile row is created lazily, so the first preference
 * change a user makes is also the insert. Splitting it into "check then insert or update"
 * would be two round trips and a race between them.
 */
export async function upsertPreferences(
  db: Executor,
  userId: string,
  patch: UserPreferencesPatch,
): Promise<void> {
  const { name, image, ...preferences } = patch;

  if (name !== undefined || image !== undefined) {
    await db
      .update(schema.users)
      .set({ ...(name !== undefined && { name }), ...(image !== undefined && { image }) })
      .where(eq(schema.users.id, userId));
  }

  // Only the keys the caller actually sent reach the SET clause, so a partial PATCH cannot
  // reset a preference the form did not include.
  const changes = Object.fromEntries(
    Object.entries(preferences).filter(([, value]) => value !== undefined),
  );
  if (Object.keys(changes).length === 0) return;

  await db
    .insert(schema.userProfiles)
    .values({ userId, ...changes })
    .onConflictDoUpdate({ target: schema.userProfiles.userId, set: changes });
}
