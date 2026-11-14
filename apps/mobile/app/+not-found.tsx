import { Stack, useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { spacing, typeScale, useTheme } from '@/lib/theme';
import { Button } from '@/lib/ui';

/** A link to somewhere the app no longer has — an old notification, a stale share — and the way home. */
export default function NotFoundScreen() {
  const theme = useTheme();
  const router = useRouter();
  return (
    <View style={[styles.page, { backgroundColor: theme.background }]}>
      <Stack.Screen options={{ title: 'Not found' }} />
      <Text style={[typeScale.title, { color: theme.foreground, textAlign: 'center' }]}>
        That page isn’t here
      </Text>
      <Text style={[typeScale.body, { color: theme.mutedForeground, textAlign: 'center' }]}>
        The link may be old, or what it pointed to has been removed.
      </Text>
      <Button label="Go to your garage" variant="primary" onPress={() => router.replace('/')} />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, justifyContent: 'center', gap: spacing.md, paddingHorizontal: spacing.xl },
});
