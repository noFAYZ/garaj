import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import {
  CreateEvent,
  EventParams,
  EventWithWarnings,
  ListEventsQuery,
  Paginated,
  StandardErrors,
  UpdateEvent,
  VehicleEvent,
  VehicleIdParam,
} from '@vehicle-os/contracts';
import type { EventType } from '@vehicle-os/domain';
import { NotFoundError } from '../../../../infrastructure/errors';
import {
  decodeKeysetCursor,
  encodeCursor,
  normaliseLimit,
  toPage,
} from '../../../../infrastructure/pagination';
import { editEvent, recordEvent, removeEvent } from '../../application/commands/record-event';
import { findEventById, listEvents } from '../../infrastructure/repositories/event-repository';
import { serializeEvent } from '../serializers/event-serializer';
import type { FastifyRequest } from 'fastify';

function commandMeta(request: FastifyRequest) {
  return {
    requestId: request.id,
    ipAddress: request.ip,
    actorEmail: request.actor?.email ?? null,
  };
}

/** A single value or a repeated one — `?eventType=FUEL` and `?eventType=A&eventType=B`. */
function toArray(value: EventType | EventType[] | undefined): EventType[] | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value : [value];
}

export const eventRoutes: FastifyPluginAsyncTypebox = async (fastify) => {
  fastify.get(
    '/:vehicleId/events',
    {
      schema: {
        tags: ['events'],
        summary: 'Vehicle timeline, newest first',
        params: VehicleIdParam,
        querystring: ListEventsQuery,
        response: { 200: Paginated(VehicleEvent), ...StandardErrors },
      },
    },
    async (request) => {
      await fastify.requireVehicleAccess(request, request.params.vehicleId, 'event.read');

      const limit = normaliseLimit(request.query.limit);
      const cursor = request.query.cursor ? decodeKeysetCursor(request.query.cursor) : undefined;

      const rows = await listEvents(fastify.db, {
        vehicleId: request.params.vehicleId,
        eventTypes: toArray(request.query.eventType),
        from: request.query.from ? new Date(request.query.from) : undefined,
        to: request.query.to ? new Date(request.query.to) : undefined,
        limit,
        cursor: cursor ? { occurredAt: cursor.at, id: cursor.id } : undefined,
      });

      const page = toPage(rows, limit, (row) => encodeCursor([row.occurredAt, row.id]));
      return { data: page.data.map(serializeEvent), pagination: page.pagination };
    },
  );

  fastify.post(
    '/:vehicleId/events',
    {
      schema: {
        tags: ['events'],
        summary: 'Record something that happened to the vehicle',
        description:
          'Succeeds with warnings when a value is suspicious but plausible — an odometer ' +
          'reading lower than the previous one, for instance.',
        params: VehicleIdParam,
        body: CreateEvent,
        response: { 201: EventWithWarnings, ...StandardErrors },
      },
    },
    async (request, reply) => {
      const { actor } = await fastify.requireVehicleAccess(
        request,
        request.params.vehicleId,
        'event.write',
      );
      const result = await recordEvent(fastify.db, actor, request.params.vehicleId, request.body);
      return reply
        .status(201)
        .send({ event: serializeEvent(result.event), warnings: result.warnings });
    },
  );

  fastify.get(
    '/:vehicleId/events/:eventId',
    {
      schema: {
        tags: ['events'],
        summary: 'One event',
        params: EventParams,
        response: { 200: VehicleEvent, ...StandardErrors },
      },
    },
    async (request) => {
      await fastify.requireVehicleAccess(request, request.params.vehicleId, 'event.read');
      const event = await findEventById(
        fastify.db,
        request.params.vehicleId,
        request.params.eventId,
      );
      if (!event) throw new NotFoundError('Event');
      return serializeEvent(event);
    },
  );

  fastify.patch(
    '/:vehicleId/events/:eventId',
    {
      schema: {
        tags: ['events'],
        summary: 'Edit an event',
        params: EventParams,
        body: UpdateEvent,
        response: { 200: EventWithWarnings, ...StandardErrors },
      },
    },
    async (request) => {
      const { actor, garageId } = await fastify.requireVehicleAccess(
        request,
        request.params.vehicleId,
        'event.write',
      );
      const result = await editEvent(
        fastify.db,
        actor,
        request.params.vehicleId,
        request.params.eventId,
        garageId,
        request.body,
        commandMeta(request),
      );
      return { event: serializeEvent(result.event), warnings: result.warnings };
    },
  );

  fastify.delete(
    '/:vehicleId/events/:eventId',
    {
      schema: {
        tags: ['events'],
        summary: 'Delete an event',
        params: EventParams,
        response: { 204: Type.Null(), ...StandardErrors },
      },
    },
    async (request, reply) => {
      const { actor, garageId } = await fastify.requireVehicleAccess(
        request,
        request.params.vehicleId,
        'event.delete',
      );
      await removeEvent(
        fastify.db,
        actor,
        request.params.vehicleId,
        request.params.eventId,
        garageId,
        commandMeta(request),
      );
      return reply.status(204).send(null);
    },
  );
};
