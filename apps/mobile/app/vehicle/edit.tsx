import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
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
import type { Vehicle } from '@vehicle-os/contracts';
import {
  CAPABILITY_SPEC_FIELDS,
  DISTANCE_UNITS,
  VEHICLE_CAPABILITIES,
  VEHICLE_STATUSES,
  specFieldsFor,
  type SpecField,
  type VehicleCapability,
  type VehicleType,
} from '@vehicle-os/domain';
import { amountOnly, digitsOnly } from '@vehicle-os/ui';
import { vehicleQuery } from '@vehicle-os/api-client/react';
import { api } from '@/lib/api';
import { DateField } from '@/lib/date-picker';
import { useDiscardGuard } from '@/lib/discard';
import { humanise, toMinorUnits } from '@/lib/format';
import { Eyebrow, FigureInput, Panel, PanelCell, Segmented } from '@/lib/instrument';
import { haptic, PressableScale, Rise } from '@/lib/motion';
import { enqueue, flush } from '@/lib/offline';
import { ListPicker } from '@/lib/pickers';
import { radius, spacing, typeScale, useTheme } from '@/lib/theme';
import { Button, Loading, Skeleton } from '@/lib/ui';

/**
 * Everything on record about a vehicle, editable.
 *
 * The phone could correct nothing: a plate typed wrong when the vehicle was added stayed wrong
 * until someone opened the web. The spec sections are generated from the type's own field
 * descriptors, exactly as the web's editor is — `CAPABILITY_SPEC_FIELDS` already declares every
 * field's label, kind, unit, options and bound, and the API validates writes against that same
 * list. So a field this form offers is one the server accepts, a boat gets hull and mooring, a
 * motorcycle gets its chain, and neither is written down twice.
 *
 * Tabs rather than one long column (user asked): Identity, Readings, Papers and — for a type that
 * has any — Specs, the web's sidebar sections folded into four. The tabs stay put under the header
 * and Save is in it, so nothing floats over the fields.
 */
