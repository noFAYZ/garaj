import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useState, type ReactNode } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { haptic, PressableScale } from './motion';
import { lift, radius, rimmed, spacing, typeScale, useTheme } from './theme';

export interface MenuOption {
  readonly label: string;
  readonly icon: keyof typeof Ionicons.glyphMap;
  readonly destructive?: boolean;
  readonly onPress: () => void;
}

/**
 * A few actions as a sheet — the app's own ⋯ menu, drawn like the + sheet rather than the system's
 * action sheet. A title with a line under it and one destructive row makes it a confirm as well.
 */
export function MenuSheet({
  title,
  message,
  options = [],
  children,
  onClose,
}: {
  title: string;
  message?: string;
  options?: readonly MenuOption[];
  /** Anything that is not a row of actions — a grid to choose from — under the title. */
  children?: ReactNode;
  onClose: () => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close"
        style={{ flex: 1, backgroundColor: theme.scrim, justifyContent: 'flex-end' }}
      >
        {/* Lifts with the keyboard, for a sheet that holds a field. */}
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Pressable
            onPress={(event) => event.stopPropagation()}
            style={[
              {
                backgroundColor: theme.popover,
                borderTopLeftRadius: radius.xxxl + 4,
                borderTopRightRadius: radius.xxxl + 4,
                borderBottomWidth: 0,
                paddingTop: spacing.sm + 2,
                paddingHorizontal: spacing.lg,
                paddingBottom: insets.bottom + spacing.lg,
                gap: spacing.md,
              },
              rimmed(theme),
              lift(theme),
            ]}
          >
            <View
              style={{
                alignSelf: 'center',
                width: 40,
                height: 5,
                borderRadius: 999,
                backgroundColor: theme.borderStrong,
              }}
            />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={[typeScale.title, { color: theme.foreground }]}>
                  {title}
                </Text>
                {message ? (
                  <Text style={[typeScale.caption, { color: theme.mutedForeground }]}>
                    {message}
                  </Text>
                ) : null}
              </View>
              <PressableScale
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel="Close"
                hitSlop={8}
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 999,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: theme.muted,
                }}
              >
                <Ionicons name="close" size={18} color={theme.foreground} />
              </PressableScale>
            </View>
            {children}
            <View
              style={{ borderRadius: radius.lg, overflow: 'hidden', gap: StyleSheet.hairlineWidth }}
            >
              {options.map((option) => {
                const ink = option.destructive ? theme.destructive : theme.foreground;
                return (
                  <PressableScale
                    key={option.label}
                    onPress={() => {
                      haptic.selection();
                      option.onPress();
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={option.label}
                    scaleTo={0.98}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: spacing.md,
                      minHeight: 54,
                      paddingHorizontal: spacing.md,
                      backgroundColor: theme.muted,
                    }}
                  >
                    <View
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: 12,
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: option.destructive ? theme.destructiveSoft : theme.card,
                      }}
                    >
                      <Ionicons name={option.icon} size={18} color={ink} />
                    </View>
                    <Text style={[typeScale.label, { flex: 1, color: ink }]}>{option.label}</Text>
                  </PressableScale>
                );
              })}
            </View>
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}

/**
 * A calendar day, stepped a day at a time.
 *
 * No picker dependency: the days people log are today, yesterday or a few back, and the quick
 * chips beside this cover the common jumps. `min`/`max` bound it, so a done item cannot be dated
 * in the future and a due date cannot be in the past.
 */
export function SavedNotice({ text }: { text: string }) {
  const theme = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        backgroundColor: theme.card,
        borderRadius: radius.md,
        padding: spacing.md,
      }}
    >
      <Ionicons name="checkmark-circle" size={22} color={theme.success} />
      <Text style={[typeScale.body, { color: theme.foreground, flex: 1 }]}>{text}</Text>
    </View>
  );
}

export interface ListOption {
  readonly value: string;
  readonly label: string;
  readonly hint?: string;
  /** A small leading picture, such as a flag. */
  readonly image?: string;
}

/**
 * A long list to choose one from, as a sheet with a search field at the top.
 *
 * For the lists chips cannot hold — currencies, time zones. The chosen row is inked and listed
 * first; `extra` turns a search that matches nothing into an option of its own, for a value the
 * built-in list does not carry (the server still has the final say on it).
 */
