import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { planWall } from '@vehicle-os/api-client';
import { queryKeys } from '@vehicle-os/api-client/react';
import { api } from '@/lib/api';
import { Chip, Eyebrow, Headline } from '@/lib/instrument';
import { haptic, Rise } from '@/lib/motion';
import { figure, radius, spacing, typeScale, useTheme } from '@/lib/theme';
import { Button } from '@/lib/ui';
import { useProfile } from '@/lib/vehicle-units';

/** Names people actually give garages, so the common case is one tap rather than typing. */
const SUGGESTIONS = ['Home', 'Work', 'Weekend', 'Project cars', 'Family'] as const;
const BAYS = 4;

/**
 * A new garage (GAPS §10): name it, and watch it appear.
 *
 * The screen is the card the garage will be on the home screen, filling in as it is named — the
 * same icon, name, count and empty bays — so there is no gap between what is typed here and what
 * turns up there. One field, because a garage is a name and nothing else is needed to start one;
 * its currency follows the account's, and everything else is set from the garage later.
 *
 * Online only, on purpose: a garage is where other people are invited and where vehicles are
 * placed, and one created offline would be a place nobody else can see until it syncs. The
 * refusal says so rather than queueing it.
 */
export default function NewGarageScreen() {
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const profile = useProfile();
  const [name, setName] = useState('');
  const trimmed = name.trim();
  const currency = profile.data?.defaultCurrency;

  const create = useMutation({
    mutationFn: () =>
      api.garages.create({ name: trimmed, ...(currency ? { defaultCurrency: currency } : {}) }),
    onSuccess: () => {
      haptic.success();
      void queryClient.invalidateQueries({ queryKey: queryKeys.garages() });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.plan() });
      router.back();
    },
  });

  // A plan refusal opens the upgrade screen from the query client; anything else is said here.
  const failure =
    create.error && !planWall(create.error)
      ? create.error instanceof Error && /network|fetch/i.test(create.error.message)
        ? 'A garage needs a connection to create — others have to be able to see it.'
        : create.error instanceof Error
          ? create.error.message
          : 'That did not work. Try again.'
      : null;

  const submit = () => {
    if (!trimmed || create.isPending) return;
    create.mutate();
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: theme.background }}
    >
      <Stack.Screen options={{ title: 'New garage' }} />
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        {/* The card as it will be on the home screen, live. */}
        <Rise style={[styles.preview, { backgroundColor: theme.card }]}>
          <View style={styles.previewTop}>
            <View style={[styles.previewIcon, { backgroundColor: theme.muted }]}>
              <Ionicons name="home-outline" size={18} color={theme.foreground} />
            </View>
            <View style={[styles.newTag, { backgroundColor: theme.primarySoft }]}>
              <Text style={[typeScale.overline, { fontSize: 10, color: theme.foreground }]}>
                NEW
              </Text>
            </View>
          </View>
          <View style={{ gap: 2 }}>
            <Text
              numberOfLines={1}
              style={[
                typeScale.title,
                { color: trimmed ? theme.foreground : theme.mutedForeground },
              ]}
            >
              {trimmed || 'Your garage'}
            </Text>
            <Text style={[typeScale.caption, figure, { color: theme.mutedForeground }]}>
              00 vehicles{currency ? ` · ${currency}` : ''}
            </Text>
          </View>
          <View
            style={styles.bays}
            accessible
            accessibilityRole="image"
            accessibilityLabel="Four empty bays"
          >
            {Array.from({ length: BAYS }, (_, index) => (
              <Rise key={index} index={index + 1} distance={6} style={{ flex: 1 }}>
                <View style={[styles.bay, { borderColor: theme.borderStrong }]} />
              </Rise>
            ))}
          </View>
        </Rise>

        <Rise index={1} style={{ gap: spacing.sm }}>
          <Headline
            label="Name"
            value={name}
            onChangeText={setName}
            placeholder="Name it"
            autoFocus
            maxLength={120}
            returnKeyType="done"
            onSubmitEditing={submit}
            error={failure ?? undefined}
          />
          <View style={{ gap: spacing.xs }}>
            <Eyebrow>Or pick one</Eyebrow>
            <View style={styles.chips}>
              {SUGGESTIONS.map((suggestion) => (
                <Chip
                  key={suggestion}
                  label={suggestion}
                  selected={trimmed === suggestion}
                  onPress={() => {
                    haptic.selection();
                    setName(suggestion);
                  }}
                />
              ))}
            </View>
          </View>
        </Rise>

        <Rise index={2}>
          <Button
            label="Create garage"
            variant="primary"
            disabled={!trimmed}
            loading={create.isPending}
            onPress={submit}
          />
        </Rise>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  page: { padding: spacing.md, gap: spacing.lg },
  preview: { borderRadius: radius.xl, padding: spacing.md, gap: spacing.md },
  previewTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  previewIcon: {
    width: 36,
    height: 36,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  newTag: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  bays: { flexDirection: 'row', gap: 6 },
  bay: { aspectRatio: 1, borderRadius: 10, borderWidth: 1.5, borderStyle: 'dashed' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs + 2 },
});
