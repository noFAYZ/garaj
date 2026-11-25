import type { Ionicons } from '@expo/vector-icons';

/**
 * Where something on the + sheet goes: one of the sheet's own forms, or a screen of its own.
 * Kept apart from routes on purpose — the forms used to be screens, and a path standing in for
 * a form outlived them, typed as any string and pointing at routes that no longer exist.
 */
export type AddTarget =
  | { readonly form: 'done' | 'planned' }
  | { readonly screen: '/add/document' | '/add/photo' | '/add/vehicle' };

export interface AddOption {
  readonly key: string;
  readonly to: AddTarget;
  readonly icon: keyof typeof Ionicons.glyphMap;
  readonly label: string;
  readonly hint: string;
}

/**
 * What + offers, phrased as answers to the sheet's question rather than as categories — so the
 * row is the whole instruction and needs no line under it explaining itself.
 */
export const ADD_ACTIONS: readonly AddOption[] = [
  {
    key: 'done',
    to: { form: 'done' },
    icon: 'checkmark-done-outline',
    label: 'Something done',
    hint: '',
  },
  {
    key: 'planned',
    to: { form: 'planned' },
    icon: 'calendar-outline',
    label: 'A reminder',
    hint: '',
  },
  {
    key: 'document',
    to: { screen: '/add/document' },
    icon: 'document-text-outline',
    label: 'A document',
    hint: '',
  },
  {
    key: 'vehicle',
    to: { screen: '/add/vehicle' },
    icon: 'car-sport-outline',
    label: 'A new vehicle',
    hint: '',
  },
];
