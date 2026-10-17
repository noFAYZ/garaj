import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState, type ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { localDay } from '@vehicle-os/ui';
import { haptic, PressableScale, Rise } from '@/lib/motion';
import { figure, radius, spacing, typeScale, useTheme } from '@/lib/theme';

/**
 * Dates, everywhere, from one place.
 *
 * The app used to step a day at a time with two arrows. That is exactly right for "yesterday" and
 * useless for a receipt from March — eleven presses, each one a re-render, with no sight of what
 * day of the week any of them were. A month at a time answers both: today is one tap, March is
 * two, and the shape of the month is visible while choosing.
 *
 * One component for a single day and for a span, because a range is a single date chosen twice
 * and a second calendar would be the same arithmetic written again, differently.
 */

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

const MONTH_LABEL = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' });
const TRIGGER_LABEL = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});
const SHORT_LABEL = new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'short' });

/** A `YYYY-MM-DD` day as a local `Date` at noon, which no time zone can push into another day. */
const asDate = (day: string) => new Date(`${day}T12:00:00`);
const asDay = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;

/** The Monday-first grid for a month, padded with the days either side that share its weeks. */
function monthGrid(anchor: string): { day: string; inMonth: boolean }[] {
  const date = asDate(anchor);
  const first = new Date(date.getFullYear(), date.getMonth(), 1);
  // `getDay()` is Sunday-first; this app reads Monday-first, as the rest of its week labels do.
  const lead = (first.getDay() + 6) % 7;

  const cells: { day: string; inMonth: boolean }[] = [];
  for (let index = 0; index < 42; index += 1) {
    const cell = new Date(first.getFullYear(), first.getMonth(), 1 - lead + index);
    cells.push({ day: asDay(cell), inMonth: cell.getMonth() === first.getMonth() });
  }
  // Six rows only when the month genuinely needs them, so most months do not draw a blank week.
  return cells[35] && cells[35].inMonth ? cells : cells.slice(0, 35);
}

export interface DateFieldProps {
  /** `YYYY-MM-DD`. Empty means nothing chosen yet. */
  value: string;
  onChange: (day: string) => void;
  /** Bounds, inclusive. A done entry cannot be tomorrow; a due date cannot be yesterday. */
  min?: string;
  max?: string;
  label?: string;
  placeholder?: string;
  /**
   * Draws the trigger in place of the field's own — a chip in a row of facts. Given the words the
   * field would say and the press that opens the calendar.
   */
  trigger?: (said: string, open: () => void) => ReactNode;
}

/** One day: a trigger that reads as a date, and the calendar behind it. */
export function DateField({
  value,
  onChange,
  min,
  max,
  label = 'Date',
  placeholder = 'Pick a date',
  trigger,
}: DateFieldProps) {
  const [open, setOpen] = useState(false);
  const said = value ? TRIGGER_LABEL.format(asDate(value)) : placeholder;
  return (
    <>
      {trigger ? (
        trigger(said, () => setOpen(true))
      ) : (
        <Trigger text={said} muted={!value} label={label} onPress={() => setOpen(true)} />
      )}
      {open ? (
        <Calendar
          start={value || localDay()}
          end={null}
          min={min}
          max={max}
          onClose={() => setOpen(false)}
          onPick={(day) => {
            onChange(day);
            setOpen(false);
          }}
        />
      ) : null}
    </>
  );
}

export interface DateRangeFieldProps {
  from: string;
  to: string;
  onChange: (range: { from: string; to: string }) => void;
  min?: string;
  max?: string;
  label?: string;
}

/** A span: the same calendar, tapped twice, with the days between it shaded. */
export function DateRangeField({
  from,
  to,
  onChange,
  min,
  max,
  label = 'Between',
}: DateRangeFieldProps) {
  const [open, setOpen] = useState(false);
  const text =
    from && to
      ? `${SHORT_LABEL.format(asDate(from))} – ${SHORT_LABEL.format(asDate(to))}`
      : 'Any dates';

  return (
    <>
      <Trigger text={text} muted={!from || !to} label={label} onPress={() => setOpen(true)} />
      {open ? (
        <Calendar
          start={from || localDay()}
          end={to || null}
          range
          min={min}
          max={max}
          onClose={() => setOpen(false)}
          onPickRange={(range) => {
            onChange(range);
            setOpen(false);
          }}
        />
      ) : null}
    </>
  );
}

