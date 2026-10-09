/**
 * Personal API keys: `gk_` and 32 random bytes in base64url.
 *
 * The prefix makes a key recognisable wherever it ends up — a secret scanner, a log line, the
 * `Authorization` header — and lets the server tell a key from a session token without a
 * database round trip. Only the SHA-256 is stored: 256 bits of randomness leave nothing for a
 * slow hash to protect, and a lookup by hash stays one indexed read.
 */

import { createHash, randomBytes } from 'node:crypto';

export const API_KEY_PREFIX = 'gk_';

export function isApiKey(token: string): boolean {
  return token.startsWith(API_KEY_PREFIX) && token.length > API_KEY_PREFIX.length + 20;
}

export function hashApiKey(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** A new key, its stored hash, and the part of it a list may show. */
export function mintApiKey(): { token: string; tokenHash: string; prefix: string } {
  const token = `${API_KEY_PREFIX}${randomBytes(32).toString('base64url')}`;
  return { token, tokenHash: hashApiKey(token), prefix: token.slice(0, API_KEY_PREFIX.length + 6) };
}
