import { Ionicons } from '@expo/vector-icons';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { amountOnly, digitsOnly, localDay, stampForDay } from '@vehicle-os/ui';
import { newId } from '@vehicle-os/utils';
import { toMinorUnits } from '@/lib/format';
import { FigureInput, Panel, PanelCell } from '@/lib/instrument';
import { pickPhoto, type PickedFile } from '@/lib/file-picker';
import { haptic, PressableScale, Rise } from '@/lib/motion';
import { enqueue, enqueueUpload, flush } from '@/lib/offline';
import { DateField } from '@/lib/date-picker';
import { spacing, typeScale, useTheme } from '@/lib/theme';
import { Button } from '@/lib/ui';

export type QuickAction = 'fuel' | 'odometer' | 'service';

/** What each quick entry is called and wears, in the order a pump visit needs them. */
export const QUICK_ACTIONS: {
  kind: QuickAction;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  hint: string;
}[] = [
  { kind: 'fuel', icon: 'water-outline', label: 'Fuel', hint: 'Litres, cost, odometer' },
  { kind: 'odometer', icon: 'speedometer-outline', label: 'Odometer', hint: 'Just the reading' },
  { kind: 'service', icon: 'construct-outline', label: 'Service', hint: 'What was done, and cost' },
];

/**
 * The three-field entry a pump or a car park calls for.
 *
 * It lived open on the vehicle's Activity screen, above the record — three buttons and, once one
 * was pressed, a form pushing the timeline down the page. Every visit paid for it in scrolling,
 * including the many that came only to read. It is behind the dock's + now, which is where every
 * other "record something" already starts.
 *
 * What it does not do is change: the entry is queued to disk and only then sent, so the save
 * finishes before the button does and the network is a later problem.
 */
