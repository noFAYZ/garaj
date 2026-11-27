import { useState } from 'react';
import { Image, StyleSheet, useWindowDimensions, View } from 'react-native';
import Svg, { Defs, LinearGradient, RadialGradient, Rect, Stop } from 'react-native-svg';
import grain from '@/assets/grain.png';
import { LITE } from '@/lib/motion';
import { useTheme } from '@/lib/theme';

/**
 * The page under every screen: the brand's copper as a grained, graphic gradient (user asked for
 * it as the whole app's background). A warm wash runs down from the top; over it a copper bloom
 * high on the right, an amber one on the left and a low copper haze at the foot, so no part of the
 * page is flat; then film grain over all of it, which is what makes it read as printed rather than
 * rendered. By night the same light is embers on the dark.
 *
 * Drawn once per screen by the root stack's `screenLayout`, under each screen's own content —
 * every screen stays opaque, so a push never shows the screen beneath through it. Gradients and a
 * tiled noise image only: react-native-svg filters (a blur, `feTurbulence` grain) crash Android.
 *
 * Not on a low-end phone (`LITE`): four screen-sized gradients and a screen of blended grain, drawn
 * again for every screen in a push, are more than its GPU has to spare. The page colour stands in.
 */
export function Backdrop() {
  if (LITE) return null;
  return <Painted />;
}

function Painted() {
  const theme = useTheme();
  const screen = useWindowDimensions();
  /*
   * The box it actually fills, measured. The window's size is short of it on Android drawing
   * edge to edge — the system bars are not in it — and the gradient stopped short of the foot.
   */
  const [box, setBox] = useState<{ width: number; height: number } | null>(null);
  const width = box?.width ?? screen.width;
  const height = box?.height ?? screen.height;
  const dark = theme.dark;
  // Square boxes, so each bloom is round rather than stretched to the screen's shape.
  const copper = width * 1.45;
  const amber = width * 1.2;
  const haze = width * 1.6;
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={StyleSheet.absoluteFill}
      onLayout={(event) => {
        const { width: w, height: h } = event.nativeEvent.layout;
        if (!box || box.width !== w || box.height !== h) setBox({ width: w, height: h });
      }}
    >
      <Svg width={width} height={height}>
        <Defs>
          <LinearGradient id="bd-wash" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={theme.primary} stopOpacity={dark ? 0.26 : 0.2} />
            <Stop offset="0.32" stopColor={theme.primary} stopOpacity={dark ? 0.1 : 0.07} />
            <Stop offset="0.62" stopColor={theme.primary} stopOpacity={0} />
          </LinearGradient>
          <RadialGradient id="bd-copper" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={theme.primary} stopOpacity={dark ? 0.42 : 0.34} />
            <Stop offset="0.45" stopColor={theme.primary} stopOpacity={dark ? 0.16 : 0.12} />
            <Stop offset="1" stopColor={theme.primary} stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id="bd-amber" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={theme.warning} stopOpacity={dark ? 0.16 : 0.2} />
            <Stop offset="1" stopColor={theme.warning} stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id="bd-haze" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={theme.primary} stopOpacity={dark ? 0.16 : 0.1} />
            <Stop offset="1" stopColor={theme.primary} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect width={width} height={height} fill="url(#bd-wash)" />
        <Rect
          x={width - copper * 0.6}
          y={-copper * 0.52}
          width={copper}
          height={copper}
          fill="url(#bd-copper)"
        />
        <Rect
          x={-amber * 0.55}
          y={-amber * 0.34}
          width={amber}
          height={amber}
          fill="url(#bd-amber)"
        />
        <Rect
          x={-haze * 0.4}
          y={height - haze * 0.42}
          width={haze}
          height={haze}
          fill="url(#bd-haze)"
        />
      </Svg>
      {/*
       * The grain: a noise tile repeated over the whole page, at a few percent. Sized outright:
       * an image's own size otherwise wins over the fill, and the grain stays one tile square.
       */}
      <Image
        source={grain}
        resizeMode="repeat"
        style={[styles.grain, { opacity: dark ? 0.07 : 0.09 }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  grain: { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' },
});
