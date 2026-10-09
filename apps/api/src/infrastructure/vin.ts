/**
 * VIN decoding, from NHTSA vPIC.
 *
 * Shaped like `fx.ts`: `fetch` with a deadline, cached, and null rather than an error when the
 * answer cannot be had. A decode is a suggestion to fill a form, so a provider outage means
 * the person types their make and model — never that adding a vehicle fails.
 *
 * vPIC is a US database. A European or Japanese VIN usually comes back with a make (the WMI
 * prefix is international) and little else, which is why every field is optional and the
 * result says what it did not find rather than pretending the rest is blank on the car.
 */

export interface VinDecode {
  readonly vin: string;
  readonly make: string | null;
  readonly model: string | null;
  readonly year: number | null;
  readonly variant: string | null;
  /** Values for keys in `vehicle-specs.ts`, only those the decode actually filled. */
  readonly specs: Readonly<Record<string, string | number>>;
  /** vPIC's own note when the decode was partial or the check digit did not match. */
  readonly warning: string | null;
}

/** 17 characters, no I, O or Q — the letters ISO 3779 excludes to avoid reading them as 1 and 0. */
export function isVin(value: string): boolean {
  return /^[A-HJ-NPR-Z0-9]{17}$/.test(value);
}

export function normaliseVin(value: string): string {
  return value.replace(/[\s-]+/g, '').toUpperCase();
}

type VpicResult = Readonly<Record<string, string | null | undefined>>;

const text = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim();
  // vPIC writes "Not Applicable" into fields that do not apply, which is not a value.
  return trimmed && trimmed !== 'Not Applicable' ? trimmed : null;
};

const integer = (value: string | null | undefined): number | null => {
  const parsed = Number.parseFloat(value ?? '');
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
};

/**
 * Title case for the make: vPIC shouts (`BMW`, `MERCEDES-BENZ`, `TOYOTA`), and a make stored
 * in capitals sits badly next to one the user typed. Three-letter-or-shorter makes stay in
 * capitals because they are initialisms.
 */
function titleCaseMake(make: string): string {
  if (make.length <= 3) return make.toUpperCase();
  return make
    .toLowerCase()
    .replace(
      /(^|[\s-])([a-z])/g,
      (_all, gap: string, letter: string) => `${gap}${letter.toUpperCase()}`,
    );
}

function fuelType(primary: string | null): string | null {
  if (!primary) return null;
  if (/diesel/i.test(primary)) return 'DIESEL';
  if (/electric/i.test(primary)) return 'ELECTRIC_SLOW';
  if (/liquefied petroleum|lpg|propane/i.test(primary)) return 'LPG';
  if (/compressed natural|cng/i.test(primary)) return 'CNG';
  if (/gasoline|petrol|flex/i.test(primary)) return 'GASOLINE';
  return null;
}

function transmission(style: string | null): string | null {
  if (!style) return null;
  if (/dual.?clutch|dct/i.test(style)) return 'DCT';
  if (/cvt|continuously/i.test(style)) return 'CVT';
  if (/manual/i.test(style)) return 'MANUAL';
  if (/automatic/i.test(style)) return 'AUTOMATIC';
  return null;
}

function drivetrain(drive: string | null): string | null {
  if (!drive) return null;
  if (/4x4|4wd|four/i.test(drive)) return '4WD';
  if (/awd|all/i.test(drive)) return 'AWD';
  if (/fwd|front/i.test(drive)) return 'FWD';
  if (/rwd|rear/i.test(drive)) return 'RWD';
  return null;
}

/** One vPIC `DecodeVinValues` row as this product's fields. Pure, for testing. */
export function mapVpic(vin: string, result: VpicResult): VinDecode {
  const make = text(result.Make);
  const specs: Record<string, string | number> = {};

  const put = (key: string, value: string | number | null) => {
    if (value !== null) specs[key] = value;
  };
  put('displacementCc', integer(result.DisplacementCC));
  put('cylinders', integer(result.EngineCylinders));
  put('powerHp', integer(result.EngineHP));
  put('engineCode', text(result.EngineModel));
  put('fuelType', fuelType(text(result.FuelTypePrimary)));
  put('transmissionType', transmission(text(result.TransmissionStyle)));
  put('gears', integer(result.TransmissionSpeeds));
  put('drivetrain', drivetrain(text(result.DriveType)));

  // "0" is success; anything else is a partial decode or a check-digit mismatch, which is
  // worth saying — a mistyped character decodes to someone else's car.
  const code = (result.ErrorCode ?? '0').split(',')[0]!.trim();
  const warning = code === '0' ? null : (text(result.ErrorText) ?? 'The VIN decoded only partly.');

  return {
    vin,
    make: make ? titleCaseMake(make) : null,
    model: text(result.Model),
    year: integer(result.ModelYear),
    variant: text(result.Trim) ?? text(result.Series),
    specs,
    warning,
  };
}

/*
 * A VIN's decode never changes, so entries never expire.
 *
 * ponytail: in-process and capped rather than shared — one fetch per VIN per instance. Move to
 * Redis if the instance count makes that rude to NHTSA.
 */
const MAX_CACHED = 1000;
const cache = new Map<string, VinDecode>();

/** Test seam, as in `fx.ts`: tests must never reach the provider. */
export function __setVinCache(vin: string, value: VinDecode | null): void {
  if (value === null) cache.delete(vin);
  else cache.set(vin, value);
}

export async function decodeVin(
  baseUrl: string,
  vin: string,
  log?: { warn: (o: object, m: string) => void },
): Promise<VinDecode | null> {
  const cached = cache.get(vin);
  if (cached) return cached;

  try {
    const response = await fetch(
      `${baseUrl.replace(/\/$/, '')}/vehicles/DecodeVinValues/${encodeURIComponent(vin)}?format=json`,
      { signal: AbortSignal.timeout(5000) },
    );
    if (!response.ok) throw new Error(`vPIC returned ${response.status}`);

    const body = (await response.json()) as { Results?: VpicResult[] };
    const row = body.Results?.[0];
    if (!row) return null;

    const decoded = mapVpic(vin, row);
    if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value!);
    cache.set(vin, decoded);
    return decoded;
  } catch (error) {
    log?.warn({ err: error }, 'VIN decode failed; the form stays manual');
    return null;
  }
}
