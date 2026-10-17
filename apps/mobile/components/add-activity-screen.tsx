import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { KeyboardAvoidingView, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EVENT_TYPES, type EventType } from '@vehicle-os/domain';
import { AddActivity, type ActivityMode } from '@/components/add-activity';
import { fromParams, type FileParams } from '@/lib/file-picker';
import { spacing, useTheme } from '@/lib/theme';

/**
 * The add form as a screen, for what opens it by route — the activity feed's "log the first", a
 * schedule's "log it", a deep link. The same form the + sheet holds (`AddActivity`), so the two
 * cannot drift apart; `/add/planned` opens it on Reminder.
 */
export function AddActivityScreen({ mode }: { mode: ActivityMode }) {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ vehicleId?: string; kind?: string } & FileParams>();
  // The dock's fan opens this on the kind it named — "Service", "Expense".
  const kind = EVENT_TYPES.includes(params.kind as EventType) ? (params.kind as EventType) : null;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      // The stack header over this screen: the status bar and its 44pt bar.
      keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top + 44 : 0}
      style={{ flex: 1, backgroundColor: theme.background }}
    >
      <Stack.Screen options={{ title: 'Add to activity' }} />
      <AddActivity
        vehicleId={params.vehicleId}
        initialMode={mode}
        initialKind={kind}
        initialPhoto={fromParams(params)}
        footerInset={Math.max(insets.bottom, spacing.sm)}
        onDone={() => router.back()}
        onAddVehicle={() => router.replace('/add/vehicle')}
      />
    </KeyboardAvoidingView>
  );
}
