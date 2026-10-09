import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { api } from '@/lib/api';
import { PressableScale } from '@/lib/motion';
import { figure, radius, spacing, typeScale, useTheme } from '@/lib/theme';
import { Button } from '@/lib/ui';

type Loaded =
  | { kind: 'image'; url: string }
  | { kind: 'pdf'; base64: string }
  | { kind: 'text'; text: string }
  | { kind: 'other'; url: string };

/**
 * The file's bytes, read by the app itself rather than handed to a browser.
 *
 * Storage serves documents as downloads, and both a web view and the in-app browser tab answer a
 * download by offering to save it. So nothing here depends on how the link is served: the type
 * comes from the document's own record, and the bytes are fetched and drawn in the app.
 */
async function load(vehicleId: string, id: string): Promise<Loaded & { filename: string }> {
  const { url, mimeType, filename } = await api.documents.download(vehicleId, id);

  // expo-image decodes whatever arrives, whatever the response calls it.
  if (mimeType.startsWith('image/')) return { kind: 'image', url, filename };
  if (mimeType !== 'application/pdf' && mimeType !== 'text/plain') {
    return { kind: 'other', url, filename };
  }

  const response = await fetch(url);
  if (!response.ok) throw new Error(`The file did not load (${response.status}).`);
  if (mimeType === 'text/plain') return { kind: 'text', text: await response.text(), filename };

  const blob = await response.blob();
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(new Error('The file could not be read.'));
    reader.readAsDataURL(blob);
  });
  return { kind: 'pdf', base64, filename };
}

/**
 * A PDF drawn page by page with pdf.js, inside a web view that never navigates anywhere.
 *
 * iOS's web view can show a PDF on its own and Android's cannot; drawing it this way looks and
 * behaves the same on both. Pages render at the screen's pixel density so text stays sharp, and
 * the viewport allows a pinch.
 * ponytail: the whole file goes in as base64, fine for the 25 MB upload cap; stream it if that rises.
 */
function pdfPage(base64: string, background: string, foreground: string): string {
  return `<!doctype html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5">
<style>
  html,body{margin:0;background:${background};color:${foreground};font:14px -apple-system,Roboto,sans-serif}
  #pages{display:flex;flex-direction:column;gap:12px;padding:12px}
  canvas{width:100%;height:auto;border-radius:6px;background:#fff}
</style>
<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
</head><body><div id="pages"></div>
<script>
(async function () {
  try {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    const raw = atob('${base64}');
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
    const pages = document.getElementById('pages');
    const density = window.devicePixelRatio || 2;
    const width = pages.clientWidth - 24;
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: (width / base.width) * density });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      pages.appendChild(canvas);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      if (n === 1) window.ReactNativeWebView.postMessage('ready');
    }
  } catch (error) {
    window.ReactNativeWebView.postMessage('error:' + (error && error.message));
  }
})();
</script></body></html>`;
}

