import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import { haptic, PressableScale } from '@/lib/motion';
import { showUpgrade, useOwnPlanGoverns, usePlan } from '@/lib/upgrade';
import { figure, radius, typeScale, useTheme } from '@/lib/theme';
import { pad } from '@/lib/format';

/**
 * Growing the garage, as one control with two halves (GAPS §10).
 *
 * A new vehicle and a new garage are the two ways the garage itself gets bigger — not records
 * *about* a vehicle, like everything above them in the sheet — so they sit together, apart from
 * the list, as a split: the same shape, two answers.
 *
 * Each half shows its own capacity before it is pressed: a dashed bay for the one being added,
 * and the count. A full half says so with a lock, and pressing it opens the upgrade instead of a
 * form that would be refused — the same wall the server would raise, met before any typing.
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
  const { data, limitWall } = usePlan();
  // Vehicles count against the owner of the garage they go in; garages always against you.
  const governsVehicles = useOwnPlanGoverns();

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
    <View style={styles.combo}>
      <Half
        label="New vehicle"
        full={vehicleFull}
        used={data?.usage.vehicles}
        allowed={data?.limits.vehicles}
        onPress={() => press('vehicles')}
      />
      <Half
        label="New garage"
        full={garageFull}
        used={data?.usage.garages}
        allowed={data?.limits.garages}
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
  onPress,
}: {
  label: string;
  full: boolean;
  used: number | undefined;
  allowed: number | undefined;
  onPress: () => void;
}) {
  const theme = useTheme();

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
      {/* The one being added: dashed and open, or locked when there is no room for it. */}
      <View
        importantForAccessibility="no-hide-descendants"
        style={[
          styles.bay,
          full
            ? { backgroundColor: theme.foreground }
            : { borderWidth: 1.5, borderStyle: 'dashed', borderColor: theme.foreground },
        ]}
      >
        <Ionicons
          name={full ? 'lock-closed' : 'add'}
          size={full ? 13 : 17}
          color={full ? theme.background : theme.foreground}
        />
      </View>

      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={[typeScale.label, { color: theme.foreground }]}>
          {label}
        </Text>
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
  combo: { flexDirection: 'row', gap: 8 },
  half: {
    // A control, as the menu's tiles: symmetric corners, filled, no outline.
    borderRadius: radius.lg,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 56,
    paddingHorizontal: 10,
  },
  bay: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
