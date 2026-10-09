/**
 * Share-link tokens (Architecture.md §35).
 *
 * A token is a bearer credential: whoever holds it can read the passport. That makes the
 * handling rules the same as for a password, minus the parts that only apply to something a
 * human types.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * 256 bits, base64url.
 *
 * `randomBytes`, not `Math.random` or a uuid: the only thing standing between a stranger and
 * someone's vehicle history is that the token cannot be guessed, and a v4 uuid — 122 bits in
 * a recognisable shape — is both weaker and advertises what it is. base64url so it survives a
 * URL, a QR code and a copy-paste out of a chat message unharmed.
 */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * What actually goes in the database.
 *
 * SHA-256 rather than a password hash: this is a 256-bit random value, so there is no
 * dictionary to attack and nothing for a slow KDF to buy. What matters is that a database
 * dump does not contain working links.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Compares two hashes without leaking where they diverge.
 *
 * The lookup is by hash, so this is belt and braces — but a timing-variable comparison on a
 * credential is the kind of thing that is correct today and wrong after one refactor.
 */
export function tokenMatches(candidateHash: string, storedHash: string): boolean {
  const a = Buffer.from(candidateHash, 'hex');
  const b = Buffer.from(storedHash, 'hex');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export interface LinkState {
  readonly revokedAt: Date | null;
  readonly expiresAt: Date | null;
}

/**
 * Whether a link still works.
 *
 * Revocation and expiry are separate on purpose: an expiry is a promise made when the link
 * was created, and revocation is the owner changing their mind. Either one alone is enough
 * to close it, and neither deletes the row — the owner should still see that the link
 * existed and how often it was opened.
 */
export function isUsable(link: LinkState, now: Date = new Date()): boolean {
  if (link.revokedAt !== null) return false;
  if (link.expiresAt !== null && link.expiresAt <= now) return false;
  return true;
}
