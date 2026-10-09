/**
 * The mileage report (GAPS §6): trips in a period, for a tax return or an expense claim.
 *
 * Its own file rather than another route in `event.routes.ts`: a report has a CSV body and a
 * reader outside the product, and it is the one events route an accountant will ask about.
 */

import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { and, asc, eq, gte, isNotNull, lte } from 'drizzle-orm';
import { schema } from '@vehicle-os/database';
import {
  MileageReport,
  MileageReportQuery,
  StandardErrors,
  VehicleIdParam,
} from '@vehicle-os/contracts';
import { minorUnitExponent, type TripPurpose } from '@vehicle-os/domain';
import { toCsv } from '../../../../infrastructure/csv';
import { serializeTrip } from '../serializers/event-serializer';

const CSV_COLUMNS = [
  'date',
  'title',
  'purpose',
  'startOdometer',
  'endOdometer',
  'distance',
  'unit',
  'rate',
  'deduction',
  'currency',
  'notes',
] as const;

export const mileageRoutes: FastifyPluginAsyncTypebox = async (fastify) => {
  fastify.get(
    '/:vehicleId/mileage-report',
    {
      schema: {
        tags: ['events'],
        summary: 'Trips in a period, with distance and deduction per purpose',
        description:
          'Deductions use the rate stored on each trip, never a current one, and are totalled ' +
          'per currency. `format=csv` returns the same trips as a spreadsheet.',
        params: VehicleIdParam,
        querystring: MileageReportQuery,
        produces: ['application/json', 'text/csv'],
        response: { 200: MileageReport, ...StandardErrors },
      },
    },
    async (request, reply) => {
      const access = await fastify.requireVehicleAccess(
        request,
        request.params.vehicleId,
        'event.read',
      );
      await fastify.requireEntitlement(request, 'mileage.report', access.garageId);

      const from = new Date(request.query.from);
      const to = new Date(request.query.to);

      const rows = await fastify.db
        .select()
        .from(schema.vehicleEvents)
        .where(
          and(
            eq(schema.vehicleEvents.vehicleId, request.params.vehicleId),
            eq(schema.vehicleEvents.eventType, 'TRIP'),
            isNotNull(schema.vehicleEvents.tripPurpose),
            gte(schema.vehicleEvents.occurredAt, from),
            lte(schema.vehicleEvents.occurredAt, to),
          ),
        )
        .orderBy(asc(schema.vehicleEvents.occurredAt), asc(schema.vehicleEvents.id));

      const totals: Record<TripPurpose, number> = { BUSINESS: 0, PERSONAL: 0, COMMUTE: 0 };
      const deductions = new Map<string, number>();
      let unratedBusinessTrips = 0;

      const trips = rows.flatMap((row) => {
        const trip = serializeTrip(row);
        if (!trip) return [];
        totals[trip.purpose] += trip.distance;
        // Only business trips are deductible; a rate typed on a personal trip is kept on the
        // record but never counted toward a claim.
        if (trip.purpose === 'BUSINESS') {
          if (trip.deduction) {
            deductions.set(
              trip.deduction.currency,
              (deductions.get(trip.deduction.currency) ?? 0) + trip.deduction.amountMinor,
            );
          } else {
            unratedBusinessTrips += 1;
          }
        }
        return [{ row, trip }];
      });

      /*
       * One unit for the whole report: the vehicle's. A trip entered in the other unit is
       * rare (an imported log, a unit changed later) and its distance is reported as stored,
       * with the unit column saying so in the CSV.
       */
      const distanceUnit = access.vehicle.odometerUnit;

      if (request.query.format === 'csv') {
        const csv = toCsv(
          CSV_COLUMNS,
          trips.map(({ row, trip }) => ({
            date: row.occurredAt.toISOString().slice(0, 10),
            title: row.title,
            purpose: trip.purpose,
            startOdometer: trip.startOdometer,
            endOdometer: trip.startOdometer === null ? null : row.odometer,
            distance: trip.distance,
            unit: row.odometerUnit ?? distanceUnit,
            // Major units, as a claim form wants them; exact because it is a string, not a float sum.
            rate: trip.rate ? formatMajor(trip.rate.amountMinor, trip.rate.currency) : null,
            deduction:
              trip.purpose === 'BUSINESS' && trip.deduction
                ? formatMajor(trip.deduction.amountMinor, trip.deduction.currency)
                : null,
            currency: trip.rate?.currency ?? null,
            notes: row.description,
          })),
        );
        const name = `mileage-${request.query.from.slice(0, 10)}-to-${request.query.to.slice(0, 10)}.csv`;
        return (
          reply
            .header('content-type', 'text/csv; charset=utf-8')
            .header('content-disposition', `attachment; filename="${name}"`)
            .header('cache-control', 'no-store')
            // The 200 schema describes the JSON body; a string with a non-JSON content type is
            // sent as-is by Fastify, which the type provider cannot express.
            .send(csv as never)
        );
      }

      return {
        vehicleId: request.params.vehicleId,
        from: from.toISOString(),
        to: to.toISOString(),
        distanceUnit,
        totals,
        deductions: [...deductions].map(([currency, amountMinor]) => ({ amountMinor, currency })),
        unratedBusinessTrips,
        trips: trips.map(({ row, trip }) => ({
          eventId: row.id,
          occurredAt: row.occurredAt.toISOString(),
          title: row.title,
          description: row.description,
          trip,
        })),
      };
    },
  );
};

/** Minor units as a plain decimal string in the currency's own precision: 2940 USD → "29.40". */
function formatMajor(amountMinor: number, currency: string): string {
  const digits = minorUnitExponent(currency);
  return (amountMinor / 10 ** digits).toFixed(digits);
}
