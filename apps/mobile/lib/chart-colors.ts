import { healthBand } from '@vehicle-os/ui';
import { useTheme } from './theme';

/*
 * Chart colours: the one place the app uses hue for something other than a status.
 *
 * The series hues are shared tokens (`chart*` in `@vehicle-os/ui/tokens.ts`), the same the web
 * reads from `globals.css`, so a report group is one colour on both: refuelling orange, services
 * blue, other expenses magenta, income aqua, trips violet. Stepped per theme against the card and
 * validated with the dataviz script; every slice and series still carries a visible label.
 *
 * Status colours are a separate, fixed set — never a series colour — and always ride beside a
 * word or an icon, so no state is told by colour alone.
 */

export const STATUS = {
  good: '#0ca30c',
  warning: '#fab219',
  serious: '#ec835a',
  critical: '#d03b3b',
} as const;

export type StatusKey = keyof typeof STATUS;

/** A health score's band — the shared thresholds, not a copy — as a status colour's key. */
export function healthStatus(score: number): StatusKey {
  const band = healthBand(score);
  return band === 'success' ? 'good' : band === 'warning' ? 'warning' : 'critical';
}

export function useChartColors() {
  const theme = useTheme();
  return {
    REFUELING: theme.chartRefuel,
    SERVICES: theme.chartService,
    EXPENSES: theme.chartExpense,
    income: theme.chartIncome,
    trip: theme.chartTrip,
    neutral: theme.chartNeutral,
    /** Ink, for the one line a chart is about (cost to own). */
    ink: theme.foreground,
    /** Every group at once (spent, beside earned): grey ink, not a group's hue. */
    muted: theme.mutedForeground,
  };
}
