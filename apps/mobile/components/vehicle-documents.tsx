import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import type { VehicleDocument } from '@vehicle-os/contracts';
import type { DocumentType } from '@vehicle-os/domain';
import { documentsQuery } from '@vehicle-os/api-client/react';
import { daysUntil, spanOfDays } from '@vehicle-os/ui';
import { RemoteImage } from '@/components/remote-image';
import { api } from '@/lib/api';
import { humanise } from '@/lib/format';
import { SectionHeading, ToneChip, type Tone } from '@/lib/instrument';
import { haptic, PressableScale, Rise } from '@/lib/motion';
import { figure, radius, spacing, typeScale, useTheme } from '@/lib/theme';
import { Skeleton } from '@/lib/ui';

const DOC_ICON: Partial<Record<DocumentType, keyof typeof Ionicons.glyphMap>> = {
  REGISTRATION: 'id-card-outline',
  INSURANCE: 'shield-checkmark-outline',
  PURCHASE_AGREEMENT: 'document-lock-outline',
  SERVICE_INVOICE: 'construct-outline',
  REPAIR_INVOICE: 'hammer-outline',
  INSPECTION_REPORT: 'search-outline',
  WARRANTY: 'ribbon-outline',
  MANUAL: 'book-outline',
  RECEIPT: 'receipt-outline',
};

/** Past this, an expiry is a date, not a warning — the server's "expiring soon" line. */
const SOON_DAYS = 60;

/**
 * The papers a vehicle is expected to have.
 *
 * These four are the ones that are asked for — at a roadside stop, at a sale, at renewal — and
 * the ones that run out. The grid shows all four whether or not they exist, because the useful
 * answer is as often "there is no insurance on file" as it is the policy itself, and a list of
 * what you happen to have uploaded can never say that.
 */
const KEY_DOCUMENTS: { type: DocumentType; label: string }[] = [
  { type: 'REGISTRATION', label: 'Registration' },
  { type: 'INSURANCE', label: 'Insurance' },
  { type: 'INSPECTION_REPORT', label: 'Inspection' },
  { type: 'WARRANTY', label: 'Warranty' },
];

export function expiry(document: VehicleDocument): { label: string; tone: Tone } | null {
  if (!document.expiresOn) return null;
  const days = daysUntil(document.expiresOn);
  if (days < 0) return { label: `Expired ${spanOfDays(-days)} ago`, tone: 'destructive' };
  if (days <= SOON_DAYS) return { label: `Expires in ${spanOfDays(days)}`, tone: 'warning' };
  return {
    label: `Until ${new Date(`${document.expiresOn}T00:00:00`).toLocaleDateString('en-US', {
      month: 'short',
      year: 'numeric',
    })}`,
    tone: 'neutral',
  };
}

function fileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * A vehicle's paperwork: what runs out first, then everything else, newest first. A row opens the
 * file in the app's own viewer.
 */
