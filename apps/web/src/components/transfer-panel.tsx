'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { planWall } from '@vehicle-os/api-client';
import { LockedFeature } from '@/components/upgrade-dialog';
import { FormError, ModalActions } from '@/components/ui/modal';
import { DateRangeField } from '@/components/ui/date-picker';
import { useState } from 'react';
import type { ExportDataset, ImportFormat, ImportReport } from '@vehicle-os/contracts';
import type { VolumeUnit } from '@vehicle-os/domain';
import { garagesQuery, queryKeys } from '@vehicle-os/api-client/react';
import { api } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import { Button } from '@/components/ui/primitives';
import { SelectField } from '@/components/ui/select-field';
import { SettingRow } from '@/components/ui/setting-row';
import { Skeleton } from '@/components/ui/skeleton';

const DATASET_OPTIONS: { value: ExportDataset; label: string }[] = [
  { value: 'expenses', label: 'Expenses' },
  { value: 'events', label: 'Timeline' },
  { value: 'maintenance', label: 'Service records' },
  { value: 'documents', label: 'Document index' },
];

/** The file never says; the user does. The same "gallons" column is US for some, imperial for others. */
const VOLUME_OPTIONS: { value: VolumeUnit; label: string }[] = [
  { value: 'LITER', label: 'Litres' },
  { value: 'US_GALLON', label: 'US gallons' },
  { value: 'IMP_GALLON', label: 'Imperial gallons' },
];

const FORMAT_OPTIONS: { value: ImportFormat; label: string }[] = [
  { value: 'fuelly', label: 'Fuelly' },
  { value: 'drivvo', label: 'Drivvo' },
  { value: 'garaj', label: 'Garaj export' },
];

/**
 * Hands a fetched file to the browser as a download.
 *
 * The object URL is revoked on the next tick rather than immediately: Safari starts the
 * download asynchronously and a URL revoked in the same task saves a zero-byte file.
 */
export function save({ blob, filename }: { blob: Blob; filename: string }) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

type Download = () => Promise<{ blob: Blob; filename: string }>;

/** CSV of one dataset, or everything as JSON — the two buttons every export surface shows. */
function ExportControls({
  csv,
  json,
}: {
  csv: (dataset: ExportDataset) => Download;
  json: Download;
}) {
  const [dataset, setDataset] = useState<ExportDataset>('expenses');

  // `toast: false`: the download bar is the result, and a toast saying so is noise.
  const download = useMutation({
    mutationFn: async (run: Download) => save(await run()),
    meta: { toast: false },
  });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <SelectField
          label="Dataset"
          value={dataset}
          onChange={(value) => setDataset(value as ExportDataset)}
          options={DATASET_OPTIONS}
          className="w-48"
        />
        <Button
          loading={download.isPending && download.variables !== json}
          disabled={download.isPending}
          onClick={() => download.mutate(csv(dataset))}
        >
          Download CSV
        </Button>
        <Button
          variant="ghost"
          loading={download.isPending && download.variables === json}
          disabled={download.isPending}
          onClick={() => download.mutate(json)}
        >
          Everything as JSON
        </Button>
      </div>
      {download.isError ? <FormError>{(download.error as Error).message}</FormError> : null}
    </div>
  );
}

