import {
  BarChart3,
  Car,
  LayoutDashboard,
  ScrollText,
  Server,
  SlidersHorizontal,
  Users,
  Warehouse,
  type LucideIcon,
} from 'lucide-react';

export const NAV_ICONS: Record<string, LucideIcon> = {
  overview: LayoutDashboard,
  analytics: BarChart3,
  system: Server,
  logs: ScrollText,
  users: Users,
  garages: Warehouse,
  vehicles: Car,
  settings: SlidersHorizontal,
};

/** Three kinds of visit, in the order a visit tends to go: look, act on records, configure. */
export const NAV_GROUPS: { label: string; items: { section: string; label: string }[] }[] = [
  {
    label: 'Monitor',
    items: [
      { section: 'overview', label: 'Overview' },
      { section: 'analytics', label: 'Analytics' },
      { section: 'system', label: 'System' },
      { section: 'logs', label: 'Logs' },
    ],
  },
  {
    label: 'Manage',
    items: [
      { section: 'users', label: 'Users' },
      { section: 'garages', label: 'Garages' },
      { section: 'vehicles', label: 'Vehicles' },
    ],
  },
  { label: 'Configure', items: [{ section: 'settings', label: 'Settings' }] },
];
