import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type {
  PartLine,
  VehicleDocument,
  PartProduct,
  UpdatePart,
  Vehicle,
  VehiclePart,
} from '@vehicle-os/contracts';
import {
  convertDistance,
  currentParts,
  draftAsPart,
  draftFor as domainDraftFor,
  draftFromPart,
  lastFitted,
  PART_GROUPS,
  partAmount as domainAmount,
  partName,
  partPosition,
  partPositionsFor,
  partProductKey,
  partSummary as domainSummary,
  partUnitWord,
  productsFor,
  toPartLine,
  type PartDraft,
  type PartPosition,
  type PartUnit,
  type RecordedPart,
  type VehicleType,
} from '@vehicle-os/domain';
import { documentsQuery, partsQuery, queryKeys } from '@vehicle-os/api-client/react';
import { amountOnly, digitsOnly, localDay, spanOfDays, stampForDay } from '@vehicle-os/ui';
import { newId } from '@vehicle-os/utils';
import { Fact, Rail } from '@/components/add-kit';
import { RemoteImage } from '@/components/remote-image';
import { api } from '@/lib/api';
import { DateField } from '@/lib/date-picker';
import { dialog, FAILED } from '@/lib/dialog';
import { DATE_LOCALE, formatDistance, humanise } from '@/lib/format';
import { Eyebrow, FigureInput, Panel, PanelCell, Segmented } from '@/lib/instrument';
import { usePendingWrites, type PendingWrite, type SentWrite } from '@/lib/offline';
import { PressableScale, Rise } from '@/lib/motion';
import { cardSurface, figure, spacing, typeScale, useTheme, leaf } from '@/lib/theme';
import { Button, Skeleton } from '@/lib/ui';

/*
 * Parts and fluids on the phone (PRD §17): what went into a vehicle, read off its lines. The add
 * form's "What went in", the vehicle's Parts view, an entry's own lines and a reminder's "Last:"
 * are all this file, so a product reads the same wherever it shows.
 */

const DATE = new Intl.DateTimeFormat(DATE_LOCALE, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

export const positionLabel = (position: string) =>
  partPosition(position)?.label ?? humanise(position);
type PartIconName = keyof typeof MaterialCommunityIcons.glyphMap;

/** Each position's own drawing, from the workshop's icon set; anything else is a wrench. */
const PART_ICON: Record<string, PartIconName> = {
  ENGINE_OIL: 'oil',
  OIL_FILTER: 'filter-cog-outline',
  AIR_FILTER: 'air-filter',
  FUEL_FILTER: 'gas-station-outline',
  SPARK_PLUGS: 'flash',
  TIMING_BELT: 'cog-sync',
  COOLANT: 'car-coolant-level',
  GEARBOX_OIL: 'car-shift-pattern',
  CHAIN: 'link-variant',
  SPROCKETS: 'cogs',
  BRAKE_PADS_FRONT: 'car-brake-worn-linings',
  BRAKE_PADS_REAR: 'car-brake-worn-linings',
  BRAKE_DISCS_FRONT: 'car-brake-hold',
  BRAKE_DISCS_REAR: 'car-brake-hold',
  BRAKE_FLUID: 'car-brake-fluid-level',
  TYRES_FRONT: 'tire',
  TYRES_REAR: 'tire',
  BATTERY: 'car-battery',
  WIPER_BLADES: 'wiper',
  CABIN_FILTER: 'air-purifier',
  ANODES: 'anchor',
  IMPELLER: 'fan',
  OTHER: 'wrench',
};

/** The colour a position's group wears: fluids and the engine orange, brakes red, and so on. */
function groupTint(theme: ReturnType<typeof useTheme>, position: string): string | null {
  switch (partPosition(position)?.group) {
    case 'ENGINE':
      return theme.chartRefuel;
    case 'DRIVETRAIN':
    case 'HULL':
      return theme.chartService;
    case 'BRAKES':
      return theme.destructive;
    case 'TYRES':
      return theme.chartTrip;
    case 'ELECTRICAL':
      return theme.warning;
    case 'BODY':
      return theme.chartExpense;
    default:
      return null;
  }
}

/**
 * A position's icon: its drawing in its group's colour, on a tile washed in it — or, `bare`, the
 * drawing alone, for a chip.
 */
export function PartIcon({
  position,
  size = 36,
  bare = false,
}: {
  position: string;
  size?: number;
  bare?: boolean;
}) {
  const theme = useTheme();
  const tint = groupTint(theme, position);
  const drawing = (
    <MaterialCommunityIcons
      name={PART_ICON[position] ?? 'wrench'}
      size={bare ? size : Math.round(size * 0.56)}
      color={tint ?? theme.mutedForeground}
    />
  );
  if (bare) return drawing;
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.36),
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: tint ? `${tint}1F` : theme.muted,
      }}
    >
      {drawing}
    </View>
  );
}

/** "4.2 L", "×4" — the domain's, in this phone's own number format. */
export const partAmount = (quantity: number | null, unit: PartUnit | null) =>
  domainAmount(quantity, unit, DATE_LOCALE);
/** "Castrol Edge 5W-30 · 4.2 L"; a line that named nothing says so. */
export const partSummary = (part: RecordedPart) => domainSummary(part, DATE_LOCALE);

/** A line as the screens read it: the server's, or one still on this phone waiting to be sent. */
export type PartLike = VehiclePart & { readonly local?: true };
export type { PartDraft };

/**
 * The lines of entries still queued on this phone, as the lines they will become — so a service
 * logged at the roadside shows its oil at once, and the next one offers it as "same as last
 * time". One the server has taken stays until this vehicle's parts are read again after it.
 */
