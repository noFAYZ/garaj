import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Fragment } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';
import type { VehicleDocument } from '@vehicle-os/contracts';
import type { DocumentType } from '@vehicle-os/domain';
import { documentsQuery } from '@vehicle-os/api-client/react';
import { spanOfDays } from '@vehicle-os/ui';
import { RemoteImage } from '@/components/remote-image';
import { api } from '@/lib/api';
import { humanise } from '@/lib/format';
import { SectionHeading } from '@/lib/instrument';
import { haptic, PressableScale, Rise } from '@/lib/motion';
import { countdown, current, urgency, validity, type PaperState } from '@/lib/papers';
import { cardSurface, figure, radius, spacing, typeScale, useTheme, type Theme } from '@/lib/theme';
import { Skeleton } from '@/lib/ui';

/*
 * A vehicle's papers, read the way they are asked for — "is it all in order?" — so the answer comes
 * first: a ring of the four papers that matter and one line on the most pressing of them. Then
 * those four as passes, most pressing first, each with what is left of its term as a figure and a
 * bar that empties as it runs out; a missing one is a dashed slot that adds it. Then everything
 * else, an older renewal marked as replaced rather than overdue.
 */

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

/**
 * The papers a vehicle is expected to have.
 *
 * These four are the ones that are asked for — at a roadside stop, at a sale, at renewal — and
 * the ones that run out. They show whether or not they exist, because the useful answer is as
 * often "there is no insurance on file" as it is the policy itself, and a list of what you happen
 * to have uploaded can never say that.
 */
const KEY_DOCUMENTS: { type: DocumentType; label: string }[] = [
  { type: 'REGISTRATION', label: 'Registration' },
  { type: 'INSURANCE', label: 'Insurance' },
  { type: 'INSPECTION_REPORT', label: 'Inspection' },
  { type: 'WARRANTY', label: 'Warranty' },
];
const KEY_TYPES = new Set(KEY_DOCUMENTS.map((key) => key.type));

const DAY = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const MONTH_YEAR = new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric' });
const dayOf = (iso: string) => DAY.format(new Date(`${iso}T00:00:00`));

