import { describe, expect, it } from 'vitest';
import { ownedFor, paintSwatch, vinTail } from './vehicle-facts';

const at = (iso: string) => new Date(`${iso}T12:00:00`);

describe('ownedFor', () => {
  it('counts days under a month, then calendar months and years', () => {
    expect(ownedFor('2026-09-04', at('2026-09-16'))).toBe('12d');
    expect(ownedFor('2026-01-16', at('2026-09-16'))).toBe('8m');
    expect(ownedFor('2023-09-16', at('2026-09-16'))).toBe('3y');
    expect(ownedFor('2023-05-17', at('2026-09-16'))).toBe('3y 3m');
  });

  it('treats the end of a short month as the anniversary of a later day', () => {
    expect(ownedFor('2026-01-31', at('2026-02-28'))).toBe('1m');
  });

  it('refuses a future or broken date', () => {
    expect(ownedFor('2027-01-01', at('2026-09-16'))).toBeNull();
    expect(ownedFor('not a date', at('2026-09-16'))).toBeNull();
  });
});

describe('paintSwatch', () => {
  it('reads the colour word out of a paint name', () => {
    expect(paintSwatch('Soul Red Crystal')).toBe(paintSwatch('red'));
    expect(paintSwatch('Blue Black')).toBe(paintSwatch('black'));
    expect(paintSwatch('Chalk')).toBeNull();
    expect(paintSwatch(null)).toBeNull();
  });
});

describe('vinTail', () => {
  it('keeps the last four', () => {
    expect(vinTail('jm1nd2l79f0 404f21')).toBe('···4F21');
    expect(vinTail('ab12')).toBe('AB12');
  });
});
