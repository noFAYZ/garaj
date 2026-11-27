import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useEffect, useRef, useState, type Ref } from 'react';
import {
  Animated,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type TextInputInstance,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import logoTextLight from '@/assets/logo-text-light.png';
import logoText from '@/assets/logo-text.png';
import { useScheme } from '@/lib/appearance';
import { requestPasswordReset, signIn, signUp, useSession } from '@/lib/auth';
import { Eyebrow, Segmented } from '@/lib/instrument';
import { haptic, PressableScale, Rise, useReduceMotion } from '@/lib/motion';
import { radius, spacing, typeScale, useTheme, leaf } from '@/lib/theme';
import { Button, Ground } from '@/lib/ui';
import { dialog, FAILED } from '@/lib/dialog';
import { Welcome } from '@/components/welcome';

/**
 * The way in, as the web's: the wordmark, a line, the fields and the copper key — set here over the
 * web's workshop graph paper, drifting slowly, under a two-tone headline. The only motion that
 * never stops in the app lives here, because this is the one screen with nothing else to do.
 */
export default function SignInScreen() {
  const theme = useTheme();
  const scheme = useScheme();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  // Sent here by the server ending the session, rather than by signing out: say so.
  const { ended } = useSession();
  // Signed out, the welcome comes first every time; it hands over to the form in the mode it was
  // left in. An expired session skips it, so the form can say why they are back.
  const [welcomed, setWelcomed] = useState(ended === 'expired');

  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Return on each field moves to the next, as a native form does; the last one submits.
  const emailField = useRef<TextInputInstance>(null);
  const passwordField = useRef<TextInputInstance>(null);

  const signingUp = mode === 'sign-up';
  const shortPassword = signingUp && password.length > 0 && password.length < 12;

  const submit = async () => {
    // The keyboard's Go and the button are two ways to press once.
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      /*
       * The cache is persisted to disk and survives a sign-out, so it is cleared on the way in —
       * before the session lands, because the moment it does the gate opens the garage, and the
       * next person on this device would see the previous one's until it refetched.
       */
      queryClient.clear();
      if (signingUp) await signUp({ name: name.trim(), email: email.trim(), password });
      else await signIn({ email: email.trim(), password });
      haptic.success();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!welcomed) {
    return (
      <Welcome
        onFinish={(next) => {
          setMode(next);
          setError(null);
          setWelcomed(true);
        }}
      />
    );
  }

  return (
    <KeyboardAvoidingView
      // Otherwise the keyboard covers the password field on a small phone.
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: 'transparent' }}
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
            accessibilityLabel="Garajj"
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
                autoComplete="name"
                textContentType="name"
                returnKeyType="next"
                submitBehavior="submit"
                onSubmitEditing={() => emailField.current?.focus()}
                placeholder="Alex Morgan"
              />
            ) : null}
            <Input
              label="Email"
              inputRef={emailField}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              // `autoComplete` is what Android's autofill (and Google Password Manager) reads;
              // `textContentType` is iOS's keychain.
              autoComplete="email"
              textContentType="emailAddress"
              returnKeyType="next"
              submitBehavior="submit"
              onSubmitEditing={() => passwordField.current?.focus()}
              placeholder="you@example.com"
            />
            <Input
              label="Password"
              inputRef={passwordField}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              // A new one on sign-up, so the password manager offers to generate and save it.
              autoComplete={signingUp ? 'new-password' : 'current-password'}
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

          {ended === 'expired' && !error ? (
            <View style={[styles.error, { backgroundColor: theme.card }]}>
              <Text
                accessibilityRole="alert"
                style={[typeScale.caption, { color: theme.foreground }]}
              >
                Your session ended. Sign in again — anything saved on this phone is still waiting to
                be sent.
              </Text>
            </View>
          ) : null}

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

          {signingUp ? null : (
            // The link opens the web app's reset page; the new password then works here too.
            <PressableScale
              onPress={() => forgot(email.trim())}
              accessibilityRole="button"
              hitSlop={8}
              style={{ alignSelf: 'center' }}
            >
              <Text style={[typeScale.label, { color: theme.mutedForeground }]}>
                Forgot your password?
              </Text>
            </PressableScale>
          )}
        </Rise>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/**
 * A reset link, for the address typed in. Always the same answer, whether or not it has an
 * account — a different one would tell anyone holding the phone who uses Garajj.
 */
function forgot(email: string) {
  if (!email.includes('@')) {
    dialog('Reset your password', 'Type the email you sign in with first, then tap here.', [], {
      icon: 'key-outline',
    });
    return;
  }
  dialog(
    'Reset your password',
    `Send a link to ${email}?`,
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Send link',
        onPress: () =>
          void requestPasswordReset(email)
            .then(() =>
              dialog(
                'Check your email',
                `If ${email} has a Garajj account, a link to choose a new password is on its way. It works for an hour.`,
                [],
                { icon: 'mail-outline' },
              ),
            )
            .catch((error: unknown) =>
              dialog('Could not send the link', (error as Error).message, undefined, FAILED),
            ),
      },
    ],
    { icon: 'key-outline' },
  );
}

/** A field as a panel row: the label as an eyebrow over what is typed. */
function Input({
  label,
  note,
  inputRef,
  ...props
}: TextInputProps & { label: string; note?: string; inputRef?: Ref<TextInputInstance> }) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View style={[styles.input, { backgroundColor: focused ? theme.popover : theme.card }]}>
      <Eyebrow>{label}</Eyebrow>
      <TextInput
        ref={inputRef}
        placeholderTextColor={theme.placeholder}
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
  logo: { width: 139, height: 37 },
  headline: { fontSize: 34, lineHeight: 38, letterSpacing: -1.3 },
  panel: {
    ...leaf('md'),
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
  error: { borderRadius: radius.lg, padding: spacing.md + 2 },
});