function queuedLines(
  writes: readonly (PendingWrite | SentWrite)[],
  vehicleId: string,
  readAt: number,
): PartLike[] {
  return writes.flatMap((write) => {
    if ('sentAt' in write && write.sentAt <= readAt) return [];
    if (
      (write.kind !== 'event' &&
        write.kind !== 'maintenance' &&
        write.kind !== 'maintenance-log') ||
      write.vehicleId !== vehicleId
    ) {
      return [];
    }
    const at = write.kind === 'event' ? write.body.occurredAt : write.body.performedAt;
    return (write.body.parts ?? []).map((line, index): PartLike => ({
      id: line.id ?? `${write.id}:${index}`,
      vehicleId,
      eventId: null,
      position: line.position,
      action: line.action ?? 'REPLACED',
      brand: line.brand ?? null,
      name: line.name ?? null,
      spec: line.spec ?? null,
      partNumber: line.partNumber ?? null,
      quantity: line.quantity ?? null,
      unit: line.quantity == null ? null : (line.unit ?? null),
      cost: null,
      fittedAt: at,
      odometer: write.body.odometer ?? null,
      odometerUnit: write.body.odometerUnit ?? null,
      warrantyUntil: line.warrantyUntil ?? null,
      notes: null,
      createdAt: new Date(write.queuedAt).toISOString(),
      local: true,
    }));
  });
}

/** The server's lines with this phone's queued ones in their places, newest first as the API orders. */
function withQueued(server: readonly VehiclePart[], queued: PartLike[]): readonly PartLike[] {
  const known = new Set(server.map((part) => part.id));
  const fresh = queued.filter((part) => !known.has(part.id));
  if (fresh.length === 0) return server;
  const at = (part: PartLike) => Date.parse(part.fittedAt ?? part.createdAt);
  // `sort` on the copy: Hermes has no `toSorted`.
  return [...fresh, ...server].sort(
    (a, b) => at(b) - at(a) || Date.parse(b.createdAt) - Date.parse(a.createdAt),
  );
}

/** One cached read for every parts screen: the lines, what is fitted now, the garage's products. */
export function useParts(vehicle: Vehicle) {
  const query = useQuery(partsQuery(api, vehicle.id));
  const writes = usePendingWrites();
  const server = query.data?.data;
  const readAt = query.dataUpdatedAt;
  const history = useMemo(
    () => withQueued(server ?? [], queuedLines(writes, vehicle.id, readAt)),
    [server, writes, vehicle.id, readAt],
  );
  const current = useMemo(() => currentParts(history), [history]);
  const positions = useMemo(
    () => partPositionsFor(vehicle.vehicleType as VehicleType, vehicle.specs),
    [vehicle.vehicleType, vehicle.specs],
  );
  return {
    query,
    history,
    current,
    products: query.data?.products ?? [],
    positions,
  };
}

export { lastFitted };

// --- A line being written ----------------------------------------------------

/** The domain's line drafts, shared with the web's add form, given an id here. */
export const draftFor = (position: PartPosition, vehicle: Vehicle, last?: RecordedPart) =>
  domainDraftFor(newId(), position, vehicle, last);
export const toLine = (draft: PartDraft): PartLine => toPartLine(draft);

/**
 * One line's fields, in the form's own panel: the products this garage used here before, as
 * one-tap chips, then brand and product, grade and part number, and how much.
 */
function PartEditor({
  draft,
  products,
  onChange,
}: {
  draft: PartDraft;
  products: readonly PartProduct[];
  onChange: (draft: PartDraft) => void;
}) {
  const spec = partPosition(draft.position)!;
  const offered = productsFor(products, draft.position).slice(0, 8);
  const chosen = partProductKey(draft);
  // Any change by hand is no longer "same as last time", nor the photo's word.
  const set = (patch: Partial<PartDraft>) =>
    onChange({ ...draft, ...patch, same: false, read: false });

  return (
    <View style={{ gap: spacing.sm }}>
      {offered.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.chips}
        >
          {offered.map((product) => (
            <Fact
              key={partProductKey(product)}
              icon="refresh"
              label={partName(product)!}
              selected={partProductKey(product) === chosen}
              onPress={() =>
                set({
                  brand: product.brand ?? '',
                  name: product.name ?? '',
                  spec: product.spec ?? '',
                  partNumber: product.partNumber ?? '',
                  ...(product.quantity !== null
                    ? { quantity: String(product.quantity), unit: product.unit ?? draft.unit }
                    : {}),
                })
              }
            />
          ))}
        </ScrollView>
      ) : null}
      <Panel>
        <View style={styles.pair}>
          <WordCell label="Brand" value={draft.brand} onChange={(brand) => set({ brand })} />
          <WordCell label="Product" value={draft.name} onChange={(name) => set({ name })} />
        </View>
        <View style={styles.pair}>
          <WordCell
            label={spec.liquid ? 'Grade' : 'Size or type'}
            value={draft.spec}
            placeholder={spec.specHint}
            onChange={(value) => set({ spec: value })}
          />
          <WordCell
            label="Part no."
            value={draft.partNumber}
            onChange={(partNumber) => set({ partNumber })}
          />
        </View>
        <View style={styles.pair}>
          <PanelCell label="Quantity">
            <FigureInput
              unit={partUnitWord(draft.unit === 'PIECE' ? null : draft.unit)}
              value={draft.quantity}
              onChangeText={(text) => set({ quantity: amountOnly(text) })}
              placeholder={spec.liquid ? '0.0' : '1'}
              keyboardType="decimal-pad"
              accessibilityLabel={`${spec.label} quantity`}
            />
          </PanelCell>
        </View>
        {/* A row of its own: half a row cut both words short. */}
        {spec.liquid ? (
          <View style={styles.pair}>
            <PanelCell label="This time">
              <Segmented
                small
                value={draft.action}
                options={[
                  { value: 'REPLACED', label: 'Changed' },
                  { value: 'TOPPED_UP', label: 'Topped up' },
                ]}
                onChange={(action) => set({ action })}
              />
            </PanelCell>
          </View>
        ) : (
          // A part carries cover — a battery's years, a tyre's road hazard — a fluid does not.
          <View style={styles.pair}>
            <PanelCell label="Warranty until" note="Reminded before it ends">
              <DateField
                value={draft.warrantyUntil}
                onChange={(warrantyUntil) => set({ warrantyUntil })}
                label="Warranty until"
                placeholder="None"
              />
            </PanelCell>
          </View>
        )}
      </Panel>
    </View>
  );
}