export default function DocumentScreen() {
  const theme = useTheme();
  const { id, vehicleId, title } = useLocalSearchParams<{
    id: string;
    vehicleId: string;
    title?: string;
  }>();
  const [rendering, setRendering] = useState(true);
  const [renderError, setRenderError] = useState<string | null>(null);

  const file = useQuery({
    queryKey: ['vehicles', vehicleId, 'documents', id, 'view'],
    queryFn: () => load(vehicleId, id),
    // The link inside expires in minutes; nothing here is worth keeping past the screen.
    staleTime: 0,
    gcTime: 0,
    retry: 1,
  });

  const data = file.data;
  const shareUrl = data && (data.kind === 'image' || data.kind === 'other') ? data.url : null;

  const retry = () => {
    setRenderError(null);
    setRendering(true);
    void file.refetch();
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <Stack.Screen
        options={{
          title: title ?? data?.filename ?? 'Document',
          headerRight: () =>
            shareUrl ? (
              <PressableScale
                onPress={() => void Linking.openURL(shareUrl)}
                accessibilityRole="button"
                accessibilityLabel="Open in another app"
                hitSlop={8}
                scaleTo={0.9}
              >
                <Ionicons name="share-outline" size={22} color={theme.foreground} />
              </PressableScale>
            ) : null,
        }}
      />

      {file.isPending ? (
        <View style={styles.centered}>
          <ActivityIndicator color={theme.mutedForeground} />
          <Text style={[typeScale.caption, { color: theme.mutedForeground }]}>Opening…</Text>
        </View>
      ) : file.isError || renderError || !data ? (
        <View style={styles.centered}>
          <View style={[styles.icon, { backgroundColor: theme.card }]}>
            <Ionicons name="alert-circle-outline" size={26} color={theme.foreground} />
          </View>
          <Text style={[typeScale.headline, { color: theme.foreground }]}>
            Could not open this document
          </Text>
          <Text style={[typeScale.caption, { color: theme.mutedForeground, textAlign: 'center' }]}>
            {renderError ?? file.error?.message ?? 'The file did not load.'}
          </Text>
          <Button label="Try again" variant="primary" onPress={retry} />
        </View>
      ) : data.kind === 'image' ? (
        // A ScrollView zooms natively on iOS; Android shows the page fitted, which reads a receipt.
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ flexGrow: 1 }}
          maximumZoomScale={5}
          minimumZoomScale={1}
          centerContent
          showsHorizontalScrollIndicator={false}
          showsVerticalScrollIndicator={false}
        >
          <Image
            // Keyed by the document, not its signed link, so reopening it reads from disk.
            source={{ uri: data.url, cacheKey: `document:${id}:full` }}
            cachePolicy="memory-disk"
            style={{ flex: 1, minHeight: 400 }}
            contentFit="contain"
            transition={150}
            onError={() => setRenderError('The image could not be loaded.')}
            accessibilityIgnoresInvertColors
          />
        </ScrollView>
      ) : data.kind === 'text' ? (
        <ScrollView contentContainerStyle={{ padding: spacing.md }}>
          <Text selectable style={[typeScale.caption, figure, { color: theme.foreground }]}>
            {data.text}
          </Text>
        </ScrollView>
      ) : data.kind === 'pdf' ? (
        <View style={{ flex: 1 }}>
          <WebView
            originWhitelist={['*']}
            source={{
              html: pdfPage(data.base64, theme.background, theme.foreground),
              baseUrl: 'https://cdnjs.cloudflare.com/',
            }}
            style={{ flex: 1, backgroundColor: theme.background }}
            onMessage={(event) => {
              const message = event.nativeEvent.data;
              setRendering(false);
              if (message.startsWith('error:')) {
                setRenderError(`This PDF could not be shown. ${message.slice(6)}`);
              }
            }}
            // A viewer, not a browser: a tapped link inside it goes nowhere.
            onShouldStartLoadWithRequest={(request) => request.navigationType !== 'click'}
          />
          {rendering ? (
            <View
              pointerEvents="none"
              style={[
                StyleSheet.absoluteFill,
                styles.centered,
                { backgroundColor: theme.background },
              ]}
            >
              <ActivityIndicator color={theme.mutedForeground} />
              <Text style={[typeScale.caption, { color: theme.mutedForeground }]}>
                Drawing pages…
              </Text>
            </View>
          ) : null}
        </View>
      ) : (
        // Word and Excel files have no in-app renderer; the phone's own apps open them.
        <View style={styles.centered}>
          <View style={[styles.icon, { backgroundColor: theme.card }]}>
            <Ionicons name="document-outline" size={26} color={theme.foreground} />
          </View>
          <Text style={[typeScale.headline, { color: theme.foreground, textAlign: 'center' }]}>
            {data.filename}
          </Text>
          <Text style={[typeScale.caption, { color: theme.mutedForeground, textAlign: 'center' }]}>
            Cannot be shown here.
          </Text>
          <Button
            label="Open in another app"
            variant="primary"
            onPress={() => void Linking.openURL(data.url)}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.xl,
  },
  icon: {
    width: 56,
    height: 56,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