export default function EditVehicleScreen() {
  const { vehicleId } = useLocalSearchParams<{ vehicleId: string }>();
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const vehicle = useQuery(vehicleQuery(api, vehicleId));
  const data = vehicle.data;

  const initial = useMemo(() => (data ? initialForm(data) : null), [data]);
  const [form, setForm] = useState<Record<string, string> | null>(null);
  const [picking, setPicking] = useState<SpecField | null>(null);
  const [tab, setTab] = useState<Tab>('identity');

  // The form is seeded once, when the vehicle lands — after that it is the person's to change.
  const current = form ?? initial;
  const set = (key: string) => (value: string) => setForm({ ...(current ?? {}), [key]: value });

  const changed =
    current && initial ? Object.keys(current).filter((k) => current[k] !== initial[k]) : [];
  const release = useDiscardGuard(changed.length > 0);

  const save = useMutation({
    mutationFn: async () => {
      if (!data || !current || !initial) return;
      await enqueue({
        kind: 'vehicle-update',
        vehicleId,
        body: buildPatch(data, current, initial),
      });
      void flush();
    },
    onSuccess: () => {
      haptic.success();
      void queryClient.invalidateQueries({ queryKey: ['vehicles'] });
      release();
      router.back();
    },
  });

  if (vehicle.isPending || !current) {
    return (
      <View style={{ flex: 1, backgroundColor: 'transparent', padding: spacing.md }}>
        <Loading label="Loading vehicle" />
        <Skeleton width="100%" height={180} radius={radius.lg} />
      </View>
    );
  }

  const specFields = specFieldsFor(data!.vehicleType as VehicleType);
  const specsIn = (capabilities: readonly VehicleCapability[]) =>
    specFields.filter((field) => capabilities.some((c) => CAPABILITY_OF[field.key] === c));

  const specSections = SPEC_SECTIONS.map(([title, icon, capabilities]) => ({
    title,
    icon,
    fields: specsIn(capabilities),
  })).filter((section) => section.fields.length > 0);
  const tabs: { value: Tab; label: string; icon: IconName }[] = [
    { value: 'identity', label: 'Identity', icon: 'car-outline' },
    { value: 'readings', label: 'Readings', icon: 'speedometer-outline' },
    { value: 'papers', label: 'Papers', icon: 'document-text-outline' },
    // A type with no spec groups of its own (a bicycle) has no Specs tab.
    ...(specSections.length > 0
      ? [{ value: 'specs' as const, label: 'Specs', icon: 'construct-outline' as const }]
      : []),
  ];

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: 'transparent' }}
    >
      {/* Save is the header's, with how many fields it carries — no bar floating at the foot. */}
      <Stack.Screen
        options={{
          title: 'Edit details',
          headerRight: () => (
            <Button
              label={changed.length > 0 ? `Save · ${changed.length}` : 'Save'}
              a11yLabel={
                changed.length > 0 ? `Save ${changed.length} changes` : 'No changes to save'
              }
              size="sm"
              variant="primary"
              loading={save.isPending}
              disabled={changed.length === 0}
              onPress={() => save.mutate()}
            />
          ),
        }}
      />

      {/* The tabs stay put under the header; only the tab's own fields scroll. */}
      <View style={styles.tabs}>
        <Segmented small value={tab} options={tabs} onChange={setTab} />
      </View>

      {/* Keyed by the tab, so each opens at its top and arrives as a page does. */}
      <ScrollView
        key={tab}
        contentContainerStyle={[
          styles.page,
          { paddingBottom: Math.max(insets.bottom, spacing.md) + spacing.xl },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        {tab === 'identity' ? (
          <>
            <Section title="Vehicle" icon="car-sport-outline" index={0}>
              <Panel>
                <Field label="Nickname" value={current.nickname} onChange={set('nickname')} />
                <View style={styles.pair}>
                  <Field label="Make" value={current.make} onChange={set('make')} />
                  <Field label="Model" value={current.model} onChange={set('model')} />
                </View>
                <View style={styles.pair}>
                  <Field label="Variant" value={current.variant} onChange={set('variant')} />
                  <PanelCell label="Year">
                    <FigureInput
                      value={current.year}
                      onChangeText={(text) => set('year')(digitsOnly(text, 4))}
                      placeholder="—"
                      keyboardType="number-pad"
                      accessibilityLabel="Year"
                    />
                  </PanelCell>
                </View>
                <Field label="Colour" value={current.color} onChange={set('color')} />
              </Panel>
            </Section>
            <Section title="Status" icon="flag-outline" index={1}>
              <Panel>
                <PanelCell label="In the garage as">
                  <Segmented
                    small
                    value={current.status!}
                    options={VEHICLE_STATUSES.map((status) => ({
                      value: status,
                      label: humanise(status),
                    }))}
                    onChange={set('status')}
                  />
                </PanelCell>
              </Panel>
            </Section>
          </>
        ) : tab === 'readings' ? (
          <>
            <Section title="Odometer" icon="speedometer-outline" index={0}>
              <Panel>
                <PanelCell label="Reading" note="Only ever moves forward">
                  <FigureInput
                    unit={current.odometerUnit === 'MI' ? 'mi' : 'km'}
                    value={
                      current.currentOdometer
                        ? Number(current.currentOdometer).toLocaleString()
                        : ''
                    }
                    onChangeText={(text) => set('currentOdometer')(digitsOnly(text, 9))}
                    placeholder="0"
                    keyboardType="number-pad"
                    accessibilityLabel="Odometer"
                  />
                </PanelCell>
                <PanelCell label="Unit">
                  <Segmented
                    small
                    value={current.odometerUnit!}
                    options={DISTANCE_UNITS.map((unit) => ({
                      value: unit,
                      label: unit === 'MI' ? 'Miles' : 'Kilometres',
                    }))}
                    onChange={set('odometerUnit')}
                  />
                </PanelCell>
              </Panel>
            </Section>
            {data!.capabilities.includes('engineHours') ? (
              <Section title="Engine" icon="time-outline" index={1}>
                <Panel>
                  <PanelCell label="Engine hours">
                    <FigureInput
                      unit="h"
                      value={current.currentEngineHours}
                      onChangeText={(text) => set('currentEngineHours')(digitsOnly(text, 7))}
                      placeholder="0"
                      keyboardType="number-pad"
                      accessibilityLabel="Engine hours"
                    />
                  </PanelCell>
                </Panel>
              </Section>
            ) : null}
          </>
        ) : tab === 'papers' ? (
          <>
            <Section title="Registration" icon="id-card-outline" index={0}>
              <Panel>
                <PanelCell label="Number plate">
                  <TextInput
                    value={current.registrationIdentifier}
                    onChangeText={(text) => set('registrationIdentifier')(text.toUpperCase())}
                    placeholder="—"
                    placeholderTextColor={theme.placeholder}
                    autoCapitalize="characters"
                    accessibilityLabel="Number plate"
                    maxLength={32}
                    style={[typeScale.headline, styles.plate, { color: theme.foreground }]}
                  />
                </PanelCell>
                <PanelCell label="VIN / frame number" note="17 characters on most road vehicles">
                  <TextInput
                    value={current.identificationNumber}
                    onChangeText={(text) => set('identificationNumber')(text.toUpperCase())}
                    placeholder="—"
                    placeholderTextColor={theme.placeholder}
                    autoCapitalize="characters"
                    accessibilityLabel="VIN"
                    maxLength={64}
                    style={[typeScale.headline, styles.mono, { color: theme.foreground }]}
                  />
                </PanelCell>
                <SpecCells
                  fields={specsIn(['registration', 'insurance'])}
                  form={current}
                  onChange={set}
                  onPick={setPicking}
                />
              </Panel>
            </Section>
            <Section title="Ownership" icon="key-outline" index={1}>
              <Panel>
                <PanelCell label="Purchased">
                  <DateField
                    value={current.purchaseDate ?? ''}
                    onChange={set('purchaseDate')}
                    label="Purchased"
                    placeholder="Not recorded"
                  />
                </PanelCell>
                <View style={styles.pair}>
                  <PanelCell label="Price">
                    <FigureInput
                      unit={current.purchaseCurrency}
                      value={current.purchasePrice}
                      onChangeText={(text) => set('purchasePrice')(amountOnly(text))}
                      placeholder="0.00"
                      keyboardType="decimal-pad"
                      accessibilityLabel="Purchase price"
                    />
                  </PanelCell>
                  <PanelCell label="Currency">
                    <TextInput
                      value={current.purchaseCurrency}
                      onChangeText={(text) =>
                        set('purchaseCurrency')(text.toUpperCase().slice(0, 3))
                      }
                      placeholder="USD"
                      placeholderTextColor={theme.placeholder}
                      autoCapitalize="characters"
                      accessibilityLabel="Currency"
                      maxLength={3}
                      style={[typeScale.headline, styles.mono, { color: theme.foreground }]}
                    />
                  </PanelCell>
                </View>
              </Panel>
            </Section>
          </>
        ) : (
          // Generated from the type's own descriptors: a car has no hull, a bicycle no fuel.
          specSections.map((section, index) => (
            <Section key={section.title} title={section.title} icon={section.icon} index={index}>
              <Panel>
                <SpecCells
                  fields={section.fields}
                  form={current}
                  onChange={set}
                  onPick={setPicking}
                />
              </Panel>
            </Section>
          ))
        )}
      </ScrollView>

      {picking ? (
        <ListPicker
          title={picking.label}
          value={current[specKey(picking.key)] || undefined}
          options={[
            { value: '', label: 'Not recorded' },
            ...(picking.options ?? []).map((option) => ({
              value: option,
              label: humanise(option),
            })),
          ]}
          placeholder={`Search ${picking.label.toLowerCase()}`}
          onChange={(value) => set(specKey(picking.key))(value)}
          onClose={() => setPicking(null)}
        />
      ) : null}
    </KeyboardAvoidingView>
  );
}

