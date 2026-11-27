import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { avatarSeeds, avatarUrl } from '@vehicle-os/contracts';
import { dashboardQuery } from '@vehicle-os/api-client/react';
import {
  askToSignOut,
  Group,
  Row,
  SettingsPage,
  useProfileUpdate,
  useSignOut,
} from '@/components/settings-kit';
import { dialog, FAILED } from '@/lib/dialog';
import { pad } from '@/lib/format';
import { api } from '@/lib/api';
import { ToneChip } from '@/lib/instrument';
import { PressableScale, Rise } from '@/lib/motion';
import { pendingCount } from '@/lib/offline';
import { sendConfirmationEmail } from '@/lib/auth';
import { openStoreManagement, storeBilled, storeName } from '@/lib/store';
import { usePlan } from '@/lib/upgrade';
import { useProfile } from '@/lib/vehicle-units';
import { spacing, typeScale, useTheme, leaf } from '@/lib/theme';
import { MenuSheet } from '@/lib/pickers';
import { Button, Face, Skeleton } from '@/lib/ui';

/**
 * The account: the name others see on a shared garage, the facts about the account, and the way
 * out. Sign-out is here, at the end of its own branch, rather than on the root — it is the one
 * control on the tree that loses something, and it says what before the second press.
 */
export default function AccountScreen() {
  const theme = useTheme();
  const router = useRouter();
  const profile = useProfile();
  const dashboard = useQuery(dashboardQuery(api));
  const update = useProfileUpdate();
  // Its own, so a new picture does not tick the name field as saved.
  const updatePicture = useProfileUpdate();
  const me = profile.data;
  const [picking, setPicking] = useState(false);
  const [seeds, setSeeds] = useState(() => avatarSeeds(12));
  // Four to a row across the sheet's width.
  const faceSize = Math.floor((useWindowDimensions().width - spacing.lg * 2 - spacing.md * 3) / 4);

  // The field follows the saved name: filled when it loads, reset to it once a save lands.
  const saved = me?.name;
  const [name, setName] = useState('');
  useEffect(() => {
    if (saved !== undefined) setName(saved);
  }, [saved]);

  const [pending, setPending] = useState<number | null>(null);
  useFocusEffect(
    useCallback(() => {
      void pendingCount().then(setPending);
    }, []),
  );
  const { leave, remove, leaving } = useSignOut();
  const [deleting, setDeleting] = useState(false);
  // A store subscription outlives the account — only the store can stop it — so it is said first.
  const { data: plan } = usePlan();
  const inStore = storeBilled(plan);
  const confirm = useMutation({
    mutationFn: () => sendConfirmationEmail(me!.email),
  });
  const removeAccount = async () => {
    setDeleting(true);
    try {
      await remove();
    } catch (error) {
      dialog('Could not delete your account', (error as Error).message, undefined, FAILED);
    } finally {
      setDeleting(false);
    }
  };
  // The second press, in the app's dialog: what goes, for everyone — and a store plan said first,
  // since only the store can stop it.
  const askToDelete = () => {
    const store = storeName(plan?.store);
    dialog(
      'Delete your account?',
      inStore
        ? `Every garage you own goes too, with its vehicles, records and documents, for everyone in it. This cannot be undone. Your plan is billed through ${store}, and deleting the account does not stop it — cancel it there first.`
        : 'Every garage you own goes too, with its vehicles, records and documents, for everyone in it. A plan paid for on the web is cancelled. This cannot be undone.',
      [
        { text: 'Keep it', style: 'cancel' },
        ...(inStore
          ? [{ text: `Cancel plan in ${store}`, onPress: () => void openStoreManagement(plan) }]
          : []),
        { text: 'Delete for good', style: 'destructive', onPress: () => void removeAccount() },
      ],
    );
  };

  const trimmed = name.trim();
  const valid = trimmed.length >= 1 && trimmed.length <= 120;
  const changed = Boolean(me) && trimmed !== me?.name;

  return (
    <SettingsPage>
      <Rise style={styles.hero}>
        {/* The face is its own control: a press opens the faces to choose from. */}
        <PressableScale
          onPress={() => {
            setPicking(true);
          }}
          disabled={!me}
          accessibilityRole="button"
          accessibilityLabel="Change picture"
          scaleTo={0.94}
        >
          <Face user={me} size={80} />
          <View
            style={[
              styles.badge,
              { backgroundColor: theme.primary, borderColor: theme.background },
            ]}
          >
            <Ionicons name="shuffle" size={14} color={theme.primaryForeground} />
          </View>
        </PressableScale>
        {me ? (
          <View style={{ alignItems: 'center', gap: 6 }}>
            <Text numberOfLines={1} style={[typeScale.title, { color: theme.foreground }]}>
              {trimmed || me.name}
            </Text>
            <ToneChip
              tone={me.emailVerified ? 'success' : 'warning'}
              label={me.emailVerified ? 'Email verified' : 'Email not verified'}
            />
          </View>
        ) : (
          <Skeleton width={160} height={22} />
        )}
      </Rise>

      <Group title="Name" index={1} footer="Shown to the people you share a garage with.">
        <View style={[styles.nameRow, { backgroundColor: theme.card }]}>
          <TextInput
            value={name}
            onChangeText={setName}
            editable={Boolean(me)}
            maxLength={120}
            autoCapitalize="words"
            autoComplete="name"
            returnKeyType="done"
            onSubmitEditing={() => valid && changed && update.mutate({ name: trimmed })}
            placeholder="Your name"
            placeholderTextColor={theme.placeholder}
            accessibilityLabel="Name"
            style={[typeScale.body, styles.nameInput, { color: theme.foreground }]}
          />
          {changed ? (
            <PressableScale
              onPress={() => valid && update.mutate({ name: trimmed })}
              disabled={!valid}
              accessibilityRole="button"
              accessibilityLabel="Save name"
              style={[styles.save, { backgroundColor: theme.primary, opacity: valid ? 1 : 0.5 }]}
            >
              <Text style={[typeScale.label, { color: theme.primaryForeground }]}>Save</Text>
            </PressableScale>
          ) : update.isSuccess ? (
            <Ionicons name="checkmark-circle" size={18} color={theme.success} />
          ) : null}
        </View>
      </Group>

      <Group title="Account" index={2}>
        <Row icon="mail-outline" label="Email" value={me?.email} />
        {me && !me.emailVerified ? (
          // Until it is confirmed, nobody can add this account to their garage.
          <Row
            icon="checkmark-done-outline"
            label={
              confirm.isSuccess
                ? `Link sent to ${me.email}`
                : confirm.isError
                  ? 'Could not send — try again'
                  : 'Confirm your email'
            }
            chevron={false}
            onPress={confirm.isPending || confirm.isSuccess ? undefined : () => confirm.mutate()}
          />
        ) : null}
        <Row
          icon="calendar-outline"
          label="Member since"
          value={
            me
              ? new Date(me.createdAt).toLocaleDateString(undefined, {
                  month: 'short',
                  year: 'numeric',
                })
              : undefined
          }
        />
        <Row
          icon="car-sport-outline"
          label="Vehicles"
          value={dashboard.data ? pad(dashboard.data.summary.vehicles) : undefined}
          mono
          onPress={() => router.push('/vehicles')}
        />
        <Row
          icon="home-outline"
          label="Garages"
          value={dashboard.data ? pad(dashboard.data.summary.garages) : undefined}
          mono
          onPress={() => router.push('/settings/data')}
        />
      </Group>

      {/*
       * Apart from everything routine, on its own tint, and two presses: the second, in the app's
       * dialog, says exactly what happens, including what is lost.
       */}
      <Rise index={3} style={[styles.danger, { backgroundColor: theme.destructiveSoft }]}>
        <View style={styles.dangerTop}>
          <Ionicons name="log-out-outline" size={20} color={theme.destructive} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[typeScale.label, { color: theme.destructive }]}>Sign out</Text>
            <Text style={[typeScale.caption, { color: theme.foreground }]}>
              {pending
                ? `${pending} ${pending === 1 ? 'entry has' : 'entries have'} not been sent. Signing out discards ${pending === 1 ? 'it' : 'them'}.`
                : 'Your garage stays; this phone forgets it.'}
            </Text>
          </View>
        </View>
        <Button
          label="Sign out"
          variant="danger"
          loading={leaving}
          onPress={() => void askToSignOut(leave)}
        />
      </Rise>

      {/*
       * Deleting the account (the stores require it to be here, in the app): the same two presses,
       * and the second says plainly what goes — for everyone, not only this person.
       */}
      <Rise index={4} style={[styles.danger, { backgroundColor: theme.destructiveSoft }]}>
        <View style={styles.dangerTop}>
          <Ionicons name="trash-outline" size={20} color={theme.destructive} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[typeScale.label, { color: theme.destructive }]}>Delete account</Text>
            <Text style={[typeScale.caption, { color: theme.foreground }]}>
              Removes your account, and every garage you own, for good.
            </Text>
          </View>
        </View>
        <Button
          label="Delete account"
          variant="danger"
          loading={deleting}
          disabled={leaving}
          onPress={() => {
            askToDelete();
          }}
        />
      </Rise>

      {picking ? (
        <MenuSheet
          title="Choose a picture"
          message="Shown beside your name to the people you share a garage with."
          options={[
            { label: 'Shuffle', icon: 'shuffle', onPress: () => setSeeds(avatarSeeds(12)) },
          ]}
          onClose={() => setPicking(false)}
        >
          <View style={styles.faces}>
            {seeds.map((seed) => (
              <PressableScale
                key={seed}
                onPress={() => {
                  // Queued like the name: saved on this phone first, sent when there is signal.
                  updatePicture.mutate({ image: avatarUrl(seed) });
                  setPicking(false);
                }}
                accessibilityRole="button"
                accessibilityLabel="Use this picture"
                scaleTo={0.9}
              >
                <Face user={{ id: seed, image: null }} size={faceSize} />
              </PressableScale>
            ))}
          </View>
        </MenuSheet>
      ) : null}
    </SettingsPage>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  badge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 28,
    height: 28,
    borderRadius: 999,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  faces: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 52,
    paddingLeft: 14,
    paddingRight: 8,
  },
  nameInput: { flex: 1, minHeight: 44, paddingVertical: 10 },
  save: {
    minHeight: 34,
    borderRadius: 999,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  danger: { ...leaf('md'), padding: spacing.md, gap: spacing.md },
  dangerTop: { flexDirection: 'row', gap: spacing.sm },
});
