import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type {
  PartLine,
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
import { partsQuery, queryKeys } from '@vehicle-os/api-client/react';
import { amountOnly, digitsOnly, localDay, spanOfDays, stampForDay } from '@vehicle-os/ui';
import { newId } from '@vehicle-os/utils';
import { Fact, Rail } from '@/components/add-kit';
import { KindIcon } from '@/components/timeline';
import { api } from '@/lib/api';
import { DateField } from '@/lib/date-picker';
import { dialog, FAILED } from '@/lib/dialog';
import { jobEmoji } from '@/lib/emoji';
import { DATE_LOCALE, formatDistance, humanise } from '@/lib/format';
import { Eyebrow, FigureInput, Panel, PanelCell, Segmented } from '@/lib/instrument';
import { usePendingWrites, type PendingWrite, type SentWrite } from '@/lib/offline';
import { haptic, PressableScale, Rise } from '@/lib/motion';
import { cardSurface, spacing, typeScale, useTheme, leaf } from '@/lib/theme';
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
export const positionGlyph = (position: string) => jobEmoji(positionLabel(position));

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
        placeholderTextColor={theme.borderStrong}
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
        haptic.selection();
        onToggle();
      }}
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      accessibilityLabel={`${label}: ${summary}${draft.same ? ', same as last time' : draft.read ? ', read from the photo' : ''}`}
      accessibilityHint={open ? 'Closes it' : 'Opens it to change'}
      scaleTo={0.99}
      style={styles.line}
    >
      <KindIcon emoji={positionGlyph(draft.position)} size={32} />
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
          haptic.selection();
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
            glyph: positionGlyph(position),
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

