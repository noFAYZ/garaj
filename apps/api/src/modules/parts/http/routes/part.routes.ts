import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import {
  PartParams,
  RecordParts,
  StandardErrors,
  UpdatePart,
  VehicleIdParam,
  VehiclePart,
  VehicleParts,
} from '@vehicle-os/contracts';
import { recordAudit } from '../../../../infrastructure/audit';
import { NotFoundError, ValidationError } from '../../../../infrastructure/errors';
import { findEventById } from '../../../events/infrastructure/repositories/event-repository';
import { findVehicleById } from '../../../vehicles/infrastructure/repositories/vehicle-repository';
import { resolvePartLines } from '../../domain/part-lines';
import {
  deletePart,
  findPart,
  insertParts,
  updatePart,
  listGarageProducts,
  listVehicleParts,
} from '../../infrastructure/repositories/part-repository';
import { serializePart, serializeProduct } from '../serializers/part-serializer';

/**
 * A vehicle's parts and fluids (PRD §17). Lines are usually written with the entry they came
 * with (`CreateEvent.parts`, a service's `parts`); these routes read them, record what is fitted
 * now without an entry, add lines to an entry already saved, and remove a mistaken line.
 */
export const partRoutes: FastifyPluginAsyncTypebox = async (fastify) => {
  fastify.get(
    '/:vehicleId/parts',
    {
      schema: {
        tags: ['parts'],
        summary: 'Every part and fluid fitted, newest first, and the garage’s products',
        params: VehicleIdParam,
        response: { 200: VehicleParts, ...StandardErrors },
      },
    },
    async (request) => {
      const { garageId } = await fastify.requireVehicleAccess(
        request,
        request.params.vehicleId,
        'event.read',
      );
      const [lines, products] = await Promise.all([
        listVehicleParts(fastify.db, request.params.vehicleId),
        listGarageProducts(fastify.db, garageId),
      ]);
      return { data: lines.map(serializePart), products: products.map(serializeProduct) };
    },
  );

  fastify.post(
    '/:vehicleId/parts',
    {
      schema: {
        tags: ['parts'],
        summary: 'Record parts without an entry, or add them to one',
        params: VehicleIdParam,
        body: RecordParts,
        response: { 201: Type.Object({ data: Type.Array(VehiclePart) }), ...StandardErrors },
      },
    },
    async (request, reply) => {
      const { vehicleId } = request.params;
      const { actor } = await fastify.requireVehicleAccess(request, vehicleId, 'event.write');
      const vehicle = await findVehicleById(fastify.db, vehicleId);
      if (!vehicle) throw new NotFoundError('Vehicle');

      const { eventId } = request.body;
      if (eventId && !(await findEventById(fastify.db, vehicleId, eventId))) {
        throw new NotFoundError('Event');
      }

      const fields: Record<string, string> = {};
      const drafts = resolvePartLines(
        request.body.parts,
        {
          vehicleId,
          vehicleType: vehicle.vehicleType,
          odometerUnit: vehicle.odometerUnit,
          createdBy: actor.userId,
          onEntry: Boolean(eventId),
        },
        fields,
      );
      if (Object.keys(fields).length > 0) throw new ValidationError('Invalid request', fields);

      const written = await fastify.db.transaction((tx) =>
        insertParts(tx, drafts, eventId ?? null),
      );
      const lines = written.length ? await listVehicleParts(fastify.db, vehicleId, written) : [];
      return reply.status(201).send({ data: lines.map(serializePart) });
    },
  );

  fastify.put(
    '/:vehicleId/parts/:partId',
    {
      schema: {
        tags: ['parts'],
        summary: 'Correct a line: the whole line as it should now read',
        params: PartParams,
        body: UpdatePart,
        response: { 200: VehiclePart, ...StandardErrors },
      },
    },
    async (request) => {
      const { vehicleId, partId } = request.params;
      const { actor, garageId } = await fastify.requireVehicleAccess(
        request,
        vehicleId,
        'event.write',
      );
      const [vehicle, existing] = await Promise.all([
        findVehicleById(fastify.db, vehicleId),
        findPart(fastify.db, vehicleId, partId),
      ]);
      if (!vehicle || !existing) throw new NotFoundError('Part');

      // Validated exactly as when it was first written, at the position it already has.
      const fields: Record<string, string> = {};
      const [draft] = resolvePartLines(
        [{ ...request.body, position: existing.position as never }],
        {
          vehicleId,
          vehicleType: vehicle.vehicleType,
          odometerUnit: vehicle.odometerUnit,
          createdBy: actor.userId,
          onEntry: existing.eventId !== null,
        },
        fields,
      );
      if (Object.keys(fields).length > 0) throw new ValidationError('Invalid request', fields);
      const { vehicleId: _vehicle, position: _position, createdBy: _author, ...changes } = draft!;

      await fastify.db.transaction(async (tx) => {
        await updatePart(tx, vehicleId, partId, changes);
        // Audited, as an edited entry is: it rewrites a history someone may have relied on.
        await recordAudit(tx, {
          actorId: actor.userId,
          actorEmail: actor.email,
          garageId,
          action: 'part.updated',
          resourceType: 'vehicle_part',
          resourceId: partId,
          metadata: { vehicleId, position: existing.position },
          requestId: request.id,
          ipAddress: request.ip,
        });
      });
      const [line] = await listVehicleParts(fastify.db, vehicleId, [partId]);
      return serializePart(line!);
    },
  );

  fastify.delete(
    '/:vehicleId/parts/:partId',
    {
      schema: {
        tags: ['parts'],
        summary: 'Remove a line recorded by mistake',
        params: PartParams,
        response: { 204: Type.Null(), ...StandardErrors },
      },
    },
    async (request, reply) => {
      const { vehicleId, partId } = request.params;
      const { actor, garageId } = await fastify.requireVehicleAccess(
        request,
        vehicleId,
        'event.delete',
      );
      // Audited, as removing an entry is: it changes a history someone may have relied on.
      await fastify.db.transaction(async (tx) => {
        const removed = await deletePart(tx, vehicleId, partId);
        if (!removed) throw new NotFoundError('Part');
        await recordAudit(tx, {
          actorId: actor.userId,
          actorEmail: actor.email,
          garageId,
          action: 'part.deleted',
          resourceType: 'vehicle_part',
          resourceId: partId,
          metadata: { vehicleId, position: removed.position, eventId: removed.eventId },
          requestId: request.id,
          ipAddress: request.ip,
        });
      });
      return reply.status(204).send(null);
    },
  );
};
