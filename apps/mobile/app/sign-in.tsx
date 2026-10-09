import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  Animated,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useColorScheme,
  type TextInputProps,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import logoTextLight from '@/assets/logo-text-light.png';
import logoText from '@/assets/logo-text.png';
import { signIn, signUp, useSession } from '@/lib/auth';
import { Eyebrow, Segmented } from '@/lib/instrument';
import { haptic, Rise, useReduceMotion } from '@/lib/motion';
import { radius, spacing, typeScale, useTheme } from '@/lib/theme';
import { Button, Ground } from '@/lib/ui';

/**
 * The way in, as the web's: the wordmark, a line, the fields and the copper key — set here over the
 * web's workshop graph paper, drifting slowly, under a two-tone headline. The only motion that
 * never stops in the app lives here, because this is the one screen with nothing else to do.
 */
export default function SignInScreen() {
  const theme = useTheme();
  const scheme = useColorScheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { refresh } = useSession();

  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const signingUp = mode === 'sign-up';
  const shortPassword = signingUp && password.length > 0 && password.length < 12;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (signingUp) await signUp({ name: name.trim(), email: email.trim(), password });
      else await signIn({ email: email.trim(), password });
      haptic.success();
      /*
       * The cache is persisted to disk and survives a sign-out, so it is cleared on the way in —
       * otherwise the next person on this device sees the previous one's garage until it refetches.
       */
      queryClient.clear();
      await refresh();
      router.replace('/');
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      // Otherwise the keyboard covers the password field on a small phone.
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: theme.background }}
    >
      <Ambient />
      <ScrollView
        contentContainerStyle={[
          styles.page,
          { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.lg },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <Rise style={{ gap: spacing.lg }}>
          <Image
            source={scheme === 'light' ? logoText : logoTextLight}
            style={styles.logo}
            contentFit="contain"
            accessibilityLabel="Garaj"
          />
          <View style={{ gap: spacing.sm }}>
            <Text style={[typeScale.display, styles.headline, { color: theme.foreground }]}>
              {signingUp ? 'Start your garage.' : 'Welcome back.'}
              {'\n'}
              <Text style={{ color: theme.mutedForeground }}>
                {signingUp ? 'Every mile counts.' : 'Your cars missed you.'}
              </Text>
            </Text>
            <Text style={[typeScale.body, { color: theme.mutedForeground }]}>
              {signingUp
                ? 'Every service and fill-up, kept.'
                : 'Your vehicles, and everything they need next.'}
            </Text>
          </View>
        </Rise>

        <Rise index={1} style={{ gap: spacing.md }}>
          <Segmented
            value={mode}
            options={[
              { value: 'sign-in', label: 'Sign in' },
              { value: 'sign-up', label: 'Create account' },
            ]}
            onChange={(next) => {
              setMode(next);
              setError(null);
            }}
          />

          <View
            style={[styles.panel, { backgroundColor: theme.border, borderColor: theme.hairline }]}
          >
            {signingUp ? (
              <Input
                label="Name"
                value={name}
                onChangeText={setName}
                autoCapitalize="words"
                textContentType="name"
                placeholder="Alex Morgan"
              />
            ) : null}
            <Input
              label="Email"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="emailAddress"
              placeholder="you@example.com"
            />
            <Input
              label="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              // `newPassword` on sign-up, so the keychain offers to generate one.
              textContentType={signingUp ? 'newPassword' : 'password'}
              placeholder={signingUp ? 'At least 12 characters' : '••••••••••••'}
              note={
                signingUp
                  ? shortPassword
                    ? `${12 - password.length} more characters`
                    : 'At least 12 characters'
                  : undefined
              }
              onSubmitEditing={() => void submit()}
              returnKeyType="go"
            />
          </View>

          {error ? (
            <View style={[styles.error, { backgroundColor: theme.destructiveSoft }]}>
              <Text
                accessibilityRole="alert"
                style={[typeScale.caption, { color: theme.destructive }]}
              >
                {error}
              </Text>
            </View>
          ) : null}

          <Button
            label={signingUp ? 'Create account' : 'Sign in'}
            variant="primary"
            onPress={() => void submit()}
            loading={busy}
            disabled={!email.trim() || !password || shortPassword || (signingUp && !name.trim())}
          />
        </Rise>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/** A field as a panel row: the label as an eyebrow over what is typed. */
function Input({ label, note, ...props }: TextInputProps & { label: string; note?: string }) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View style={[styles.input, { backgroundColor: focused ? theme.popover : theme.card }]}>
      {/* A volt edge on the field you are in — the caret's lane. */}
      <View
        style={[styles.focusBar, { backgroundColor: focused ? theme.primary : 'transparent' }]}
      />
      <Eyebrow>{label}</Eyebrow>
      <TextInput
        placeholderTextColor={theme.borderStrong}
        accessibilityLabel={label}
        accessibilityHint={note}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={[
          typeScale.headline,
          { color: theme.foreground, paddingVertical: 4, paddingHorizontal: 0 },
        ]}
        {...props}
      />
      {note ? (
        <Text style={[typeScale.caption, { color: theme.mutedForeground }]}>{note}</Text>
      ) : null}
    </View>
  );
}

/** The graph paper, drifting on a slow loop behind the form. Still under reduce motion. */
function Ambient() {
  const reduce = useReduceMotion();
  const [drift] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (reduce) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(drift, { toValue: 1, duration: 9000, useNativeDriver: true }),
        Animated.timing(drift, { toValue: 0, duration: 9000, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [drift, reduce]);
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        // Larger than the screen by the drift, so its edge never shows as it moves.
        { position: 'absolute', top: -24, left: -24, right: -24, bottom: -24 },
        {
          transform: [
            { translateX: drift.interpolate({ inputRange: [0, 1], outputRange: [0, -16] }) },
            { translateY: drift.interpolate({ inputRange: [0, 1], outputRange: [0, 16] }) },
          ],
        },
      ]}
    >
      <Ground cx="100%" cy="0%" />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  page: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: spacing.xl, gap: spacing.xxl },
  logo: { width: 132, height: 37 },
  headline: { fontSize: 34, lineHeight: 38, letterSpacing: -1.3 },
  panel: {
    borderRadius: radius.xl,
    overflow: 'hidden',
    gap: StyleSheet.hairlineWidth,
    borderWidth: StyleSheet.hairlineWidth,
  },
  input: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md + 2,
    paddingBottom: spacing.md,
    gap: 4,
  },
  focusBar: { position: 'absolute', left: 0, top: 14, bottom: 14, width: 3, borderRadius: 2 },
  error: { borderRadius: radius.lg, padding: spacing.md + 2 },
});
