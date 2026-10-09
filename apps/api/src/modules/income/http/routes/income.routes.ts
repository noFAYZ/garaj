import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import { eq } from 'drizzle-orm';
import { schema } from '@vehicle-os/database';
import {
  CreateIncome,
  Income,
  IncomeList,
  IncomeQuery,
  IncomeSummary,
  StandardErrors,
  UpdateIncome,
} from '@vehicle-os/contracts';
import { newId } from '@vehicle-os/utils';
import { NotFoundError, ValidationError } from '../../../../infrastructure/errors';
import {
  decodeKeysetCursor,
  encodeCursor,
  normaliseLimit,
  toPage,
} from '../../../../infrastructure/pagination';
import { primaryCurrency } from '../../../expenses/domain/cost';
import {
  garageCostSettings,
  odometerSpan,
  sumByCategory,
} from '../../../expenses/infrastructure/repositories/expense-repository';
import { computeNet } from '../../domain/net';
import {
  findIncomeById,
  listIncome,
  sumIncome,
  sumIncomeByCategory,
  sumIncomeByDriver,
} from '../../infrastructure/repositories/income-repository';
import { serializeIncome } from '../serializers/income-serializer';

const VehicleIdParam = Type.Object({ vehicleId: Type.String({ format: 'uuid' }) });
const IncomeIdParam = Type.Object({
  vehicleId: Type.String({ format: 'uuid' }),
  incomeId: Type.String({ format: 'uuid' }),
});

/**
 * What a vehicle earned (GAPS §14).
 *
 * Two gates on every route, answering different questions. `expense.read` / `.write` is the
 * role: a DRIVER may log what they earned, a VIEWER may not. `income.track` is the plan, and
 * this is the business tier's reason to exist. A free owner gets 402 with the tier named; a
 * viewer on a business plan gets 403. Neither is told the other's answer.
 */
