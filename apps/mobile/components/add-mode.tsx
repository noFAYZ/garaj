/**
 * Where something on the + sheet goes: one of the sheet's own forms, or a screen of its own.
 * Kept apart from routes on purpose — the forms used to be screens, and a path standing in for
 * a form outlived them, typed as any string and pointing at routes that no longer exist.
 */
export type AddTarget =
  | { readonly form: 'done' | 'planned' }
  | { readonly screen: '/add/document' | '/add/photo' | '/add/vehicle' };
