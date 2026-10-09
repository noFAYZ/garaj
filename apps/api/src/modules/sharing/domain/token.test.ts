import { describe, expect, it } from 'vitest';
import { generateToken, hashToken, isUsable, tokenMatches } from './token';

describe('generateToken', () => {
  it('is long enough not to be guessable', () => {
    // 32 random bytes in base64url — 43 characters, 256 bits of entropy.
    expect(generateToken()).toHaveLength(43);
  });

  it('is different every time', () => {
    const tokens = new Set(Array.from({ length: 100 }, () => generateToken()));
    expect(tokens.size).toBe(100);
  });

  /** It has to survive a URL, a QR code and a paste out of a chat message unharmed. */
  it('is URL-safe', () => {
    for (let i = 0; i < 50; i++) {
      expect(generateToken()).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });
});

describe('hashToken', () => {
  it('is stable for the same token', () => {
    const token = generateToken();
    expect(hashToken(token)).toBe(hashToken(token));
  });

  /** What goes in the database must not be what opens the link. */
  it('does not contain the token', () => {
    const token = generateToken();
    expect(hashToken(token)).not.toContain(token);
    expect(hashToken(token)).toHaveLength(64);
  });
});

describe('tokenMatches', () => {
  it('accepts the same hash and rejects a different one', () => {
    const hash = hashToken('one');
    expect(tokenMatches(hash, hash)).toBe(true);
    expect(tokenMatches(hashToken('two'), hash)).toBe(false);
  });

  it('rejects a malformed candidate rather than throwing', () => {
    expect(tokenMatches('not-hex', hashToken('one'))).toBe(false);
  });
});

describe('isUsable', () => {
  const now = new Date('2026-09-08T12:00:00Z');

  it('is usable when neither revoked nor expired', () => {
    expect(isUsable({ revokedAt: null, expiresAt: null }, now)).toBe(true);
  });

  it('is not usable once revoked', () => {
    expect(isUsable({ revokedAt: new Date('2026-09-01T00:00:00Z'), expiresAt: null }, now)).toBe(
      false,
    );
  });

  it('is not usable past its expiry', () => {
    expect(isUsable({ revokedAt: null, expiresAt: new Date('2026-09-07T00:00:00Z') }, now)).toBe(
      false,
    );
  });

  it('is still usable before its expiry', () => {
    expect(isUsable({ revokedAt: null, expiresAt: new Date('2026-10-01T00:00:00Z') }, now)).toBe(
      true,
    );
  });

  /*
   * Revocation is the owner changing their mind and has to win over a promise made when the
   * link was created — a link revoked today does not come back because its expiry is next year.
   */
  it('stays closed when revoked even if the expiry is still in the future', () => {
    expect(
      isUsable(
        {
          revokedAt: new Date('2026-09-02T00:00:00Z'),
          expiresAt: new Date('2027-01-01T00:00:00Z'),
        },
        now,
      ),
    ).toBe(false);
  });

  it('closes exactly at the expiry instant rather than a moment after', () => {
    expect(isUsable({ revokedAt: null, expiresAt: now }, now)).toBe(false);
  });
});
