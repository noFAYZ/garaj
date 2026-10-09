/**
 * Getting data out, and getting it in (PRD §6.5).
 *
 * Both directions in one contract because they are one promise: the file an export writes
 * is a file the importer accepts, so "your data is yours" is something a user can verify in
 * an afternoon rather than something the marketing page says.
 */

import { Type, type Static } from '@sinclair/typebox';
import { IsoDateTime, Uuid } from './common';
import { VolumeUnit } from './expenses';

/**
 * What to export.
 *
 * One dataset per CSV, because a single file holding events, expenses and documents would
 * need a column union none of the three fills in — the spreadsheet that opens it would be
 * three tables stacked with blanks between them. JSON gets all of it at once, which is the
 * shape a backup wants.
 */
export const EXPORT_DATASETS = ['expenses', 'events', 'maintenance', 'documents'] as const;
export const ExportDataset = Type.Union(EXPORT_DATASETS.map((name) => Type.Literal(name)));
export type ExportDataset = Static<typeof ExportDataset>;

export const ExportQuery = Type.Object({
  format: Type.Optional(Type.Union([Type.Literal('csv'), Type.Literal('json')])),
  /** Ignored by `json`, which carries every dataset. Defaults to `expenses` for `csv`. */
  dataset: Type.Optional(ExportDataset),
  from: Type.Optional(IsoDateTime),
  to: Type.Optional(IsoDateTime),
});
export type ExportQuery = Static<typeof ExportQuery>;

/**
 * Column shapes the importer understands.
 *
 * `garaj` is this product's own export, so a file can make the round trip; the other two are
 * the apps people are most likely to be leaving. A format is a *named mapping*, not a guess:
 * sniffing the columns would turn a mis-detected file into silently wrong history, and an
 * import is the one place a bad row looks authoritative afterwards.
 */
export const IMPORT_FORMATS = ['garaj', 'fuelly', 'drivvo', 'fuelio', 'mycars'] as const;
export const ImportFormat = Type.Union(IMPORT_FORMATS.map((name) => Type.Literal(name)));
export type ImportFormat = Static<typeof ImportFormat>;

export const ImportRequest = Type.Object(
  {
    format: ImportFormat,
    /** The file's text. Uploads go to object storage; this one is small enough to post. */
    csv: Type.String({ minLength: 1, maxLength: 4_000_000 }),
    /**
     * Report what would happen and write nothing.
     *
     * Defaults to true: an import that silently creates 900 rows on a mis-picked format is
     * the failure this whole feature has to be careful about, so committing is the
     * deliberate second call.
     */
    dryRun: Type.Optional(Type.Boolean({ default: true })),
    /**
     * What the file's volume column is in. None of the formats say, and the same Fuelly
     * "gallons" column is US gallons for one user and imperial for another — so it is asked,
     * not guessed. Defaults to litres.
     */
    volumeUnit: Type.Optional(VolumeUnit),
  },
  { additionalProperties: false },
);
export type ImportRequest = Static<typeof ImportRequest>;

/** A row the importer could not map, named by its line in the file the user is looking at. */
export const ImportProblem = Type.Object({
  /** 1-based, counting the header — the number the spreadsheet shows in its gutter. */
  line: Type.Integer(),
  message: Type.String(),
});

export const ImportPreviewRow = Type.Object({
  line: Type.Integer(),
  occurredAt: IsoDateTime,
  category: Type.String(),
  description: Type.String(),
  amountMinor: Type.Integer(),
  currency: Type.String(),
  odometer: Type.Union([Type.Integer(), Type.Null()]),
  quantity: Type.Union([Type.String(), Type.Null()]),
});

/**
 * What an import did, or would do.
 *
 * `duplicates` is separate from `created` on purpose: re-running the same file is the
 * expected way to resume a half-finished import, and a report that counted the second run's
 * no-ops as creations would make it look like the history doubled.
 */
export const ImportReport = Type.Object({
  vehicleId: Uuid,
  format: ImportFormat,
  dryRun: Type.Boolean(),
  rowsRead: Type.Integer(),
  created: Type.Integer(),
  duplicates: Type.Integer(),
  failed: Type.Integer(),
  problems: Type.Array(ImportProblem),
  /** The first rows as the importer read them, so a wrong mapping is visible before it lands. */
  preview: Type.Array(ImportPreviewRow),
  /** The unit the quantities were read in, echoed so a wrong choice shows in the dry run. */
  volumeUnit: VolumeUnit,
});
export type ImportReport = Static<typeof ImportReport>;