/** A tab's group of fields under its icon and name. */
function Section({
  title,
  icon,
  index,
  children,
}: {
  title: string;
  icon: IconName;
  index: number;
  children: React.ReactNode;
}) {
  const theme = useTheme();
  return (
    <Rise index={index} style={{ gap: spacing.sm }}>
      <View style={styles.sectionHead}>
        <Ionicons name={icon} size={14} color={theme.mutedForeground} />
        <Eyebrow>{title}</Eyebrow>
      </View>
      {children}
    </Rise>
  );
}

/** A plain text cell, which most identity fields are. */
function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | undefined;
  onChange: (value: string) => void;
}) {
  const theme = useTheme();
  return (
    <PanelCell label={label}>
      <TextInput
        value={value ?? ''}
        onChangeText={onChange}
        placeholder="—"
        placeholderTextColor={theme.placeholder}
        accessibilityLabel={label}
        maxLength={200}
        style={[typeScale.headline, { color: theme.foreground, paddingVertical: 2 }]}
      />
    </PanelCell>
  );
}

/**
 * Spec cells, from the domain's descriptors: `kind` picks the control, `unit` becomes the suffix
 * and `max` the bound — the same numbers `validateSpecs` enforces on the server.
 */
function SpecCells({
  fields,
  form,
  onChange,
  onPick,
}: {
  fields: readonly SpecField[];
  form: Record<string, string>;
  onChange: (key: string) => (value: string) => void;
  onPick: (field: SpecField) => void;
}) {
  const theme = useTheme();

  const cells = fields.map((field) => {
    const key = specKey(field.key);
    const value = form[key] ?? '';

    if (field.kind === 'select') {
      return (
        <PanelCell key={field.key} label={field.label}>
          <PressableScale
            onPress={() => {
              haptic.selection();
              onPick(field);
            }}
            accessibilityRole="button"
            accessibilityLabel={`${field.label}: ${value ? humanise(value) : 'not recorded'}`}
            scaleTo={0.98}
            style={{ paddingVertical: 4 }}
          >
            <Text
              style={[typeScale.headline, { color: value ? theme.foreground : theme.borderStrong }]}
            >
              {value ? humanise(value) : '—'}
            </Text>
          </PressableScale>
        </PanelCell>
      );
    }

    const numeric = field.kind === 'number' || field.kind === 'integer';
    return (
      <PanelCell key={field.key} label={field.label}>
        {numeric ? (
          <FigureInput
            unit={field.unit}
            value={value}
            onChangeText={(text) =>
              onChange(key)(field.kind === 'integer' ? digitsOnly(text, 9) : amountOnly(text))
            }
            placeholder="—"
            keyboardType={field.kind === 'integer' ? 'number-pad' : 'decimal-pad'}
            accessibilityLabel={field.label}
          />
        ) : (
          <TextInput
            value={value}
            onChangeText={onChange(key)}
            placeholder="—"
            placeholderTextColor={theme.placeholder}
            accessibilityLabel={field.label}
            maxLength={200}
            style={[typeScale.headline, { color: theme.foreground, paddingVertical: 2 }]}
          />
        )}
      </PanelCell>
    );
  });

  // Two to a row, as make and model sit: a spec is a short value, and a column of them ran long.
  return (
    <>
      {Array.from({ length: Math.ceil(cells.length / 2) }, (_, row) => {
        const pair = cells.slice(row * 2, row * 2 + 2);
        return pair.length === 2 ? (
          <View key={row} style={styles.pair}>
            {pair}
          </View>
        ) : (
          pair[0]
        );
      })}
    </>
  );
}

