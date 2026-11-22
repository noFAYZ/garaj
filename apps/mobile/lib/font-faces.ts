/**
 * Which font file a piece of text is set in. Albert Sans for words and Cascadia Mono for figures,
 * the two faces the web loads, so a label and a figure are the same shape on both.
 *
 * Each weight is its own family on a phone. `fontWeight` does nothing to a custom family, so the
 * weight already on a style picks the file, and `Mono` is a role that picks from the mono files.
 * `lib/font-text.tsx` and `lib/font-text-input.tsx` dress every Text and TextInput with this.
 */

import { StyleSheet, type StyleProp, type TextStyle } from 'react-native';

const SANS: Record<string, string> = {
  '100': 'AlbertSans_400Regular',
  '200': 'AlbertSans_400Regular',
  '300': 'AlbertSans_400Regular',
  '400': 'AlbertSans_400Regular',
  normal: 'AlbertSans_400Regular',
  '500': 'AlbertSans_500Medium',
  '600': 'AlbertSans_600SemiBold',
  '700': 'AlbertSans_700Bold',
  '800': 'AlbertSans_800ExtraBold',
  '900': 'AlbertSans_800ExtraBold',
  bold: 'AlbertSans_700Bold',
};
const MONO: Record<string, string> = {
  '100': 'CascadiaMono_400Regular',
  '200': 'CascadiaMono_400Regular',
  '300': 'CascadiaMono_400Regular',
  '400': 'CascadiaMono_400Regular',
  normal: 'CascadiaMono_400Regular',
  '500': 'CascadiaMono_500Medium',
  '600': 'CascadiaMono_600SemiBold',
  '700': 'CascadiaMono_700Bold',
  '800': 'CascadiaMono_700Bold',
  '900': 'CascadiaMono_700Bold',
  bold: 'CascadiaMono_700Bold',
};

/**
 * A text's style with its font file chosen. The font goes after the style's own, so a style that
 * names a real family (the icon font, a header's bold) keeps it; only no family, or the `Mono`
 * role, is resolved here.
 */
export function dressed(style: StyleProp<TextStyle>): StyleProp<TextStyle> {
  const flat = StyleSheet.flatten(style);
  const family = flat?.fontFamily;
  if (family && family !== 'Mono') return style;
  const table = family === 'Mono' ? MONO : SANS;
  const fontFamily = table[String(flat?.fontWeight ?? '400')] ?? table['400'];
  /*
   * The weight is spent choosing the file, then reset. Android asked for bold inside a family that
   * registers no bold style falls back to Roboto.
   */
  return [style, { fontFamily, fontWeight: 'normal' }];
}