function ImportReportView({
  report,
  currencyNote,
}: {
  report: ImportReport;
  currencyNote: boolean;
}) {
  const figures = [
    { label: report.dryRun ? 'Would add' : 'Added', value: report.created },
    { label: 'Already here', value: report.duplicates },
    { label: 'Unreadable', value: report.failed },
  ];

  return (
    <div className="flex flex-col gap-3 rounded-xl bg-muted/60 p-4" role="status">
      <dl className="grid grid-cols-3 gap-2">
        {figures.map((figure) => (
          <div key={figure.label}>
            <dt className="text-label uppercase text-muted-foreground">{figure.label}</dt>
            <dd className="font-mono text-lg tabular-nums text-foreground">
              {String(figure.value).padStart(2, '0')}
            </dd>
          </div>
        ))}
      </dl>

      {report.preview.length > 0 ? (
        <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
          {report.preview.map((row) => (
            <li key={row.line} className="flex justify-between gap-3">
              <span className="truncate">
                <span className="font-mono tabular-nums">{row.occurredAt.slice(0, 10)}</span> ·{' '}
                {row.description}
              </span>
              <span className="shrink-0 font-mono tabular-nums">
                {formatMoney({ amountMinor: row.amountMinor, currency: row.currency })}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {report.problems.length > 0 ? (
        <ul className="flex flex-col gap-1 text-xs text-destructive">
          {report.problems.slice(0, 5).map((problem) => (
            <li key={problem.line}>
              Line <span className="font-mono tabular-nums">{problem.line}</span>: {problem.message}
            </li>
          ))}
        </ul>
      ) : null}

      {currencyNote ? (
        <p className="text-xs text-muted-foreground">
          The file has no currency, so amounts use this garage’s default. Check the preview.
        </p>
      ) : null}
    </div>
  );
}

/**
 * Import is two presses on purpose: the first is a dry run that shows what would land, and
 * only the second writes. A mis-picked format is then a paragraph on screen, not a year of
 * wrong history.
 */
function ImportControls({ vehicleId }: { vehicleId: string }) {
  const queryClient = useQueryClient();
  const [format, setFormat] = useState<ImportFormat>('fuelly');
  const [volumeUnit, setVolumeUnit] = useState<VolumeUnit>('LITER');
  const [csv, setCsv] = useState<string | null>(null);

  const run = useMutation({
    mutationFn: (dryRun: boolean) =>
      api.transfer.import(vehicleId, { format, csv: csv!, dryRun, volumeUnit }),
    meta: { toast: false },
    onSuccess: (report) => {
      if (report.dryRun) return;
      void queryClient.invalidateQueries({ queryKey: queryKeys.vehicle(vehicleId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard() });
    },
  });

  const report = run.data;
  const committed = report && !report.dryRun;
  // Read before the JSX: inside the branches below TypeScript narrows `run` by `report` and
  // loses `variables`.
  const checking = run.isPending && run.variables === true;
  const importing = run.isPending && run.variables === false;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <SelectField
          label="From"
          value={format}
          onChange={(value) => {
            setFormat(value as ImportFormat);
            run.reset();
          }}
          options={FORMAT_OPTIONS}
          className="w-40"
        />
        {/* A Garaj export names its unit on every row, so there is nothing to ask. */}
        {format !== 'garaj' ? (
          <SelectField
            label="Volumes in"
            value={volumeUnit}
            onChange={(value) => {
              setVolumeUnit(value as VolumeUnit);
              run.reset();
            }}
            options={VOLUME_OPTIONS}
            className="w-44"
          />
        ) : null}
        <label className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">CSV file</span>
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={async (event) => {
              const file = event.currentTarget.files?.[0];
              run.reset();
              setCsv(file ? await file.text() : null);
            }}
            className="h-10 rounded-xl bg-input px-3 py-2 text-sm text-foreground file:mr-3 file:border-0 file:bg-transparent file:text-sm file:font-semibold file:text-foreground"
          />
        </label>
      </div>

      {report ? <ImportReportView report={report} currencyNote={format !== 'garaj'} /> : null}

      {run.isError ? <FormError>{(run.error as Error).message}</FormError> : null}

      <ModalActions>
        {report?.dryRun && report.created > 0 ? (
          <Button variant="primary" loading={importing} onClick={() => run.mutate(false)}>
            Import {report.created} {report.created === 1 ? 'row' : 'rows'}
          </Button>
        ) : (
          <Button
            variant={committed ? 'ghost' : 'primary'}
            disabled={!csv}
            loading={checking}
            onClick={() => run.mutate(true)}
          >
            {committed ? 'Check another file' : 'Check file'}
          </Button>
        )}
      </ModalActions>
    </div>
  );
}

/** Start of this calendar year and today, as `YYYY-MM-DD` — the period most claims cover. */
function yearToDate(): { from: string; to: string } {
  const today = new Date();
  return { from: `${today.getFullYear()}-01-01`, to: today.toISOString().slice(0, 10) };
}

/**
 * The mileage log for a tax return: business, personal and commute distance for a period, and
 * the deduction at the rate stored on each trip.
 */
function MileageReportControls({ vehicleId }: { vehicleId: string }) {
  const [range, setRange] = useState(yearToDate);
  const query = {
    from: new Date(`${range.from}T00:00:00`).toISOString(),
    to: new Date(`${range.to}T23:59:59`).toISOString(),
  };

  const download = useMutation({
    mutationFn: async () => save(await api.events.mileageReportCsv(vehicleId, query)),
    meta: { toast: false },
  });
  const report = useQuery({
    queryKey: ['vehicles', vehicleId, 'mileage-report', query],
    queryFn: () => api.events.mileageReport(vehicleId, query),
    enabled: Boolean(range.from && range.to),
  });

  const totals = report.data?.totals;
  const unit = report.data?.distanceUnit === 'MI' ? 'mi' : 'km';

  /*
   * Walled from the report's own answer rather than from a guess about the plan: whose plan
   * governs is the garage owner's, and the server is the one place that knows that for certain.
   * A 4xx is not retried (see `providers.tsx`), so the wall appears as fast as the figures would.
   */
  const wall = planWall(report.error);
  if (wall) {
    return <LockedFeature wall={wall} />;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <DateRangeField
          label="Period"
          value={range}
          onChange={setRange}
          max={new Date().toLocaleDateString('en-CA')}
          className="w-full sm:w-72"
        />
        <Button loading={download.isPending} onClick={() => download.mutate()}>
          Download CSV
        </Button>
      </div>
      {report.isPending ? (
        <Skeleton className="h-5 w-80 max-w-full" />
      ) : (
        <p className="text-sm text-muted-foreground" role="status">
          {totals
            ? `Business ${totals.BUSINESS.toLocaleString()} ${unit} · personal ${totals.PERSONAL.toLocaleString()} ${unit} · commute ${totals.COMMUTE.toLocaleString()} ${unit}` +
              (report.data!.deductions.length > 0
                ? ` · deductible ${report.data!.deductions.map((money) => formatMoney(money)).join(' + ')}`
                : '') +
              (report.data!.unratedBusinessTrips > 0
                ? ` · ${report.data!.unratedBusinessTrips} business ${report.data!.unratedBusinessTrips === 1 ? 'trip has' : 'trips have'} no rate`
                : '')
            : 'Log trips with a purpose to build the report.'}
        </p>
      )}
    </div>
  );
}

/** Export and import for one vehicle, opened from its ⋯ menu. */
export function VehicleTransferPanel({ vehicleId }: { vehicleId: string }) {
  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <h3 className="text-label uppercase text-muted-foreground">Download</h3>
        <ExportControls
          csv={(dataset) => () => api.transfer.exportVehicle(vehicleId, { dataset })}
          json={() => api.transfer.exportVehicle(vehicleId, { format: 'json' })}
        />
      </section>
      <section className="flex flex-col gap-3">
        <h3 className="text-label uppercase text-muted-foreground">Mileage report</h3>
        <MileageReportControls vehicleId={vehicleId} />
      </section>
      <section className="flex flex-col gap-3">
        <h3 className="text-label uppercase text-muted-foreground">Import a fuel log</h3>
        <ImportControls vehicleId={vehicleId} />
      </section>
    </div>
  );
}

/**
 * The garage-wide download, in Settings.
 *
 * With several garages the user picks one — nothing is preselected, because which garage's
 * records leave the product is theirs to say. With one, it is the only answer and is used.
 */
export function DataSettings() {
  const garages = useQuery(garagesQuery(api));
  const [chosen, setChosen] = useState('');

  const list = garages.data ?? [];
  const garageId = list.length === 1 ? list[0]!.id : chosen;

  return (
    <div className="flex flex-col gap-2">
      <SettingRow
        title="Download your data"
        description="Every record, as it was stored — nothing converted. Import a fuel log from a vehicle’s ⋯ menu."
      />
      <div className="flex flex-col gap-3 px-4 pb-3">
        {garages.isPending ? (
          <Skeleton className="h-10 w-64 rounded-xl" />
        ) : list.length > 1 ? (
          <SelectField
            label="Garage"
            value={chosen}
            onChange={setChosen}
            options={list.map((garage) => ({ value: garage.id, label: garage.name }))}
            placeholder="Choose a garage"
            className="w-64"
          />
        ) : null}
        {garageId ? (
          <ExportControls
            key={garageId}
            csv={(dataset) => () => api.transfer.exportGarage(garageId, { dataset })}
            json={() => api.transfer.exportGarage(garageId, { format: 'json' })}
          />
        ) : null}
      </div>
    </div>
  );
}
