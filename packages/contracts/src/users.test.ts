import { describe, expect, it } from 'vitest';
import { AVATAR_URL_PATTERN, avatarFor, avatarSeeds, avatarUrl } from './users';

describe('avatars', () => {
  const accepted = new RegExp(AVATAR_URL_PATTERN);

  it('builds URLs the PATCH accepts, from picker seeds and account ids alike', () => {
    for (const seed of [...avatarSeeds(20), '019245a1-7c3e-7d2a-9f10-2b3c4d5e6f70']) {
      expect(avatarUrl(seed)).toMatch(accepted);
    }
  });

  it('refuses anything that is not that one style', () => {
    expect('https://evil.example/pixel.gif').not.toMatch(accepted);
    expect('https://api.dicebear.com/9.x/bottts/svg?seed=a').not.toMatch(accepted);
    expect(avatarUrl('a') + '&x=<script>').not.toMatch(accepted);
  });

  it('falls back to the face the account id draws', () => {
    expect(avatarFor({ id: 'abc', image: null })).toBe(avatarUrl('abc'));
    expect(avatarFor({ id: 'abc', image: avatarUrl('zz') })).toBe(avatarUrl('zz'));
  });
});
