/**
 * How long a vehicle has been owned, as a figure: `12d`, `8m`, `3y`, `3y 4m`.
 *
 * Counted in calendar months, not 30-day blocks — bought on the 31st of January, it is a month on
 * the last day of February, not three days into March. A date in the future is not ownership yet.
 */
export function ownedFor(purchaseDate: string, now = new Date()): string | null {
  const start = new Date(`${purchaseDate}T00:00:00`);
  if (Number.isNaN(start.getTime()) || start > now) return null;

  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const dayReached = now.getDate() >= Math.min(start.getDate(), endOfMonth);
  const months =
    (now.getFullYear() - start.getFullYear()) * 12 +
    now.getMonth() -
    start.getMonth() -
    (dayReached ? 0 : 1);

  if (months < 1) return `${Math.floor((now.getTime() - start.getTime()) / 86_400_000)}d`;
  const years = Math.floor(months / 12);
  const rest = months % 12;
  if (years === 0) return `${rest}m`;
  return rest === 0 ? `${years}y` : `${years}y ${rest}m`;
}

/*
 * Paint names are marketing — "Soul Red Crystal", "Nardo Grey" — so the swatch is read from the
 * plain colour word inside the name. These are the paint's own colour, not interface colour, which
 * is why they are not tokens. No recognisable word means no swatch rather than a guess.
 */
const PAINT: Record<string, string> = {
  black: '#16161a',
  white: '#f4f4f2',
  silver: '#b9bcc0',
  grey: '#7d8085',
  gray: '#7d8085',
  red: '#b3202a',
  maroon: '#6b1d24',
  burgundy: '#6b1d24',
  blue: '#2a4f9c',
  navy: '#1f2a4d',
  green: '#2f6b45',
  yellow: '#e2b52a',
  orange: '#d9682a',
  brown: '#6b4a32',
  bronze: '#8c6239',
  beige: '#d8c7a6',
  gold: '#b8923a',
  purple: '#5b3a82',
  pink: '#d77aa0',
};

export function paintSwatch(color: string | null): string | null {
  if (!color) return null;
  // The last colour word wins: "Blue Black" is a black, "Pearl White" a white.
  const word = color
    .toLowerCase()
    .split(/[^a-z]+/)
    .reverse()
    .find((candidate) => candidate in PAINT);
  return word ? PAINT[word]! : null;
}

/** A VIN shown by its tail, the part people read back to a dealer: `···4F21`. */
export function vinTail(vin: string): string {
  const clean = vin.replace(/\s+/g, '');
  return clean.length > 6 ? `···${clean.slice(-4).toUpperCase()}` : clean.toUpperCase();
}
