import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { DOCUMENT_TYPES, type DocumentType } from '@vehicle-os/domain';
import { ApiError } from '@vehicle-os/api-client';
import { vehiclesQuery } from '@vehicle-os/api-client/react';
import { localDay } from '@vehicle-os/ui';
import { api } from '@/lib/api';
import { enqueueUpload, flush } from '@/lib/offline';
import { fromParams, pickFile, type FileParams, type PickedFile } from '@/lib/file-picker';
import { humanise } from '@/lib/format';
import { Chip, Eyebrow, Glyph, Headline, Panel, PanelCell, ToneTile } from '@/lib/instrument';
import { haptic, PressableScale, Rise } from '@/lib/motion';
import { DateField } from '@/lib/date-picker';
import { figure, radius, spacing, typeScale, useTheme } from '@/lib/theme';
import { Button, Empty } from '@/lib/ui';

const DOC_GLYPH: Partial<Record<DocumentType, string>> = {
  REGISTRATION: '📋',
  INSURANCE: '🛡️',
  PURCHASE_AGREEMENT: '🧾',
  SERVICE_INVOICE: '🔧',
  REPAIR_INVOICE: '🛠️',
  INSPECTION_REPORT: '🔍',
  WARRANTY: '📜',
  MANUAL: '📘',
  RECEIPT: '🧾',
};

/** The kinds that run out, so the expiry is asked for them up front. */
const EXPIRES: readonly DocumentType[] = [
  'REGISTRATION',
  'INSURANCE',
  'WARRANTY',
  'INSPECTION_REPORT',
];

