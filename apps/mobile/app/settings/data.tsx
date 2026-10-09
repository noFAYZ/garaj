import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, Text } from 'react-native';
import { garagesQuery, queryKeys } from '@vehicle-os/api-client/react';
import type { ExportDataset, Garage } from '@vehicle-os/contracts';
import { capabilitiesFor } from '@vehicle-os/domain';
import { Group, pad, Row, SettingsPage } from '@/components/settings-kit';
import { api } from '@/lib/api';
import { humanise } from '@/lib/format';
import { haptic } from '@/lib/motion';
import { ListPicker } from '@/lib/pickers';
import { shareGarageExport, type GarageExport } from '@/lib/share-export';
import { typeScale, useTheme } from '@/lib/theme';
import { Button, Empty, Skeleton } from '@/lib/ui';

/** Everything as one backup, or one dataset as a spreadsheet — the same choices as the web. */
const EXPORT_OPTIONS = [
  { value: 'json', label: 'Everything (JSON)', hint: 'A full backup, every dataset in one file' },
  { value: 'expenses', label: 'Expenses (CSV)' },
  { value: 'events', label: 'Timeline (CSV)' },
  { value: 'maintenance', label: 'Service records (CSV)' },
  { value: 'documents', label: 'Document list (CSV)' },
] as const;

/**
 * Your data, garage by garage: take it out, or — for the garages you own — delete it. Export sits
 * first and routine; deleting is apart, on its own tint, behind the phone's own confirm, and only
 * offered where the server would allow it: a member shown a Delete that always fails is being
 * offered a button that lies.
 */
export default function DataScreen() {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const garages = useQuery(garagesQuery(api));
  const [exporting, setExporting] = useState<string | null>(null);
  const [exportFor, setExportFor] = useState<Garage | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  const list = garages.data ?? [];
  const deletable = list.filter((garage) => capabilitiesFor(garage.role).includes('garage.delete'));

  const exportGarage = async (garage: Garage, choice: GarageExport) => {
    setExporting(garage.id);
    try {
      await shareGarageExport(garage, choice);
    } catch (error) {
      Alert.alert('Could not export', (error as Error).message);
    } finally {
      setExporting(null);
    }
  };

  // ponytail: the native alert is the confirm. A custom sheet if this ever needs typing the name.
  const confirmDelete = (garage: Garage) => {
    haptic.selection();
    Alert.alert(
      `Delete ${garage.name}?`,
      `${garage.vehicleCount} ${garage.vehicleCount === 1 ? 'vehicle' : 'vehicles'} and all their records go, for every member. This cannot be undone.`,
      [
        { text: 'Keep it', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            setRemoving(garage.id);
            void api.garages
              .remove(garage.id)
              .then(() => {
                haptic.success();
                void queryClient.invalidateQueries({ queryKey: queryKeys.garages() });
                void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard() });
                void queryClient.invalidateQueries({ queryKey: ['vehicles'] });
                void queryClient.invalidateQueries({ queryKey: ['me', 'plan'] });
              })
              .catch((error: unknown) =>
                Alert.alert('Could not delete the garage', (error as Error).message),
              )
              .finally(() => setRemoving(null));
          },
        },
      ],
    );
  };

  if (garages.isError && !garages.data) {
    return (
      <SettingsPage>
        <Empty title="Couldn't load your garages" description={garages.error.message} />
        <Button label="Try again" onPress={() => void garages.refetch()} />
      </SettingsPage>
    );
  }

  return (
    <SettingsPage>
      <Group
        title="Export"
        footer="As stored, nothing converted: a full JSON backup, or one dataset as CSV."
      >
        {garages.isPending ? (
          <Row icon="download-outline" label="Loading garages">
            <Skeleton width={72} height={32} radius={999} />
          </Row>
        ) : list.length === 0 ? (
          <Row icon="download-outline" label="No garages yet" hint="Nothing to export." />
        ) : (
          list.map((garage) => (
            <Row
              key={garage.id}
              icon="download-outline"
              label={garage.name}
              hint={`${pad(garage.vehicleCount)} ${garage.vehicleCount === 1 ? 'vehicle' : 'vehicles'} · ${garage.defaultCurrency}${garage.role === 'OWNER' ? '' : ` · ${humanise(garage.role)}`}`}
            >
              <Button
                label="Export"
                loading={exporting === garage.id}
                onPress={() => setExportFor(garage)}
              />
            </Row>
          ))
        )}
      </Group>

      {deletable.length > 0 ? (
        <Group
          title="Delete a garage"
          index={1}
          footer="Goes for every member, with everything in it. Export first if in doubt."
        >
          {deletable.map((garage) => (
            <Row
              key={garage.id}
              icon="trash-outline"
              label={garage.name}
              destructive
              hint={`${pad(garage.vehicleCount)} ${garage.vehicleCount === 1 ? 'vehicle' : 'vehicles'}`}
            >
              <Button
                label="Delete"
                variant="danger"
                loading={removing === garage.id}
                onPress={() => confirmDelete(garage)}
              />
            </Row>
          ))}
        </Group>
      ) : list.length > 0 ? (
        <Text style={[typeScale.caption, { color: theme.mutedForeground, paddingHorizontal: 4 }]}>
          The garages here are shared with you; only their owners can delete them.
        </Text>
      ) : null}

      {exportFor ? (
        <ListPicker
          title={`Export ${exportFor.name}`}
          value={undefined}
          options={EXPORT_OPTIONS}
          placeholder="Search formats"
          onChange={(value) => {
            const garage = exportFor;
            setExportFor(null);
            void exportGarage(
              garage,
              value === 'json'
                ? { format: 'json' }
                : { format: 'csv', dataset: value as ExportDataset },
            );
          }}
          onClose={() => setExportFor(null)}
        />
      ) : null}
    </SettingsPage>
  );
}
