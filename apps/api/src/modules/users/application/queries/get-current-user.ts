import type { Database } from '@vehicle-os/database';
import { NotFoundError } from '../../../../infrastructure/errors';
import type { User } from '../../domain/entities/user';
import { findById } from '../../infrastructure/repositories/user-repository';

export async function getCurrentUser(db: Database, userId: string): Promise<User> {
  const user = await findById(db, userId);
  // A valid session pointing at a deleted user: possible during account deletion, and a
  // clear 404 beats a null dereference three layers up.
  if (!user) throw new NotFoundError('User');
  return user;
}
