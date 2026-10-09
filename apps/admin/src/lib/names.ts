import { humanise } from '@/lib/format';
import type { VehicleRow } from './api';

/** What each feature flag is called in the product, and what it does. */
export const FLAG_LABELS: Record<string, string> = {
  ai: 'Ask Garaj (AI)',
  ocr: 'Receipt scanning',
  passport: 'Vehicle passport',
  advancedAnalytics: 'Advanced analytics',
  obd: 'OBD diagnostics',
  billing: 'Billing',
  experimentalUi: 'Experimental UI',
};

export const FLAG_NOTES: Record<string, { what: string; needs?: string }> = {
  ai: { what: 'The Ask tab: answers from a vehicle’s records.', needs: 'AI_API_KEY' },
  ocr: { what: 'Reads amounts and dates off receipts.', needs: 'AI_API_KEY' },
  passport: { what: 'Public vehicle passports, shared by link.' },
  advancedAnalytics: { what: 'Deeper cost statistics. Not built yet.' },
  obd: { what: 'OBD-II adapter readings. Not built yet.' },
  billing: { what: 'Checkout, upgrades and the Stripe webhook.', needs: 'STRIPE_SECRET_KEY' },
  experimentalUi: { what: 'Unfinished screens; on outside production.' },
};

export const madeOf = (vehicle: Pick<VehicleRow, 'year' | 'make' | 'model'>) =>
  [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ');

export function vehicleName(vehicle: VehicleRow): string {
  return vehicle.nickname || madeOf(vehicle) || humanise(vehicle.vehicleType);
}

/** "Api key" is what title-casing makes of it; acronyms stay acronyms. */
export const resourceLabel = (type: string) => humanise(type).replace(/^Api\b/, 'API');

/** `ATV`, `RV` stay capitals; the rest read as words. */
export const vehicleType = (type: string) => (['ATV', 'RV'].includes(type) ? type : humanise(type));