/** When it was fitted and how long ago, and how far the vehicle has gone on it since. */
function fittedText(part: VehiclePart, vehicle: Vehicle): string {
  if (!part.fittedAt) return 'Date not recorded';
  const since = `Since ${DATE.format(new Date(part.fittedAt))}`;
  // How far it has gone is the wear that matters; without a reading, how long it has been in.
  if (part.odometer !== null && part.odometerUnit && vehicle.currentOdometer !== null) {
    const at = convertDistance(part.odometer, part.odometerUnit, vehicle.odometerUnit);
    const driven = Math.round(vehicle.currentOdometer - at);
    if (driven > 0) return `${since} · ${formatDistance(driven, vehicle.odometerUnit)}`;
  }
  const days = Math.floor((Date.now() - Date.parse(part.fittedAt)) / 86_400_000);
  return days >= 1 ? `${since} · ${spanOfDays(days)}` : since;
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

/**
 * Holding a line: correct it, or remove it — a mistake typed in, never the entry it came with.
 * A line still on this phone has nothing on the server to change yet.
 */
function useLineActions(vehicleId: string, onEdit: (part: PartLike) => void) {
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: (partId: string) => api.parts.remove(vehicleId, partId),
    onSuccess: () => {
      haptic.success();
      void queryClient.invalidateQueries({ queryKey: queryKeys.parts(vehicleId) });
    },
    onError: (error) => dialog('Could not remove it', (error as Error).message, undefined, FAILED),
  });
  const confirmRemove = (part: PartLike) =>
    dialog(
      `Remove ${positionLabel(part.position).toLowerCase()}?`,
      `${partSummary(part)} leaves the history. The entry it came with stays.`,
      [
        { text: 'Keep it', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => remove.mutate(part.id) },
      ],
    );
  return (part: PartLike) => {
    haptic.selection();
    if (part.local) {
      dialog('Waiting to sync', 'It can be changed once it has been sent.', undefined, {
        icon: 'cloud-upload-outline',
      });
      return;
    }
    dialog(positionLabel(part.position), partSummary(part), [
      { text: 'Edit', onPress: () => onEdit(part) },
      { text: 'Remove', style: 'destructive', onPress: () => confirmRemove(part) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };
}

/**
 * A position with something fitted: its glyph, what is there, and since when. Pressed, it opens
 * every line it has had, newest first — the product history; holding one removes it.
 */
function FittedRow({
  part,
  history,
  vehicle,
  open,
  onToggle,
  onHold,
}: {
  part: PartLike;
  history: readonly PartLike[];
  vehicle: Vehicle;
  open: boolean;
  onToggle: () => void;
  onHold: (part: PartLike) => void;
}) {
  const theme = useTheme();
  const label = positionLabel(part.position);
  const earlier = history.length - 1;
  const warranty = warrantyText(part.warrantyUntil);
  return (
    <View>
      <PressableScale
        onPress={() => {
          haptic.selection();
          onToggle();
        }}
        onLongPress={() => onHold(part)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={[
          `${label}: ${partSummary(part)}`,
          fittedText(part, vehicle),
          warranty?.text,
          part.local ? 'waiting to sync' : null,
        ]
          .filter(Boolean)
          .join(', ')}
        accessibilityHint="Shows its history. Hold to edit or remove."
        scaleTo={0.99}
        style={styles.line}
      >
        <KindIcon emoji={positionGlyph(part.position)} size={36} />
        <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
          <Text numberOfLines={1} style={[styles.lineLabel, { color: theme.mutedForeground }]}>
            {label}
          </Text>
          <Text numberOfLines={1} style={[styles.product, { color: theme.foreground }]}>
            {partSummary(part)}
          </Text>
          <Text numberOfLines={1} style={[typeScale.caption, { color: theme.mutedForeground }]}>
            {fittedText(part, vehicle)}
          </Text>
          {warranty || part.local ? (
            <View style={styles.flags}>
              {part.local ? (
                <View style={styles.flag}>
                  <Ionicons name="cloud-upload-outline" size={12} color={theme.warning} />
                  <Text style={[typeScale.caption, { color: theme.warning }]}>Waiting to sync</Text>
                </View>
              ) : null}
              {warranty ? (
                <View style={styles.flag}>
                  <Ionicons
                    name="shield-checkmark-outline"
                    size={12}
                    color={
                      warranty.ended
                        ? theme.mutedForeground
                        : warranty.soon
                          ? theme.warning
                          : theme.success
                    }
                  />
                  <Text
                    numberOfLines={1}
                    style={[
                      typeScale.caption,
                      { color: warranty.soon ? theme.warning : theme.mutedForeground },
                    ]}
                  >
                    {warranty.text}
                  </Text>
                </View>
              ) : null}
            </View>
          ) : null}
        </View>
        {earlier > 0 ? (
          <View style={[styles.count, { backgroundColor: theme.muted }]}>
            <Ionicons name="time-outline" size={11} color={theme.mutedForeground} />
            <Text style={[styles.countText, { color: theme.mutedForeground }]}>{earlier}</Text>
          </View>
        ) : null}
        <Ionicons
          name={open ? 'chevron-up' : 'chevron-down'}
          size={16}
          color={theme.mutedForeground}
        />
      </PressableScale>
      {open ? (
        <View style={styles.history}>
          {history.map((line) => (
            <PressableScale
              key={line.id}
              onLongPress={() => onHold(line)}
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
              <Text style={[typeScale.caption, styles.pastDate, { color: theme.mutedForeground }]}>
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
function PartForm({
  vehicle,
  position,
  part,
  products,
  onDone,
}: {
  vehicle: Vehicle;
  position: PartPosition;
  /** The line being corrected; none to record a new one. */
  part?: PartLike;
  products: readonly PartProduct[];
  onDone: () => void;
}) {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(() =>
    part ? draftFromPart(part) : draftFor(position, vehicle, undefined),
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
      haptic.success();
      void queryClient.invalidateQueries({ queryKey: queryKeys.parts(vehicle.id) });
      onDone();
    },
  });

  return (
    <Rise style={[styles.card, styles.recording, cardSurface(theme)]}>
      <View style={styles.lineHead}>
        <KindIcon emoji={positionGlyph(position)} size={32} />
        <Text style={[typeScale.headline, { flex: 1, color: theme.foreground }]}>
          {positionLabel(position)}
        </Text>
        <PressableScale
          onPress={onDone}
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

/**
 * The vehicle's parts: what is fitted at each position, grouped as a workshop would — engine,
 * brakes, tyres — each with its history a tap away; then the positions with nothing recorded,
 * one tap to record what is there now.
 */
export function VehicleParts({ vehicle }: { vehicle: Vehicle }) {
  const theme = useTheme();
  const { query, history, current, products, positions } = useParts(vehicle);
  const [open, setOpen] = useState<string | null>(null);
  // The form open over the list: a position to record, or a line to correct.
  const [form, setForm] = useState<{ position: PartPosition; part?: PartLike } | null>(null);
  const hold = useLineActions(vehicle.id, (part) =>
    setForm({ position: part.position as PartPosition, part }),
  );

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
      (position) => (partPosition(position)?.group ?? 'OTHER') === group,
    ),
  })).filter((entry) => entry.positions.length > 0);
  const unrecorded = positions.filter((position) => position !== 'OTHER' && !current.has(position));

  return (
    <View style={{ gap: spacing.lg }}>
      {form ? (
        <PartForm
          key={form.part?.id ?? form.position}
          vehicle={vehicle}
          position={form.position}
          part={form.part}
          products={products}
          onDone={() => setForm(null)}
        />
      ) : null}

      {groups.length === 0 && others.length === 0 && !form ? (
        <View style={[styles.card, styles.empty, cardSurface(theme)]}>
          <Ionicons name="construct-outline" size={26} color={theme.mutedForeground} />
          <Text style={[typeScale.headline, { color: theme.foreground }]}>
            What’s in it, and since when
          </Text>
          <Text style={[typeScale.label, styles.emptyText, { color: theme.mutedForeground }]}>
            Record the oil, tyres and battery fitted now. Every service you log from here fills it
            in, and next time is one tap: same as last time.
          </Text>
        </View>
      ) : null}

      {groups.map(({ group, positions: fitted }, index) => (
        <Rise key={group} index={index} style={{ gap: spacing.sm }}>
          <Eyebrow>{GROUP_LABEL[group]}</Eyebrow>
          <View style={[styles.card, cardSurface(theme)]}>
            {fitted.map((position, place) => (
              <Fragment key={position}>
                {place > 0 ? (
                  <View style={[styles.rule, { backgroundColor: theme.border }]} />
                ) : null}
                <FittedRow
                  part={current.get(position)!}
                  history={history.filter((part) => part.position === position)}
                  vehicle={vehicle}
                  open={open === position}
                  onToggle={() => setOpen(open === position ? null : position)}
                  onHold={hold}
                />
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
                <FittedRow
                  part={part}
                  history={[part]}
                  vehicle={vehicle}
                  open={false}
                  onToggle={() => undefined}
                  onHold={hold}
                />
              </Fragment>
            ))}
          </View>
        </View>
      ) : null}

      {unrecorded.length > 0 ? (
        <View style={{ gap: spacing.sm }}>
          <Eyebrow>{groups.length ? 'Not recorded yet' : 'Record what’s fitted'}</Eyebrow>
          <View style={styles.wrap}>
            {unrecorded.map((position) => (
              <Fact
                key={position}
                glyph={positionGlyph(position)}
                label={positionLabel(position)}
                selected={form?.position === position && !form.part}
                onPress={() =>
                  setForm(form?.position === position && !form.part ? null : { position })
                }
              />
            ))}
          </View>
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
          <KindIcon emoji={positionGlyph(part.position)} size={30} />
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

/**
 * The vehicle's upkeep: what it needs next and what is in it now, on two tabs of one section, so
 * a reminder and the part it replaces are a tap apart.
 */
export function VehicleUpkeep({ vehicle, reminders }: { vehicle: Vehicle; reminders: ReactNode }) {
  const [tab, setTab] = useState<'reminders' | 'parts'>('reminders');
  return (
    <View style={{ gap: spacing.md }}>
      <Segmented
        small
        value={tab}
        options={[
          { value: 'reminders', label: 'Reminders', icon: 'alarm-outline' },
          { value: 'parts', label: 'Parts & fluids', icon: 'construct-outline' },
        ]}
        onChange={setTab}
      />
      {tab === 'reminders' ? reminders : <VehicleParts vehicle={vehicle} />}
    </View>
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
  pastDate: { width: 92 },
  recording: { padding: 14, gap: spacing.md, overflow: 'visible' },
  empty: { alignItems: 'center', gap: spacing.sm, padding: spacing.xl },
  emptyText: { fontWeight: '400', textAlign: 'center' },
  entry: { padding: 14, gap: 10 },
  entryLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
});
