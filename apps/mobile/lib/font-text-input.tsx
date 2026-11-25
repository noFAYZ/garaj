/**
 * React Native's TextInput in the app's fonts, as `font-text.tsx` does for Text: Metro hands this
 * file to everything that loads RN's own TextInput, and only this file gets the original.
 */

import type { ComponentProps } from 'react';
import NativeTextInput from 'react-native/Libraries/Components/TextInput/TextInput';
import { dressed } from './font-faces';

function TextInput(props: ComponentProps<typeof NativeTextInput>) {
  return <NativeTextInput {...props} style={dressed(props.style)} />;
}
TextInput.displayName = 'TextInput';
// What RN hangs on its own: which input has focus, read by the keyboard handling.
TextInput.State = NativeTextInput.State;

export default TextInput;
