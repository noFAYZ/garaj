import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
// The path-and-string API; SDK 54 moved it under `legacy` when it made the File/Directory one default.
import * as FileSystem from 'expo-file-system/legacy';
import { Image } from 'expo-image';
import * as IntentLauncher from 'expo-intent-launcher';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { api } from '@/lib/api';
import { HeaderKey } from '@/components/settings-kit';
import { figure, radius, spacing, typeScale, useTheme } from '@/lib/theme';
import { Button } from '@/lib/ui';
import { dialog, FAILED } from '@/lib/dialog';

type Loaded =
  | { kind: 'image'; url: string }
  /** On this phone, in the cache: drawn from disk, deleted when the screen goes. */
  | { kind: 'pdf'; file: string }
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

  if (mimeType === 'text/plain') {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`The file did not load (${response.status}).`);
    return { kind: 'text', text: await response.text(), filename };
  }

  /*
   * Downloaded natively, straight to a file: the bytes never pass through JS on the way in, and
   * nothing the size of a scanned service book sits in memory or in the query cache.
   */
  const target = `${FileSystem.cacheDirectory}document-${id}.pdf`;
  const downloaded = await FileSystem.downloadAsync(url, target);
  if (downloaded.status < 200 || downloaded.status >= 300) {
    await FileSystem.deleteAsync(target, { idempotent: true });
    throw new Error(`The file did not load (${downloaded.status}).`);
  }
  return { kind: 'pdf', file: downloaded.uri, filename };
}

/**
 * A PDF on Android, drawn with pdf.js inside a web view that never navigates anywhere. (iOS's web
 * view draws a PDF itself, natively — zoom, text selection and all — so it is handed the file.)
 *
 * Only the pages near the screen are drawn: each page is a sized placeholder, drawn as it comes
 * within a screen and a half of view and let go once it is well past. Drawing every page up
 * front at full density was ~7 MB of canvas a page — a fifty-page manual was a crashed web view.
 * Density is capped at 2×, which is sharp at reading size, and the viewport allows a pinch.
 * ponytail: the file still goes in as base64, fine for the 25 MB upload cap; stream it if that rises.
 */
function pdfPage(base64: string, background: string, foreground: string): string {
  return `<!doctype html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5">
<style>
  html,body{margin:0;background:${background};color:${foreground};font:14px Roboto,sans-serif}
  #pages{display:flex;flex-direction:column;gap:12px;padding:12px}
  .page{width:100%;border-radius:6px;overflow:hidden;background:#fff}
  .page canvas{display:block;width:100%;height:100%}
</style>
<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
</head><body><div id="pages"></div>
<script>
(async function () {
  const post = (message) => window.ReactNativeWebView.postMessage(message);
  try {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    const raw = atob('${base64}');
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    const pdf = await pdfjsLib.getDocument({ data: bytes, isEvalSupported: false }).promise;
    const pages = document.getElementById('pages');
    const density = Math.min(window.devicePixelRatio || 1, 2);
    const width = pages.clientWidth - 24;
    const first = (await pdf.getPage(1)).getViewport({ scale: 1 });

    async function draw(slot) {
      if (slot.firstChild || slot.dataset.busy) return;
      slot.dataset.busy = '1';
      const page = await pdf.getPage(Number(slot.dataset.n));
      const base = page.getViewport({ scale: 1 });
      slot.style.aspectRatio = base.width + ' / ' + base.height;
      const viewport = page.getViewport({ scale: (width / base.width) * density });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      page.cleanup();
      delete slot.dataset.busy;
      // Scrolled past while it was drawing: let the canvas go rather than keep it.
      if (slot.dataset.near) slot.appendChild(canvas);
      else canvas.width = canvas.height = 0;
      if (slot.dataset.n === '1') post('ready');
    }
    function drop(slot) {
      const canvas = slot.firstChild;
      if (!canvas) return;
      canvas.width = canvas.height = 0;
      slot.removeChild(canvas);
    }

    const near = new IntersectionObserver(
      (entries) => entries.forEach((entry) => {
        const slot = entry.target;
        if (entry.isIntersecting) {
          slot.dataset.near = '1';
          draw(slot).catch((error) => post('error:' + (error && error.message)));
        } else {
          delete slot.dataset.near;
          drop(slot);
        }
      }),
      { rootMargin: '150% 0px' },
    );
    for (let n = 1; n <= pdf.numPages; n++) {
      const slot = document.createElement('div');
      slot.className = 'page';
      slot.dataset.n = String(n);
      slot.style.aspectRatio = first.width + ' / ' + first.height;
      pages.appendChild(slot);
      near.observe(slot);
    }
  } catch (error) {
    post('error:' + (error && error.message));
  }
})();
</script></body></html>`;
}

