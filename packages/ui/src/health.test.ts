import { describe, expect, it } from 'vitest';
import { healthBand } from './health';

describe('healthBand', () => {
  it('bands a score at the edges, where an off-by-one shows', () => {
    expect(healthBand(100)).toBe('success');
    expect(healthBand(80)).toBe('success');
    expect(healthBand(79)).toBe('warning');
    expect(healthBand(55)).toBe('warning');
    expect(healthBand(54)).toBe('destructive');
    expect(healthBand(0)).toBe('destructive');
  });

  it('has no band for a vehicle nothing is recorded against', () => {
    expect(healthBand(null)).toBeNull();
  });
});
