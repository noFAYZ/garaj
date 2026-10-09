import type { ListOption } from './pickers';

/*
 * The choices behind the account's currency and time zone.
 *
 * Written out rather than read from `Intl.supportedValuesOf` / `Intl.DisplayNames`: Hermes, the
 * phone's JavaScript engine, has neither. A zone missing here can still be typed into the search
 * and saved — the server checks it against the real IANA list.
 */

export const CURRENCIES: readonly ListOption[] = [
  ['USD', 'US dollar'],
  ['EUR', 'Euro'],
  ['GBP', 'British pound'],
  ['PKR', 'Pakistani rupee'],
  ['INR', 'Indian rupee'],
  ['AED', 'UAE dirham'],
  ['SAR', 'Saudi riyal'],
  ['QAR', 'Qatari riyal'],
  ['KWD', 'Kuwaiti dinar'],
  ['BHD', 'Bahraini dinar'],
  ['OMR', 'Omani rial'],
  ['CAD', 'Canadian dollar'],
  ['AUD', 'Australian dollar'],
  ['NZD', 'New Zealand dollar'],
  ['JPY', 'Japanese yen'],
  ['CNY', 'Chinese yuan'],
  ['HKD', 'Hong Kong dollar'],
  ['SGD', 'Singapore dollar'],
  ['KRW', 'South Korean won'],
  ['MYR', 'Malaysian ringgit'],
  ['THB', 'Thai baht'],
  ['IDR', 'Indonesian rupiah'],
  ['PHP', 'Philippine peso'],
  ['BDT', 'Bangladeshi taka'],
  ['LKR', 'Sri Lankan rupee'],
  ['CHF', 'Swiss franc'],
  ['SEK', 'Swedish krona'],
  ['NOK', 'Norwegian krone'],
  ['DKK', 'Danish krone'],
  ['PLN', 'Polish złoty'],
  ['CZK', 'Czech koruna'],
  ['HUF', 'Hungarian forint'],
  ['RON', 'Romanian leu'],
  ['TRY', 'Turkish lira'],
  ['ILS', 'Israeli shekel'],
  ['EGP', 'Egyptian pound'],
  ['ZAR', 'South African rand'],
  ['NGN', 'Nigerian naira'],
  ['KES', 'Kenyan shilling'],
  ['BRL', 'Brazilian real'],
  ['MXN', 'Mexican peso'],
  ['ARS', 'Argentine peso'],
  ['CLP', 'Chilean peso'],
  ['COP', 'Colombian peso'],
].map(([value, label]) => ({ value: value!, label: label!, hint: value, image: flagUrl(value!) }));

/**
 * The flag for a currency, as an image rather than an emoji — flag emoji draw as two letters on
 * some Android builds, and emoji are kept for activity. An ISO 4217 code starts with its country's
 * ISO 3166 code (EUR with the EU's), which is what flagcdn names its files by. Cached on disk by
 * expo-image after the first load.
 */
export function flagUrl(currency: string): string {
  return `https://flagcdn.com/w80/${currency.slice(0, 2).toLowerCase()}.png`;
}

const ZONES = [
  'Pacific/Honolulu',
  'America/Anchorage',
  'America/Los_Angeles',
  'America/Denver',
  'America/Phoenix',
  'America/Chicago',
  'America/Mexico_City',
  'America/New_York',
  'America/Toronto',
  'America/Bogota',
  'America/Santiago',
  'America/Sao_Paulo',
  'America/Argentina/Buenos_Aires',
  'Atlantic/Reykjavik',
  'Europe/London',
  'Europe/Dublin',
  'Europe/Lisbon',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Madrid',
  'Europe/Rome',
  'Europe/Amsterdam',
  'Europe/Stockholm',
  'Europe/Warsaw',
  'Europe/Athens',
  'Europe/Helsinki',
  'Europe/Istanbul',
  'Europe/Moscow',
  'Africa/Lagos',
  'Africa/Cairo',
  'Africa/Johannesburg',
  'Africa/Nairobi',
  'Asia/Jerusalem',
  'Asia/Riyadh',
  'Asia/Qatar',
  'Asia/Dubai',
  'Asia/Tehran',
  'Asia/Karachi',
  'Asia/Kolkata',
  'Asia/Colombo',
  'Asia/Kathmandu',
  'Asia/Dhaka',
  'Asia/Bangkok',
  'Asia/Jakarta',
  'Asia/Kuala_Lumpur',
  'Asia/Singapore',
  'Asia/Manila',
  'Asia/Hong_Kong',
  'Asia/Shanghai',
  'Asia/Seoul',
  'Asia/Tokyo',
  'Australia/Perth',
  'Australia/Adelaide',
  'Australia/Brisbane',
  'Australia/Sydney',
  'Pacific/Auckland',
];

const zoneOption = (zone: string): ListOption => {
  const parts = zone.split('/');
  return {
    value: zone,
    label: (parts.at(-1) ?? zone).replaceAll('_', ' '),
    hint: zone,
  };
};

/** The zone this phone is set to, when the engine can say. */
export function deviceTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

export function timeZoneOptions(): ListOption[] {
  const device = deviceTimeZone();
  const zones = ZONES.map(zoneOption);
  if (!device) return zones;
  return [
    { ...zoneOption(device), label: `This phone · ${zoneOption(device).label}` },
    ...zones.filter((zone) => zone.value !== device),
  ];
}

/** A typed `Area/City` the list does not carry, offered as-is for the server to check. */
export function typedZone(query: string): ListOption | null {
  const zone = query.replaceAll(' ', '_');
  return /^[A-Za-z]+(\/[A-Za-z0-9_+-]+)+$/.test(zone)
    ? { value: zone, label: `Use “${zone}”`, hint: 'Checked when saved' }
    : null;
}
