/**
 * Putting an entry on a vehicle's record, the one way every surface does it.
 *
 * The add dialog and GarajAI's approve card both write through here, so the rules live once:
 * a service goes in as a maintenance record (the history a buyer reads has it), anything else
 * as an activity entry; a repeating job is a schedule, a one-off is a task.
 */

import { uploadDocument, uploadPhoto } from '@vehicle-os/api-client';
import type { CreateEvent } from '@vehicle-os/contracts';
import type { DistanceUnit, DocumentType, EventType } from '@vehicle-os/domain';
import { isImage, PHOTO_TYPES } from '@/components/onboard-uploads';
import { api } from '@/lib/api';
import { humanise } from '@/lib/format';

/** What an attach picker takes: photographs, and the papers the documents store accepts. */
export const ATTACH_TYPES = [
  PHOTO_TYPES,
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
].join(',');

export const attachable = (file: File) =>
  isImage(file) || ATTACH_TYPES.split(',').includes(file.type);

/** A paper's type from the entry it is filed with: a service's paper is its invoice. */
export const PAPER: Partial<Record<EventType, DocumentType>> = {
  MAINTENANCE: 'SERVICE_INVOICE',
  REPAIR: 'REPAIR_INVOICE',
  INSPECTION: 'INSPECTION_REPORT',
  INSURANCE: 'INSURANCE',
  REGISTRATION: 'REGISTRATION',
  PURCHASE: 'PURCHASE_AGREEMENT',
  MODIFICATION: 'MODIFICATION_CERTIFICATE',
};

/**
 * Files up to an entry once it exists, addressed to it: photos to its gallery, papers to its
 * documents. One that fails does not undo the entry — that would lose what was typed for a
 * file — it is said, and the rest still go. Returns what to say.
 */
export async function attachFiles(
  vehicleId: string,
  eventId: string | null | undefined,
  files: readonly File[],
  kind: EventType,
): Promise<string[]> {
  if (files.length === 0) return [];
  if (!eventId) return ['Saved, but its files could not be attached to it.'];
  const failed: string[] = [];
  for (const file of files) {
    try {
      if (isImage(file)) await uploadPhoto(api, vehicleId, file, { eventId });
      else
        await uploadDocument(api, vehicleId, file, {
          documentType: PAPER[kind] ?? 'RECEIPT',
          title: file.name.replace(/\.[^.]+$/, '') || file.name,
          eventId,
        });
    } catch (error) {
      failed.push(`${file.name} was not attached: ${(error as Error).message}`);
    }
  }
  return failed;
}

export interface DoneEntry {
  vehicleId: string;
  kind: EventType;
  /** Empty takes the kind's own name, which the logbook then leaves to the stamp. */
  title: string;
  /** ISO timestamp. */
  when: string;
  odometer?: number;
  odometerUnit: DistanceUnit;
  /** In minor units of `currency`. */
  amountMinor?: number;
  currency: string;
  place?: string;
  note?: string;
  trip?: CreateEvent['trip'];
}

/** Returns the entry's event, for files to attach to, and any warning the save came back with. */
export async function saveDone(
  entry: DoneEntry,
): Promise<{ eventId: string | null | undefined; warnings: string[] }> {
  const title = entry.title || humanise(entry.kind);
  const reading =
    entry.odometer !== undefined
      ? { odometer: entry.odometer, odometerUnit: entry.odometerUnit }
      : {};

  if (entry.kind === 'MAINTENANCE') {
    const done = await api.maintenance.log(entry.vehicleId, {
      title,
      performedAt: entry.when,
      ...(entry.note ? { workPerformed: entry.note } : {}),
      ...(entry.place ? { provider: entry.place } : {}),
      ...reading,
      ...(entry.amountMinor !== undefined
        ? { laborCostAmountMinor: entry.amountMinor, costCurrency: entry.currency }
        : {}),
    });
    return { eventId: done.record.eventId, warnings: [] };
  }

  const result = await api.events.create(entry.vehicleId, {
    eventType: entry.kind,
    title,
    occurredAt: entry.when,
    ...(entry.note ? { description: entry.note } : {}),
    ...(entry.place ? { provider: entry.place } : {}),
    ...reading,
    ...(entry.amountMinor !== undefined
      ? { costAmountMinor: entry.amountMinor, costCurrency: entry.currency }
      : {}),
    ...(entry.trip ? { trip: entry.trip } : {}),
  });
  return {
    eventId: result.event.id,
    warnings: result.warnings.map((warning) => warning.message),
  };
}

export interface PlannedEntry {
  vehicleId: string;
  garageId: string;
  title: string;
  /** A repeating job: a schedule, due from its intervals. Otherwise a one-off task. */
  repeats: boolean;
  everyMonths?: number;
  everyDistance?: number;
  odometerUnit: DistanceUnit;
  /** `YYYY-MM-DD`, for a one-off. */
  due?: string;
}

export async function savePlanned(entry: PlannedEntry): Promise<void> {
  if (entry.repeats) {
    await api.maintenance.createPlan(entry.vehicleId, {
      title: entry.title,
      ...(entry.everyMonths ? { intervalMonths: entry.everyMonths } : {}),
      ...(entry.everyDistance
        ? { intervalDistance: entry.everyDistance, intervalDistanceUnit: entry.odometerUnit }
        : {}),
    });
    return;
  }
  // Filed against the vehicle, so it shows in the task centre too.
  await api.tasks.create({
    garageId: entry.garageId,
    vehicleId: entry.vehicleId,
    title: entry.title,
    ...(entry.due ? { dueDate: entry.due } : {}),
  });
}

/** "€", "$", "£": how a currency is written in front of an amount. */
export function symbolOf(currency: string): string {
  try {
    return (
      new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency,
        currencyDisplay: 'narrowSymbol',
      })
        .formatToParts(0)
        .find((part) => part.type === 'currency')?.value ?? currency
    );
  } catch {
    return currency;
  }
}

/**
 * The currency a typed amount is in: "€62" is euros whatever the vehicle counts in. A bare "$"
 * is the vehicle's own dollar when it counts in one, else the US dollar; no sign at all is the
 * vehicle's currency.
 */
export function currencyOfLine(written: string | null, vehicleCurrency: string): string | null {
  if (written === '$') return symbolOf(vehicleCurrency).includes('$') ? vehicleCurrency : 'USD';
  return written;
}