export function QuickEntryForm({
  kind,
  vehicleId,
  unit,
  currency,
  currentOdometer,
  onDone,
}: {
  kind: QuickAction;
  vehicleId: string;
  unit: string;
  /** The vehicle's own currency. Assuming one here wrote dollars into a euro garage. */
  currency: string;
  currentOdometer: number | null;
  onDone: () => void;
}) {
  const theme = useTheme();
  /*
   * Undefined until the person types, and the last known reading until then. Seeding state
   * from the prop froze it at mount, so a reading that arrived while the form was open never
   * showed.
   */
  const [typedOdometer, setOdometer] = useState<string>();
  const odometer = typedOdometer ?? (currentOdometer === null ? '' : String(currentOdometer));
  const [amount, setAmount] = useState('');
  const [litres, setLitres] = useState('');
  const [note, setNote] = useState('');
  const [where, setWhere] = useState('');
  const [day, setDay] = useState(() => localDay());
  const [fullTank, setFullTank] = useState(true);
  const [photo, setPhoto] = useState<PickedFile | null>(null);
  /*
   * The extra fields, folded away. A fill-up at a pump is odometer, litres, cost and done — the
   * station, the day and a photograph of the receipt are all things someone occasionally wants
   * and nobody wants in the way. Closed by default, and it says how many it is hiding.
   */
  const [more, setMore] = useState(false);
  const [saved, setSaved] = useState(false);
  const reading = odometer ? Number(odometer) : null;
  const today = localDay();

  const attachPhoto = async () => {
    try {
      const picked = await pickPhoto('camera');
      if (picked) {
        haptic.success();
        setPhoto(picked);
      }
    } catch {
      // A refused camera is not worth an alert over an optional field; the library is still
      // available from the sheet's own capture tiles.
      const picked = await pickPhoto('library').catch(() => null);
      if (picked) setPhoto(picked);
    }
  };

  const save = useMutation({
    mutationFn: async () => {
      /*
       * The entry's id is chosen here rather than by the server: a photograph queued behind it
       * has to name it, and both may be sent days later from a different place entirely.
       */
      const eventId = newId();
      const body: Record<string, unknown> = {
        id: eventId,
        eventType: kind === 'fuel' ? 'FUEL' : kind === 'service' ? 'MAINTENANCE' : 'NOTE',
        title:
          note.trim() ||
          (kind === 'fuel' ? 'Fuel' : kind === 'service' ? 'Service' : 'Odometer reading'),
        occurredAt: stampForDay(day),
        ...(where.trim() ? { provider: where.trim() } : {}),
        // The event has no quantity field, so the litres are kept in its description.
        ...(kind === 'fuel' && litres
          ? { description: `${litres} L${fullTank ? ' · full tank' : ''}` }
          : {}),
        ...(reading !== null
          ? { odometer: reading, odometerUnit: unit === 'mi' ? 'MI' : 'KM' }
          : {}),
        // The form takes a human amount; the API stores minor units, so the rounding happens
        // here rather than sending a decimal across the wire.
        ...(amount
          ? { costAmountMinor: toMinorUnits(Number(amount), currency), costCurrency: currency }
          : {}),
      };

      /*
       * Queued, not posted. This is the difference that matters on a phone: the entry is on
       * disk before the button finishes animating, and the network is a later problem.
       */
      await enqueue({ kind: 'event', vehicleId, body });

      // The receipt, filed against the entry it belongs to, and queued behind it so the entry
      // exists by the time the picture names it.
      if (photo) {
        await enqueueUpload({
          kind: 'upload',
          target: 'photo',
          vehicleId,
          uri: photo.uri,
          name: photo.name,
          mimeType: photo.mimeType,
          size: photo.size,
          body: { eventId },
        });
      }
      void flush();
    },
    onSuccess: () => {
      // Felt as well as seen: at a pump the phone is often already on its way to a pocket.
      haptic.success();
      setSaved(true);
      // Long enough to read the confirmation, short enough not to be in the way.
      setTimeout(onDone, 900);
    },
  });

  if (saved) {
    return (
      <Rise style={[styles.saved, { backgroundColor: theme.successSoft }]}>
        <Ionicons name="checkmark-circle" size={20} color={theme.success} />
        <Text style={[typeScale.caption, { flex: 1, color: theme.success, fontWeight: '600' }]}>
          Saved. Sends itself.
        </Text>
      </Rise>
    );
  }

  const delta =
    reading !== null && currentOdometer !== null && typedOdometer !== undefined
      ? reading - currentOdometer
      : null;

  return (
    <Rise style={{ gap: spacing.sm }}>
      <Panel>
        <PanelCell
          label="Odometer"
          note={
            delta === null
              ? currentOdometer === null
                ? 'Optional'
                : 'Last known reading'
              : delta >= 0
                ? `+${delta.toLocaleString()} ${unit} since the last reading`
                : 'Below the last reading'
          }
          noteTone={delta !== null && delta < 0 ? 'warning' : undefined}
        >
          <FigureInput
            unit={unit}
            value={reading !== null ? reading.toLocaleString() : ''}
            onChangeText={(text) => setOdometer(digitsOnly(text, 10))}
            placeholder="0"
            keyboardType="number-pad"
            accessibilityLabel={`Odometer in ${unit}`}
            selectTextOnFocus
          />
        </PanelCell>

        {kind !== 'odometer' ? (
          <View style={styles.row}>
            <PanelCell label="Cost">
              <FigureInput
                unit={currency}
                value={amount}
                onChangeText={(text) => setAmount(amountOnly(text))}
                placeholder="0.00"
                keyboardType="decimal-pad"
                accessibilityLabel={`Cost in ${currency}`}
              />
            </PanelCell>
            {kind === 'fuel' ? (
              <PanelCell label="Litres">
                <FigureInput
                  unit="L"
                  value={litres}
                  onChangeText={(text) => setLitres(amountOnly(text))}
                  placeholder="0.0"
                  keyboardType="decimal-pad"
                  accessibilityLabel="Litres"
                />
              </PanelCell>
            ) : null}
          </View>
        ) : null}

        <PanelCell label="Note">
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder={
              kind === 'fuel' ? 'Filled up' : kind === 'service' ? 'Oil change' : 'Optional'
            }
            placeholderTextColor={theme.borderStrong}
            accessibilityLabel="Note"
            maxLength={200}
            style={[typeScale.headline, { color: theme.foreground, paddingVertical: 2 }]}
          />
        </PanelCell>

        {/*
         * Only the one field that needs a keyboard stays in the panel. The rest — the day, the
         * full-tank answer, the receipt — are one-touch choices, and four stacked rows of them
         * turned a quick entry into a form. They sit as chips under the panel instead.
         */}
        {more && kind !== 'odometer' ? (
          <PanelCell label={kind === 'fuel' ? 'Station' : 'Garage'}>
            <TextInput
              value={where}
              onChangeText={setWhere}
              placeholder={kind === 'fuel' ? 'Shell, Tesco' : 'Who did it'}
              placeholderTextColor={theme.borderStrong}
              accessibilityLabel={kind === 'fuel' ? 'Station' : 'Garage'}
              maxLength={200}
              style={[typeScale.headline, { color: theme.foreground, paddingVertical: 2 }]}
            />
          </PanelCell>
        ) : null}
      </Panel>

      {more ? (
        <Rise style={styles.extras}>
          {/* The day, as its own stepper — most entries are today, and the rest are a tap back. */}
          <View style={[styles.chip, { backgroundColor: theme.muted }]}>
            <DateField value={day} onChange={setDay} max={today} label="When" />
          </View>

          {kind === 'fuel' ? (
            <PressableScale
              onPress={() => {
                haptic.selection();
                setFullTank((current) => !current);
              }}
              accessibilityRole="switch"
              accessibilityState={{ checked: fullTank }}
              accessibilityLabel="Filled to full"
              scaleTo={0.94}
              style={[
                styles.chip,
                styles.chipPad,
                { backgroundColor: fullTank ? theme.primary : theme.muted },
              ]}
            >
              <Ionicons
                name={fullTank ? 'checkmark' : 'remove'}
                size={14}
                color={fullTank ? theme.primaryForeground : theme.mutedForeground}
              />
              <Text
                style={[
                  typeScale.caption,
                  {
                    fontWeight: '700',
                    color: fullTank ? theme.primaryForeground : theme.mutedForeground,
                  },
                ]}
              >
                Full
              </Text>
            </PressableScale>
          ) : null}

          <PressableScale
            onPress={() => void attachPhoto()}
            accessibilityRole="button"
            accessibilityLabel={photo ? 'Photo attached. Replace it' : 'Add a photo'}
            scaleTo={0.94}
            style={[
              styles.chip,
              styles.chipPad,
              { backgroundColor: photo ? theme.successSoft : theme.muted },
            ]}
          >
            <Ionicons
              name={photo ? 'checkmark-circle' : 'camera-outline'}
              size={14}
              color={photo ? theme.success : theme.foreground}
            />
            <Text
              numberOfLines={1}
              style={[
                typeScale.caption,
                { fontWeight: '700', color: photo ? theme.success : theme.foreground },
              ]}
            >
              {photo ? 'Photo' : kind === 'fuel' ? 'Receipt' : 'Photo'}
            </Text>
          </PressableScale>
        </Rise>
      ) : null}

      {/* One press to the rest, and it says what is behind it rather than just "More". */}
      <PressableScale
        onPress={() => {
          haptic.selection();
          setMore((current) => !current);
        }}
        accessibilityRole="button"
        accessibilityState={{ expanded: more }}
        accessibilityLabel={more ? 'Fewer fields' : 'More fields'}
        scaleTo={0.98}
        style={styles.moreRow}
      >
        <Text style={[typeScale.caption, { color: theme.mutedForeground }]}>
          {more ? 'Less' : kind === 'odometer' ? 'Date, photo' : 'Date, place, photo'}
        </Text>
        <Ionicons
          name={more ? 'chevron-up' : 'chevron-down'}
          size={14}
          color={theme.mutedForeground}
        />
      </PressableScale>

      <Button
        label="Save"
        variant="primary"
        loading={save.isPending}
        onPress={() => save.mutate()}
        disabled={!odometer && !amount && !note.trim()}
      />
    </Rise>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: StyleSheet.hairlineWidth },
  extras: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    minHeight: 34,
    borderRadius: 999,
  },
  chipPad: { paddingHorizontal: 12 },
  moreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    minHeight: 36,
  },
  saved: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: 14,
    padding: spacing.sm,
  },
});
