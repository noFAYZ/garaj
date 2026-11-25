import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { View } from 'react-native';
import {
  ChoiceHero,
  ChoiceList,
  Group,
  Row,
  SettingsPage,
  useProfileUpdate,
} from '@/components/settings-kit';
import { DATE_LOCALE } from '@/lib/format';
import { deviceTimeZone, timeZoneOptions, typedZone } from '@/lib/locale-options';
import { useNow } from '@/lib/motion';
import { useProfile } from '@/lib/vehicle-units';
import { useTheme } from '@/lib/theme';

const city = (zone: string) => (zone.split('/').at(-1) ?? zone).replaceAll('_', ' ');

/** The zone's own clock; a zone this phone's Intl does not know gives no time, not a wrong one. */
function clockIn(zone: string, now: Date): string | null {
  try {
    return new Intl.DateTimeFormat(DATE_LOCALE, {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: zone,
    }).format(now);
  } catch {
    return null;
  }
}

/**
 * The time zone reminders fall due by, as its own page — the twin of the currency's: what it is
 * now (the city, the zone, its clock), one press to match the phone when they differ, then the
 * list, each zone with its time. A pick saves and goes back.
 */
export default function TimeZoneScreen() {
  const theme = useTheme();
  const router = useRouter();
  const me = useProfile().data;
  const update = useProfileUpdate();
  const now = useNow();

  const zone = me?.timezone;
  const phone = deviceTimeZone();
  const elsewhere = Boolean(zone && phone && phone !== zone);
  const pick = (timezone: string) => {
    if (timezone !== zone) update.mutate({ timezone });
    router.back();
  };

  return (
    <SettingsPage title="Time zone">
      <ChoiceHero
        loading={!me}
        leading={
          <View
            style={{
              width: 40,
              height: 40,
              borderRadius: 20,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: theme.muted,
            }}
          >
            <Ionicons name="globe-outline" size={20} color={theme.foreground} />
          </View>
        }
        title={zone ? city(zone) : ''}
        // A bare `UTC` has no Area/City to add under its name.
        caption={
          zone
            ? `${zone.includes('/') ? zone : 'Universal time'}${zone === phone ? ' · this phone' : ''}`
            : ''
        }
        reading={(zone && clockIn(zone, now)) ?? ''}
      />
      {elsewhere && phone ? (
        <Group index={2}>
          <Row
            icon="locate-outline"
            label="Match this phone"
            tone="warning"
            value={`${city(phone)}${clockIn(phone, now) ? ` · ${clockIn(phone, now)}` : ''}`}
            onPress={() => pick(phone)}
          />
        </Group>
      ) : null}
      <ChoiceList
        title="All time zones"
        options={timeZoneOptions()}
        value={zone}
        placeholder="Search a city or Area/City"
        leading={() => <Ionicons name="time-outline" size={18} color={theme.mutedForeground} />}
        trailing={(option) => clockIn(option.value, now)}
        extra={typedZone}
        onPick={pick}
      />
    </SettingsPage>
  );
}
