/**
 * What + offers, phrased as answers to the sheet's question rather than as categories — so the
 * row is the whole instruction and needs no line under it explaining itself.
 */
export const ADD_ACTIONS = [
  { href: '/add/done', icon: 'checkmark-done-outline', label: 'Something done', hint: '' },
  { href: '/add/planned', icon: 'calendar-outline', label: 'A reminder', hint: '' },
  { href: '/add/document', icon: 'document-text-outline', label: 'A document', hint: '' },
  { href: '/add/vehicle', icon: 'car-sport-outline', label: 'A new vehicle', hint: '' },
] as const;