/** "expires in 3 days", "expires today", "expired yesterday". */
const ahead = (days: number) =>
  days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${spanOfDays(days)}`;
const behind = (days: number) => (days === -1 ? 'yesterday' : `${spanOfDays(-days)} ago`);

/** A state's colour: run out in red, running out in amber, valid in green; undated is quiet. */
const stateColor = (theme: Theme, state: PaperState) =>
  state === 'expired'
    ? theme.destructive
    : state === 'soon'
      ? theme.warning
      : state === 'valid'
        ? theme.success
        : theme.mutedForeground;

/** What a paper's state says, in a line under its name. */
function stateLine(state: PaperState, expiresOn: string | null): string {
  if (!expiresOn) return 'On file · no expiry date';
  if (state === 'expired') return `Expired ${dayOf(expiresOn)}`;
  if (state === 'soon') return `Renew by ${dayOf(expiresOn)}`;
  return `Valid until ${dayOf(expiresOn)}`;
}

function fileSize(bytes: number): string {
  // From a thousand KB it is a megabyte: "1008 KB" reads worse than "1.0 MB".
  if (bytes < 1000 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** A file's kind as its tile says it when there is no page to show: "PDF", "DOCX". */
const extension = (document: VehicleDocument) =>
  (/\.([a-z0-9]{1,4})$/i.exec(document.filename)?.[1] ?? 'FILE').toUpperCase();

/**
 * The papers that want attention, counted as the page shows them — run out, or running out — and
 * not an older paper of a key kind that a newer one has replaced. The dock's count on Docs.
 */
export function pressingPapers(list: readonly VehicleDocument[]): { expired: number; soon: number } {
  const standing = new Set(
    KEY_DOCUMENTS.map(({ type }) => current(list.filter((item) => item.documentType === type))?.id),
  );
  let expired = 0;
  let soon = 0;
  for (const document of list) {
    if (KEY_TYPES.has(document.documentType) && !standing.has(document.id)) continue;
    const { state } = validity(document);
    if (state === 'expired') expired += 1;
    else if (state === 'soon') soon += 1;
  }
  return { expired, soon };
}

type KeyPaper = {
  type: DocumentType;
  label: string;
  document: VehicleDocument | undefined;
  state: PaperState | null;
  days: number | null;
  left: number | null;
};

export function VehicleDocuments({ vehicleId }: { vehicleId: string }) {
  const theme = useTheme();
  const router = useRouter();
  // ponytail: the first page only (the API's default size); page through when a vehicle outgrows it.
  const documents = useQuery(documentsQuery(api, vehicleId));
  const list = (documents.data?.data ?? []).filter((document) => document.uploadedAt !== null);

  const keys: KeyPaper[] = KEY_DOCUMENTS.map(({ type, label }) => {
    const document = current(list.filter((item) => item.documentType === type));
    const status = document ? validity(document) : null;
    return {
      type,
      label,
      document,
      state: status?.state ?? null,
      days: status?.days ?? null,
      left: status?.left ?? null,
    };
  }).sort((a, b) => urgency(a.state, a.days) - urgency(b.state, b.days));

  // Everything not standing for a key kind, in the server's order — newest first.
  const standing = new Set(keys.map((key) => key.document?.id));
  const others = list.filter((document) => !standing.has(document.id));

  const add = () => router.push({ pathname: '/add/document', params: { vehicleId } });

  return (
    <View style={{ gap: spacing.md }}>
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
        <Placeholder />
      ) : documents.isError ? (
        <View style={[styles.failed, cardSurface(theme)]}>
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
          <Rise>
            <Summary keys={keys} />
          </Rise>

          <View style={{ gap: spacing.sm }}>
            {keys.map((key, index) => (
              <Rise key={key.type} index={index + 1}>
                {key.document && key.state ? (
                  <Pass vehicleId={vehicleId} paper={key} />
                ) : (
                  <Slot vehicleId={vehicleId} type={key.type} label={key.label} />
                )}
              </Rise>
            ))}
          </View>

          {others.length > 0 ? (
            <Rise index={6} style={{ gap: spacing.sm }}>
              <View style={styles.listHead}>
                <Text style={[styles.listTitle, { color: theme.foreground }]}>Other papers</Text>
                <Text style={[figure, styles.listCount, { color: theme.mutedForeground }]}>
                  {others.length}
                </Text>
              </View>
              <View style={[styles.list, cardSurface(theme)]}>
                {others.map((document, place) => (
                  <Fragment key={document.id}>
                    {place > 0 ? (
                      <View style={[styles.rule, { backgroundColor: theme.border }]} />
                    ) : null}
                    <PaperRow
                      vehicleId={vehicleId}
                      document={document}
                      replaced={KEY_TYPES.has(document.documentType)}
                    />
                  </Fragment>
                ))}
              </View>
            </Rise>
          ) : null}
        </>
      )}
    </View>
  );
}

/** The ring's size, and its stroke. */
const RING = 52;
const STROKE = 5;

/**
 * The answer first: a ring of the four papers — one segment each, in the order of the passes below,
 * green on file, amber running out, red run out, grey missing — round how many are on file, and one
 * line on the most pressing of them, then what comes next.
 */
function Summary({ keys }: { keys: KeyPaper[] }) {
  const theme = useTheme();
  const expired = keys.filter((key) => key.state === 'expired');
  const soon = keys.filter((key) => key.state === 'soon');
  const filed = keys.filter((key) => key.document).length;
  const missing = keys.length - filed;
  // The keys arrive most pressing first, so the first of each state is the one to name.
  const next = keys.find((key) => key.state === 'valid');

  const [headline, line] =
    expired.length > 0
      ? [
          expired.length === 1
            ? `${expired[0]!.label} expired ${behind(expired[0]!.days!)}`
            : `${expired.length} papers have expired`,
          soon[0]
            ? `${soon[0].label} runs out ${ahead(soon[0].days!)} too`
            : 'Renew to stay covered',
        ]
      : soon.length > 0
        ? [
            `${soon[0]!.label} expires ${ahead(soon[0]!.days!)}`,
            `Renew by ${dayOf(soon[0]!.document!.expiresOn!)}`,
          ]
        : filed > 0
          ? [
              // In order only when all four are there; a gap is not "in order", just not urgent.
              missing > 0 ? 'Nothing expiring' : 'Papers in order',
              next
                ? `Next renewal · ${next.label}, ${dayOf(next.document!.expiresOn!)}`
                : missing > 0
                  ? // The slots below name them; one line here says how many.
                    missing === 1
                    ? `${keys.find((key) => !key.document)!.label} not on file`
                    : `${missing} of ${keys.length} not on file`
                  : 'No renewal dates on file',
            ]
          : ['No papers on file yet', 'Add the registration and insurance to track renewals'];

  const centre = RING / 2;
  const r = centre - STROKE / 2 - 1;
  const circumference = 2 * Math.PI * r;
  const slot = circumference / keys.length;
  // The round caps reach STROKE/2 past each end; what is left of the slot is the gap.
  const dash = slot - STROKE - 4;

  return (
    <View
      accessible
      accessibilityLabel={`${headline}. ${line}. ${filed} of ${keys.length} key papers on file.`}
      style={[styles.summary, cardSurface(theme)]}
    >
      <View style={styles.ring}>
        <Svg width={RING} height={RING}>
          <G transform={`rotate(-90 ${centre} ${centre})`}>
            {keys.map((key, index) => (
              <Circle
                key={key.type}
                cx={centre}
                cy={centre}
                r={r}
                fill="none"
                stroke={key.state ? stateColor(theme, key.state === 'open' ? 'valid' : key.state) : theme.border}
                strokeWidth={STROKE}
                strokeLinecap="round"
                strokeDasharray={`${dash} ${circumference - dash}`}
                strokeDashoffset={-index * slot}
              />
            ))}
          </G>
        </Svg>
        <View style={styles.ringCentre}>
          <Text style={[figure, styles.ringFigure, { color: theme.foreground }]}>{filed}</Text>
          <Text style={[figure, styles.ringOf, { color: theme.mutedForeground }]}>
            /{keys.length}
          </Text>
        </View>
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <Text numberOfLines={2} style={[styles.headline, { color: theme.foreground }]}>
          {headline}
        </Text>
        <Text numberOfLines={2} style={[typeScale.caption, { color: theme.mutedForeground }]}>
          {line}
        </Text>
      </View>
    </View>
  );
}

/**
 * A key paper on file, as a pass: its name and the policy's, a line on where it stands, and on the
 * right what is left of it — the figure large, its unit small — over a bar that empties as the
 * term runs out, in the state's colour. Undated, a tick says it is on file. Opens the file.
 */
function Pass({ vehicleId, paper }: { vehicleId: string; paper: KeyPaper }) {
  const theme = useTheme();
  const router = useRouter();
  const document = paper.document!;
  const state = paper.state!;
  const color = stateColor(theme, state);
  const count = paper.days === null ? null : countdown(paper.days);
  const past = paper.days !== null && paper.days < 0;
  const named =
    document.title.trim().toLowerCase() !== paper.label.toLowerCase() ? document.title.trim() : null;
  const line = stateLine(state, document.expiresOn);

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
      accessibilityLabel={[
        paper.label,
        named,
        line,
        count ? `${count.value} ${count.unit} ${past ? 'ago' : 'left'}` : null,
      ]
        .filter(Boolean)
        .join(', ')}
      accessibilityHint="Opens the file"
      scaleTo={0.98}
      style={[styles.pass, cardSurface(theme)]}
    >
      <View style={styles.passTop}>
        <Ionicons name={DOC_ICON[paper.type] ?? 'document-outline'} size={22} color={theme.foreground} />
        <View style={styles.passText}>
          <View style={styles.nameLine}>
            <Text numberOfLines={1} style={[styles.passName, { color: theme.foreground }]}>
              {paper.label}
            </Text>
            {named ? (
              <Text
                numberOfLines={1}
                style={[styles.passTitle, { flexShrink: 1, color: theme.mutedForeground }]}
              >
                {named}
              </Text>
            ) : null}
          </View>
          <View style={styles.stateLine}>
            <View style={[styles.stateDot, { backgroundColor: color }]} />
            <Text
              numberOfLines={1}
              style={[
                styles.stateText,
                { color: state === 'expired' || state === 'soon' ? color : theme.mutedForeground },
              ]}
            >
              {line}
            </Text>
          </View>
        </View>
        {count ? (
          <View style={styles.count}>
            <Text
              style={[
                figure,
                styles.countValue,
                { color: state === 'valid' ? theme.foreground : color },
              ]}
            >
              {count.value}
            </Text>
            <Text style={[styles.countUnit, { color: theme.mutedForeground }]}>
              {`${count.unit} ${past ? 'ago' : 'left'}`.toUpperCase()}
            </Text>
          </View>
        ) : (
          <Ionicons name="checkmark-circle" size={20} color={theme.success} />
        )}
      </View>
      {paper.left !== null ? (
        // What is left of the term: it empties as the paper runs out, and is empty once it has.
        <View style={[styles.track, { backgroundColor: `${color}26` }]}>
          <View
            style={[
              styles.fill,
              {
                width: `${state === 'expired' ? 0 : Math.max(paper.left * 100, 3)}%`,
                backgroundColor: color,
              },
            ]}
          />
        </View>
      ) : null}
    </PressableScale>
  );
}

/** A key paper not on file: a dashed slot, one press from the add screen already set to it. */
function Slot({ vehicleId, type, label }: { vehicleId: string; type: DocumentType; label: string }) {
  const theme = useTheme();
  const router = useRouter();
  return (
    <PressableScale
      onPress={() => {
        haptic.selection();
        router.push({ pathname: '/add/document', params: { vehicleId, documentType: type } });
      }}
      accessibilityRole="button"
      accessibilityLabel={`${label}, not on file`}
      accessibilityHint="Adds one"
      scaleTo={0.98}
      style={[styles.slot, { borderColor: theme.borderStrong }]}
    >
      <Ionicons name={DOC_ICON[type] ?? 'document-outline'} size={22} color={theme.mutedForeground} />
      <Text numberOfLines={1} style={[styles.passName, { flex: 1, color: theme.mutedForeground }]}>
        {label}
      </Text>
      <View style={[styles.addKey, { backgroundColor: theme.muted }]}>
        <Ionicons name="add" size={14} color={theme.foreground} />
        <Text style={[styles.addText, { color: theme.foreground }]}>Add</Text>
      </View>
    </PressableScale>
  );
}

/**
 * Any other paper: its page when it is an image, its kind as a file tile when not; the name, then
 * what it is, when, and how big. One that still runs out says so on the right; an older paper of a
 * key kind is marked replaced — its successor is the pass above.
 */
function PaperRow({
  vehicleId,
  document,
  replaced,
}: {
  vehicleId: string;
  document: VehicleDocument;
  replaced: boolean;
}) {
  const theme = useTheme();
  const router = useRouter();
  const status = validity(document);
  const pressing = !replaced && (status.state === 'expired' || status.state === 'soon');
  const when = MONTH_YEAR.format(
    new Date(document.issuedOn ? `${document.issuedOn}T00:00:00` : document.createdAt),
  );
  const facts = [humanise(document.documentType), replaced ? 'Replaced' : when, fileSize(document.sizeBytes)];

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
      accessibilityLabel={[document.title, ...facts, pressing ? stateLine(status.state, document.expiresOn) : null]
        .filter(Boolean)
        .join(', ')}
      accessibilityHint="Opens the file"
      scaleTo={0.99}
      style={styles.paper}
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
            <Text style={[figure, styles.extension, { color: theme.mutedForeground }]}>
              {extension(document)}
            </Text>
          }
        />
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text numberOfLines={1} style={[typeScale.label, { color: theme.foreground }]}>
          {document.title}
        </Text>
        <Text numberOfLines={1} style={[typeScale.caption, { color: theme.mutedForeground }]}>
          {facts.join(' · ')}
        </Text>
      </View>
      {pressing ? (
        <Text style={[styles.rowState, { color: stateColor(theme, status.state) }]}>
          {status.state === 'expired' ? 'Expired' : `${countdown(status.days!).value} ${countdown(status.days!).unit} left`}
        </Text>
      ) : (
        <Ionicons name="chevron-forward" size={16} color={theme.mutedForeground} />
      )}
    </PressableScale>
  );
}

/** The page before the papers arrive: the summary's shape and the passes'. */
function Placeholder() {
  const theme = useTheme();
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel="Loading documents"
      style={{ gap: spacing.sm }}
    >
      <View style={[styles.summary, cardSurface(theme)]}>
        <Skeleton width={RING} height={RING} radius={RING / 2} />
        <View style={{ flex: 1, gap: 8 }}>
          <Skeleton width="60%" height={14} />
          <Skeleton width="40%" height={10} />
        </View>
      </View>
      {[0, 1, 2].map((key) => (
        <View key={key} style={[styles.pass, cardSurface(theme)]}>
          <View style={styles.passTop}>
            <Skeleton width={22} height={22} radius={6} />
            <View style={{ flex: 1, gap: 7 }}>
              <Skeleton width="45%" height={13} />
              <Skeleton width="60%" height={10} />
            </View>
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 32,
    borderRadius: 999,
    paddingHorizontal: 12,
  },
  failed: { alignItems: 'center', gap: spacing.sm, borderRadius: radius.xl, padding: spacing.lg },
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderRadius: radius.xl + 2,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  ring: { width: RING, height: RING, alignItems: 'center', justifyContent: 'center' },
  ringCentre: { position: 'absolute', flexDirection: 'row', alignItems: 'baseline' },
  ringFigure: { fontSize: 15, lineHeight: 18, fontWeight: '700' },
  ringOf: { fontSize: 10, lineHeight: 18, fontWeight: '600' },
  headline: { fontSize: 15, lineHeight: 20, fontWeight: '600', letterSpacing: -0.15 },
  pass: { borderRadius: radius.xl, paddingHorizontal: 14, paddingVertical: 12, gap: 10 },
  passTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  passText: { flex: 1, minWidth: 0, gap: 3 },
  nameLine: { flexDirection: 'row', alignItems: 'baseline', gap: 6, minWidth: 0 },
  passName: { fontSize: 14.5, lineHeight: 19, fontWeight: '600', letterSpacing: -0.1 },
  passTitle: { fontSize: 12, lineHeight: 16, fontWeight: '500' },
  stateLine: { flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 },
  stateDot: { width: 6, height: 6, borderRadius: 3 },
  stateText: { flexShrink: 1, fontSize: 12, lineHeight: 16, fontWeight: '500' },
  count: { alignItems: 'flex-end', minWidth: 54 },
  countValue: { fontSize: 22, lineHeight: 26, fontWeight: '600', letterSpacing: -0.6 },
  countUnit: { fontSize: 8.5, lineHeight: 11, fontWeight: '700', letterSpacing: 0.8 },
  track: { height: 4, borderRadius: 2, overflow: 'hidden', marginLeft: 34 },
  fill: { height: 4, borderRadius: 2 },
  slot: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 52,
    paddingHorizontal: 14,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderStyle: 'dashed',
  },
  addKey: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    height: 28,
    paddingLeft: 8,
    paddingRight: 10,
    borderRadius: 999,
  },
  addText: { fontSize: 12, lineHeight: 16, fontWeight: '600' },
  listHead: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 2 },
  listTitle: { fontSize: 13, lineHeight: 17, fontWeight: '600' },
  listCount: { fontSize: 11, lineHeight: 14, fontWeight: '500' },
  list: { borderRadius: radius.xl },
  rule: { height: StyleSheet.hairlineWidth, marginLeft: 66 },
  paper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 60,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  thumb: {
    width: 40,
    height: 40,
    borderRadius: 10,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  extension: { fontSize: 9, lineHeight: 12, fontWeight: '700', letterSpacing: 0.6 },
  rowState: { fontSize: 11.5, lineHeight: 15, fontWeight: '600' },
});
