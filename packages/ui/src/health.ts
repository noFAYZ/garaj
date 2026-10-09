/**
 * A health score's band, shared by both platforms.
 *
 * The thresholds lived in the web's `HealthDial` and were copied into the phone's gauge, which
 * is how the same 56 comes out amber in one place and red in the other. The band is the shared
 * fact; how it is painted is not — the web resolves it to a text class, the phone to a token.
 */
export type HealthBand = 'success' | 'warning' | 'destructive';

export function healthBand(score: number | null): HealthBand | null {
  if (score === null) return null;
  if (score >= 80) return 'success';
  if (score >= 55) return 'warning';
  return 'destructive';
}