export const incomeRoutes: FastifyPluginAsyncTypebox = async (fastify) => {
  fastify.get(
    '/:vehicleId/income',
    {
      schema: {
        tags: ['income'],
        summary: 'What this vehicle has earned',
        params: VehicleIdParam,
        querystring: IncomeQuery,
        response: { 200: IncomeList, ...StandardErrors },
      },
    },
    async (request) => {
      const access = await fastify.requireVehicleAccess(
        request,
        request.params.vehicleId,
        'expense.read',
      );
      await fastify.requireEntitlement(request, 'income.track', access.garageId);

      const limit = normaliseLimit(request.query.limit);
      const cursor = request.query.cursor ? decodeKeysetCursor(request.query.cursor) : undefined;

      const rows = await listIncome(fastify.db, request.params.vehicleId, {
        limit,
        from: request.query.from ? new Date(request.query.from) : undefined,
        to: request.query.to ? new Date(request.query.to) : undefined,
        category: request.query.category,
        driverId: request.query.driverId,
        cursor: cursor ? { occurredAt: cursor.at, id: cursor.id } : undefined,
      });

      const page = toPage(rows, limit, (row) => encodeCursor([row.occurredAt, row.id]));
      return { ...page, data: page.data.map(serializeIncome) };
    },
  );

  /**
   * Earned against spent, in one currency.
   *
   * The currency and the spend come from the same rows and the same `primaryCurrency` the
   * cost summary uses, rather than being decided again here — profit and cost showing as two
   * different answers on one screen is the failure this endpoint would otherwise introduce.
   */
  fastify.get(
    '/:vehicleId/income/summary',
    {
      schema: {
        tags: ['income'],
        summary: 'Earned against spent, per category and per driver',
        description:
          'In the cost summary’s currency. Income in another currency is left out of the ' +
          'totals and listed separately, exactly as spend in another currency is.',
        params: VehicleIdParam,
        querystring: Type.Object({
          from: Type.Optional(Type.String({ format: 'date-time' })),
          to: Type.Optional(Type.String({ format: 'date-time' })),
        }),
        response: { 200: IncomeSummary, ...StandardErrors },
      },
    },
    async (request) => {
      const access = await fastify.requireVehicleAccess(
        request,
        request.params.vehicleId,
        'expense.read',
      );
      await fastify.requireEntitlement(request, 'income.track', access.garageId);

      const { vehicle } = access;
      const window = {
        from: request.query.from ? new Date(request.query.from) : undefined,
        to: request.query.to ? new Date(request.query.to) : undefined,
      };

      const [windowSums, lifetimeSums, settings, span] = await Promise.all([
        sumByCategory(fastify.db, vehicle.id, window),
        sumByCategory(fastify.db, vehicle.id),
        garageCostSettings(fastify.db, access.garageId),
        odometerSpan(fastify.db, vehicle.id),
      ]);

      const currency = primaryCurrency(
        {
          windowSums: [],
          lifetimeSums,
          purchasePriceAmountMinor: vehicle.purchasePriceAmountMinor,
          purchasePriceCurrency: vehicle.purchasePriceCurrency,
          purchaseDate: vehicle.purchaseDate,
          odometerLow: null,
          odometerHigh: null,
          now: new Date(),
        },
        settings.currency,
      );

      /*
       * The purchase is left out of what the vehicle "cost to run" here, as it is in
       * `costPerDistance`: a taxi bought for £20,000 did not lose money in its first week.
       */
      const totalSpentMinor = windowSums
        .filter((sum) => sum.currency === currency && sum.category !== 'PURCHASE')
        .reduce((total, sum) => total + sum.amountMinor, 0);

      const distanceCovered =
        span.low !== null && span.high !== null && span.high > span.low
          ? span.high - span.low
          : null;

      const [earned, byCategory, byDriver] = await Promise.all([
        sumIncome(fastify.db, vehicle.id, window),
        sumIncomeByCategory(fastify.db, vehicle.id, currency, window),
        sumIncomeByDriver(fastify.db, vehicle.id, currency, window),
      ]);

      const net = computeNet({ earned, spentMinor: totalSpentMinor, currency, distanceCovered });

      return {
        vehicleId: vehicle.id,
        currency,
        totalEarned: { amountMinor: net.totalEarnedMinor, currency },
        totalSpent: { amountMinor: totalSpentMinor, currency },
        netMinor: net.netMinor,
        byCategory,
        byDriver,
        earnedPerDistance:
          net.earnedPerDistanceMinor === null
            ? null
            : { amountMinor: net.earnedPerDistanceMinor, currency },
        distanceUnit: vehicle.odometerUnit,
        otherCurrencies: net.otherCurrencies,
      };
    },
  );

  fastify.post(
    '/:vehicleId/income',
    {
      schema: {
        tags: ['income'],
        summary: 'Record what the vehicle earned',
        params: VehicleIdParam,
        body: CreateIncome,
        response: { 201: Income, ...StandardErrors },
      },
    },
    async (request, reply) => {
      const access = await fastify.requireVehicleAccess(
        request,
        request.params.vehicleId,
        'expense.write',
      );
      await fastify.requireEntitlement(request, 'income.track', access.garageId);
      if (request.body.driverId) {
        await fastify.requireEntitlement(request, 'driver.assign', access.garageId);
        await assertDriverInGarage(fastify.db, request.body.driverId, access.garageId);
      }

      const [row] = await fastify.db
        .insert(schema.vehicleIncome)
        .values({
          id: newId(),
          vehicleId: request.params.vehicleId,
          category: request.body.category,
          description: request.body.description,
          payer: request.body.payer ?? null,
          amountMinor: request.body.amountMinor,
          currency: request.body.currency,
          occurredAt: new Date(request.body.occurredAt),
          odometer: request.body.odometer ?? null,
          // The vehicle's own unit when the client does not say, which is what the entry
          // forms record — a reading in the wrong unit is wrong at the one place it matters.
          odometerUnit: request.body.odometerUnit ?? access.vehicle.odometerUnit,
          driverId: request.body.driverId ?? null,
          createdBy: access.actor.userId,
        })
        .returning({ id: schema.vehicleIncome.id });

      const created = await findIncomeById(fastify.db, row!.id);
      return reply.status(201).send(serializeIncome(created!));
    },
  );

  fastify.patch(
    '/:vehicleId/income/:incomeId',
    {
      schema: {
        tags: ['income'],
        summary: 'Correct a recorded income',
        description: 'Only the supplied fields change; an omitted one is left as-is.',
        params: IncomeIdParam,
        body: UpdateIncome,
        response: { 200: Income, ...StandardErrors },
      },
    },
    async (request) => {
      const access = await fastify.requireVehicleAccess(
        request,
        request.params.vehicleId,
        'expense.write',
      );
      await fastify.requireEntitlement(request, 'income.track', access.garageId);

      const existing = await findIncomeById(fastify.db, request.params.incomeId);
      /*
       * A row belonging to another vehicle answers 404, not 403 — the caller passed an id
       * that is not theirs to see, and confirming it exists is the leak.
       */
      if (!existing || existing.vehicleId !== request.params.vehicleId) {
        throw new NotFoundError('Income');
      }
      if (request.body.driverId) {
        await fastify.requireEntitlement(request, 'driver.assign', access.garageId);
        await assertDriverInGarage(fastify.db, request.body.driverId, access.garageId);
      }

      const { occurredAt, ...rest } = request.body;
      const changes = Object.fromEntries(
        Object.entries(rest).filter(([, value]) => value !== undefined),
      );

      await fastify.db
        .update(schema.vehicleIncome)
        .set({
          ...changes,
          ...(occurredAt === undefined ? {} : { occurredAt: new Date(occurredAt) }),
        })
        .where(eq(schema.vehicleIncome.id, request.params.incomeId));

      return serializeIncome((await findIncomeById(fastify.db, request.params.incomeId))!);
    },
  );

  fastify.delete(
    '/:vehicleId/income/:incomeId',
    {
      schema: {
        tags: ['income'],
        summary: 'Remove a recorded income',
        params: IncomeIdParam,
        response: { 204: Type.Null(), ...StandardErrors },
      },
    },
    async (request, reply) => {
      const access = await fastify.requireVehicleAccess(
        request,
        request.params.vehicleId,
        'expense.delete',
      );
      await fastify.requireEntitlement(request, 'income.track', access.garageId);

      const existing = await findIncomeById(fastify.db, request.params.incomeId);
      if (!existing || existing.vehicleId !== request.params.vehicleId) {
        throw new NotFoundError('Income');
      }

      await fastify.db
        .delete(schema.vehicleIncome)
        .where(eq(schema.vehicleIncome.id, request.params.incomeId));
      return reply.status(204).send(null);
    },
  );
};

/**
 * A driver must be a member of the garage the vehicle is in.
 *
 * Without this, a membership id from another garage attributes a fleet's earnings to someone
 * who was never in it — and the per-driver report would look perfectly normal.
 */
async function assertDriverInGarage(
  db: Parameters<typeof findIncomeById>[0],
  driverId: string,
  garageId: string,
): Promise<void> {
  const [member] = await db
    .select({ garageId: schema.garageMembers.garageId })
    .from(schema.garageMembers)
    .where(eq(schema.garageMembers.id, driverId))
    .limit(1);

  if (!member || member.garageId !== garageId) {
    throw new ValidationError('That driver is not a member of this garage', {
      driverId: 'not a member of this garage',
    });
  }
}
