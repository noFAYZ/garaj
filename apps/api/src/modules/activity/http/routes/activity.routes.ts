import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import {
  ListActivityQuery,
  StandardErrors,
  VehicleActivity,
  VehicleIdParam,
  type PlannedItem,
} from '@vehicle-os/contracts';
import type { EventType } from '@vehicle-os/domain';
import {
  decodeKeysetCursor,
  encodeCursor,
  normaliseLimit,
  toPage,
} from '../../../../infrastructure/pagination';
import { serializeEvent } from '../../../events/http/serializers/event-serializer';
import { listEvents } from '../../../events/infrastructure/repositories/event-repository';
import { serializePlan } from '../../../maintenance/http/serializers/maintenance-serializer';
import { listPlans } from '../../../maintenance/infrastructure/repositories/maintenance-repository';
import { serializeTask } from '../../../tasks/http/serializers/task-serializer';
import { listTasks } from '../../../tasks/infrastructure/repositories/task-repository';
import { orderPlanned } from '../../domain/planned-order';

/** A single value or a repeated one — `?eventType=FUEL` and `?eventType=A&eventType=B`. */
function toArray(value: EventType | EventType[] | undefined): EventType[] | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value : [value];
}

export const activityRoutes: FastifyPluginAsyncTypebox = async (fastify) => {
  fastify.get(
    '/:vehicleId/activity',
    {
      schema: {
        tags: ['activity'],
        summary: 'Everything about a vehicle: what is planned, and what was done',
        description:
          '`planned` is the vehicle’s active schedules and open tasks, most urgent first, on ' +
          'the first page only. `done` is its events, newest first, keyset-paginated like ' +
          '`/events`; every expense is one of them.',
        params: VehicleIdParam,
        querystring: ListActivityQuery,
        response: { 200: VehicleActivity, ...StandardErrors },
      },
    },
    async (request) => {
      /*
       * One guard for the three reads. `event.read` is the gate; schedules and tasks need
       * `maintenance.read` and `task.read`, and every role that holds one read capability holds
       * all of them (`READ_CAPABILITIES` in the domain's authz), so a second check would never
       * refuse anyone this one let through.
       */
      const { vehicle, garageId } = await fastify.requireVehicleAccess(
        request,
        request.params.vehicleId,
        'event.read',
      );

      const limit = normaliseLimit(request.query.limit);
      const cursor = request.query.cursor ? decodeKeysetCursor(request.query.cursor) : undefined;

      const rows = await listEvents(fastify.db, {
        vehicleId: request.params.vehicleId,
        eventTypes: toArray(request.query.eventType),
        limit,
        cursor: cursor ? { occurredAt: cursor.at, id: cursor.id } : undefined,
      });
      const page = toPage(rows, limit, (row) => encodeCursor([row.occurredAt, row.id]));
      const done = { data: page.data.map(serializeEvent), pagination: page.pagination };

      if (cursor) return { planned: [], done };

      const [plans, tasks] = await Promise.all([
        listPlans(fastify.db, request.params.vehicleId),
        listTasks(fastify.db, {
          garageIds: [garageId],
          vehicleId: request.params.vehicleId,
          openOnly: true,
        }),
      ]);

      const planned: PlannedItem[] = [
        ...plans.map((plan) => ({
          kind: 'SCHEDULE' as const,
          schedule: serializePlan(plan, vehicle),
        })),
        ...tasks.map((task) => ({ kind: 'TASK' as const, task: serializeTask(task) })),
      ];

      return { planned: orderPlanned(planned, new Date().toISOString().slice(0, 10)), done };
    },
  );
};
