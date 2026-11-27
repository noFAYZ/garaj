/**
 * React Native's TextInput in the app's fonts, as `font-text.tsx` does for Text: Metro hands this
 * file to everything that loads RN's own TextInput, and only this file gets the original.
 */

import { useState, useSyncExternalStore, type ComponentProps } from 'react';
import { AccessibilityInfo, Platform, StyleSheet } from 'react-native';
import NativeTextInput from 'react-native/Libraries/Components/TextInput/TextInput';
import { dressed } from './font-faces';

/*
 * Android's high-contrast text setting redraws every glyph solid black or solid white, outlined in
 * the other, whatever colour it was given — so a placeholder's soft grey came out as loud as typed
 * text. A view's opacity is applied after that redraw, so while the setting is on, an empty field
 * shows its hint in its text colour at a fraction of its strength: grey again, on any background.
 */
let highContrast = false;
const listeners = new Set<() => void>();
if (Platform.OS === 'android') {
  const set = (on: boolean) => {
    highContrast = on;
    listeners.forEach((listener) => listener());
  };
  AccessibilityInfo.isHighTextContrastEnabled().then(set, () => undefined);
  AccessibilityInfo.addEventListener('highTextContrastChanged', set);
}
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const HUSHED = 0.42;

function TextInput(props: ComponentProps<typeof NativeTextInput>) {
  const contrast = useSyncExternalStore(subscribe, () => highContrast);
  // What has been typed, for a field nobody controls: `value` answers for the rest.
  const [typed, setTyped] = useState(props.defaultValue ?? '');
  const style = dressed(props.style);
  const flat = StyleSheet.flatten(style);
  // A field that paints its own ground would fade with its hint, so it keeps the solid hint.
  const hush =
    contrast && Boolean(props.placeholder) && !(props.value ?? typed) && !flat?.backgroundColor;

  return (
    <NativeTextInput
      {...props}
      onChangeText={(text) => {
        setTyped(text);
        props.onChangeText?.(text);
      }}
      placeholderTextColor={
        hush ? (flat?.color ?? props.placeholderTextColor) : props.placeholderTextColor
      }
      style={hush ? [style, { opacity: HUSHED }] : style}
    />
  );
}
TextInput.displayName = 'TextInput';
// What RN hangs on its own: which input has focus, read by the keyboard handling.
TextInput.State = NativeTextInput.State;

export default TextInput;