function WordCell({
  label,
  value,
  placeholder = '—',
  onChange,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  const theme = useTheme();
  return (
    <PanelCell label={label}>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={theme.placeholder}
        accessibilityLabel={label}
        maxLength={label === 'Product' ? 120 : 80}
        autoCapitalize="words"
        style={[typeScale.headline, styles.word, { color: theme.foreground }]}
      />
    </PanelCell>
  );
}

/** A line as one row: its position's glyph and name, what went in, and how to change or drop it. */
function LineRow({
  draft,
  open,
  onToggle,
  onRemove,
}: {
  draft: PartDraft;
  open: boolean;
  onToggle: () => void;
  onRemove: () => void;
}) {
  const theme = useTheme();
  const label = positionLabel(draft.position);
  const summary = partSummary(draftAsPart(draft));
  return (
    <PressableScale
      onPress={() => {
        onToggle();
      }}
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      accessibilityLabel={`${label}: ${summary}${draft.same ? ', same as last time' : draft.read ? ', read from the photo' : ''}`}
      accessibilityHint={open ? 'Closes it' : 'Opens it to change'}
      scaleTo={0.99}
      style={styles.line}
    >
      <PartIcon position={draft.position} size={32} />
      <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
        <View style={styles.lineHead}>
          <Text numberOfLines={1} style={[styles.lineLabel, { color: theme.foreground }]}>
            {label}
          </Text>
          {draft.same ? (
            <View style={[styles.same, { backgroundColor: theme.successSoft }]}>
              <Ionicons name="refresh" size={10} color={theme.success} />
              <Text style={[styles.sameText, { color: theme.success }]}>Same as last time</Text>
            </View>
          ) : draft.read ? (
            <View style={[styles.same, { backgroundColor: theme.primarySoft }]}>
              <Ionicons name="sparkles" size={10} color={theme.primary} />
              <Text style={[styles.sameText, { color: theme.primary }]}>From the photo</Text>
            </View>
          ) : draft.action === 'TOPPED_UP' ? (
            <View style={[styles.same, { backgroundColor: theme.muted }]}>
              <Text style={[styles.sameText, { color: theme.mutedForeground }]}>Top-up</Text>
            </View>
          ) : null}
        </View>
        <Text numberOfLines={1} style={[typeScale.caption, { color: theme.mutedForeground }]}>
          {summary}
        </Text>
      </View>
      <Ionicons
        name={open ? 'chevron-up' : 'chevron-down'}
        size={16}
        color={theme.mutedForeground}
      />
      <PressableScale
        onPress={() => {
          onRemove();
        }}
        accessibilityRole="button"
        accessibilityLabel={`Leave out ${label}`}
        hitSlop={8}
        scaleTo={0.85}
        style={styles.remove}
      >
        <Ionicons name="close" size={15} color={theme.mutedForeground} />
      </PressableScale>
    </PressableScale>
  );
}

/**
 * The add form's "What went in": the lines on a card, one open at a time to change, and a rail of
 * the vehicle's positions to add another. Completing a reminder arrives with its lines already
 * here, each the product fitted last time — so a routine oil service is saved as it was before.
 */
export function PartLinesField({
  vehicle,
  lines,
  onChange,
}: {
  vehicle: Vehicle;
  lines: readonly PartDraft[];
  onChange: (lines: PartDraft[]) => void;
}) {
  const theme = useTheme();
  const { current, products, positions } = useParts(vehicle);
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const taken = new Set(lines.map((line) => line.position));
  const left = positions.filter((position) => position === 'OTHER' || !taken.has(position));

  const add = (position: PartPosition) => {
    const draft = draftFor(position, vehicle, current.get(position));
    onChange([...lines, draft]);
    setAdding(false);
    // A line with nothing in it yet opens to be filled; one filled from last time stays shut.
    setOpen(draft.same ? null : draft.id);
  };

  return (
    <View style={{ gap: spacing.sm }}>
      <Eyebrow>What went in</Eyebrow>
      {lines.length > 0 ? (
        <View style={[styles.card, cardSurface(theme)]}>
          {lines.map((draft, place) => (
            <Fragment key={draft.id}>
              {place > 0 ? <View style={[styles.rule, { backgroundColor: theme.border }]} /> : null}
              <LineRow
                draft={draft}
                open={open === draft.id}
                onToggle={() => setOpen(open === draft.id ? null : draft.id)}
                onRemove={() => onChange(lines.filter((line) => line.id !== draft.id))}
              />
              {open === draft.id ? (
                <View style={styles.editor}>
                  <PartEditor
                    draft={draft}
                    products={products}
                    onChange={(next) =>
                      onChange(lines.map((line) => (line.id === next.id ? next : line)))
                    }
                  />
                </View>
              ) : null}
            </Fragment>
          ))}
        </View>
      ) : null}
      {adding ? (
        <Rail
          inset={spacing.lg}
          items={left.map((position) => ({
            key: position,
            label: positionLabel(position),
            glyph: <PartIcon position={position} size={17} bare />,
            selected: false,
            onPress: () => add(position),
          }))}
        />
      ) : (
        <View style={styles.wrap}>
          <Fact
            icon="add"
            label={lines.length ? 'Another part or fluid' : 'Add a part or fluid'}
            onPress={() => setAdding(true)}
          />
        </View>
      )}
    </View>
  );
}

// --- The vehicle's parts -----------------------------------------------------

/** How far the vehicle has gone on a line, and how long it has been in: the wear that matters. */
function wear(
  part: VehiclePart,
  vehicle: Vehicle,
): { driven: string | null; age: string | null; since: string | null } {
  if (!part.fittedAt) return { driven: null, age: null, since: null };
  let driven: string | null = null;
  if (part.odometer !== null && part.odometerUnit && vehicle.currentOdometer !== null) {
    const at = convertDistance(part.odometer, part.odometerUnit, vehicle.odometerUnit);
    const gone = Math.round(vehicle.currentOdometer - at);
    if (gone > 0) driven = formatDistance(gone, vehicle.odometerUnit);
  }
  const days = Math.floor((Date.now() - Date.parse(part.fittedAt)) / 86_400_000);
  return {
    driven,
    age: days >= 1 ? spanOfDays(days) : 'Today',
    since: DATE.format(new Date(part.fittedAt)),
  };
}

/** "Warranty until 3 Mar 2028", or that it has ended; nothing without one. */
function warrantyText(
  until: string | null,
): { text: string; ended: boolean; soon: boolean } | null {
  if (!until) return null;
  const end = new Date(`${until}T00:00:00`);
  const days = Math.round((end.getTime() - Date.now()) / 86_400_000);
  return days < 0
    ? { text: `Warranty ended ${DATE.format(end)}`, ended: true, soon: false }
    : { text: `Warranty until ${DATE.format(end)}`, ended: false, soon: days <= 60 };
}

/** The add screen, for a position (a new line there) or a line (to correct it). */
export const partRoute = (vehicleId: string, to: { position?: string; partId?: string } = {}) => ({
  pathname: '/add/part' as const,
  params: { vehicleId, ...to },
});

/**
 * What a line can have done to it: corrected on the add screen, or removed — a mistake typed in,
 * never the entry it came with. A line still on this phone has nothing on the server to change.
 */
function useLineActions(vehicleId: string) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const removal = useMutation({
    mutationFn: (partId: string) => api.parts.remove(vehicleId, partId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.parts(vehicleId) });
    },
    onError: (error) => dialog('Could not remove it', (error as Error).message, undefined, FAILED),
  });
  const waiting = (part: PartLike) => {
    if (!part.local) return false;
    dialog('Waiting to sync', 'It can be changed once it has been sent.', undefined, {
      icon: 'cloud-upload-outline',
    });
    return true;
  };
  const edit = (part: PartLike) => {
    if (!waiting(part)) router.push(partRoute(vehicleId, { partId: part.id }));
  };
  // Its receipt, its warranty card, a photo of the box: the add-document screen, filed against it.
  const attach = (part: PartLike) => {
    if (waiting(part)) return;
    router.push({
      pathname: '/add/document',
      params: {
        vehicleId,
        partId: part.id,
        documentType: part.warrantyUntil ? 'WARRANTY' : 'RECEIPT',
        title: `${positionLabel(part.position)} · ${partName(part) ?? 'receipt'}`,
      },
    });
  };
  const open = (paper: VehicleDocument) =>
    router.push({
      pathname: '/document/[id]',
      params: { id: paper.id, vehicleId, title: paper.title },
    });
  const remove = (part: PartLike) => {
    if (waiting(part)) return;
    dialog(
      `Remove ${positionLabel(part.position).toLowerCase()}?`,
      `${partSummary(part)} leaves the history. The entry it came with stays.`,
      [
        { text: 'Keep it', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => removal.mutate(part.id) },
      ],
    );
  };
  // Held: the same two, asked.
  const hold = (part: PartLike) => {
    if (waiting(part)) return;
    dialog(positionLabel(part.position), partSummary(part), [
      { text: 'Edit', onPress: () => edit(part) },
      { text: 'Remove', style: 'destructive', onPress: () => remove(part) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };
  return { edit, remove, hold, attach, open };
}

/**
 * A position with something fitted: its glyph, its name over what is there, since when and its
 * cover; flush right, how far it has gone and how long it has been in, in the ledger's mono.
 * Pressed, it opens every line it has had, newest first, and what can be done: fit a new one,
 * correct this one, or remove it.
 */
function FittedRow({
  part,
  history,
  vehicle,
  open,
  onToggle,
  actions,
  onReplace,
  papers,
}: {
  part: PartLike;
  history: readonly PartLike[];
  vehicle: Vehicle;
  open: boolean;
  onToggle: () => void;
  actions: ReturnType<typeof useLineActions>;
  onReplace: () => void;
  /** What is filed against this line: its receipt, its warranty card, photos. */
  papers: readonly VehicleDocument[];
}) {
  const theme = useTheme();
  const label = positionLabel(part.position);
  const earlier = history.length - 1;
  const warranty = warrantyText(part.warrantyUntil);
  const { driven, age, since } = wear(part, vehicle);
  return (
    <View>
      <PressableScale
        onPress={() => {
          onToggle();
        }}
        onLongPress={() => actions.hold(part)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={[
          `${label}: ${partSummary(part)}`,
          since ? `fitted ${since}` : 'date not recorded',
          driven ? `${driven} since` : null,
          warranty?.text,
          earlier > 0 ? `${earlier} earlier` : null,
          papers.length > 0
            ? `${papers.length} ${papers.length === 1 ? 'attachment' : 'attachments'}`
            : null,
          part.local ? 'waiting to sync' : null,
        ]
          .filter(Boolean)
          .join(', ')}
        accessibilityHint="Shows its history and what can be done."
        scaleTo={0.99}
        style={styles.line}
      >
        <PartIcon position={part.position} size={40} />
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text numberOfLines={1} style={[styles.rowTitle, { color: theme.foreground }]}>
            {label}
          </Text>
          <Text numberOfLines={1} style={[styles.rowProduct, { color: theme.mutedForeground }]}>
            {partSummary(part)}
            {part.action === 'TOPPED_UP' ? ' · top-up' : ''}
          </Text>
          {part.local || (warranty && !warranty.ended) || papers.length > 0 ? (
            <View style={styles.flags}>
              {papers.length > 0 ? (
                <View style={styles.flag}>
                  <Ionicons name="attach" size={13} color={theme.mutedForeground} />
                  <Text style={[typeScale.caption, { color: theme.mutedForeground }]}>
                    {papers.length}
                  </Text>
                </View>
              ) : null}
              {part.local ? (
                <View style={styles.flag}>
                  <Ionicons name="cloud-upload-outline" size={12} color={theme.warning} />
                  <Text style={[typeScale.caption, { color: theme.warning }]}>Waiting to sync</Text>
                </View>
              ) : null}
              {warranty && !warranty.ended ? (
                <View style={styles.flag}>
                  <Ionicons
                    name="shield-checkmark"
                    size={11}
                    color={warranty.soon ? theme.warning : theme.success}
                  />
                  <Text
                    numberOfLines={1}
                    style={[
                      typeScale.caption,
                      { color: warranty.soon ? theme.warning : theme.mutedForeground },
                    ]}
                  >
                    {warranty.soon ? warranty.text : 'Under warranty'}
                  </Text>
                </View>
              ) : null}
            </View>
          ) : null}
        </View>
        {/* The wear, flush right: how far on it, over how long. */}
        <View style={styles.wear}>
          <Text style={[figure, styles.wearFigure, { color: theme.foreground }]}>
            {driven ?? age ?? '—'}
          </Text>
          <Text style={[figure, styles.wearAge, { color: theme.mutedForeground }]}>
            {driven ? age : since ? since : 'no date'}
          </Text>
        </View>
        <Ionicons
          name={open ? 'chevron-up' : 'chevron-down'}
          size={15}
          color={theme.mutedForeground}
        />
      </PressableScale>
      {open ? (
        <View style={styles.history}>
          {history.map((line) => (
            <PressableScale
              key={line.id}
              onLongPress={() => actions.hold(line)}
              accessibilityRole="text"
              accessibilityLabel={`${line.fittedAt ? DATE.format(new Date(line.fittedAt)) : 'Date not recorded'}, ${partSummary(line)}${line.action === 'TOPPED_UP' ? ', top-up' : ''}`}
              accessibilityHint="Hold to edit or remove."
              scaleTo={0.99}
              style={styles.past}
            >
              <View
                style={[
                  styles.pastDot,
                  { backgroundColor: line.id === part.id ? theme.primary : theme.borderStrong },
                ]}
              />
              <Text style={[figure, styles.pastDate, { color: theme.mutedForeground }]}>
                {line.fittedAt ? DATE.format(new Date(line.fittedAt)) : '—'}
              </Text>
              <Text
                numberOfLines={1}
                style={[typeScale.caption, { flex: 1, color: theme.foreground }]}
              >
                {partSummary(line)}
                {line.action === 'TOPPED_UP' ? '  · top-up' : ''}
              </Text>
            </PressableScale>
          ))}
          {papers.length > 0 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.papers}
            >
              {papers.map((paper) => (
                <PressableScale
                  key={paper.id}
                  onPress={() => {
                    actions.open(paper);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${paper.title}`}
                  scaleTo={0.94}
                  style={[
                    styles.paper,
                    { backgroundColor: theme.muted, borderColor: theme.border },
                  ]}
                >
                  <RemoteImage
                    uri={paper.thumbnailUrl}
                    cacheKey={`document:${paper.id}`}
                    style={StyleSheet.absoluteFill}
                    contentFit="cover"
                    accessibilityIgnoresInvertColors
                    fallback={
                      <Ionicons
                        name={
                          paper.mimeType === 'application/pdf'
                            ? 'document-text-outline'
                            : 'document-outline'
                        }
                        size={20}
                        color={theme.mutedForeground}
                      />
                    }
                  />
                </PressableScale>
              ))}
            </ScrollView>
          ) : null}
          <View style={styles.actions}>
            <Button size="xs" icon="add" label="Fit new" onPress={onReplace} />
            <Button size="xs" icon="attach" label="Attach" onPress={() => actions.attach(part)} />
            <Button
              size="xs"
              icon="create-outline"
              label="Edit"
              onPress={() => actions.edit(part)}
            />
            <Button
              size="xs"
              variant="ghost"
              icon="trash-outline"
              label="Remove"
              onPress={() => actions.remove(part)}
            />
          </View>
        </View>
      ) : null}
    </View>
  );
}

/** The local calendar day of an instant: what the date field shows for it. */
const dayOf = (iso: string) => {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

/**
 * Recording what is fitted now without an entry — or correcting a line already recorded. The
 * line's fields and, for a line of its own, when it went in and at what reading; a line on an
 * entry keeps the entry's. Sent at once, not queued: a record of the past, typed at leisure.
 */
export function PartForm({
  vehicle,
  position,
  part,
  last,
  products,
  onDone,
  onCancel = onDone,
}: {
  vehicle: Vehicle;
  position: PartPosition;
  /** The line being corrected; none to record a new one. */
  part?: PartLike;
  /** What is fitted there now, for a new line: offered as "same as last time". */
  last?: RecordedPart;
  products: readonly PartProduct[];
  /** Saved. */
  onDone: () => void;
  /** The ×: by default the same as done. */
  onCancel?: () => void;
}) {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(() =>
    part ? draftFromPart(part) : draftFor(position, vehicle, last),
  );
  const onEntry = Boolean(part?.eventId);
  const [day, setDay] = useState(() => (part?.fittedAt && !onEntry ? dayOf(part.fittedAt) : ''));
  const [odometer, setOdometer] = useState(() =>
    part?.odometer != null && !onEntry ? String(part.odometer) : '',
  );
  const unit = vehicle.odometerUnit === 'MI' ? 'mi' : 'km';

  const save = useMutation({
    mutationFn: async () => {
      const { id: _id, position: _position, ...line } = toLine(draft);
      const dated = onEntry
        ? {}
        : {
            ...(day ? { fittedAt: stampForDay(day) } : {}),
            ...(odometer ? { odometer: Number(odometer), odometerUnit: vehicle.odometerUnit } : {}),
          };
      if (!part) {
        await api.parts.record(vehicle.id, { parts: [{ ...toLine(draft), ...dated }] });
        return;
      }
      // The whole line as it should read: what this form does not show — its cost, its note —
      // goes back as it was, not cleared.
      const body: UpdatePart = {
        ...line,
        ...dated,
        ...(part.cost
          ? { costAmountMinor: part.cost.amountMinor, costCurrency: part.cost.currency }
          : {}),
        ...(part.notes ? { notes: part.notes } : {}),
      };
      await api.parts.update(vehicle.id, part.id, body);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.parts(vehicle.id) });
      onDone();
    },
  });

  return (
    <Rise style={[styles.card, styles.recording, cardSurface(theme)]}>
      <View style={styles.lineHead}>
        <PartIcon position={position} size={32} />
        <Text style={[typeScale.headline, { flex: 1, color: theme.foreground }]}>
          {positionLabel(position)}
        </Text>
        <PressableScale
          onPress={onCancel}
          accessibilityRole="button"
          accessibilityLabel="Cancel"
          hitSlop={8}
          scaleTo={0.85}
        >
          <Ionicons name="close" size={18} color={theme.mutedForeground} />
        </PressableScale>
      </View>
      <PartEditor draft={draft} products={products} onChange={setDraft} />
      {onEntry ? (
        <Text style={[typeScale.caption, { color: theme.mutedForeground }]}>
          Fitted with its entry on {DATE.format(new Date(part!.fittedAt!))} — the entry’s date is
          the line’s.
        </Text>
      ) : (
        <Panel>
          <View style={styles.pair}>
            <PanelCell label="Fitted" note="If you know">
              <DateField
                value={day}
                onChange={setDay}
                max={localDay()}
                label="Fitted"
                placeholder="Not sure"
              />
            </PanelCell>
            <PanelCell label="At" note="Optional">
              <FigureInput
                unit={unit}
                value={odometer ? Number(odometer).toLocaleString() : ''}
                onChangeText={(text) => setOdometer(digitsOnly(text, 9))}
                placeholder="0"
                keyboardType="number-pad"
                accessibilityLabel={`Odometer when fitted, in ${unit}`}
              />
            </PanelCell>
          </View>
        </Panel>
      )}
      {save.isError ? (
        <Text accessibilityRole="alert" style={[typeScale.caption, { color: theme.destructive }]}>
          {(save.error as Error).message}
        </Text>
      ) : null}
      <Button
        label={part ? 'Save the change' : 'Save what’s fitted'}
        icon="checkmark"
        variant="primary"
        loading={save.isPending}
        onPress={() => save.mutate()}
      />
    </Rise>
  );
}

const GROUP_LABEL: Record<(typeof PART_GROUPS)[number], string> = {
  ENGINE: 'Engine',
  DRIVETRAIN: 'Drivetrain',
  BRAKES: 'Brakes',
  TYRES: 'Tyres',
  ELECTRICAL: 'Electrical',
  BODY: 'Body',
  HULL: 'Hull',
  OTHER: 'Other parts',
};

const NO_PAPERS: readonly VehicleDocument[] = [];

/** Tiles to a row in the position grid. */
const GRID = 3;
const GRID_GAP = 8;

/**
 * Positions as a grid of tiles, grouped as a workshop would — engine, brakes, tyres — each its
 * glyph over its name; one already fitted wears a green dot. A press picks it.
 */
export function PositionGrid({
  positions,
  current,
  onPick,
}: {
  positions: readonly PartPosition[];
  /** What is fitted where, to mark those tiles. */
  current?: ReadonlyMap<string, PartLike>;
  onPick: (position: PartPosition) => void;
}) {
  const theme = useTheme();
  const [width, setWidth] = useState(0);
  const tile = width > 0 ? (width - GRID_GAP * (GRID - 1)) / GRID : 0;
  const groups = PART_GROUPS.map((group) => ({
    group,
    positions: positions.filter((position) => (partPosition(position)?.group ?? 'OTHER') === group),
  })).filter((entry) => entry.positions.length > 0);
  return (
    <View
      style={{ gap: spacing.md }}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
    >
      {tile > 0
        ? groups.map(({ group, positions: inGroup }) => (
            <View key={group} style={{ gap: spacing.sm }}>
              <Eyebrow>{GROUP_LABEL[group]}</Eyebrow>
              <View style={styles.grid}>
                {inGroup.map((position) => {
                  const fitted = current?.get(position);
                  return (
                    <PressableScale
                      key={position}
                      onPress={() => {
                        onPick(position);
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={`${positionLabel(position)}${fitted ? `, fitted: ${partSummary(fitted)}` : ''}`}
                      scaleTo={0.95}
                      style={[styles.tile, { width: tile, backgroundColor: theme.muted }]}
                    >
                      <PartIcon position={position} size={40} />
                      <Text
                        numberOfLines={2}
                        style={[styles.tileLabel, { color: theme.foreground }]}
                      >
                        {positionLabel(position)}
                      </Text>
                      {fitted ? (
                        <View style={[styles.tileDot, { backgroundColor: theme.success }]} />
                      ) : null}
                    </PressableScale>
                  );
                })}
              </View>
            </View>
          ))
        : null}
    </View>
  );
}

/**
 * The vehicle's parts: what is fitted at each position, grouped as a workshop would, each with its
 * history and its actions a tap away; then the positions with nothing recorded and Other, a tile
 * each, one tap to record what is there now.
 */
export function VehicleParts({ vehicle }: { vehicle: Vehicle }) {
  const theme = useTheme();
  const router = useRouter();
  const { query, history, current, positions } = useParts(vehicle);
  const [open, setOpen] = useState<string | null>(null);
  const actions = useLineActions(vehicle.id);
  // The Docs tab's own read, so this is the cache, not another request.
  // ponytail: the first page only (25), as the logbook's thumbnails; a partId filter if garages file more.
  const documents = useQuery(documentsQuery(api, vehicle.id));
  const papersByPart = useMemo(() => {
    const byPart = new Map<string, VehicleDocument[]>();
    for (const paper of documents.data?.data ?? []) {
      if (paper.partId && paper.uploadedAt) {
        byPart.set(paper.partId, [...(byPart.get(paper.partId) ?? []), paper]);
      }
    }
    return byPart;
  }, [documents.data]);
  const add = (position?: string) => {
    router.push(partRoute(vehicle.id, position ? { position } : {}));
  };

  if (query.isPending) {
    return (
      <View accessibilityRole="progressbar" accessibilityLabel="Loading parts" style={{ gap: 8 }}>
        {[0, 1].map((index) => (
          <Skeleton key={index} width="100%" height={72} radius={16} />
        ))}
      </View>
    );
  }
  if (query.isError && !query.data) {
    return (
      <View style={[styles.card, styles.empty, cardSurface(theme)]}>
        <Text style={[typeScale.caption, { color: theme.mutedForeground, textAlign: 'center' }]}>
          {(query.error as Error).message}
        </Text>
        <Button label="Try again" onPress={() => void query.refetch()} />
      </View>
    );
  }

  const others = history.filter((part) => part.position === 'OTHER');
  const groups = PART_GROUPS.map((group) => ({
    group,
    positions: [...current.keys()].filter(
      (position) => position !== 'OTHER' && (partPosition(position)?.group ?? 'OTHER') === group,
    ),
  })).filter((entry) => entry.positions.length > 0);
  const unrecorded = positions.filter((position) => position !== 'OTHER' && !current.has(position));
  const fitted = [
    ...groups.flatMap((entry) => entry.positions.map((position) => current.get(position)!)),
    ...others,
  ];

  const row = (part: PartLike, lines: readonly PartLike[]) => (
    <FittedRow
      part={part}
      history={lines}
      vehicle={vehicle}
      open={open === part.id}
      onToggle={() => setOpen(open === part.id ? null : part.id)}
      actions={actions}
      onReplace={() => add(part.position)}
      papers={papersByPart.get(part.id) ?? NO_PAPERS}
    />
  );

  return (
    <View style={{ gap: spacing.lg }}>
      {fitted.length === 0 ? (
        <View style={[styles.card, styles.empty, cardSurface(theme)]}>
          <Ionicons name="construct-outline" size={26} color={theme.mutedForeground} />
          <Text style={[typeScale.headline, { color: theme.foreground }]}>
            What’s in it, and since when
          </Text>
          <Text style={[typeScale.label, styles.emptyText, { color: theme.mutedForeground }]}>
            Record the oil, tyres and battery fitted now. Every service you log fills it in, and
            next time is one tap: same as last time.
          </Text>
        </View>
      ) : null}

      {groups.map(({ group, positions: inGroup }, index) => (
        <Rise key={group} index={index + 1} style={{ gap: spacing.sm }}>
          <Eyebrow>{GROUP_LABEL[group]}</Eyebrow>
          <View style={[styles.card, cardSurface(theme)]}>
            {inGroup.map((position, place) => (
              <Fragment key={position}>
                {place > 0 ? (
                  <View style={[styles.rule, { backgroundColor: theme.border }]} />
                ) : null}
                {row(
                  current.get(position)!,
                  history.filter((part) => part.position === position),
                )}
              </Fragment>
            ))}
          </View>
        </Rise>
      ))}

      {others.length > 0 ? (
        <View style={{ gap: spacing.sm }}>
          <Eyebrow>{GROUP_LABEL.OTHER}</Eyebrow>
          <View style={[styles.card, cardSurface(theme)]}>
            {others.map((part, place) => (
              <Fragment key={part.id}>
                {place > 0 ? (
                  <View style={[styles.rule, { backgroundColor: theme.border }]} />
                ) : null}
                {row(part, [part])}
              </Fragment>
            ))}
          </View>
        </View>
      ) : null}

      {/* What is not recorded yet, a tile each — and Other, for anything the list does not name. */}
      <View style={{ gap: spacing.sm }}>
        <Text style={[typeScale.headline, { color: theme.foreground }]}>
          {unrecorded.length > 0 ? 'Not recorded yet' : 'Add a part'}
        </Text>
        <PositionGrid
          positions={[...unrecorded, ...(positions.includes('OTHER') ? (['OTHER'] as const) : [])]}
          onPick={(position) => add(position)}
        />
      </View>
    </View>
  );
}

/** How many of an entry's lines its timeline row shows before "+N". */
const CHIPS = 3;

/**
 * An entry's lines on its timeline row: one small chip each — the position's glyph, its name and
 * what went in ("Engine oil 4.2 L") — the first few, then how many more. The product is on the
 * entry's own screen.
 */
export function PartChips({ lines }: { lines: readonly PartLike[] }) {
  const theme = useTheme();
  const more = lines.length - CHIPS;
  return (
    <View style={styles.partChips}>
      {lines.slice(0, CHIPS).map((part) => {
        const amount = [
          part.action === 'TOPPED_UP' ? 'top-up' : null,
          partAmount(part.quantity, part.unit),
        ]
          .filter(Boolean)
          .join(' ');
        return (
          <View key={part.id} style={[styles.partChip, { backgroundColor: theme.muted }]}>
            <PartIcon position={part.position} size={12} bare />
            <Text numberOfLines={1} style={[styles.chipLabel, { color: theme.foreground }]}>
              {positionLabel(part.position)}
            </Text>
            {amount ? (
              <Text style={[figure, styles.chipAmount, { color: theme.mutedForeground }]}>
                {amount}
              </Text>
            ) : null}
          </View>
        );
      })}
      {more > 0 ? (
        <View style={[styles.partChip, { backgroundColor: theme.muted }]}>
          <Text style={[figure, styles.chipAmount, { color: theme.mutedForeground }]}>+{more}</Text>
        </View>
      ) : null}
    </View>
  );
}

/** An entry's own lines, for its screen: what went in with it. Nothing when it has none. */
export function EntryParts({
  vehicleId,
  eventId,
  label,
  index = 0,
}: {
  vehicleId: string;
  eventId: string;
  /** The heading over the card, drawn by the screen in its own style. */
  label: ReactNode;
  /** Its place in the screen's entrance. */
  index?: number;
}) {
  const theme = useTheme();
  const parts = useQuery(partsQuery(api, vehicleId));
  const lines = (parts.data?.data ?? []).filter((part) => part.eventId === eventId);
  if (lines.length === 0) return null;
  return (
    <Rise index={index} style={[styles.card, styles.entry, cardSurface(theme)]}>
      {label}
      {lines.map((part) => (
        <View
          key={part.id}
          accessible
          accessibilityLabel={`${positionLabel(part.position)}: ${partSummary(part)}`}
          style={styles.entryLine}
        >
          <PartIcon position={part.position} size={30} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={[styles.lineLabel, { color: theme.mutedForeground }]}>
              {positionLabel(part.position)}
              {part.action === 'TOPPED_UP' ? ' · top-up' : ''}
            </Text>
            <Text numberOfLines={1} style={[styles.product, { color: theme.foreground }]}>
              {partSummary(part)}
            </Text>
          </View>
        </View>
      ))}
    </Rise>
  );
}

const styles = StyleSheet.create({
  card: { ...leaf('md'), overflow: 'hidden' },
  rule: { height: StyleSheet.hairlineWidth, marginLeft: 14 + 36 + spacing.md },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 60,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  lineHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  lineLabel: { flexShrink: 1, fontSize: 12, lineHeight: 16, fontWeight: '600' },
  product: { fontSize: 15, lineHeight: 20, fontWeight: '600', letterSpacing: -0.2 },
  same: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    height: 17,
    paddingHorizontal: 6,
    borderRadius: 999,
  },
  sameText: { fontSize: 10, lineHeight: 13, fontWeight: '700' },
  remove: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  editor: { paddingHorizontal: 14, paddingBottom: 14 },
  chips: { gap: 6 },
  pair: { flexDirection: 'row', gap: StyleSheet.hairlineWidth },
  word: { paddingVertical: 2 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  count: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    height: 20,
    paddingHorizontal: 7,
    borderRadius: 999,
  },
  countText: { fontSize: 11, lineHeight: 14, fontWeight: '600' },
  history: { paddingHorizontal: 14, paddingBottom: 12, paddingLeft: 14 + 36 + spacing.md, gap: 2 },
  past: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 28 },
  pastDot: { width: 6, height: 6, borderRadius: 3 },
  flags: { flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing.md, marginTop: 2 },
  flag: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  pastDate: { width: 84, fontSize: 11, lineHeight: 16 },
  papers: { gap: 6, paddingTop: 8 },
  paper: {
    width: 48,
    height: 48,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowTitle: { fontSize: 14.5, lineHeight: 19, fontWeight: '600', letterSpacing: -0.2 },
  rowProduct: { fontSize: 12.5, lineHeight: 16, fontWeight: '500' },
  wear: { alignItems: 'flex-end', gap: 1, flexShrink: 0 },
  wearFigure: { fontSize: 13, lineHeight: 17, fontWeight: '600', letterSpacing: -0.3 },
  wearAge: { fontSize: 10.5, lineHeight: 14, fontWeight: '500' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingTop: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GRID_GAP },
  tile: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 78,
    paddingHorizontal: 6,
    paddingVertical: 10,
    ...leaf('sm'),
  },
  tileLabel: { fontSize: 11.5, lineHeight: 14, fontWeight: '600', textAlign: 'center' },
  tileDot: { position: 'absolute', top: 8, right: 8, width: 6, height: 6, borderRadius: 3 },
  recording: { padding: 14, gap: spacing.md, overflow: 'visible' },
  empty: { alignItems: 'center', gap: spacing.sm, padding: spacing.xl },
  emptyText: { fontWeight: '400', textAlign: 'center' },
  entry: { padding: 14, gap: 10 },
  entryLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  partChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  partChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 20,
    paddingHorizontal: 6,
    borderRadius: 6,
    maxWidth: '100%',
  },
  chipLabel: { flexShrink: 1, fontSize: 11, lineHeight: 14, fontWeight: '600' },
  chipAmount: { fontSize: 10.5, lineHeight: 14, fontWeight: '500', letterSpacing: -0.2 },
});