/**
 * The downloaded PDF in the phone's own viewer (Drive, Files, whatever handles PDFs) — offered
 * beside the in-app one, and the way out when that one cannot draw: pdf.js comes from a CDN, so
 * with no signal the page has nothing to draw with, while the file itself is already on the phone.
 */
async function openWithPhone(file: string): Promise<void> {
  const uri = await FileSystem.getContentUriAsync(file);
  // FLAG_GRANT_READ_URI_PERMISSION: the other app may read this one file, and only it.
  await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
    data: uri,
    type: 'application/pdf',
    flags: 1,
  });
}

/** Android's half: the downloaded file read into the page that draws it. */
function useAndroidPdf(file: string | null): { html: string | null; error: string | null } {
  const theme = useTheme();
  const [base64, setBase64] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!file || Platform.OS !== 'android') return;
    let live = true;
    setBase64(null);
    setError(null);
    FileSystem.readAsStringAsync(file, { encoding: FileSystem.EncodingType.Base64 })
      .then((read) => live && setBase64(read))
      .catch(() => live && setError('The file could not be read.'));
    return () => {
      live = false;
    };
  }, [file]);
  return {
    html: base64 ? pdfPage(base64, theme.background, theme.foreground) : null,
    error,
  };
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
  const pdfFile = data?.kind === 'pdf' ? data.file : null;
  // Android only: iOS draws the PDF natively and has its own share sheet for it.
  const handOff =
    pdfFile && Platform.OS === 'android'
      ? () =>
          void openWithPhone(pdfFile).catch(() =>
            dialog(
              'No app opens PDFs',
              'Install one — Google Drive does — and try again.',
              undefined,
              FAILED,
            ),
          )
      : null;
  const android = useAndroidPdf(pdfFile);
  // The downloaded copy is the screen's alone: gone with it, and with each fresh download.
  useEffect(() => {
    if (!pdfFile) return;
    return () => void FileSystem.deleteAsync(pdfFile, { idempotent: true }).catch(() => undefined);
  }, [pdfFile]);

  const retry = () => {
    setRenderError(null);
    setRendering(true);
    void file.refetch();
  };

  return (
    <View style={{ flex: 1, backgroundColor: 'transparent' }}>
      <Stack.Screen
        options={{
          title: title ?? data?.filename ?? 'Document',
          headerRight: () =>
            shareUrl || handOff ? (
              <HeaderKey
                icon="share-outline"
                label="Open in another app"
                onPress={() => (handOff ? handOff() : void Linking.openURL(shareUrl!))}
              />
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
          {handOff ? (
            <Button label="Open in another app" variant="primary" onPress={handOff} />
          ) : null}
          <Button label="Try again" variant={handOff ? 'secondary' : 'primary'} onPress={retry} />
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
          {Platform.OS === 'ios' ? (
            // The file itself, drawn by WebKit's own PDF view: native zoom, search and selection.
            <WebView
              originWhitelist={['*']}
              source={{ uri: data.file }}
              allowingReadAccessToURL={FileSystem.cacheDirectory ?? undefined}
              style={{ flex: 1, backgroundColor: theme.background }}
              onLoadEnd={() => setRendering(false)}
              onError={() => setRenderError('This PDF could not be shown.')}
              onShouldStartLoadWithRequest={(request) => request.navigationType !== 'click'}
            />
          ) : android.html ? (
            <WebView
              originWhitelist={['*']}
              source={{ html: android.html, baseUrl: 'https://cdnjs.cloudflare.com/' }}
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
          ) : android.error ? (
            <Text style={[typeScale.caption, styles.centered, { color: theme.destructive }]}>
              {android.error}
            </Text>
          ) : null}
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