export function VehicleDocuments({ vehicleId }: { vehicleId: string }) {
  const theme = useTheme();
  const router = useRouter();
  // ponytail: the first page only (the API's default size); page through when a vehicle outgrows it.
  const documents = useQuery(documentsQuery(api, vehicleId));
  const list = (documents.data?.data ?? []).filter((document) => document.uploadedAt !== null);

  /*
   * The newest of each key kind stands for it in the grid — a vehicle accumulates five years of
   * insurance certificates, and the current one is the only one anybody wants at a glance. The
   * older ones are not hidden: they fall through to the list below with everything else.
   */
  const featured = new Map<DocumentType, VehicleDocument>();
  for (const document of list) {
    const key = KEY_DOCUMENTS.find((entry) => entry.type === document.documentType);
    if (key && !featured.has(document.documentType)) featured.set(document.documentType, document);
  }

  const remaining = list.filter((document) => featured.get(document.documentType) !== document);
  // What needs attention leads; the rest keep the server's order.
  const urgent = remaining.filter((document) => {
    const state = expiry(document);
    return state && state.tone !== 'neutral';
  });
  const rest = remaining.filter((document) => !urgent.includes(document));

  const add = () => router.push({ pathname: '/add/document', params: { vehicleId } });

  return (
    <View style={{ gap: spacing.sm }}>
      <SectionHeading
        title="Documents"
        count={documents.data ? list.length : undefined}
        trailing={
          <PressableScale
            onPress={add}
            accessibilityRole="button"
            accessibilityLabel="Add a document"
            style={[styles.pill, { backgroundColor: theme.muted }]}
          >
            <Ionicons name="add" size={16} color={theme.foreground} />
            <Text style={[typeScale.caption, { fontWeight: '600', color: theme.foreground }]}>
              Add
            </Text>
          </PressableScale>
        }
      />

      {documents.isPending ? (
        <View
          accessibilityRole="progressbar"
          accessibilityLabel="Loading documents"
          style={styles.list}
        >
          {[0, 1, 2].map((key) => (
            <View key={key} style={[styles.row, { backgroundColor: theme.card }]}>
              <Skeleton width={44} height={44} radius={12} />
              <View style={{ flex: 1, gap: 6 }}>
                <Skeleton width="55%" height={14} />
                <Skeleton width="35%" height={10} />
              </View>
            </View>
          ))}
        </View>
      ) : documents.isError ? (
        <View style={[styles.empty, { backgroundColor: theme.card }]}>
          <Text style={[typeScale.label, { color: theme.foreground }]}>
            Could not load documents
          </Text>
          <PressableScale
            onPress={() => void documents.refetch()}
            accessibilityRole="button"
            accessibilityLabel="Try again"
            style={[styles.pill, { backgroundColor: theme.muted }]}
          >
            <Text style={[typeScale.caption, { fontWeight: '600', color: theme.foreground }]}>
              Try again
            </Text>
          </PressableScale>
        </View>
      ) : (
        <>
          {/* Two across: four tiles read as a set, and three columns made each one a stamp. */}
          <View style={styles.grid}>
            {KEY_DOCUMENTS.map((key, index) => (
              <Rise key={key.type} index={index} style={styles.gridCell}>
                <KeyDocumentTile
                  vehicleId={vehicleId}
                  label={key.label}
                  type={key.type}
                  document={featured.get(key.type)}
                />
              </Rise>
            ))}
          </View>

          {urgent.length + rest.length > 0 ? (
            <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
              <SectionHeading title="Everything else" count={urgent.length + rest.length} />
              <View style={[styles.list, { backgroundColor: theme.border }]}>
                {[...urgent, ...rest].map((document, index) => (
                  <Rise key={document.id} index={index}>
                    <DocumentRow vehicleId={vehicleId} document={document} />
                  </Rise>
                ))}
              </View>
            </View>
          ) : null}
        </>
      )}
    </View>
  );
}

/**
 * One of the four expected papers: what it is, and whether this vehicle has it.
 *
 * On file, the tile is the document and opens it, with the expiry doing the talking. Missing, it
 * is an outline and a plus, and pressing it opens the add screen already set to that kind — so
 * the gap the grid just pointed out is one press from being filled.
 */
