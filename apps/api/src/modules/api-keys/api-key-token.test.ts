import { describe, expect, it } from 'vitest';
import { hashApiKey, isApiKey, mintApiKey } from './api-key-token';

describe('api key tokens', () => {
  it('mints a recognisable key whose stored hash matches and whose prefix is its start', () => {
    const key = mintApiKey();
    expect(isApiKey(key.token)).toBe(true);
    expect(key.token).toMatch(/^gk_[A-Za-z0-9_-]{43}$/);
    expect(key.tokenHash).toBe(hashApiKey(key.token));
    expect(key.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(key.token.startsWith(key.prefix)).toBe(true);
    expect(mintApiKey().token).not.toBe(key.token);
  });

  it('does not mistake a session token for a key', () => {
    expect(isApiKey('abc123.signature')).toBe(false);
    expect(isApiKey('gk_short')).toBe(false);
  });
});
