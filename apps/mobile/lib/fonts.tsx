/**
 * Albert Sans (the web's face) and Cascadia Mono for figures. The web loads the same two, so a
 * figure is the same shape on both (it once fell to each system's monospace: Cascadia on Windows,
 * SF Mono on a Mac, and the phone's Geist Mono beside neither).
 *
 * Albert Sans is served from the app's own files in `assets/fonts`, downloaded from Google Fonts
 * (OFL, licence beside them); Cascadia Mono comes from its expo-google-fonts package, which ships
 * its files too. Nothing is fetched at run time.
 *
 * React Native has no cascade: a font set on a container reaches nothing below it. Every Text and
 * TextInput is dressed by `lib/font-text.tsx` / `lib/font-text-input.tsx`, which Metro puts in
 * place of RN's own (`metro.config.js`); the weight picks the file in `lib/font-faces.ts`. Under
 * RN 0.88 Text is a plain function, so the patch on `Text.render` this file used to make found
 * nothing to patch and every label fell to the system font.
 */

import { Ionicons } from '@expo/vector-icons';
import { useFonts } from 'expo-font';
import {
  CascadiaMono_400Regular,
  CascadiaMono_500Medium,
  CascadiaMono_600SemiBold,
  CascadiaMono_700Bold,
} from '@expo-google-fonts/cascadia-mono';
import AlbertSansRegular from '@/assets/fonts/AlbertSans-Regular.ttf';
import AlbertSansMedium from '@/assets/fonts/AlbertSans-Medium.ttf';
import AlbertSansSemiBold from '@/assets/fonts/AlbertSans-SemiBold.ttf';
import AlbertSansBold from '@/assets/fonts/AlbertSans-Bold.ttf';
import AlbertSansExtraBold from '@/assets/fonts/AlbertSans-ExtraBold.ttf';

export function useAppFonts(): boolean {
  const [loaded, error] = useFonts({
    // The family names the font files are asked for by, in `lib/font-faces.ts`.
    AlbertSans_400Regular: AlbertSansRegular,
    AlbertSans_500Medium: AlbertSansMedium,
    AlbertSans_600SemiBold: AlbertSansSemiBold,
    AlbertSans_700Bold: AlbertSansBold,
    AlbertSans_800ExtraBold: AlbertSansExtraBold,
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
