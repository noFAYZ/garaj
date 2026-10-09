import type { SearchResult, SearchResultType } from '@vehicle-os/contracts';
import type { IconName } from '@/components/icons';

/**
 * Where a search hit goes when clicked, and the glyph that identifies it.
 *
 * Shared by the search page and the header combobox. It lived only on the page, and when the
 * timeline route was renamed to `history` this map kept pointing at the old one — every
 * timeline hit was a 404 that nothing tested.
 */
export const SEARCH_KINDS: Record<
  SearchResultType,
  { label: string; icon: IconName; href: (result: SearchResult) => string }
> = {
  VEHICLE: { label: 'Vehicles', icon: 'car', href: (r) => `/vehicles/${r.id}` },
  EVENT: { label: 'Activity', icon: 'timeline', href: (r) => `/vehicles/${r.vehicleId}` },
  TASK: { label: 'Tasks', icon: 'task', href: () => '/tasks' },
  MAINTENANCE: {
    label: 'Schedules',
    icon: 'maintenance',
    href: (r) => `/vehicles/${r.vehicleId}`,
  },
  DOCUMENT: {
    label: 'Documents',
    icon: 'document',
    href: (r) => `/vehicles/${r.vehicleId}/documents`,
  },
  EXPENSE: { label: 'Spending', icon: 'money', href: (r) => `/vehicles/${r.vehicleId}` },
  // ponytail: ideas have no screen of their own yet, so a hit opens the vehicle it belongs to.
  IDEA: { label: 'Ideas', icon: 'star', href: (r) => `/vehicles/${r.vehicleId}` },
};