function Trigger({
  text,
  muted,
  label,
  onPress,
}: {
  text: string;
  muted: boolean;
  label: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <PressableScale
      onPress={() => {
        haptic.selection();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${text}`}
      accessibilityHint="Opens a calendar"
      scaleTo={0.98}
      style={[styles.trigger, { backgroundColor: theme.muted }]}
    >
      <Ionicons name="calendar-outline" size={15} color={theme.mutedForeground} />
      <Text
        numberOfLines={1}
        style={[
          typeScale.label,
          { flex: 1, color: muted ? theme.mutedForeground : theme.foreground },
        ]}
      >
        {text}
      </Text>
      <Ionicons name="chevron-down" size={14} color={theme.mutedForeground} />
    </PressableScale>
  );
}

/**
 * The calendar itself.
 *
 * A month of cells, the days outside the bounds unpressable rather than hidden — a grid that
 * changes shape as the limits move is harder to read than one with some cells greyed.
 */
function Calendar({
  start,
  end,
  range = false,
  min,
  max,
  onClose,
  onPick,
  onPickRange,
}: {
  start: string;
  end: string | null;
  range?: boolean;
  min?: string;
  max?: string;
  onClose: () => void;
  onPick?: (day: string) => void;
  onPickRange?: (range: { from: string; to: string }) => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const today = localDay();

  const [anchor, setAnchor] = useState(start);
  // While a range is half-made: the first tap is held here until the second lands.
  const [from, setFrom] = useState(range ? start : '');
  const [to, setTo] = useState(range ? (end ?? '') : '');

  const cells = useMemo(() => monthGrid(anchor), [anchor]);
  const allowed = (day: string) => (!min || day >= min) && (!max || day <= max);

  const shiftMonth = (by: -1 | 1) => {
    const date = asDate(anchor);
    setAnchor(asDay(new Date(date.getFullYear(), date.getMonth() + by, 1)));
    haptic.selection();
  };

  const choose = (day: string) => {
    haptic.selection();
    if (!range) {
      onPick?.(day);
      return;
    }
    // First tap sets the start and clears the end; the second closes the span.
    if (!from || (from && to) || day < from) {
      setFrom(day);
      setTo('');
      return;
    }
    setTo(day);
    onPickRange?.({ from, to: day });
  };

  const quick: { label: string; apply: () => void }[] = range
    ? [
        {
          label: '30 days',
          apply: () => onPickRange?.({ from: localDay({ days: -29 }), to: today }),
        },
        {
          label: '3 months',
          apply: () => onPickRange?.({ from: localDay({ months: -3 }), to: today }),
        },
        {
          label: 'A year',
          apply: () => onPickRange?.({ from: localDay({ months: -12 }), to: today }),
        },
      ]
    : [
        { label: 'Today', apply: () => onPick?.(today) },
        { label: 'Yesterday', apply: () => onPick?.(localDay({ days: -1 })) },
      ].filter((option) => allowed(option.label === 'Today' ? today : localDay({ days: -1 })));

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close"
        style={styles.backdrop}
      >
        <Rise distance={36}>
          <Pressable
            onPress={(event) => event.stopPropagation()}
            style={[
              styles.sheet,
              { backgroundColor: theme.card, paddingBottom: insets.bottom + spacing.md },
            ]}
          >
            <View style={[styles.grabber, { backgroundColor: theme.borderStrong }]} />

            <View style={styles.header}>
              <Text style={[typeScale.headline, { flex: 1, color: theme.foreground }]}>
                {MONTH_LABEL.format(asDate(anchor))}
              </Text>
              <PressableScale
                onPress={() => shiftMonth(-1)}
                accessibilityRole="button"
                accessibilityLabel="Previous month"
                hitSlop={8}
                style={[styles.arrow, { backgroundColor: theme.muted }]}
              >
                <Ionicons name="chevron-back" size={16} color={theme.foreground} />
              </PressableScale>
              <PressableScale
                onPress={() => shiftMonth(1)}
                accessibilityRole="button"
                accessibilityLabel="Next month"
                hitSlop={8}
                style={[styles.arrow, { backgroundColor: theme.muted }]}
              >
                <Ionicons name="chevron-forward" size={16} color={theme.foreground} />
              </PressableScale>
            </View>

            <View style={styles.week}>
              {WEEKDAYS.map((day, index) => (
                <Text
                  key={`${day}-${index}`}
                  style={[styles.cell, typeScale.caption, { color: theme.mutedForeground }]}
                >
                  {day}
                </Text>
              ))}
            </View>

            <View style={styles.grid}>
              {cells.map(({ day, inMonth }) => {
                const enabled = allowed(day);
                const isFrom = range && day === from;
                const isTo = range && day === to;
                const inSpan = range && from && to && day > from && day < to;
                const selected = range ? isFrom || isTo : day === start;

                return (
                  <PressableScale
                    key={day}
                    onPress={() => choose(day)}
                    disabled={!enabled}
                    accessibilityRole="button"
                    accessibilityState={{ selected, disabled: !enabled }}
                    accessibilityLabel={TRIGGER_LABEL.format(asDate(day))}
                    scaleTo={0.9}
                    style={[
                      styles.cell,
                      styles.day,
                      selected
                        ? { backgroundColor: theme.primary }
                        : inSpan
                          ? { backgroundColor: theme.primarySoft }
                          : null,
                    ]}
                  >
                    <Text
                      style={[
                        figure,
                        styles.dayText,
                        {
                          color: selected
                            ? theme.primaryForeground
                            : !enabled
                              ? theme.borderStrong
                              : inMonth
                                ? theme.foreground
                                : theme.mutedForeground,
                        },
                      ]}
                    >
                      {asDate(day).getDate()}
                    </Text>
                    {/* Today is marked even when it is not the chosen day. */}
                    {day === today && !selected ? (
                      <View style={[styles.today, { backgroundColor: theme.foreground }]} />
                    ) : null}
                  </PressableScale>
                );
              })}
            </View>

            <View style={styles.quickRow}>
              {quick.map((option) => (
                <PressableScale
                  key={option.label}
                  onPress={() => {
                    haptic.selection();
                    option.apply();
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={option.label}
                  scaleTo={0.95}
                  style={[styles.quick, { backgroundColor: theme.muted }]}
                >
                  <Text style={[typeScale.caption, { fontWeight: '700', color: theme.foreground }]}>
                    {option.label}
                  </Text>
                </PressableScale>
              ))}
              {range && from && !to ? (
                <Text style={[typeScale.caption, { color: theme.mutedForeground }]}>
                  Now pick the last day
                </Text>
              ) : null}
            </View>
          </Pressable>
        </Rise>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 40,
    borderRadius: radius.md,
    paddingHorizontal: 12,
  },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: radius.xl + 8,
    borderTopRightRadius: radius.xl + 8,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    gap: spacing.sm,
  },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 999, marginBottom: 4 },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 40 },
  arrow: {
    width: 34,
    height: 34,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  week: { flexDirection: 'row' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  // Seven to a row, and the width follows the container rather than a guess at the screen.
  cell: { width: `${100 / 7}%`, textAlign: 'center' },
  day: { height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 999 },
  dayText: { fontSize: 15, fontWeight: '600' },
  today: { position: 'absolute', bottom: 6, width: 4, height: 4, borderRadius: 999 },
  quickRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 36 },
  quick: { minHeight: 32, borderRadius: 999, paddingHorizontal: 12, justifyContent: 'center' },
});
