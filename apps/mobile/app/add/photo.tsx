import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { queryKeys, vehiclesQuery } from '@vehicle-os/api-client/react';
import { BrandLogo } from '@/components/brand-logo';
import { api } from '@/lib/api';
import { enqueueUpload, flush } from '@/lib/offline';
import { fromParams, type FileParams } from '@/lib/file-picker';
import { Eyebrow, Segmented } from '@/lib/instrument';
import { haptic, PressableScale } from '@/lib/motion';
import { radius, spacing, typeScale, useTheme } from '@/lib/theme';
import { Button, Empty } from '@/lib/ui';

/**
 * A photo into a vehicle's gallery: the picture large, which vehicle as a row of logos, and whether
 * it becomes the cover — the one question with a consequence elsewhere in the app.
 */
export default function AddPhotoScreen() {
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ vehicleId?: string; eventId?: string } & FileParams>();
  const [photo] = useState(() => fromParams(params));

  const vehicles = useQuery(vehiclesQuery(api));
  const [vehicleId, setVehicleId] = useState<string | null>(params.vehicleId ?? null);
  const [caption, setCaption] = useState('');
  const [cover, setCover] = useState<'yes' | 'no'>('no');

  const list = vehicles.data?.data ?? [];
  // One vehicle is the common case, and a choice with one answer is not asked.
  const chosen = vehicleId ?? (list.length === 1 ? list[0]!.id : null);
  const chosenVehicle = list.find((vehicle) => vehicle.id === chosen);

  const upload = useMutation({
    // Queued, like every other write the phone makes: the picture is taken at the vehicle.
    mutationFn: async () => {
      await enqueueUpload({
        kind: 'upload',
        target: 'photo',
        vehicleId: chosen!,
        uri: photo!.uri,
        name: photo!.name,
        mimeType: photo!.mimeType,
        size: photo!.size,
        body: {
          ...(caption.trim() ? { caption: caption.trim() } : {}),
          // Filed against the entry it was taken for, when it came from one.
          ...(params.eventId ? { eventId: params.eventId } : {}),
          setAsPrimary: cover === 'yes',
        },
      });
      void flush();
    },
    onSuccess: () => {
      haptic.success();
      void queryClient.invalidateQueries({ queryKey: queryKeys.vehicles() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard() });
      router.replace({ pathname: '/vehicle/[id]', params: { id: chosen! } });
    },
  });

  if (!photo) {
    return <Empty title="No photo" description="Use + to take or choose one." />;
  }
  if (vehicles.data && list.length === 0) {
    return <Empty title="No vehicles yet" description="Add a vehicle first." />;
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <Stack.Screen options={{ title: 'Add a photo' }} />
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <View style={[styles.preview, { backgroundColor: theme.muted }]}>
          <Image
            source={{ uri: photo.uri }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            transition={150}
            accessibilityIgnoresInvertColors
          />
        </View>

        {list.length > 1 ? (
          <View style={{ gap: spacing.sm }}>
            <Eyebrow>Which vehicle</Eyebrow>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ marginHorizontal: -spacing.md }}
              contentContainerStyle={{ gap: spacing.sm, paddingHorizontal: spacing.md }}
            >
              {list.map((vehicle) => {
                const selected = vehicle.id === chosen;
                return (
                  <PressableScale
                    key={vehicle.id}
                    onPress={() => {
                      if (!selected) haptic.selection();
                      setVehicleId(vehicle.id);
                    }}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    accessibilityLabel={vehicle.displayName}
                    scaleTo={0.94}
                    style={[
                      styles.vehicle,
                      { backgroundColor: selected ? theme.primarySoft : theme.card },
                    ]}
                  >
                    <View style={[styles.logo, { backgroundColor: theme.muted }]}>
                      <BrandLogo make={vehicle.make ?? vehicle.displayName} size={24} />
                    </View>
                    <Text
                      numberOfLines={1}
                      style={[
                        typeScale.caption,
                        {
                          fontWeight: '600',
                          color: selected ? theme.foreground : theme.mutedForeground,
                        },
                      ]}
                    >
                      {vehicle.displayName}
                    </Text>
                  </PressableScale>
                );
              })}
            </ScrollView>
          </View>
        ) : null}

        <View style={{ gap: spacing.sm }}>
          <Eyebrow>Caption</Eyebrow>
          <TextInput
            value={caption}
            onChangeText={setCaption}
            placeholder="Optional"
            placeholderTextColor={theme.mutedForeground}
            accessibilityLabel="Caption"
            maxLength={500}
            style={[
              typeScale.body,
              styles.input,
              { backgroundColor: theme.card, color: theme.foreground },
            ]}
          />
        </View>

        <View style={{ gap: spacing.sm }}>
          <Eyebrow>Make it the cover</Eyebrow>
          <Segmented
            value={cover}
            options={[
              { value: 'no', label: 'Just add it' },
              { value: 'yes', label: 'Use as cover' },
            ]}
            onChange={setCover}
          />
        </View>

        {upload.isError ? (
          <View style={[styles.banner, { backgroundColor: theme.destructiveSoft }]}>
            <Text
              accessibilityRole="alert"
              style={[typeScale.caption, { color: theme.destructive }]}
            >
              {(upload.error as Error).message}
            </Text>
          </View>
        ) : null}

        <Button
          label={chosenVehicle ? `Add to ${chosenVehicle.displayName}` : 'Choose a vehicle'}
          variant="primary"
          loading={upload.isPending}
          disabled={!chosen}
          onPress={() => upload.mutate()}
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: spacing.md, gap: spacing.lg, paddingBottom: spacing.xl },
  preview: { width: '100%', aspectRatio: 4 / 3, borderRadius: radius.xl, overflow: 'hidden' },
  vehicle: {
    width: 104,
    alignItems: 'center',
    gap: 6,
    borderRadius: radius.lg,
    padding: 10,
  },
  logo: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: { minHeight: 44, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10 },
  banner: { borderRadius: radius.lg, padding: 14 },
});
