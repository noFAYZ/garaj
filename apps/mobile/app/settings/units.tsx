import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ApiError } from '@vehicle-os/api-client';
import { garagesQuery } from '@vehicle-os/api-client/react';
import { Group, Row, SettingsPage, useProfileUpdate } from '@/components/settings-kit';
import { api } from '@/lib/api';
import { formatMoney, toMinorUnits } from '@/lib/format';
import { Eyebrow, Segmented } from '@/lib/instrument';
import { Rise } from '@/lib/motion';
import {
  CURRENCIES,
  deviceTimeZone,
  flagUrl,
  timeZoneOptions,
  typedZone,
} from '@/lib/locale-options';
import { ListPicker } from '@/lib/pickers';
import { useProfile } from '@/lib/vehicle-units';
import { figure, radius, spacing, typeScale, useTheme } from '@/lib/theme';
import { Skeleton } from '@/lib/ui';

/** One fill-up, said in each unit: the preview is the same trip, only the words change. */
const DISTANCE_SAMPLE = { KM: '612 km', MI: '380 mi' } as const;
const VOLUME_SAMPLE = {
  LITER: '45.0 L',
  US_GALLON: '11.9 US gal',
  IMP_GALLON: '9.9 UK gal',
} as const;

function localTime(zone: string): string | null {
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: zone,
    }).format(new Date());
  } catch {
    // A zone this phone's Intl does not know: say nothing rather than the wrong time.
    return null;
  }
}

/**
 * The units and region new records default to, with the proof beside the switches: a fill-up as
 * it will read — distance, volume, price and the local time — updating as each one is picked.
 * Every switch saves as it is set; there is no Save button, because this is a switch, not a form.
 */
export default function UnitsScreen() {
  const theme = useTheme();
  const profile = useProfile();
  const garages = useQuery(garagesQuery(api));
  const update = useProfileUpdate();
  const [picking, setPicking] = useState<'currency' | 'timezone' | null>(null);
  const me = profile.data;

  const owned = (garages.data ?? []).filter((garage) => garage.role === 'OWNER').length;
  const phoneZone = deviceTimeZone();
  const time = me ? localTime(me.timezone) : null;

  return (
    <SettingsPage>
      {/* --- the proof: one entry, in the units as they are now ------------------------------ */}
      <Rise>
        <View
          accessible
          accessibilityLabel={
            me
              ? `A fill-up will read ${VOLUME_SAMPLE[me.volumeUnit]}, ${DISTANCE_SAMPLE[me.distanceUnit]}, ${formatMoney({ amountMinor: toMinorUnits(68.4, me.defaultCurrency), currency: me.defaultCurrency })}`
              : 'Preview'
          }
          style={[styles.preview, { backgroundColor: theme.card }]}
        >
          <Eyebrow>A fill-up will read</Eyebrow>
          {me ? (
            <>
              <View style={styles.previewLine}>
                <Text style={[figure, styles.previewFigure, { color: theme.foreground }]}>
                  {VOLUME_SAMPLE[me.volumeUnit]}
                </Text>
                <Text style={[figure, styles.previewFigure, { color: theme.foreground }]}>
                  {formatMoney({
                    amountMinor: toMinorUnits(68.4, me.defaultCurrency),
                    currency: me.defaultCurrency,
                  })}
                </Text>
              </View>
              <View style={styles.previewLine}>
                <Text style={[typeScale.caption, figure, { color: theme.mutedForeground }]}>
                  odometer {DISTANCE_SAMPLE[me.distanceUnit]}
                </Text>
                <Text style={[typeScale.caption, figure, { color: theme.mutedForeground }]}>
                  {time ? `${time} local` : me.timezone}
                </Text>
              </View>
            </>
          ) : (
            <Skeleton width="100%" height={48} />
          )}
        </View>
      </Rise>

      <Group title="Units" index={1}>
        <Row icon="speedometer-outline" label="Distance">
          {me ? (
            <View style={{ width: 120 }}>
              <Segmented
                value={me.distanceUnit}
                options={[
                  { value: 'KM', label: 'km' },
                  { value: 'MI', label: 'mi' },
                ]}
                onChange={(distanceUnit) => update.mutate({ distanceUnit })}
              />
            </View>
          ) : (
            <Skeleton width={120} height={36} radius={999} />
          )}
        </Row>
        <Row icon="water-outline" label="Volume" stacked>
          {me ? (
            <Segmented
              value={me.volumeUnit}
              options={[
                { value: 'LITER', label: 'Litres' },
                { value: 'US_GALLON', label: 'US gal' },
                { value: 'IMP_GALLON', label: 'UK gal' },
              ]}
              onChange={(volumeUnit) => update.mutate({ volumeUnit })}
            />
          ) : (
            <Skeleton width="100%" height={44} radius={999} />
          )}
        </Row>
      </Group>

      <Group
        title="Region"
        index={2}
        footer={
          owned > 0
            ? `Currency also moves the totals of the ${owned === 1 ? 'garage' : `${owned} garages`} you own. Shared garages keep theirs.`
            : undefined
        }
      >
        <Row
          icon="cash-outline"
          label="Currency"
          value={me?.defaultCurrency}
          mono
          onPress={me ? () => setPicking('currency') : undefined}
        >
          {me ? (
            <Image
              source={{ uri: flagUrl(me.defaultCurrency) }}
              style={[styles.flag, { backgroundColor: theme.muted }]}
              contentFit="cover"
              cachePolicy="disk"
              accessibilityIgnoresInvertColors
            />
          ) : null}
        </Row>
        <Row
          icon="time-outline"
          label="Time zone"
          hint={
            me && phoneZone && phoneZone !== me.timezone
              ? `This phone is on ${phoneZone.split('/').at(-1)?.replaceAll('_', ' ')}`
              : 'When reminders fall due'
          }
          value={me?.timezone.split('/').at(-1)?.replaceAll('_', ' ')}
          onPress={me ? () => setPicking('timezone') : undefined}
        />
        {/* One press to line the account up with where the phone is. */}
        {me && phoneZone && phoneZone !== me.timezone ? (
          <Row
            icon="locate-outline"
            label="Use this phone's time zone"
            onPress={() => update.mutate({ timezone: phoneZone })}
          />
        ) : null}
      </Group>

      {update.isError ? (
        <Text accessibilityRole="alert" style={[typeScale.caption, { color: theme.destructive }]}>
          Could not save:{' '}
          {(update.error instanceof ApiError && update.error.fields
            ? Object.values(update.error.fields)[0]
            : undefined) ?? (update.error as Error).message}
        </Text>
      ) : null}

      {picking === 'currency' ? (
        <ListPicker
          title="Currency"
          value={me?.defaultCurrency}
          options={CURRENCIES}
          placeholder="Search currencies"
          onChange={(defaultCurrency) => update.mutate({ defaultCurrency })}
          onClose={() => setPicking(null)}
        />
      ) : picking === 'timezone' ? (
        <ListPicker
          title="Time zone"
          value={me?.timezone}
          options={timeZoneOptions()}
          placeholder="Search a city or Area/City"
          extra={typedZone}
          onChange={(timezone) => update.mutate({ timezone })}
          onClose={() => setPicking(null)}
        />
      ) : null}
    </SettingsPage>
  );
}

const styles = StyleSheet.create({
  preview: { borderRadius: radius.xl, padding: spacing.md + 2, gap: spacing.sm },
  previewLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  previewFigure: { fontSize: 22, lineHeight: 28, fontWeight: '600' },
  flag: { width: 24, height: 16, borderRadius: 3 },
});
