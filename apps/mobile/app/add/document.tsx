import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DOCUMENT_TYPES, type DocumentType } from '@vehicle-os/domain';
import { ApiError } from '@vehicle-os/api-client';
import { vehiclesQuery } from '@vehicle-os/api-client/react';
import { localDay } from '@vehicle-os/ui';
import { Fact, Rail } from '@/components/add-kit';
import { api } from '@/lib/api';
import { DateField } from '@/lib/date-picker';
import {
  fromParams,
  pickFile,
  pickPhoto,
  type FileParams,
  type PickedFile,
} from '@/lib/file-picker';
import { humanise } from '@/lib/format';
import { haptic, PressableScale, Rise } from '@/lib/motion';
import { enqueueUpload, flush } from '@/lib/offline';
import { addMonths, countdown, validity } from '@/lib/papers';
import { cardSurface, figure, radius, spacing, typeScale, useTheme } from '@/lib/theme';
import { Button, Empty } from '@/lib/ui';

const DOC_GLYPH: Partial<Record<DocumentType, string>> = {
  REGISTRATION: '📋',
  INSURANCE: '🛡️',
  PURCHASE_AGREEMENT: '🧾',
  SERVICE_INVOICE: '🧰',
  REPAIR_INVOICE: '🛠️',
  INSPECTION_REPORT: '🔍',
  WARRANTY: '📜',
  MANUAL: '📘',
  RECEIPT: '🧾',
};

/**
 * The papers that run out, with the terms they usually run for: theirs are the dates asked for up
 * front, and they lead the rail — they are the ones the Docs tab looks for.
 */
const TERMS: Partial<Record<DocumentType, readonly number[]>> = {
  REGISTRATION: [12, 24],
  INSURANCE: [6, 12],
  INSPECTION_REPORT: [12, 24],
  WARRANTY: [12, 24, 36],
};
const ORDER: readonly DocumentType[] = [
  ...DOCUMENT_TYPES.filter((type) => TERMS[type]),
  ...DOCUMENT_TYPES.filter((type) => !TERMS[type]),
];

/** The kind as the rail and the Docs tab say it. */
const kindName = (type: DocumentType) =>
  type === 'INSPECTION_REPORT' ? 'Inspection' : humanise(type);
const term = (months: number) =>
  months % 12 === 0 ? `${months / 12} year${months === 12 ? '' : 's'}` : `${months} months`;

const DAY = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const dayOf = (iso: string) => DAY.format(new Date(`${iso}T00:00:00`));

