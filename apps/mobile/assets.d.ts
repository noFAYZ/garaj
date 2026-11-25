/** A bundled image, as Metro resolves it: an asset id that `<Image source>` accepts. */
declare module '*.png' {
  const asset: number;
  export default asset;
}

/** A bundled font file, as Metro resolves it: an asset id that `useFonts` accepts. */
declare module '*.ttf' {
  const asset: number;
  export default asset;
}

/*
 * React Native's own Text and TextInput, which only `lib/font-text.tsx` and
 * `lib/font-text-input.tsx` import: RN ships no types for its deep paths, and these are the same
 * components the package root exports.
 */
declare module 'react-native/Libraries/Text/Text' {
  import { Text } from 'react-native';
  export default Text;
}
declare module 'react-native/Libraries/Components/TextInput/TextInput' {
  import { TextInput } from 'react-native';
  export default TextInput;
}