type IconName = keyof typeof Ionicons.glyphMap;
type Tab = 'identity' | 'readings' | 'papers' | 'specs';

/** The Specs tab's groups, each with the capabilities it gathers. */
const SPEC_SECTIONS: [string, IconName, VehicleCapability[]][] = [
  [
    'Drivetrain',
    'cog-outline',
    ['engine', 'fuelSystem', 'electricSystem', 'battery', 'transmission'],
  ],
  ['Wheels & tyres', 'disc-outline', ['tires', 'chain']],
  ['Hull & mooring', 'boat-outline', ['hull', 'mooring']],
  ['Towing', 'link-outline', ['trailer']],
];

/** Specs share a namespace with the identity fields, so they are kept apart in form state. */
const specKey = (key: string) => `spec:${key}`;

/** Which capability owns each spec key, so a section can ask for "everything about the engine". */
const CAPABILITY_OF: Record<string, VehicleCapability> = Object.fromEntries(
  VEHICLE_CAPABILITIES.flatMap((capability) =>
    CAPABILITY_SPEC_FIELDS[capability].map((field) => [field.key, capability] as const),
  ),
);

function initialForm(vehicle: Vehicle): Record<string, string> {
  const currency = vehicle.purchasePrice?.currency ?? 'USD';
  const form: Record<string, string> = {
    nickname: vehicle.nickname ?? '',
    make: vehicle.make ?? '',
    model: vehicle.model ?? '',
    variant: vehicle.variant ?? '',
    year: vehicle.year?.toString() ?? '',
    color: vehicle.color ?? '',
    identificationNumber: vehicle.identificationNumber ?? '',
    registrationIdentifier: vehicle.registrationIdentifier ?? '',
    purchaseDate: vehicle.purchaseDate ?? '',
    purchasePrice: vehicle.purchasePrice ? String(vehicle.purchasePrice.amountMinor / 100) : '',
    purchaseCurrency: currency,
    currentOdometer: vehicle.currentOdometer?.toString() ?? '',
    odometerUnit: vehicle.odometerUnit,
    currentEngineHours: vehicle.currentEngineHours?.toString() ?? '',
    status: vehicle.status,
  };
  for (const field of specFieldsFor(vehicle.vehicleType as VehicleType)) {
    const value = vehicle.specs[field.key];
    form[specKey(field.key)] = value === null || value === undefined ? '' : String(value);
  }
  return form;
}