function fileSize(bytes: number | null | undefined): string | null {
  if (!bytes) return null;
  if (bytes < 1000 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * File a paper against a vehicle, on one screen without scrolling for the common case: what it is
 * on a rail, the file from the camera, the photos or the files, then one sheet — its title, and the
 * days it runs between with the usual terms one press away — read back as the pass the Docs tab
 * will show. Save sits at the foot, always in reach.
 */
export default function AddDocumentScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<
    { vehicleId?: string; documentType?: DocumentType } & FileParams
  >();

  const vehicles = useQuery(vehiclesQuery(api));
  const [vehicleId, setVehicleId] = useState<string | null>(params.vehicleId ?? null);
  /*
   * Preset when the caller already knows — the Docs tab sends the kind of the slot that was
   * pressed, so the screen opens on the paper the person went looking for.
   */
  const [documentType, setDocumentType] = useState<DocumentType>(
    params.documentType && DOCUMENT_TYPES.includes(params.documentType)
      ? params.documentType
      : 'INSURANCE',
  );
  const [title, setTitle] = useState('');
  const [issued, setIssued] = useState('');
  const [until, setUntil] = useState('');
  // A photo taken from the add sheet arrives already chosen.
  const [file, setFile] = useState<PickedFile | null>(() => fromParams(params));
  const [pickError, setPickError] = useState<string | null>(null);

  const list = vehicles.data?.data ?? [];
  const chosen = vehicleId ?? list[0]?.id ?? null;
  const today = localDay();
  const terms = TERMS[documentType];
  // A paper that runs out runs from a day: today unless it says otherwise.
  const from = terms ? issued || today : issued;
  const name = kindName(documentType);
  const fallbackTitle = terms
    ? `${name} ${(from || today).slice(0, 4)}`
    : file
      ? file.name.replace(/\.[^.]+$/, '')
      : name;

  const take = async (source: 'camera' | 'library' | 'files') => {
    setPickError(null);
    try {
      const picked = source === 'files' ? await pickFile() : await pickPhoto(source);
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
          title: title.trim() || fallbackTitle,
          ...(from ? { issuedOn: from } : {}),
          ...(until ? { expiresOn: until } : {}),
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

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      // The stack header over this screen: the status bar and its 44pt bar.
      keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top + 44 : 0}
      style={{ flex: 1, backgroundColor: theme.background }}
    >
      <Stack.Screen options={{ title: 'Add a document' }} />
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        {list.length > 1 && !params.vehicleId ? (
          <Rail
            label="For"
            inset={spacing.lg}
            items={list.map((vehicle) => ({
              key: vehicle.id,
              label: vehicle.displayName,
              selected: vehicle.id === chosen,
              onPress: () => setVehicleId(vehicle.id),
            }))}
          />
        ) : null}

        <Rail
          label="What is it"
          inset={spacing.lg}
          items={ORDER.map((type) => ({
            key: type,
            label: kindName(type),
            glyph: DOC_GLYPH[type],
            selected: type === documentType,
            onPress: () => setDocumentType(type),
          }))}
        />

        {file ? (
          <Rise>
            <FileCard file={file} onRemove={() => setFile(null)} />
          </Rise>
        ) : (
          <View style={styles.sources}>
            <SourceKey icon="camera-outline" label="Camera" onPress={() => void take('camera')} />
            <SourceKey icon="images-outline" label="Photos" onPress={() => void take('library')} />
            <SourceKey icon="document-outline" label="Files" onPress={() => void take('files')} />
          </View>
        )}
        {pickError ? (
          <Text accessibilityRole="alert" style={[typeScale.caption, { color: theme.warning }]}>
            {pickError}
          </Text>
        ) : null}

        {/* The paper's sheet: what it is called, the days it runs between, and how that reads. */}
        <View style={[styles.sheet, cardSurface(theme)]}>
          <View style={styles.cell}>
            <Text style={[styles.label, { color: theme.mutedForeground }]}>TITLE</Text>
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder={fallbackTitle}
              placeholderTextColor={theme.borderStrong}
              maxLength={200}
              returnKeyType="done"
              accessibilityLabel="Title"
              style={[styles.titleInput, { color: theme.foreground }]}
            />
            {fieldErrors?.title ? (
              <Text style={[typeScale.caption, { color: theme.destructive }]}>
                {fieldErrors.title}
              </Text>
            ) : null}
          </View>

          <View style={[styles.rule, { backgroundColor: theme.border }]} />

          <View style={styles.dates}>
            <DateCell
              label={terms ? 'Valid from' : 'Dated'}
              value={from}
              placeholder="Optional"
              onChange={setIssued}
            />
            <View style={[styles.divider, { backgroundColor: theme.border }]} />
            <DateCell
              label={terms ? 'Valid until' : 'Expires'}
              value={until}
              placeholder={terms ? 'Pick a day' : 'Never'}
              min={from || undefined}
              onChange={setUntil}
            />
          </View>

          {terms ? (
            <View style={styles.terms}>
              {terms.map((months) => {
                const end = addMonths(from, months);
                return (
                  <Fact
                    key={months}
                    label={term(months)}
                    selected={until === end}
                    onPress={() => setUntil(until === end ? '' : end)}
                  />
                );
              })}
            </View>
          ) : null}

          {until || terms ? (
            <>
              <View style={[styles.rule, { backgroundColor: theme.border }]} />
              <ReadBack from={from} until={until} kind={name} />
            </>
          ) : null}
          {fieldErrors?.expiresOn ? (
            <Text style={[typeScale.caption, styles.cellError, { color: theme.destructive }]}>
              {fieldErrors.expiresOn}
            </Text>
          ) : null}
        </View>

        {upload.isError && !fieldErrors ? (
          <Text accessibilityRole="alert" style={[typeScale.caption, { color: theme.destructive }]}>
            {(upload.error as Error).message}
          </Text>
        ) : null}
      </ScrollView>

      <View
        style={[
          styles.footer,
          {
            paddingBottom: Math.max(insets.bottom, spacing.sm),
            borderTopColor: theme.hairline,
            backgroundColor: theme.background,
          },
        ]}
      >
        <Button
          label={file ? `Save ${name.toLowerCase()}` : 'Attach the file to save'}
          variant="primary"
          size="lg"
          loading={upload.isPending}
          disabled={!file || !chosen}
          onPress={() => upload.mutate()}
        />
      </View>
    </KeyboardAvoidingView>
  );
}

/** One way to bring the file in: the camera, the photos, or the files app. */
function SourceKey({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Attach from ${label.toLowerCase()}`}
      scaleTo={0.95}
      style={[styles.source, { borderColor: theme.borderStrong }]}
    >
      <Ionicons name={icon} size={20} color={theme.foreground} />
      <Text style={[typeScale.caption, styles.sourceLabel, { color: theme.foreground }]}>
        {label}
      </Text>
    </PressableScale>
  );
}

/** The file that will be filed: its page when it is a photo, its kind when not; × lets it go. */
function FileCard({ file, onRemove }: { file: PickedFile; onRemove: () => void }) {
  const theme = useTheme();
  const kind = (/\.([a-z0-9]{1,4})$/i.exec(file.name)?.[1] ?? file.mimeType.split('/')[1] ?? 'file')
    .toUpperCase()
    .slice(0, 4);
  return (
    <View style={[styles.file, cardSurface(theme)]}>
      <View style={[styles.preview, { backgroundColor: theme.muted }]}>
        {file.mimeType.startsWith('image/') ? (
          <Image
            source={{ uri: file.uri }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            accessibilityIgnoresInvertColors
          />
        ) : (
          <Text style={[figure, styles.kind, { color: theme.mutedForeground }]}>{kind}</Text>
        )}
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text numberOfLines={1} style={[typeScale.label, { color: theme.foreground }]}>
          {file.name}
        </Text>
        <Text numberOfLines={1} style={[typeScale.caption, { color: theme.mutedForeground }]}>
          {[kind, fileSize(file.size)].filter(Boolean).join(' · ')}
        </Text>
      </View>
      <PressableScale
        onPress={() => {
          haptic.selection();
          onRemove();
        }}
        accessibilityRole="button"
        accessibilityLabel={`Remove ${file.name}`}
        hitSlop={8}
        scaleTo={0.85}
        style={[styles.remove, { backgroundColor: theme.muted }]}
      >
        <Ionicons name="close" size={15} color={theme.foreground} />
      </PressableScale>
    </View>
  );
}

/** A day on the sheet: its small label over the day in the figures' mono, the calendar on a press. */
function DateCell({
  label,
  value,
  placeholder,
  min,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  min?: string;
  onChange: (day: string) => void;
}) {
  const theme = useTheme();
  return (
    <DateField
      value={value}
      onChange={onChange}
      min={min}
      label={label}
      placeholder={placeholder}
      trigger={(said, open) => (
        <PressableScale
          onPress={open}
          accessibilityRole="button"
          accessibilityLabel={`${label}, ${said}`}
          scaleTo={0.97}
          style={styles.dateCell}
        >
          <Text style={[styles.label, { color: theme.mutedForeground }]}>{label.toUpperCase()}</Text>
          <Text
            numberOfLines={1}
            style={[
              value ? figure : null,
              styles.dateValue,
              { color: value ? theme.foreground : theme.mutedForeground },
            ]}
          >
            {value ? dayOf(value) : placeholder}
          </Text>
        </PressableScale>
      )}
    />
  );
}

/**
 * The days read back as the Docs tab will show them: where it stands and what is left, over the
 * bar of its term — or, for a paper that runs out with no end day, the one thing worth saying.
 */
function ReadBack({ from, until, kind }: { from: string; until: string; kind: string }) {
  const theme = useTheme();
  if (!until) {
    return (
      <View style={[styles.readBack, styles.readBackPad]}>
        <Ionicons name="alert-circle-outline" size={15} color={theme.warning} />
        <Text style={[typeScale.caption, { flex: 1, color: theme.mutedForeground }]}>
          Without an end day, nothing can warn you before this {kind.toLowerCase()} runs out.
        </Text>
      </View>
    );
  }
  const status = validity({ issuedOn: from || null, expiresOn: until, createdAt: '' });
  const color =
    status.state === 'expired'
      ? theme.destructive
      : status.state === 'soon'
        ? theme.warning
        : theme.success;
  const left = countdown(status.days!);
  // Said as the Docs countdown says it.
  const said =
    status.state === 'expired'
      ? `Expired ${left.value} ${left.unit} ago`
      : `${left.value} ${left.unit} left`;
  return (
    <View style={styles.readBackColumn} accessible accessibilityLabel={said}>
      <View style={styles.readBack}>
        <View style={[styles.dot, { backgroundColor: color }]} />
        <Text
          style={[
            typeScale.caption,
            { flex: 1, color: status.state === 'valid' ? theme.mutedForeground : color },
          ]}
        >
          {said}
        </Text>
      </View>
      <View style={[styles.track, { backgroundColor: `${color}26` }]}>
        <View
          style={[
            styles.fill,
            {
              width: `${status.state === 'expired' ? 0 : Math.max((status.left ?? 0) * 100, 3)}%`,
              backgroundColor: color,
            },
          ]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xl },
  sources: { flexDirection: 'row', gap: spacing.sm },
  source: {
    flex: 1,
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderStyle: 'dashed',
  },
  sourceLabel: { fontWeight: '600' },
  file: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 10,
    borderRadius: radius.xl,
  },
  preview: {
    width: 44,
    height: 44,
    borderRadius: 10,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  kind: { fontSize: 9, lineHeight: 12, fontWeight: '700', letterSpacing: 0.6 },
  remove: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheet: { borderRadius: radius.xl + 2 },
  cell: { paddingHorizontal: 14, paddingTop: 12, paddingBottom: 10, gap: 4 },
  cellError: { paddingHorizontal: 14, paddingBottom: 10 },
  label: { fontSize: 10, lineHeight: 13, fontWeight: '600', letterSpacing: 1 },
  titleInput: { fontSize: 16, lineHeight: 21, fontWeight: '600', padding: 0 },
  rule: { height: StyleSheet.hairlineWidth },
  dates: { flexDirection: 'row' },
  divider: { width: StyleSheet.hairlineWidth },
  dateCell: { flex: 1, paddingHorizontal: 14, paddingVertical: 12, gap: 4 },
  dateValue: { fontSize: 14.5, lineHeight: 19, fontWeight: '600' },
  terms: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 14, paddingBottom: 12 },
  readBackColumn: { gap: 8, paddingHorizontal: 14, paddingVertical: 12 },
  readBack: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  readBackPad: { paddingHorizontal: 14, paddingVertical: 12 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  track: { height: 4, borderRadius: 2, overflow: 'hidden' },
  fill: { height: 4, borderRadius: 2 },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm + 2,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
