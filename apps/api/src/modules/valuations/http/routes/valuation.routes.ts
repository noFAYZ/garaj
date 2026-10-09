import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import { and, desc, eq } from 'drizzle-orm';
import { schema } from '@vehicle-os/database';
import { assertCurrency, MoneyError } from '@vehicle-os/domain';
import {
  CreateValuation,
  StandardErrors,
  Valuation,
  ValuationParams,
  ValuationSummary,
  VehicleIdParam,
} from '@vehicle-os/contracts';
import { NotFoundError, ValidationError } from '../../../../infrastructure/errors';
import { recordAudit } from '../../../../infrastructure/audit';
import type { FastifyRequest } from 'fastify';

type ValuationRow = typeof schema.valuations.$inferSelect;

function serialize(valuation: ValuationRow) {
  return {
    id: valuation.id,
    vehicleId: valuation.vehicleId,
    estimatedValue: {
      amountMinor: valuation.estimatedValueAmountMinor,
      currency: valuation.estimatedValueCurrency,
    },
    valuationDate: valuation.valuationDate,
    source: valuation.source,
    confidence: valuation.confidence,
    notes: valuation.notes,
    createdAt: valuation.createdAt.toISOString(),
  };
}

function commandMeta(request: FastifyRequest) {
  return { requestId: request.id, ipAddress: request.ip };
}

export const valuationRoutes: FastifyPluginAsyncTypebox = async (fastify) => {
  fastify.get(
    '/:vehicleId/valuations',
    {
      schema: {
        tags: ['valuations'],
        summary: 'What this vehicle is worth, and what it has been worth',
        description:
          'The history in date order plus the current figure against the purchase price ' +
          '(PRD §19). Modelled separately from the price paid, which never changes.',
        params: VehicleIdParam,
        response: { 200: ValuationSummary, ...StandardErrors },
      },
    },
    async (request) => {
      const access = await fastify.requireVehicleAccess(
        request,
        request.params.vehicleId,
        'valuation.read',
      );
      const vehicle = access.vehicle;

      const rows = await fastify.db
        .select()
        .from(schema.valuations)
        .where(eq(schema.valuations.vehicleId, request.params.vehicleId))
        .orderBy(desc(schema.valuations.valuationDate), desc(schema.valuations.id));

      const latest = rows[0] ?? null;
      const purchasePrice =
        vehicle.purchasePriceAmountMinor !== null && vehicle.purchasePriceCurrency
          ? {
              amountMinor: vehicle.purchasePriceAmountMinor,
              currency: vehicle.purchasePriceCurrency,
            }
          : null;

      /*
       * The change is only computed when both figures are in the same currency. A gain
       * across an exchange rate this application invented would be a number nobody could
       * check, and §27 keeps guesses out of financial output.
       */
      const comparable =
        latest !== null &&
        purchasePrice !== null &&
        latest.estimatedValueCurrency === purchasePrice.currency;

      const changeMinor = comparable
        ? latest.estimatedValueAmountMinor - purchasePrice.amountMinor
        : null;

      return {
        vehicleId: request.params.vehicleId,
        purchasePrice,
        currentValue: latest
          ? {
              amountMinor: latest.estimatedValueAmountMinor,
              currency: latest.estimatedValueCurrency,
            }
          : null,
        currentValueDate: latest?.valuationDate ?? null,
        changeSincePurchase:
          changeMinor === null
            ? null
            : { amountMinor: changeMinor, currency: purchasePrice!.currency },
        changePercent:
          changeMinor === null || purchasePrice!.amountMinor === 0
            ? null
            : Math.round((changeMinor / purchasePrice!.amountMinor) * 1000) / 10,
        history: rows.map(serialize),
      };
    },
  );

  fastify.post(
    '/:vehicleId/valuations',
    {
      schema: {
        tags: ['valuations'],
        summary: 'Record what the vehicle is worth today',
        params: VehicleIdParam,
        body: CreateValuation,
        response: { 201: Valuation, ...StandardErrors },
      },
    },
    async (request, reply) => {
      const access = await fastify.requireVehicleAccess(
        request,
        request.params.vehicleId,
        'valuation.write',
      );

      try {
        assertCurrency(request.body.currency);
      } catch (error) {
        if (error instanceof MoneyError) {
          throw new ValidationError('Invalid request', { currency: error.message });
        }
        throw error;
      }

      const valuation = await fastify.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(schema.valuations)
          .values({
            vehicleId: request.params.vehicleId,
            estimatedValueAmountMinor: request.body.amountMinor,
            estimatedValueCurrency: request.body.currency,
            valuationDate: request.body.valuationDate,
            source: request.body.source ?? 'USER_ESTIMATE',
            confidence: request.body.confidence ?? null,
            notes: request.body.notes?.trim() || null,
            createdBy: access.actor.userId,
          })
          .returning();
        if (!row) throw new Error('Valuation insert returned no row');

        await recordAudit(tx, {
          actorId: access.actor.userId,
          actorEmail: access.actor.email,
          garageId: access.garageId,
          action: 'valuation.recorded',
          resourceType: 'valuation',
          resourceId: row.id,
          metadata: {
            vehicleId: request.params.vehicleId,
            amountMinor: row.estimatedValueAmountMinor,
            currency: row.estimatedValueCurrency,
            source: row.source,
          },
          ...commandMeta(request),
        });

        return row;
      });

      return reply.status(201).send(serialize(valuation));
    },
  );

  fastify.delete(
    '/:vehicleId/valuations/:valuationId',
    {
      schema: {
        tags: ['valuations'],
        summary: 'Delete a valuation',
        description:
          'Removed outright, like an expense — a value history that silently drops a ' +
          'hidden row is a chart nobody can reconcile.',
        params: ValuationParams,
        response: { 204: Type.Null(), ...StandardErrors },
      },
    },
    async (request, reply) => {
      const access = await fastify.requireVehicleAccess(
        request,
        request.params.vehicleId,
        'valuation.write',
      );

      const [existing] = await fastify.db
        .select()
        .from(schema.valuations)
        .where(
          and(
            eq(schema.valuations.id, request.params.valuationId),
            eq(schema.valuations.vehicleId, request.params.vehicleId),
          ),
        )
        .limit(1);
      if (!existing) throw new NotFoundError('Valuation');

      await fastify.db.transaction(async (tx) => {
        await tx.delete(schema.valuations).where(eq(schema.valuations.id, existing.id));

        await recordAudit(tx, {
          actorId: access.actor.userId,
          actorEmail: access.actor.email,
          garageId: access.garageId,
          action: 'valuation.deleted',
          resourceType: 'valuation',
          resourceId: existing.id,
          // The whole row: after this transaction it exists nowhere else.
          metadata: {
            vehicleId: request.params.vehicleId,
            amountMinor: existing.estimatedValueAmountMinor,
            currency: existing.estimatedValueCurrency,
            valuationDate: existing.valuationDate,
            source: existing.source,
          },
          ...commandMeta(request),
        });
      });

      return reply.status(204).send(null);
    },
  );
};
