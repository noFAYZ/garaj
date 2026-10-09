/**
 * Data in and out (PRD §6.5).
 *
 * One module for both directions rather than an `export` route inside each module that owns
 * a dataset: the CSV writer, the column order and the file naming are the same code either
 * way, and splitting them across four modules would mean four copies of it that drift.
 */

import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import {
  ExportQuery,
  GarageIdParam,
  ImportReport,
  ImportRequest,
  StandardErrors,
  VehicleIdParam,
} from '@vehicle-os/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { schema } from '@vehicle-os/database';
import { and, eq, isNull } from 'drizzle-orm';
import { toCsv } from '../../../../infrastructure/csv';
import {
  DOCUMENT_COLUMNS,
  EVENT_COLUMNS,
  EXPENSE_COLUMNS,
  MAINTENANCE_COLUMNS,
  buildArchive,
  exportDocuments,
  exportEvents,
  exportExpenses,
  exportMaintenance,
  type ExportWindow,
} from '../../application/services/export-archive';
import { importCsv } from '../../application/commands/import-csv';
import { garageDefaultCurrency } from '../../../expenses/infrastructure/repositories/expense-repository';

function commandMeta(request: FastifyRequest) {
  return {
    requestId: request.id,
    ipAddress: request.ip,
    actorEmail: request.actor?.email ?? null,
  };
}

function range(query: { from?: string; to?: string }): ExportWindow {
  return {
    from: query.from ? new Date(query.from) : undefined,
    to: query.to ? new Date(query.to) : undefined,
  };
}

/**
 * The file the browser saves.
 *
 * `Content-Disposition` with a filename, because the alternative is a download called
 * `export` with no extension that Windows opens in Notepad. The date is in the name so a
 * folder of monthly backups sorts itself.
 */
function asDownload(reply: FastifyReply, name: string, type: string, body: string): FastifyReply {
  const stamp = new Date().toISOString().slice(0, 10);
  return (
    reply
      .header('content-type', `${type}; charset=utf-8`)
      .header(
        'content-disposition',
        `attachment; filename="${name}-${stamp}.${type.split('/')[1]}"`,
      )
      // A backup is a snapshot of the moment it was taken; a cached one is a lie about when.
      .header('cache-control', 'no-store')
      .send(body)
  );
}

async function writeExport(
  reply: FastifyReply,
  rows: {
    format: 'csv' | 'json';
    dataset: 'expenses' | 'events' | 'maintenance' | 'documents';
    name: string;
    csv: () => Promise<string>;
    json: () => Promise<unknown>;
  },
): Promise<FastifyReply> {
  if (rows.format === 'json') {
    return asDownload(
      reply,
      rows.name,
      'application/json',
      JSON.stringify(await rows.json(), null, 2),
    );
  }
  return asDownload(reply, `${rows.name}-${rows.dataset}`, 'text/csv', await rows.csv());
}

async function csvFor(
  db: Parameters<typeof exportExpenses>[0],
  dataset: 'expenses' | 'events' | 'maintenance' | 'documents',
  vehicleIds: readonly string[],
  window: ExportWindow,
): Promise<string> {
  switch (dataset) {
    case 'events':
      return toCsv(EVENT_COLUMNS, await exportEvents(db, vehicleIds, window));
    case 'maintenance':
      return toCsv(MAINTENANCE_COLUMNS, await exportMaintenance(db, vehicleIds, window));
    case 'documents':
      return toCsv(DOCUMENT_COLUMNS, await exportDocuments(db, vehicleIds));
    case 'expenses':
    default:
      return toCsv(EXPENSE_COLUMNS, await exportExpenses(db, vehicleIds, window));
  }
}

