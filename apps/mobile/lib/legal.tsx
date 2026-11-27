import { Fragment } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/lib/theme';

/**
 * The site that hosts the policies (apps/landing). The stores want them one tap from the app:
 * Apple's guideline 3.1.2 asks for Terms and Privacy beside any subscription purchase.
 */
export const SITE_URL = 'https://garajj.fayzan.xyz';

export type LegalPage = 'terms' | 'privacy' | 'support';

const LABELS: Record<LegalPage, string> = {
  terms: 'Terms of use',
  privacy: 'Privacy policy',
  support: 'Support',
};

export function openLegal(page: LegalPage) {
  void Linking.openURL(`${SITE_URL}/${page}`).catch(() => undefined);
}

/** The policies as a quiet line of links, a dot between: each opens its page in the browser. */
export function LegalLinks({ pages }: { pages: readonly LegalPage[] }) {
  const theme = useTheme();
  return (
    <View style={styles.row}>
      {pages.map((page, index) => (
        <Fragment key={page}>
          {index > 0 ? <Text style={[styles.dot, { color: theme.mutedForeground }]}>·</Text> : null}
          <Pressable
            accessibilityRole="link"
            onPress={() => openLegal(page)}
            // The line is small; the press is not.
            hitSlop={{ top: 12, bottom: 12, left: 6, right: 6 }}
          >
            <Text style={[styles.link, { color: theme.mutedForeground }]}>{LABELS[page]}</Text>
          </Pressable>
        </Fragment>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6 },
  link: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  dot: { fontSize: 12, lineHeight: 16 },
});
