import { Image } from 'expo-image';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { domainForMake } from '@vehicle-os/ui';
import { useTheme } from '@/lib/theme';

/*
 * A publishable logo.dev key, inlined at bundle time from `apps/mobile/.env` — the same key the
 * web reads as `NEXT_PUBLIC_LOGO_DEV_TOKEN`. Expo only inlines `EXPO_PUBLIC_*` names, and only
 * from the app's own directory, which is why it is not picked up from the repository root.
 */
const TOKEN = process.env.EXPO_PUBLIC_LOGO_DEV_TOKEN;

/**
 * A manufacturer's logo, or its initial — the web's `BrandLogo`, on the phone.
 *
 * Three ordinary things fall back to the letter: a make not in the shared list, a build with no
 * key, and a request that fails. None leaves a hole, and none shows another company's mark.
 */
export function BrandLogo({ make, size = 32 }: { make: string | null | undefined; size?: number }) {
  const theme = useTheme();
  const [failed, setFailed] = useState(false);
  const domain = domainForMake(make);
  const uri =
    domain && TOKEN
      ? `https://img.logo.dev/${domain}?token=${TOKEN}&size=${size * 3}&format=png`
      : null;

  if (!uri || failed) {
    return (
      <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontSize: size * 0.6, fontWeight: '700', color: theme.foreground }}>
          {(make ?? '?').trim().charAt(0).toUpperCase()}
        </Text>
      </View>
    );
  }

  return (
    <Image
      source={{ uri }}
      style={{ width: size, height: size }}
      contentFit="contain"
      // Disk-cached, so a logo is fetched once per make rather than once per screen.
      cachePolicy="disk"
      transition={150}
      onError={() => setFailed(true)}
      accessibilityIgnoresInvertColors
    />
  );
}
