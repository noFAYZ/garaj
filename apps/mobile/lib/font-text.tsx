/**
 * React Native's Text in the app's fonts. Metro hands this file to everything that loads RN's own
 * Text (the `react-native` index, Animated.Text, libraries), so every label in the app is dressed
 * without a screen importing anything different; see `metro.config.js`. This file alone gets the
 * original.
 */

import type { ComponentProps } from 'react';
import NativeText from 'react-native/Libraries/Text/Text';
import { dressed } from './font-faces';

function Text(props: ComponentProps<typeof NativeText>) {
  return <NativeText {...props} style={dressed(props.style)} />;
}
Text.displayName = 'Text';

export default Text;
