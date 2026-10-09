import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import {
  CostSummary,
  CostTrends,
  CostSummaryQuery,
  MonthlySpend,
  MonthlySpendQuery,
  CreateExpense,
  Expense,
  FuelPrices,
  ExpenseParams,
  ListExpensesQuery,
  Paginated,
  StandardErrors,
  UpdateExpense,
  VehicleIdParam,
} from '@vehicle-os/contracts';
import type { FastifyInstance } from 'fastify';
import { env } from '@vehicle-os/config';
import { convertMinor, latestRates } from '../../../../infrastructure/fx';
import { NotFoundError } from '../../../../infrastructure/errors';
import {
  decodeKeysetCursor,
  encodeCursor,
  normaliseLimit,
  toPage,
} from '../../../../infrastructure/pagination';
import { computeCost, convertSums, primaryCurrency, type CostInput } from '../../domain/cost';
import { unitFamily } from '@vehicle-os/domain';
import { computeUsage, usageSeries } from '../../domain/energy';
import { distancePerYear, ownershipCurve } from '../../domain/trends';
import { computeFuelConsumption } from '../../domain/fuel';
import { fuelPrices } from '../../domain/fuel-price';
import { monthlySeries, windowStart } from '../../domain/monthly';
import {
  createExpense,
  editExpense,
  removeExpense,
} from '../../application/commands/manage-expenses';
import {
  findExpenseById,
  fuelFills,
  garageCostSettings,
  monthlyHistory,
  monthlySpend,
  odometerReadings,
  purchaseRecord,
  listExpenses,
  pricedFuelFills,
  odometerSpan,
  sumByCategory,
} from '../../infrastructure/repositories/expense-repository';
import { serializeExpense } from '../serializers/expense-serializer';
import type { FastifyRequest } from 'fastify';

function commandMeta(request: FastifyRequest) {
  return {
    requestId: request.id,
    ipAddress: request.ip,
    actorEmail: request.actor?.email ?? null,
  };
}

/**
 * What the excluded spend is worth in the summary's own currency.
 *
 * All or nothing: if any one currency is missing from the rate table the whole aside is
 * dropped, because a partial sum presented as "and about this much more" would be quietly
 * short by however much it could not convert.
 */
async function convertOtherCurrencies(
  fastify: FastifyInstance,
  totals: {
    currency: string;
    otherCurrencies: readonly { currency: string; amountMinor: number }[];
  },
): Promise<{
  otherCurrenciesConverted: { amountMinor: number; currency: string } | null;
  ratesAsOf: string | null;
}> {
  const absent = { otherCurrenciesConverted: null, ratesAsOf: null };
  if (totals.otherCurrencies.length === 0) return absent;

  const rates = await latestRates(env().FX_RATES_URL, fastify.log);
  if (!rates) return absent;

  let sum = 0;
  for (const other of totals.otherCurrencies) {
    const value = convertMinor(other.amountMinor, other.currency, totals.currency, rates);
    if (value === null) return absent;
    sum += value;
  }

  return {
    otherCurrenciesConverted: { amountMinor: sum, currency: totals.currency },
    ratesAsOf: rates.asOf,
  };
}

/**
 * The currency a vehicle's secondary figures are quoted in, and how to bring other
 * currencies into it when the garage asked for that.
 *
 * Resolved exactly as the cost summary resolves it — the chart, the fuel prices and the
 * totals on one screen in different currencies would be three answers to one question.
 * `convert` is null for a strict garage, or when rates cannot be had; callers then keep only
 * the rows paid in `currency`, which is the strict behaviour.
 */
