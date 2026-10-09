import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { vehiclesQuery } from '@vehicle-os/api-client/react';
import { BrandLogo } from '@/components/brand-logo';
import { api } from '@/lib/api';
import { haptic, PressableScale } from '@/lib/motion';
import { showUpgrade, useOwnPlanGoverns, usePlan } from '@/lib/upgrade';
import { figure, radius, spacing, typeScale, useTheme } from '@/lib/theme';

const pad = (value: number) => String(value).padStart(2, '0');

/**
 * Growing the garage, as one control with two halves (GAPS §10).
 *
 * A new vehicle and a new garage are the two ways the garage itself gets bigger — not records
 * *about* a vehicle, like everything above them in the sheet — so they sit together, apart from
 * the list, as a split: the same shape, two answers.
 *
 * Each half shows its own capacity as a picture before it is pressed: the bays already taken,
 * then one dashed bay for the one being added, and the count. A full half says so with a lock,
 * and pressing it opens the upgrade instead of a form that would be refused — the same wall the
 * server would raise, met before any typing.
 */
export function GrowCombo({
  onVehicle,
  onGarage,
  onClose,
}: {
  onVehicle: () => void;
  onGarage: () => void;
  /** Closes the sheet before a wall opens, so the upgrade does not rise behind it. */
  onClose: () => void;
}) {
  const theme = useTheme();
  const { data, limitWall } = usePlan();
  // Vehicles count against the owner of the garage they go in; garages always against you.
  const governsVehicles = useOwnPlanGoverns();
  const vehicles = useQuery(vehiclesQuery(api));

  const logos = (vehicles.data?.data ?? [])
    .slice(0, 3)
    .map((vehicle) => <BrandLogo key={vehicle.id} make={vehicle.make} size={16} />);

  const vehicleFull = governsVehicles && data ? data.usage.vehicles >= data.limits.vehicles : false;
  const garageFull = data ? data.usage.garages >= data.limits.garages : false;

  const press = (kind: 'vehicles' | 'garages') => {
    haptic.selection();
    const wall = kind === 'garages' || governsVehicles ? limitWall(kind) : null;
    if (wall) {
      onClose();
      showUpgrade(wall);
      return;
    }
    if (kind === 'vehicles') onVehicle();
    else onGarage();
  };

  return (
    <View style={[styles.combo, { backgroundColor: theme.border }]}>
      <Half
        label="New vehicle"
        full={vehicleFull}
        used={data?.usage.vehicles}
        allowed={data?.limits.vehicles}
        taken={logos}
        fallbackIcon="car-sport"
        onPress={() => press('vehicles')}
      />
      <Half
        label="New garage"
        full={garageFull}
        used={data?.usage.garages}
        allowed={data?.limits.garages}
        taken={[]}
        fallbackIcon="home"
        onPress={() => press('garages')}
      />
    </View>
  );
}

function Half({
  label,
  full,
  used,
  allowed,
  taken,
  fallbackIcon,
  onPress,
}: {
  label: string;
  full: boolean;
  used: number | undefined;
  allowed: number | undefined;
  /** What is already parked, shown in the small bays; generic glyphs fill the rest. */
  taken: readonly ReactNode[];
  fallbackIcon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
}) {
  const theme = useTheme();
  // A few bays, never all of them: the picture is "what you have, and the next one".
  const shown = Math.min(used ?? 0, 3);

  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={
        used !== undefined && allowed !== undefined
          ? `${label}, ${used} of ${allowed}${full ? ', full — opens the upgrade' : ''}`
          : label
      }
      scaleTo={0.97}
      style={[styles.half, { backgroundColor: theme.muted }]}
    >
      <View style={styles.bays} importantForAccessibility="no-hide-descendants">
        {Array.from({ length: shown }, (_, index) => (
          <View key={index} style={[styles.bay, { backgroundColor: theme.card }]}>
            {taken[index] ?? (
              <Ionicons name={fallbackIcon} size={13} color={theme.mutedForeground} />
            )}
          </View>
        ))}
        {/* The one being added: dashed and open, or locked when there is no room for it. */}
        <View
          style={[
            styles.bay,
            full
              ? { backgroundColor: theme.primary }
              : { borderWidth: 1.5, borderStyle: 'dashed', borderColor: theme.foreground },
          ]}
        >
          <Ionicons
            name={full ? 'lock-closed' : 'add'}
            size={full ? 12 : 16}
            color={full ? theme.primaryForeground : theme.foreground}
          />
        </View>
      </View>

      <View style={{ gap: 1 }}>
        <Text style={[typeScale.label, { color: theme.foreground }]}>{label}</Text>
        <Text
          style={[typeScale.caption, figure, { color: theme.mutedForeground }]}
          accessibilityElementsHidden
        >
          {used !== undefined && allowed !== undefined
            ? full
              ? `${pad(used)}/${pad(allowed)} · full`
              : `${pad(used)}/${pad(allowed)}`
            : ' '}
        </Text>
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  // The hairline between the halves is the background showing through the gap — one control,
  // split, rather than two cards that happen to sit side by side.
  combo: {
    flexDirection: 'row',
    gap: StyleSheet.hairlineWidth * 2,
    borderRadius: radius.lg + 4,
    overflow: 'hidden',
  },
  half: { flex: 1, padding: spacing.md - 2, gap: spacing.sm + 2, minHeight: 112 },
  bays: { flexDirection: 'row', gap: 5 },
  bay: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
});
