/**
 * Albert Sans — the web's face — and Cascadia Mono for figures, applied to every `<Text>` and
 * `<TextInput>` in the app. The web loads the same two files, so a figure is the same shape on
 * both (it once fell to each system's monospace: Cascadia on Windows, SF Mono on a Mac, and the
 * phone's Geist Mono beside neither).
 *
 * React Native has no cascade: a font set on a container reaches nothing below it, so the
 * alternatives are a `fontFamily` on every text style in the app or one patch here.
 *
 * ponytail: patches `render` on Text and TextInput once at import. The font goes *under* each
 * call's own style, so nothing already written is overridden. If this ever fights a RN upgrade,
 * the upgrade path is an `<AppText>` wrapper and a lint rule banning bare `<Text>`.
 */

import { Ionicons } from '@expo/vector-icons';
import { cloneElement, type ReactElement } from 'react';
import { StyleSheet, Text, TextInput, type TextStyle } from 'react-native';
import {
  useFonts,
  AlbertSans_400Regular,
  AlbertSans_500Medium,
  AlbertSans_600SemiBold,
  AlbertSans_700Bold,
  AlbertSans_800ExtraBold,
} from '@expo-google-fonts/albert-sans';
import {
  CascadiaMono_400Regular,
  CascadiaMono_500Medium,
  CascadiaMono_600SemiBold,
  CascadiaMono_700Bold,
} from '@expo-google-fonts/cascadia-mono';

/*
 * Each weight is its own family, which is how expo-google-fonts ships them — `fontWeight` does
 * nothing to a custom family, so the weight already on a style has to pick the file.
 */
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

export function useAppFonts(): boolean {
  const [loaded, error] = useFonts({
    AlbertSans_400Regular,
    AlbertSans_500Medium,
    AlbertSans_600SemiBold,
    AlbertSans_700Bold,
    AlbertSans_800ExtraBold,
    CascadiaMono_400Regular,
    CascadiaMono_500Medium,
    CascadiaMono_600SemiBold,
    CascadiaMono_700Bold,
    /*
     * The icon font too. `@expo/vector-icons` otherwise loads it lazily on first use, and every
     * glyph drawn before it lands is an empty box — the tab bar, the bell and + came up blank.
     */
    ...Ionicons.font,
  });
  // A font that fails to load should cost its glyphs, not the whole app behind a blank screen.
  return loaded || Boolean(error);
}

type TextElement = ReactElement<{ style?: TextStyle }>;

interface Patchable {
  render?: (...args: unknown[]) => TextElement;
  /** The unpatched render, kept so a reload of this module wraps it once, not once per reload. */
  __apexOriginal?: (...args: unknown[]) => TextElement;
}

function patch(component: unknown) {
  const patchable = component as Patchable;
  patchable.__apexOriginal ??= patchable.render;
  const original = patchable.__apexOriginal;
  if (!original) return;

  patchable.render = function patched(...args: unknown[]): TextElement {
    const element = original.apply(this, args);
    const flat = StyleSheet.flatten(element.props.style);
    const family = flat?.fontFamily;
    // A style that names a real family — the icon font — keeps it. `Mono` is a role, not a file.
    if (family && family !== 'Mono') return element;
    const table = family === 'Mono' ? MONO : SANS;
    const fontFamily = table[String(flat?.fontWeight ?? '400')] ?? table['400'];
    return cloneElement(element, {
      /*
       * The weight is spent choosing the file, then reset. Android asked for bold inside a family
       * that registers no bold style falls back to Roboto.
       */
      style: [element.props.style, { fontFamily, fontWeight: 'normal' }] as unknown as TextStyle,
    });
  };
}

patch(Text);
patch(TextInput);