function KeyDocumentTile({
  vehicleId,
  label,
  type,
  document,
}: {
  vehicleId: string;
  label: string;
  type: DocumentType;
  document: VehicleDocument | undefined;
}) {
  const theme = useTheme();
  const router = useRouter();
  const state = document ? expiry(document) : null;
  const tone =
    state?.tone === 'destructive'
      ? theme.destructive
      : state?.tone === 'warning'
        ? theme.warning
        : null;

  const open = () => {
    haptic.selection();
    if (document) {
      router.push({
        pathname: '/document/[id]',
        params: { id: document.id, vehicleId, title: document.title },
      });
    } else {
      router.push({ pathname: '/add/document', params: { vehicleId, documentType: type } });
    }
  };

  return (
    <PressableScale
      onPress={open}
      accessibilityRole="button"
      accessibilityLabel={
        document ? `${label}, on file${state ? `, ${state.label}` : ''}` : `${label}, not added`
      }
      accessibilityHint={document ? 'Opens the file' : 'Adds one'}
      scaleTo={0.97}
      style={[
        styles.tile,
        document
          ? { backgroundColor: theme.card }
          : // An outline, so a gap looks like a gap rather than a card that failed to load.
            { borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border },
      ]}
    >
      <View style={styles.tileTop}>
        <View
          style={[styles.tileIcon, { backgroundColor: document ? theme.muted : 'transparent' }]}
        >
          <Ionicons
            name={DOC_ICON[type] ?? 'document-outline'}
            size={18}
            color={document ? theme.foreground : theme.mutedForeground}
          />
        </View>
        {document ? (
          tone ? (
            <View style={[styles.tileDot, { backgroundColor: tone }]} />
          ) : (
            <Ionicons name="checkmark-circle" size={15} color={theme.success} />
          )
        ) : (
          <Ionicons name="add" size={15} color={theme.mutedForeground} />
        )}
      </View>

      <View style={{ gap: 1 }}>
        <Text
          numberOfLines={1}
          style={[
            typeScale.label,
            { fontSize: 13, color: document ? theme.foreground : theme.mutedForeground },
          ]}
        >
          {label}
        </Text>
        <Text
          numberOfLines={1}
          style={[typeScale.caption, { fontSize: 11, color: tone ?? theme.mutedForeground }]}
        >
          {document ? (state?.label ?? 'On file') : 'Not added'}
        </Text>
      </View>
    </PressableScale>
  );
}

function DocumentRow({ vehicleId, document }: { vehicleId: string; document: VehicleDocument }) {
  const theme = useTheme();
  const router = useRouter();
  const state = expiry(document);

  return (
    <PressableScale
      onPress={() => {
        haptic.selection();
        router.push({
          pathname: '/document/[id]',
          params: { id: document.id, vehicleId, title: document.title },
        });
      }}
      accessibilityRole="button"
      accessibilityLabel={`${document.title}, ${humanise(document.documentType)}${
        state ? `, ${state.label}` : ''
      }`}
      accessibilityHint="Opens the file"
      scaleTo={0.99}
      style={[styles.row, { backgroundColor: theme.card }]}
    >
      <View style={[styles.thumb, { backgroundColor: theme.muted }]}>
        <RemoteImage
          uri={document.thumbnailUrl}
          cacheKey={`document:${document.id}`}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={150}
          accessibilityIgnoresInvertColors
          fallback={
            <Ionicons
              name={DOC_ICON[document.documentType] ?? 'document-text-outline'}
              size={20}
              color={theme.foreground}
            />
          }
        />
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <Text numberOfLines={1} style={[typeScale.label, { color: theme.foreground }]}>
          {document.title}
        </Text>
        <Text numberOfLines={1} style={[typeScale.caption, { color: theme.mutedForeground }]}>
          {humanise(document.documentType)} ·{' '}
          <Text style={figure}>{fileSize(document.sizeBytes)}</Text>
        </Text>
        {state ? <ToneChip tone={state.tone} label={state.label} /> : null}
      </View>
      <Ionicons name="chevron-forward" size={16} color={theme.mutedForeground} />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  list: { borderRadius: radius.lg, overflow: 'hidden', gap: StyleSheet.hairlineWidth },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  gridCell: { width: '48%', flexGrow: 1 },
  tile: { minHeight: 84, borderRadius: radius.md, padding: 11, justifyContent: 'space-between' },
  tileTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  tileIcon: {
    width: 30,
    height: 30,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileDot: { width: 9, height: 9, borderRadius: 999 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  thumb: {
    width: 44,
    height: 44,
    borderRadius: 12,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 32,
    borderRadius: 999,
    paddingHorizontal: 12,
  },
  empty: { alignItems: 'center', gap: spacing.sm, borderRadius: radius.lg, padding: spacing.lg },
});
