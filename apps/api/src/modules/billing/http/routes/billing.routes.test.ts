import { describe, expect, it, vi } from 'vitest';

const config = vi.hoisted(() => ({ nodeEnv: 'development' }));
vi.mock('@vehicle-os/config', () => ({
  env: () => ({ WEB_URL: 'https://garaj.app/', NODE_ENV: config.nodeEnv }),
  isProduction: () => config.nodeEnv === 'production',
}));

import { safeReturn } from './billing.routes';

describe('safeReturn', () => {
  it('keeps a web return on the configured origin', () => {
    expect(safeReturn('/settings')).toBe('https://garaj.app/settings');
    expect(safeReturn(undefined)).toBe('https://garaj.app/settings');
    expect(safeReturn('https://evil.test/')).toBe('https://garaj.app/settings');
    expect(safeReturn('//evil.test/')).toBe('https://garaj.app/settings');
  });

  it('returns to the mobile app by its own link', () => {
    expect(safeReturn('vehicleos://settings/plan')).toBe('vehicleos://settings/plan');
  });

  it('honours an Expo Go link only outside production', () => {
    config.nodeEnv = 'development';
    expect(safeReturn('exp://192.168.1.5:8081/--/settings/plan')).toBe(
      'exp://192.168.1.5:8081/--/settings/plan',
    );
    config.nodeEnv = 'production';
    expect(safeReturn('exp://evil.test/--/settings')).toBe('https://garaj.app/settings');
  });
});