export function ListPicker({
  title,
  value,
  options,
  placeholder,
  extra,
  onChange,
  onClose,
}: {
  title: string;
  value: string | undefined;
  options: readonly ListOption[];
  placeholder: string;
  extra?: (query: string) => ListOption | null;
  onChange: (value: string) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [query, setQuery] = useState('');

  const needle = query.trim().toLowerCase();
  const matches = options.filter(
    (option) =>
      !needle ||
      [option.value, option.label, option.hint ?? ''].some((field) =>
        field.toLowerCase().includes(needle),
      ),
  );
  const custom = needle && extra ? extra(query.trim()) : null;
  const rows = [
    ...(custom && !options.some((option) => option.value === custom.value) ? [custom] : []),
    ...matches.filter((option) => option.value === value),
    ...matches.filter((option) => option.value !== value),
  ];

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close"
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' }}
      >
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Pressable
            onPress={(event) => event.stopPropagation()}
            style={{
              height: Math.round(height * 0.8),
              backgroundColor: theme.card,
              borderTopLeftRadius: radius.xl + 8,
              borderTopRightRadius: radius.xl + 8,
              paddingTop: spacing.sm,
              paddingHorizontal: spacing.md,
              gap: spacing.sm,
            }}
          >
            <View
              style={{
                alignSelf: 'center',
                width: 40,
                height: 4,
                borderRadius: 999,
                backgroundColor: theme.borderStrong,
              }}
            />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <Text style={[typeScale.headline, { flex: 1, color: theme.foreground }]}>
                {title}
              </Text>
              <PressableScale
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel="Close"
                hitSlop={8}
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 999,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: theme.muted,
                }}
              >
                <Ionicons name="close" size={18} color={theme.foreground} />
              </PressableScale>
            </View>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: spacing.sm,
                minHeight: 44,
                borderRadius: radius.md,
                paddingHorizontal: 12,
                backgroundColor: theme.muted,
              }}
            >
              <Ionicons name="search" size={16} color={theme.mutedForeground} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder={placeholder}
                placeholderTextColor={theme.mutedForeground}
                accessibilityLabel={placeholder}
                autoCorrect={false}
                autoCapitalize="none"
                style={[typeScale.body, { flex: 1, paddingVertical: 8, color: theme.foreground }]}
              />
            </View>
            <FlatList
              data={rows}
              keyExtractor={(option) => option.value}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingBottom: insets.bottom + spacing.md }}
              ListEmptyComponent={
                <Text
                  style={[
                    typeScale.caption,
                    { color: theme.mutedForeground, textAlign: 'center', padding: spacing.lg },
                  ]}
                >
                  Nothing matches “{query.trim()}”
                </Text>
              }
              renderItem={({ item }) => {
                const selected = item.value === value;
                return (
                  <PressableScale
                    onPress={() => {
                      haptic.selection();
                      onChange(item.value);
                      onClose();
                    }}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    accessibilityLabel={item.hint ? `${item.label}, ${item.hint}` : item.label}
                    scaleTo={0.98}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: spacing.sm,
                      minHeight: 52,
                      paddingHorizontal: 12,
                      borderRadius: radius.md,
                      backgroundColor: selected ? theme.primarySoft : 'transparent',
                    }}
                  >
                    {item.image ? (
                      <Image
                        source={{ uri: item.image }}
                        style={{
                          width: 30,
                          height: 20,
                          borderRadius: 4,
                          backgroundColor: theme.muted,
                        }}
                        contentFit="cover"
                        cachePolicy="disk"
                        transition={120}
                        accessibilityIgnoresInvertColors
                      />
                    ) : null}
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text
                        numberOfLines={1}
                        style={[typeScale.label, { color: theme.foreground }]}
                      >
                        {item.label}
                      </Text>
                      {item.hint ? (
                        <Text
                          numberOfLines={1}
                          style={[typeScale.caption, { color: theme.mutedForeground }]}
                        >
                          {item.hint}
                        </Text>
                      ) : null}
                    </View>
                    {selected ? (
                      <Ionicons name="checkmark" size={18} color={theme.foreground} />
                    ) : null}
                  </PressableScale>
                );
              }}
            />
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}