function fileSize(bytes: number | null | undefined): string | null {
  if (!bytes) return null;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * File a document against a vehicle: the file first, as the large thing on the screen, then what
 * it is and when it runs out — without an expiry nothing can warn you before it does.
 */
export default function AddDocumentScreen() {
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<
    { vehicleId?: string; documentType?: DocumentType } & FileParams
  >();

  const vehicles = useQuery(vehiclesQuery(api));
  const [vehicleId, setVehicleId] = useState<string | null>(params.vehicleId ?? null);
  /*
   * Preset when the caller already knows — the Docs grid sends the kind of the empty tile that
   * was pressed, so the screen opens on the paper the person went looking for.
   */
  const [documentType, setDocumentType] = useState<DocumentType>(
    params.documentType && DOCUMENT_TYPES.includes(params.documentType)
      ? params.documentType
      : 'INSURANCE',
  );
  const [title, setTitle] = useState('');
  const [expiresOn, setExpiresOn] = useState('');
  // A photo taken from the add sheet arrives already chosen.
  const [file, setFile] = useState<PickedFile | null>(() => fromParams(params));
  const [pickError, setPickError] = useState<string | null>(null);

  const list = vehicles.data?.data ?? [];
  const chosen = vehicleId ?? list[0]?.id ?? null;
  const asksExpiry = EXPIRES.includes(documentType);

  const choose = async () => {
    setPickError(null);
    try {
      const picked = await pickFile();
      if (picked) {
        haptic.selection();
        setFile(picked);
      }
    } catch (error) {
      setPickError((error as Error).message);
    }
  };

  const upload = useMutation({
    /*
     * Queued with its bytes copied somewhere durable. A registration document is photographed
     * where the paperwork is — a glovebox, a dealer's forecourt — and waiting for signal there is
     * how it ends up never being filed at all.
     */
    mutationFn: async () => {
      await enqueueUpload({
        kind: 'upload',
        target: 'document',
        vehicleId: chosen!,
        uri: file!.uri,
        name: file!.name,
        mimeType: file!.mimeType,
        size: file!.size,
        body: {
          documentType,
          title: title.trim() || file!.name,
          ...(expiresOn ? { expiresOn } : {}),
        },
      });
      void flush();
    },
    onSuccess: () => {
      haptic.success();
      void queryClient.invalidateQueries({ queryKey: ['vehicles'] });
      void queryClient.invalidateQueries({ queryKey: ['documents'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      router.back();
    },
  });

  const fieldErrors = upload.error instanceof ApiError ? upload.error.fields : undefined;

  if (vehicles.data && list.length === 0) {
    return <Empty title="No vehicles yet" description="Add a vehicle first." />;
  }

  const expiryOptions = [
    { label: 'No expiry', day: '' },
    { label: 'In 6 months', day: localDay({ months: 6 }) },
    { label: 'In a year', day: localDay({ months: 12 }) },
  ];

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: theme.background }}
    >
      <Stack.Screen options={{ title: 'Add a document' }} />
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        {/* The file is the point, so it is the largest thing here — and the way to choose one. */}
        <PressableScale
          onPress={() => void choose()}
          accessibilityRole="button"
          accessibilityLabel={
            file ? `Chosen: ${file.name}. Choose a different file` : 'Choose a file'
          }
          scaleTo={0.98}
          style={[styles.drop, { backgroundColor: file ? theme.card : theme.muted }]}
        >
          {file ? (
            <Rise style={styles.fileRow}>
              {file.mimeType.startsWith('image/') ? (
                <Image
                  source={{ uri: file.uri }}
                  style={styles.thumb}
                  contentFit="cover"
                  accessibilityIgnoresInvertColors
                />
              ) : (
                <ToneTile tone="success" size={52}>
                  <Glyph size={26}>📄</Glyph>
                </ToneTile>
              )}
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <Text numberOfLines={1} style={[typeScale.headline, { color: theme.foreground }]}>
                  {file.name}
                </Text>
                <Text style={[typeScale.caption, figure, { color: theme.mutedForeground }]}>
                  {[file.mimeType.split('/')[1]?.toUpperCase(), fileSize(file.size)]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
                <Text style={[typeScale.caption, { color: theme.mutedForeground }]}>
                  Tap to choose a different file
                </Text>
              </View>
            </Rise>
          ) : (
            <View style={styles.dropEmpty}>
              <View style={[styles.dropCircle, { backgroundColor: theme.card }]}>
                <Glyph size={30}>📎</Glyph>
              </View>
              <Text style={[typeScale.headline, { color: theme.foreground }]}>Choose a file</Text>
              <Text style={[typeScale.caption, { color: theme.mutedForeground }]}>
                PDF, photo or text
              </Text>
            </View>
          )}
        </PressableScale>
        {pickError ? (
          <View style={[styles.banner, { backgroundColor: theme.warningSoft }]}>
            <Text accessibilityRole="alert" style={[typeScale.caption, { color: theme.warning }]}>
              {pickError}
            </Text>
          </View>
        ) : null}

        {list.length > 1 && !params.vehicleId ? (
          <View style={{ gap: spacing.sm }}>
            <Eyebrow>For</Eyebrow>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ marginHorizontal: -spacing.md }}
              contentContainerStyle={{ gap: spacing.sm, paddingHorizontal: spacing.md }}
            >
              {list.map((vehicle) => (
                <Chip
                  key={vehicle.id}
                  label={vehicle.displayName}
                  selected={vehicle.id === chosen}
                  onPress={() => setVehicleId(vehicle.id)}
                />
              ))}
            </ScrollView>
          </View>
        ) : null}

        <View style={{ gap: spacing.sm }}>
          <Eyebrow>What is it</Eyebrow>
          <View style={styles.wrap}>
            {DOCUMENT_TYPES.map((type) => (
              <Chip
                key={type}
                label={humanise(type)}
                selected={type === documentType}
                onPress={() => setDocumentType(type)}
                leading={DOC_GLYPH[type] ? <Glyph size={15}>{DOC_GLYPH[type]!}</Glyph> : undefined}
              />
            ))}
          </View>
        </View>

        <Headline
          label="Title"
          value={title}
          onChangeText={setTitle}
          placeholder={file?.name ?? `${humanise(documentType)} 2026`}
          note="Defaults to the file name."
          error={fieldErrors?.title}
        />

        <View style={{ gap: spacing.sm }}>
          <View style={styles.wrap}>
            {expiryOptions.map((option) => (
              <Chip
                key={option.label}
                label={option.label}
                selected={expiresOn === option.day}
                onPress={() => setExpiresOn(option.day)}
              />
            ))}
          </View>
          <Panel>
            <PanelCell
              label="Expires"
              note={
                fieldErrors?.expiresOn ??
                (expiresOn
                  ? 'You will be warned before it runs out'
                  : asksExpiry
                    ? `A ${humanise(documentType).toLowerCase()} usually runs out — without a date nothing can warn you`
                    : 'Optional')
              }
              noteTone={
                fieldErrors?.expiresOn
                  ? 'destructive'
                  : !expiresOn && asksExpiry
                    ? 'warning'
                    : undefined
              }
            >
              {expiresOn ? (
                <DateField
                  value={expiresOn}
                  onChange={setExpiresOn}
                  label="Expires"
                  placeholder="No expiry"
                />
              ) : (
                <Text
                  onPress={() => setExpiresOn(localDay({ months: 12 }))}
                  accessibilityRole="button"
                  style={[typeScale.headline, { color: theme.mutedForeground, paddingVertical: 8 }]}
                >
                  Pick a day
                </Text>
              )}
            </PanelCell>
          </Panel>
        </View>

        {upload.isError && !fieldErrors ? (
          <View style={[styles.banner, { backgroundColor: theme.destructiveSoft }]}>
            <Text
              accessibilityRole="alert"
              style={[typeScale.caption, { color: theme.destructive }]}
            >
              {(upload.error as Error).message}
            </Text>
          </View>
        ) : null}

        <Button
          label="Upload document"
          variant="primary"
          loading={upload.isPending}
          disabled={!file || !chosen}
          onPress={() => upload.mutate()}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  page: { padding: spacing.md, gap: spacing.lg, paddingBottom: spacing.xl },
  drop: { borderRadius: radius.xl, minHeight: 150, justifyContent: 'center', padding: spacing.md },
  dropEmpty: { alignItems: 'center', gap: spacing.sm },
  dropCircle: {
    width: 64,
    height: 64,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumb: { width: 52, height: 52, borderRadius: 14 },
  fileRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  banner: { borderRadius: radius.lg, padding: 14 },
});