/**
 * Only what changed.
 *
 * A PATCH echoing the whole form back would overwrite anything edited elsewhere between this
 * screen opening and the save — silently, and this one may sit in a queue for days.
 */
function buildPatch(
  vehicle: Vehicle,
  form: Record<string, string>,
  initial: Record<string, string>,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  const moved = (key: string) => (form[key] ?? '') !== (initial[key] ?? '');

  for (const key of [
    'nickname',
    'make',
    'model',
    'variant',
    'color',
    'identificationNumber',
    'registrationIdentifier',
    'purchaseDate',
  ]) {
    if (moved(key)) patch[key] = form[key]!.trim() === '' ? null : form[key]!.trim();
  }

  if (moved('year')) patch.year = form.year!.trim() === '' ? null : Number(form.year);
  if (moved('status')) patch.status = form.status;
  if (moved('odometerUnit')) patch.odometerUnit = form.odometerUnit;

  // The odometer has no null in the contract: an emptied box leaves the stored reading alone
  // rather than erasing it — a vehicle without one has not been read, not zeroed.
  if (moved('currentOdometer') && form.currentOdometer!.trim() !== '') {
    patch.currentOdometer = Number(form.currentOdometer);
  }
  if (moved('currentEngineHours') && form.currentEngineHours!.trim() !== '') {
    patch.currentEngineHours = Number(form.currentEngineHours);
  }

  // Price and currency travel together, or the same number becomes a different amount of money.
  if (moved('purchasePrice') || (form.purchasePrice!.trim() !== '' && moved('purchaseCurrency'))) {
    const price = form.purchasePrice!.trim();
    if (price === '') {
      patch.purchasePriceAmountMinor = null;
    } else {
      const currency = form.purchaseCurrency!.trim().toUpperCase();
      patch.purchasePriceAmountMinor = toMinorUnits(Number(price), currency);
      patch.purchasePriceCurrency = currency;
    }
  }

  // Specs merge server-side, so only the touched keys travel; an emptied one clears itself.
  const specs: Record<string, string | number | null> = {};
  for (const field of specFieldsFor(vehicle.vehicleType as VehicleType)) {
    const key = specKey(field.key);
    if (!moved(key)) continue;
    const value = (form[key] ?? '').trim();
    specs[field.key] =
      value === ''
        ? null
        : field.kind === 'number' || field.kind === 'integer'
          ? Number(value)
          : value;
  }
  if (Object.keys(specs).length > 0) patch.specs = specs;

  return patch;
}

const styles = StyleSheet.create({
  page: { padding: spacing.md, gap: spacing.lg },
  tabs: { paddingHorizontal: spacing.md, paddingTop: spacing.xs, paddingBottom: spacing.sm },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 2 },
  pair: { flexDirection: 'row', gap: StyleSheet.hairlineWidth },
  plate: { letterSpacing: 2, fontWeight: '700', paddingVertical: 2 },
  mono: { letterSpacing: 1, paddingVertical: 2 },
});
