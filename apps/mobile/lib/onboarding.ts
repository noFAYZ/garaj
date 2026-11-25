/**
 * What a first run needs to know: what the person's region suggests for money and units, and
 * whether the garage setup has been offered this session.
 */

import type { DistanceUnit, VolumeUnit } from '@vehicle-os/domain';
import { CURRENCIES } from './locale-options';

/*
 * The garage setup opens by itself once per session for someone with no garage — not again on
 * every visit to Home if they close it; Home's empty state keeps the way back in.
 */
let setupOffered = false;
export const wasSetupOffered = () => setupOffered;
export const markSetupOffered = () => {
  setupOffered = true;
};

/**
 * Where the phone is, for the setup's first guesses. The time zone before the language: a phone
 * in Lahore is as often set to US English as to Urdu, but its clock is on Karachi time.
 */
const ZONE_REGION: Record<string, string> = {
  'Asia/Karachi': 'PK',
  'Asia/Kolkata': 'IN',
  'Asia/Calcutta': 'IN',
  'Asia/Dubai': 'AE',
  'Asia/Riyadh': 'SA',
  'Asia/Qatar': 'QA',
  'Asia/Kuwait': 'KW',
  'Asia/Bahrain': 'BH',
  'Asia/Muscat': 'OM',
  'Asia/Dhaka': 'BD',
  'Asia/Colombo': 'LK',
  'Asia/Tokyo': 'JP',
  'Asia/Shanghai': 'CN',
  'Asia/Hong_Kong': 'HK',
  'Asia/Singapore': 'SG',
  'Asia/Seoul': 'KR',
  'Asia/Kuala_Lumpur': 'MY',
  'Asia/Bangkok': 'TH',
  'Asia/Jakarta': 'ID',
  'Asia/Manila': 'PH',
  'Asia/Jerusalem': 'IL',
  'Europe/London': 'GB',
  'Europe/Dublin': 'IE',
  'Europe/Zurich': 'CH',
  'Europe/Stockholm': 'SE',
  'Europe/Oslo': 'NO',
  'Europe/Copenhagen': 'DK',
  'Europe/Warsaw': 'PL',
  'Europe/Prague': 'CZ',
  'Europe/Budapest': 'HU',
  'Europe/Bucharest': 'RO',
  'Europe/Istanbul': 'TR',
  'Africa/Cairo': 'EG',
  'Africa/Johannesburg': 'ZA',
  'Africa/Lagos': 'NG',
  'Africa/Nairobi': 'KE',
  'America/Toronto': 'CA',
  'America/Vancouver': 'CA',
  'America/Sao_Paulo': 'BR',
  'America/Mexico_City': 'MX',
  'America/Argentina/Buenos_Aires': 'AR',
  'America/Santiago': 'CL',
  'America/Bogota': 'CO',
  'Australia/Sydney': 'AU',
  'Australia/Melbourne': 'AU',
  'Australia/Perth': 'AU',
  'Pacific/Auckland': 'NZ',
};

/** The euro's countries, which all answer to one currency. */
const EURO = new Set([
  'AT',
  'BE',
  'CY',
  'DE',
  'EE',
  'ES',
  'FI',
  'FR',
  'GR',
  'HR',
  'IE',
  'IT',
  'LT',
  'LU',
  'LV',
  'MT',
  'NL',
  'PT',
  'SI',
  'SK',
]);
/** Where road signs are in miles. */
const MILES = new Set(['US', 'GB', 'LR', 'MM']);

function region(): string | null {
  try {
    const zone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (zone && ZONE_REGION[zone]) return ZONE_REGION[zone];
    if (zone?.startsWith('America/') && !zone.includes('Argentina')) return 'US';
    if (zone?.startsWith('Europe/')) return 'EU';
  } catch {
    // Falls through to the language's region.
  }
  try {
    const locale = new Intl.NumberFormat().resolvedOptions().locale;
    const match = /-([A-Z]{2})\b/.exec(locale);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

export interface RegionDefaults {
  currency: string;
  distanceUnit: DistanceUnit;
  volumeUnit: VolumeUnit;
  timezone: string | null;
}

/** The setup's first guesses, from the phone's clock and language: one tap to confirm. */
export function regionDefaults(): RegionDefaults {
  const where = region();
  const byRegion =
    where === 'EU' || (where && EURO.has(where))
      ? 'EUR'
      : CURRENCIES.find((option) => where && option.value.startsWith(where))?.value;
  let timezone: string | null = null;
  try {
    timezone = new Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
  } catch {
    timezone = null;
  }
  return {
    currency: byRegion ?? 'USD',
    distanceUnit: where && MILES.has(where) ? 'MI' : 'KM',
    volumeUnit: where === 'US' ? 'US_GALLON' : 'LITER',
    timezone,
  };
}
