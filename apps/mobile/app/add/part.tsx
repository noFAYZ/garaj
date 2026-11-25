import { useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Vehicle } from '@vehicle-os/contracts';
import type { PartPosition } from '@vehicle-os/domain';
import { vehicleQuery } from '@vehicle-os/api-client/react';
import { RoundKey } from '@/components/onboarding-kit';
import { PartForm, PositionGrid, useParts } from '@/components/parts-kit';
import { api } from '@/lib/api';
import { Rise } from '@/lib/motion';
import { spacing, typeScale, useTheme } from '@/lib/theme';
import { Empty, Skeleton } from '@/lib/ui';

/**
 * A part or fluid recorded on its own, without an entry: which position, as a grid of tiles —
 * one already fitted wears a dot, and picking it fits a new one there, its last product offered
 * as "same as last time" — then the line's fields. With `partId`, the line is corrected instead.
 */
export default function AddPartScreen() {
  const params = useLocalSearchParams<{ vehicleId: string; position?: string; partId?: string }>();
  const vehicle = useQuery(vehicleQuery(api, params.vehicleId));
  return vehicle.data ? (
    <AddPart vehicle={vehicle.data} start={params.position} partId={params.partId} />
  ) : (
    <Page title="Add a part or fluid">
      {vehicle.isError ? (
        <Empty title="The vehicle did not load" description={(vehicle.error as Error).message} />
      ) : (
        <Skeleton width="100%" height={240} radius={20} />
      )}
    </Page>
  );
}

function AddPart({
  vehicle,
  start,
  partId,
}: {
  vehicle: Vehicle;
  start?: string;
  partId?: string;
}) {
  const router = useRouter();
  const { query, history, current, products, positions } = useParts(vehicle);
  const part = partId ? history.find((line) => line.id === partId) : undefined;
  const [picked, setPicked] = useState<PartPosition | null>((start as PartPosition) ?? null);
  const position = (part?.position as PartPosition | undefined) ?? picked;

  if (partId && !part) {
    return (
      <Page title="Edit part">
        {query.isPending ? (
          <Skeleton width="100%" height={240} radius={20} />
        ) : (
          <Empty title="Not found" description="It may have been removed." />
        )}
      </Page>
    );
  }

  return (
    <Page title={part ? 'Edit part' : 'Add a part or fluid'}>
      {position ? (
        <PartForm
          key={part?.id ?? position}
          vehicle={vehicle}
          position={position}
          part={part}
          last={part ? undefined : current.get(position)}
          products={products}
          onDone={() => router.back()}
          // Opened on a position or a line, × leaves; picked here, it goes back to the grid.
          onCancel={part || start ? () => router.back() : () => setPicked(null)}
        />
      ) : (
        <Rise>
          <PositionGrid positions={positions} current={current} onPick={setPicked} />
        </Rise>
      )}
    </Page>
  );
}

/** The screen's own top, as Add a vehicle draws it: close and the title, scrolling with the page. */
function Page({ title, children }: { title: string; children: React.ReactNode }) {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: 'transparent' }}
    >
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView
        contentContainerStyle={[
          styles.page,
          { paddingTop: insets.top + spacing.sm, paddingBottom: insets.bottom + spacing.xl },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.top}>
          <RoundKey icon="close" label="Close" onPress={() => router.back()} />
          <Text accessibilityRole="header" style={[styles.title, { color: theme.foreground }]}>
            {title}
          </Text>
        </View>
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: spacing.lg, gap: spacing.lg },
  top: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  title: {
    ...typeScale.headline,
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
});