export const transferRoutes: FastifyPluginAsyncTypebox = async (fastify) => {
  fastify.get(
    '/:vehicleId/export',
    {
      schema: {
        tags: ['transfer'],
        summary: 'Download this vehicle’s history',
        description:
          'CSV returns one dataset; JSON returns all of them, which is the shape a backup ' +
          'wants. Amounts leave in the currency and minor units they were stored in — ' +
          'nothing is converted on the way out. Documents are indexed, not included.',
        params: VehicleIdParam,
        querystring: ExportQuery,
        produces: ['text/csv', 'application/json'],
        response: StandardErrors,
      },
    },
    async (request, reply) => {
      /*
       * `expense.read` covers the CSV datasets a reader would call an export; the document
       * *index* rides along on the same check because it carries titles and dates, not
       * bytes — downloading a file is still its own authorized request.
       */
      await fastify.requireVehicleAccess(request, request.params.vehicleId, 'expense.read');

      const ids = [request.params.vehicleId];
      const window = range(request.query);
      const format = request.query.format ?? 'csv';
      const dataset = request.query.dataset ?? 'expenses';

      return writeExport(reply, {
        format,
        dataset,
        name: `garaj-${request.params.vehicleId.slice(0, 8)}`,
        csv: () => csvFor(fastify.db, dataset, ids, window),
        json: () => buildArchive(fastify.db, ids, window),
      });
    },
  );

  fastify.post(
    '/:vehicleId/import',
    {
      // A decade of fill-ups is a few hundred kilobytes of CSV, which is above the app-wide
      // JSON limit and nowhere near large enough to justify an object-storage round trip.
      bodyLimit: 5_242_880,
      schema: {
        tags: ['transfer'],
        summary: 'Import a fuel or expense log',
        description:
          'Dry by default: the report says what would be created without creating it. Row ' +
          'ids are derived from the row’s own content, so sending the same file twice ' +
          'imports it once — a failed upload is resumed by sending it again.',
        params: VehicleIdParam,
        body: ImportRequest,
        response: { 200: ImportReport, ...StandardErrors },
      },
    },
    async (request) => {
      const access = await fastify.requireVehicleAccess(
        request,
        request.params.vehicleId,
        'expense.write',
      );

      /*
       * Neither fuel-log format records a currency, so one has to be assumed — the garage's
       * default, which is the currency every other figure on this vehicle is already quoted
       * in. The report echoes it back per row, so an assumption that was wrong is visible in
       * the dry run rather than after the fact.
       */
      const currency = await garageDefaultCurrency(fastify.db, access.garageId);

      return importCsv(
        fastify.db,
        access.actor,
        request.params.vehicleId,
        access.garageId,
        {
          format: request.body.format,
          csv: request.body.csv,
          dryRun: request.body.dryRun ?? true,
          currency,
          // The vehicle's own unit: an odometer column in a file for a car logged in miles
          // is in miles, whatever the importing user's profile says.
          distanceUnit: access.vehicle.odometerUnit,
          volumeUnit: request.body.volumeUnit ?? 'LITER',
        },
        commandMeta(request),
      );
    },
  );
};

/**
 * The garage-wide export.
 *
 * Separate plugin because it hangs off `/garages`, not `/vehicles` — and separate route
 * rather than a `?garageId=` on the one above, so the authorization check is the garage's
 * own rather than a vehicle's inferred from it.
 */
export const garageTransferRoutes: FastifyPluginAsyncTypebox = async (fastify) => {
  fastify.get(
    '/:garageId/export',
    {
      schema: {
        tags: ['transfer'],
        summary: 'Download every vehicle in this garage',
        params: GarageIdParam,
        querystring: ExportQuery,
        produces: ['text/csv', 'application/json'],
        response: StandardErrors,
      },
    },
    async (request, reply) => {
      fastify.requireCapability(request, 'expense.read', request.params.garageId);

      const vehicles = await fastify.db
        .select({ id: schema.vehicles.id })
        .from(schema.vehicles)
        .where(
          and(
            eq(schema.vehicles.garageId, request.params.garageId),
            isNull(schema.vehicles.deletedAt),
          ),
        );

      const ids = vehicles.map((vehicle) => vehicle.id);
      const window = range(request.query);
      const format = request.query.format ?? 'csv';
      const dataset = request.query.dataset ?? 'expenses';

      return writeExport(reply, {
        format,
        dataset,
        name: `garaj-garage-${request.params.garageId.slice(0, 8)}`,
        csv: () => csvFor(fastify.db, dataset, ids, window),
        json: () => buildArchive(fastify.db, ids, window),
      });
    },
  );
};
