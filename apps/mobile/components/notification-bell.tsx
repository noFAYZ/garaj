import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Animated, StyleSheet, Text } from 'react-native';
import { unreadCountQuery } from '@vehicle-os/api-client/react';
import { api } from '@/lib/api';
import { ease, Pop, PressableScale, useReduceMotion } from '@/lib/motion';
import { useTheme } from '@/lib/theme';

/**
 * The web's bell: a quiet round control with the unread count on a red badge ringed in the page's
 * colour. When there is news it rings — a few swings from the top, dying away — where the web's
 * tips under the pointer.
 */
export function NotificationBell() {
  const theme = useTheme();
  const router = useRouter();
  const reduce = useReduceMotion();
  const unread = useQuery({ ...unreadCountQuery(api), staleTime: 60_000 });
  const count = unread.data?.unread ?? 0;
  const [swing] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (reduce || count === 0) return;
    const to = (toValue: number, duration: number) =>
      Animated.timing(swing, { toValue, duration, easing: ease.inOut, useNativeDriver: true });
    const ring = Animated.sequence([
      Animated.delay(500),
      to(1, 90),
      to(-0.8, 140),
      to(0.55, 130),
      to(-0.3, 120),
      to(0, 160),
    ]);
    ring.start();
    return () => ring.stop();
  }, [count, reduce, swing]);

  return (
    <PressableScale
      onPress={() => router.push('/notifications')}
      hitSlop={4}
      accessibilityRole="button"
      // The badge is hidden from a screen reader, so its count goes in the label.
      accessibilityLabel={count > 0 ? `Notifications, ${count} unread` : 'Notifications'}
      scaleTo={0.88}
      style={[styles.bell, { backgroundColor: theme.muted }]}
    >
      <Animated.View
        style={{
          transformOrigin: 'top',
          transform: [
            {
              rotate: swing.interpolate({ inputRange: [-1, 1], outputRange: ['-16deg', '16deg'] }),
            },
          ],
        }}
      >
        <Ionicons
          name={count > 0 ? 'notifications' : 'notifications-outline'}
          size={19}
          color={theme.foreground}
        />
      </Animated.View>
      {count > 0 ? (
        <Pop
          key={count}
          style={[
            styles.badge,
            { borderColor: theme.background, backgroundColor: theme.destructive },
          ]}
        >
          <Text
            accessibilityElementsHidden
            importantForAccessibility="no"
            // A count in a small circle cannot grow with the system text size without spilling
            // out of it; the label carries it at any size.
            allowFontScaling={false}
            style={[styles.badgeText, { color: theme.destructiveForeground }]}
          >
            {count > 9 ? '9+' : count}
          </Text>
        </Pop>
      ) : null}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  bell: {
    width: 40,
    height: 40,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: -2,
    right: -2,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 999,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontSize: 10, fontWeight: '700' },
});
