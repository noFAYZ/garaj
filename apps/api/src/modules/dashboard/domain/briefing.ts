/**
 * Money as text, for the briefing sentences.
 *
 * The API almost never formats money — amounts cross the wire as minor units plus a currency
 * so each client can render them in the reader's locale. The briefing is the exception: it is
 * prose composed server-side, and a sentence cannot carry a structured amount.
 */

import { minorUnitExponent } from '@vehicle-os/domain';

export function formatMoney(money: { amountMinor: number; currency: string }): string {
  const exponent = minorUnitExponent(money.currency);
  // `en-US` deliberately, not a per-user locale: this is one sentence in a summary, and
  // threading a locale here would imply the rest of the API is localised too. When the
  // product does localise, this is the one place that changes.
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: money.currency,
    maximumFractionDigits: exponent,
  }).format(money.amountMinor / 10 ** exponent);
}
