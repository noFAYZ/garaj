import { Ionicons } from '@expo/vector-icons';
import { useNetInfo } from '@react-native-community/netinfo';
import { useQuery } from '@tanstack/react-query';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Linking, Platform, StyleSheet, Text, View } from 'react-native';
import { unreadCountQuery } from '@vehicle-os/api-client/react';
import { Group, pad, Row, SettingsPage } from '@/components/settings-kit';
import { api, API_URL } from '@/lib/api';
import { haptic, Rise } from '@/lib/motion';
import { flush, pendingCount } from '@/lib/offline';
import { registerForPush } from '@/lib/push';
import { radius, spacing, typeScale, useTheme } from '@/lib/theme';
import { Button } from '@/lib/ui';

type Permission = 'granted' | 'denied' | 'undetermined';

/**
 * This phone: whether everything recorded on it has reached the server, whether it can, and
 * whether reminders can reach it.
 *
 * The send queue leads on purpose. An app that quietly holds unsent entries is one nobody can
 * trust with a reading taken at a pump — watching the count reach zero is the confirmation.
 */
export default function DeviceScreen() {
  const theme = useTheme();
  const router = useRouter();
  const net = useNetInfo();
  const unread = useQuery({ ...unreadCountQuery(api), staleTime: 60_000 });
  const [pending, setPending] = useState<number | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [permission, setPermission] = useState<Permission | null>(null);

  const read = useCallback(async () => {
    setPending(await pendingCount());
    setPermission((await Notifications.getPermissionsAsync()).status as Permission);
  }, []);
  // Again on every return: the person may have just come back from the system settings.
  useFocusEffect(
    useCallback(() => {
      void read();
    }, [read]),
  );

  const send = () => {
    haptic.selection();
    setSyncing(true);
    void flush()
      .then(read)
      .finally(() => setSyncing(false));
  };

  const online = net.isConnected === true && net.isInternetReachable !== false;
  const connection =
    net.isConnected === null
      ? 'Checking'
      : !online
        ? 'Offline'
        : net.type === 'wifi'
          ? 'Online · Wi-Fi'
          : net.type === 'cellular'
            ? 'Online · mobile data'
            : 'Online';

  /*
   * Asked once by the system and never again: after a "Don't allow" the only way back is the
   * phone's own settings, so that is where the row goes. Undecided, it asks here.
   */
  const fixPermission = () => {
    if (permission === 'denied') void Linking.openSettings();
    else if (permission === 'undetermined') void registerForPush().finally(read);
  };

  const clear = pending === 0;
  return (
    <SettingsPage>
      {/* --- the queue, first ------------------------------------------------------------------ */}
      <Rise
        style={[
          styles.sync,
          { backgroundColor: clear || pending === null ? theme.card : theme.warningSoft },
        ]}
      >
        <View style={styles.syncTop}>
          <View
            style={[styles.syncIcon, { backgroundColor: clear ? theme.successSoft : theme.card }]}
          >
            <Ionicons
              name={clear ? 'cloud-done' : 'cloud-upload'}
              size={22}
              color={clear ? theme.success : theme.warning}
            />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text accessibilityRole="header" style={[typeScale.title, { color: theme.foreground }]}>
              {pending === null ? 'Checking…' : clear ? 'All sent' : `${pad(pending)} waiting`}
            </Text>
            <Text style={[typeScale.caption, { color: theme.mutedForeground }]}>
              {clear
                ? 'Everything recorded here is on the server.'
                : online
                  ? 'Goes out by itself in a moment.'
                  : 'Goes out by itself once there is signal.'}
            </Text>
          </View>
        </View>
        {pending ? (
          <Button
            label={`Send ${pad(pending)} now`}
            variant="primary"
            loading={syncing}
            disabled={!online}
            onPress={send}
          />
        ) : null}
      </Rise>

      <Group title="Connection" index={1}>
        <Row
          icon={online ? 'wifi-outline' : 'cloud-offline-outline'}
          label="Network"
          value={connection}
          tone={net.isConnected === null ? undefined : online ? 'success' : 'warning'}
        />
        <Row
          icon="server-outline"
          label="Server"
          value={API_URL.replace(/^https?:\/\//, '')}
          mono
        />
      </Group>

      <Group title="Reminders" index={2}>
        <Row
          icon="notifications-outline"
          label="Push notifications"
          hint={
            permission === 'denied'
              ? 'Off in the phone’s settings — reminders only reach you in-app and by email'
              : permission === 'undetermined'
                ? 'Not asked yet'
                : undefined
          }
          value={
            permission === null
              ? undefined
              : permission === 'granted'
                ? 'On'
                : permission === 'denied'
                  ? 'Off'
                  : 'Ask'
          }
          tone={
            permission === 'granted' ? 'success' : permission === 'denied' ? 'warning' : undefined
          }
          onPress={permission && permission !== 'granted' ? fixPermission : undefined}
        />
        <Row
          icon="mail-unread-outline"
          label="Inbox"
          badge={unread.data?.unread ?? 0}
          onPress={() => router.push('/notifications')}
        />
      </Group>

      <Group title="About" index={3}>
        <Row
          icon="information-circle-outline"
          label="Version"
          value={Constants.expoConfig?.version}
          mono
        />
        <Row
          icon="phone-portrait-outline"
          label="Device"
          value={[
            Device.modelName,
            `${Platform.OS === 'ios' ? 'iOS' : 'Android'} ${Device.osVersion ?? ''}`,
          ]
            .filter(Boolean)
            .join(' · ')}
        />
      </Group>
    </SettingsPage>
  );
}

const styles = StyleSheet.create({
  sync: { borderRadius: radius.xl, padding: spacing.md + 2, gap: spacing.md },
  syncTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  syncIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