async function reportingCurrency(
  fastify: FastifyInstance,
  vehicle: {
    id: string;
    purchasePriceAmountMinor: number | null;
    purchasePriceCurrency: string | null;
    purchaseDate: string | null;
  },
  garageId: string,
): Promise<{
  currency: string;
  convert: ((amountMinor: number, from: string) => number | null) | null;
  ratesAsOf: string | null;
}> {
  const [lifetimeSums, settings] = await Promise.all([
    sumByCategory(fastify.db, vehicle.id),
    garageCostSettings(fastify.db, garageId),
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

  const needsRates = lifetimeSums.some((sum) => sum.currency !== currency);
  if (settings.costReporting !== 'CONVERTED' || !needsRates) {
    return { currency, convert: null, ratesAsOf: null };
  }

  const rates = await latestRates(env().FX_RATES_URL, fastify.log);
  if (!rates) return { currency, convert: null, ratesAsOf: null };

  return {
    currency,
    convert: (amountMinor, from) => convertMinor(amountMinor, from, currency, rates),
    ratesAsOf: rates.asOf,
  };
}

export const expenseRoutes: FastifyPluginAsyncTypebox = async (fastify) => {
  fastify.get(
    '/:vehicleId/expenses',
    {
      schema: {
        tags: ['expenses'],
        summary: 'Expenses for a vehicle, newest first',
        params: VehicleIdParam,
        querystring: ListExpensesQuery,
        response: { 200: Paginated(Expense), ...StandardErrors },
      },
    },
    async (request) => {
      await fastify.requireVehicleAccess(request, request.params.vehicleId, 'expense.read');

      const limit = normaliseLimit(request.query.limit);
      const cursor = request.query.cursor ? decodeKeysetCursor(request.query.cursor) : undefined;

      const rows = await listExpenses(fastify.db, {
        vehicleId: request.params.vehicleId,
        category: request.query.category,
        from: request.query.from ? new Date(request.query.from) : undefined,
        to: request.query.to ? new Date(request.query.to) : undefined,
        limit,
        cursor: cursor ? { occurredAt: cursor.at, id: cursor.id } : undefined,
      });

      const page = toPage(rows, limit, (row) => encodeCursor([row.occurredAt, row.id]));
      return { data: page.data.map(serializeExpense), pagination: page.pagination };
    },
  );

  /*
   * Declared before `/:vehicleId/expenses/:expenseId` would be — Fastify's router prefers a
   * static segment over a parameter, so "cost" cannot be swallowed as an expense id, but
   * keeping the two adjacent makes that ordering visible rather than incidental.
   */
  fastify.get(
    '/:vehicleId/cost',
    {
      schema: {
        tags: ['expenses'],
        summary: 'What this vehicle has cost',
        description:
          'Every figure is computed server-side, in one currency. Amounts in other ' +
          'currencies are reported separately and never converted.',
        params: VehicleIdParam,
        querystring: CostSummaryQuery,
        response: { 200: CostSummary, ...StandardErrors },
      },
    },
    async (request) => {
      const access = await fastify.requireVehicleAccess(
        request,
        request.params.vehicleId,
        'expense.read',
      );

      const vehicle = access.vehicle;

      const window = {
        from: request.query.from ? new Date(request.query.from) : undefined,
        to: request.query.to ? new Date(request.query.to) : undefined,
      };

      const [windowSums, lifetimeSums, span, settings, fills] = await Promise.all([
        // The window sums are the same query when no window was given; issuing it twice
        // costs one index scan and keeps the two figures impossible to mix up.
        sumByCategory(fastify.db, request.params.vehicleId, window),
        sumByCategory(fastify.db, request.params.vehicleId),
        odometerSpan(fastify.db, request.params.vehicleId),
        garageCostSettings(fastify.db, access.garageId),
        fuelFills(fastify.db, request.params.vehicleId),
      ]);
      const fallback = settings.currency;

      const input: CostInput = {
        windowSums,
        lifetimeSums,
        purchasePriceAmountMinor: vehicle.purchasePriceAmountMinor,
        purchasePriceCurrency: vehicle.purchasePriceCurrency,
        purchaseDate: vehicle.purchaseDate,
        odometerLow: span.low,
        odometerHigh: span.high,
        now: new Date(),
      };
      const strict = computeCost(input, fallback);

      /*
       * The aside, not the answer: in strict mode every figure is the sum of rows stored in
       * `strict.currency`, and this says what the excluded spend comes to today. Awaited
       * after the sums so a slow provider delays the response rather than the query.
       */
      const converted = await convertOtherCurrencies(fastify, strict);

      /*
       * A garage that asked for one currency gets the aside folded into the figures — but
       * only when every currency converted, which `convertOtherCurrencies` already decided
       * (its result is all-or-nothing). Same rates, re-applied per group, so the headline and
       * the aside cannot disagree about what the rate was.
       */
      let totals = strict;
      let includesConverted = false;
      if (settings.costReporting === 'CONVERTED' && converted.otherCurrenciesConverted) {
        const rates = await latestRates(env().FX_RATES_URL, fastify.log);
        const to = (amountMinor: number, from: string) =>
          rates ? convertMinor(amountMinor, from, strict.currency, rates) : null;
        const windowConverted = convertSums(windowSums, strict.currency, to);
        const lifetimeConverted = convertSums(lifetimeSums, strict.currency, to);
        if (windowConverted && lifetimeConverted) {
          totals = computeCost(
            { ...input, windowSums: windowConverted, lifetimeSums: lifetimeConverted },
            strict.currency,
          );
          includesConverted = true;
        }
      }

      const money = (amountMinor: number) => ({ amountMinor, currency: totals.currency });

      // Rounded here rather than in the UI: two clients rounding the same float differently
      // is how the same car gets two consumption figures.
      const fuel = computeFuelConsumption(fills, vehicle.odometerUnit);
      const round = (value: number, places: number) =>
        Math.round(value * 10 ** places) / 10 ** places;

      return {
        vehicleId: request.params.vehicleId,
        currency: totals.currency,
        totalSpent: money(totals.totalSpentMinor),
        byCategory: [...totals.byCategory],
        purchasePrice: totals.purchasePriceMinor === null ? null : money(totals.purchasePriceMinor),
        ownershipCost: money(totals.ownershipCostMinor),
        costPerYear: totals.costPerYearMinor === null ? null : money(totals.costPerYearMinor),
        costPerDistance:
          totals.costPerDistanceMinor === null ? null : money(totals.costPerDistanceMinor),
        distanceCovered: totals.distanceCovered,
        distanceUnit: vehicle.odometerUnit,
        fuelConsumption:
          fuel === null
            ? null
            : {
                litersPer100Km: round(fuel.litersPer100Km, 2),
                milesPerUsGallon: round(fuel.milesPerUsGallon, 1),
                distanceCovered: round(fuel.distanceCovered, 0),
                liters: round(fuel.liters, 2),
                segments: fuel.segments,
              },
        /*
         * Every fuel the vehicle takes, including the ones `computeFuelConsumption` cannot
         * see: it measures a tank between two full ones, and a battery is never full on
         * purpose. The two figures overlap for a petrol car, and say so — one is
         * `FULL_TO_FULL`, the other `SPAN`.
         */
        usage: computeUsage(fills, vehicle.odometerUnit).map((usage) => ({
          ...usage,
          quantity: round(usage.quantity, 2),
          distanceCovered: round(usage.distanceCovered, 0),
          per100Km: round(usage.per100Km, 2),
          distancePerUnit: round(usage.distancePerUnit, 2),
        })),
        // Listed in either mode: converted or not, the reader should see what came from where.
        otherCurrencies: [...strict.otherCurrencies],
        ...converted,
        includesConverted,
      };
    },
  );

  fastify.get(
    '/:vehicleId/cost/monthly',
    {
      schema: {
        tags: ['expenses'],
        summary: 'Spend per calendar month',
        description:
          'Every month in the window, zeros included, in the same currency the cost ' +
          'summary is quoted in. The purchase is excluded.',
        params: VehicleIdParam,
        querystring: MonthlySpendQuery,
        response: { 200: MonthlySpend, ...StandardErrors },
      },
    },
    async (request) => {
      const access = await fastify.requireVehicleAccess(
        request,
        request.params.vehicleId,
        'expense.read',
      );

      const months = request.query.months ?? 12;
      const now = new Date();

      const [{ currency, convert, ratesAsOf }, rows] = await Promise.all([
        reportingCurrency(fastify, access.vehicle, access.garageId),
        monthlySpend(fastify.db, request.params.vehicleId, windowStart(months, now)),
      ]);

      /*
       * All or nothing, like the cost summary: one month in a currency the rate table lacks
       * drops the whole chart back to strict, rather than drawing a bar that is quietly short.
       */
      const converted = convert
        ? rows.map((row) => ({
            month: row.month,
            amountMinor:
              row.currency === currency ? row.amountMinor : convert(row.amountMinor, row.currency),
          }))
        : null;
      const complete = converted?.every((row) => row.amountMinor !== null) ?? false;

      const inCurrency = complete
        ? (converted as { month: string; amountMinor: number }[])
        : rows.filter((row) => row.currency === currency);

      // Several currencies in one month are now several rows for that month; sum them.
      const byMonth = new Map<string, number>();
      for (const row of inCurrency) {
        byMonth.set(row.month, (byMonth.get(row.month) ?? 0) + row.amountMinor);
      }
      const summed = [...byMonth].map(([month, amountMinor]) => ({ month, amountMinor }));

      return {
        currency,
        includesConverted: complete && rows.some((row) => row.currency !== currency),
        ratesAsOf: complete ? ratesAsOf : null,
        points: monthlySeries(summed, months, now),
      };
    },
  );

  /**
   * The three shapes of a vehicle's history, in one request (GAPS §12, §13).
   *
   * Free at every tier, like every other reading of your own rows: a chart is a way of looking
   * at records you already own, and charging for the looking is how a product stops being
   * trusted with the recording.
   */
  fastify.get(
    '/:vehicleId/cost/trends',
    {
      schema: {
        tags: ['expenses'],
        summary: 'Consumption over time, the ownership curve, and distance per year',
        description:
          'In the cost summary’s currency and the vehicle’s distance unit. Rows in other ' +
          'currencies are excluded rather than converted, as every cost figure here is.',
        params: VehicleIdParam,
        response: { 200: CostTrends, ...StandardErrors },
      },
    },
    async (request) => {
      const access = await fastify.requireVehicleAccess(
        request,
        request.params.vehicleId,
        'expense.read',
      );
      const { vehicle } = access;
      // Resolved exactly as the cost summary resolves it: three answers to one question
      // on one screen is what this helper exists to prevent.
      const { currency } = await reportingCurrency(fastify, vehicle, access.garageId);

      const [fills, months, purchase, readings] = await Promise.all([
        fuelFills(fastify.db, request.params.vehicleId),
        monthlyHistory(fastify.db, request.params.vehicleId, currency),
        purchaseRecord(fastify.db, request.params.vehicleId, currency),
        odometerReadings(fastify.db, request.params.vehicleId),
      ]);

      const round = (value: number, places: number) =>
        Math.round(value * 10 ** places) / 10 ** places;

      return {
        currency,
        distanceUnit: vehicle.odometerUnit,
        efficiency: usageSeries(fills, vehicle.odometerUnit).map((series) => ({
          fuelType: series.fuelType,
          unit: series.unit,
          points: series.points.map((point) => ({
            ...point,
            distanceCovered: round(point.distanceCovered, 0),
            quantity: round(point.quantity, 2),
            per100Km: round(point.per100Km, 2),
            distancePerUnit: round(point.distancePerUnit, 2),
          })),
        })),
        ownership: ownershipCurve(months, purchase, new Date()),
        distancePerYear: distancePerYear(readings, vehicle.odometerUnit),
      };
    },
  );

  fastify.get(
    '/:vehicleId/cost/fuel-prices',
    {
      schema: {
        tags: ['expenses'],
        summary: 'Fuel price per litre, and which stations are cheaper',
        description:
          'Derived from each fill’s amount and quantity, in the cost summary’s currency. ' +
          'Fills in other currencies are left out, or converted for a garage that reports ' +
          'in one currency. Fills with no quantity are always left out.',
        params: VehicleIdParam,
        response: { 200: Type.Array(FuelPrices), ...StandardErrors },
      },
    },
    async (request) => {
      const access = await fastify.requireVehicleAccess(
        request,
        request.params.vehicleId,
        'expense.read',
      );

      const [{ currency, convert, ratesAsOf }, fills] = await Promise.all([
        reportingCurrency(fastify, access.vehicle, access.garageId),
        pricedFuelFills(fastify.db, request.params.vehicleId),
      ]);

      // Each fill re-expressed in the reporting currency, all or nothing as elsewhere.
      const converted = convert
        ? fills.map((fill) => {
            const amountMinor =
              fill.currency === currency
                ? fill.amountMinor
                : convert(fill.amountMinor, fill.currency);
            return amountMinor === null ? null : { ...fill, amountMinor, currency };
          })
        : null;
      const complete = converted !== null && converted.every((fill) => fill !== null);

      const priced = complete ? (converted as typeof fills) : fills;
      /*
       * Only the families this vehicle actually has fills in, so a petrol car answers with
       * one series and a plug-in hybrid with two — rather than every vehicle carrying an
       * empty kilogram chart for the sake of a fixed shape.
       */
      const families = [
        ...new Set(
          priced.flatMap((fill) => (fill.quantityUnit ? [unitFamily(fill.quantityUnit)] : [])),
        ),
      ];

      return families.map((family) => ({
        ...fuelPrices(priced, currency, family),
        includesConverted: complete && fills.some((fill) => fill.currency !== currency),
        ratesAsOf: complete ? ratesAsOf : null,
      }));
    },
  );

  fastify.post(
    '/:vehicleId/expenses',
    {
      schema: {
        tags: ['expenses'],
        summary: 'Record an expense',
        params: VehicleIdParam,
        body: CreateExpense,
        response: { 201: Expense, ...StandardErrors },
      },
    },
    async (request, reply) => {
      const access = await fastify.requireVehicleAccess(
        request,
        request.params.vehicleId,
        'expense.write',
      );

      const expense = await createExpense(
        fastify.db,
        access.actor,
        request.params.vehicleId,
        access.garageId,
        request.body,
        commandMeta(request),
      );
      return reply.status(201).send(serializeExpense(expense));
    },
  );

  fastify.get(
    '/:vehicleId/expenses/:expenseId',
    {
      schema: {
        tags: ['expenses'],
        summary: 'One expense',
        params: ExpenseParams,
        response: { 200: Expense, ...StandardErrors },
      },
    },
    async (request) => {
      await fastify.requireVehicleAccess(request, request.params.vehicleId, 'expense.read');

      const expense = await findExpenseById(
        fastify.db,
        request.params.vehicleId,
        request.params.expenseId,
      );
      if (!expense) throw new NotFoundError('Expense');
      return serializeExpense(expense);
    },
  );

  fastify.patch(
    '/:vehicleId/expenses/:expenseId',
    {
      schema: {
        tags: ['expenses'],
        summary: 'Correct an expense',
        params: ExpenseParams,
        body: UpdateExpense,
        response: { 200: Expense, ...StandardErrors },
      },
    },
    async (request) => {
      const access = await fastify.requireVehicleAccess(
        request,
        request.params.vehicleId,
        'expense.write',
      );

      const expense = await editExpense(
        fastify.db,
        access.actor,
        request.params.vehicleId,
        access.garageId,
        request.params.expenseId,
        request.body,
        commandMeta(request),
      );
      return serializeExpense(expense);
    },
  );

  fastify.delete(
    '/:vehicleId/expenses/:expenseId',
    {
      schema: {
        tags: ['expenses'],
        summary: 'Delete an expense',
        description:
          'Removed outright, not soft-deleted (§103) — a total that changes when a hidden ' +
          'row is excluded is worse than no total. The removal is written to the audit log.',
        params: ExpenseParams,
        response: { 204: Type.Null(), ...StandardErrors },
      },
    },
    async (request, reply) => {
      const access = await fastify.requireVehicleAccess(
        request,
        request.params.vehicleId,
        'expense.delete',
      );

      await removeExpense(
        fastify.db,
        access.actor,
        request.params.vehicleId,
        access.garageId,
        request.params.expenseId,
        commandMeta(request),
      );
      return reply.status(204).send(null);
    },
  );
};
