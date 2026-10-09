/**
 * Files the API writes, handed to the share sheet (PRD §6.5).
 *
 * Downloaded straight to disk with `downloadAsync` rather than through the typed client: the
 * response is a file, not a record, and writing it natively avoids the blob-to-text step React
 * Native does not reliably provide. The name is built here from what the file is and the date,
 * since `downloadAsync` does not surface `Content-Disposition`.
 *
 * Written to the cache directory, not documents: the file exists to be handed to another app,
 * and the OS may reclaim it once it has been.
 */

import type { ExportDataset } from '@vehicle-os/contracts';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { API_URL, authHeader } from './api';

export type GarageExport = { format: 'json' } | { format: 'csv'; dataset: ExportDataset };

const slug = (value: string) => value.replace(/[^\w-]+/g, '-').toLowerCase() || 'export';

async function shareDownload(
  path: string,
  query: Record<string, string>,
  file: { name: string; kind: 'csv' | 'json'; title: string },
): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('Sharing is not available on this device.');
  }

  const target = `${FileSystem.cacheDirectory}${file.name}.${file.kind}`;
  const result = await FileSystem.downloadAsync(
    `${API_URL.replace(/\/$/, '')}/api/v1${path}?${new URLSearchParams(query)}`,
    target,
    { headers: await authHeader() },
  );
  // `downloadAsync` resolves on any HTTP status; a 4xx body written to disk is not an export.
  if (result.status !== 200) {
    await FileSystem.deleteAsync(target, { idempotent: true });
    throw new Error(`The download failed (${result.status}).`);
  }

  await Sharing.shareAsync(target, {
    mimeType: file.kind === 'csv' ? 'text/csv' : 'application/json',
    dialogTitle: file.title,
    UTI: file.kind === 'csv' ? 'public.comma-separated-values-text' : 'public.json',
  });
}

export async function shareGarageExport(
  garage: { id: string; name: string },
  choice: GarageExport = { format: 'json' },
): Promise<void> {
  const stamp = new Date().toISOString().slice(0, 10);
  const csv = choice.format === 'csv';
  await shareDownload(
    `/garages/${garage.id}/export`,
    csv ? { format: 'csv', dataset: choice.dataset } : { format: 'json' },
    {
      name: `garaj-${slug(garage.name)}-${stamp}${csv ? `-${choice.dataset}` : ''}`,
      kind: csv ? 'csv' : 'json',
      title: `${garage.name} — Garaj export`,
    },
  );
}

/** The mileage log for a period, as the spreadsheet an accountant asks for. */
export async function shareMileageReport(
  vehicle: { id: string; name: string },
  range: { from: string; to: string },
): Promise<void> {
  await shareDownload(
    `/vehicles/${vehicle.id}/mileage-report`,
    { ...range, format: 'csv' },
    {
      name: `mileage-${slug(vehicle.name)}-${range.from.slice(0, 10)}-to-${range.to.slice(0, 10)}`,
      kind: 'csv',
      title: `${vehicle.name} — mileage log`,
    },
  );
}
