import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import { eq } from 'drizzle-orm';
import { schema } from '@vehicle-os/database';
import {
  CreateTask,
  ListTasksQuery,
  StandardErrors,
  Task,
  TaskBuckets,
  TaskIdParam,
  UpdateTask,
} from '@vehicle-os/contracts';
import type { TaskStatus } from '@vehicle-os/domain';
import { NotFoundError } from '../../../../infrastructure/errors';
import { bucketTasks, localDateIn } from '../../domain/buckets';
import { createTask, editTask, removeTask } from '../../application/commands/manage-tasks';
import {
  findTaskById,
  listTasks,
  type TaskRow,
} from '../../infrastructure/repositories/task-repository';
import { serializeTask } from '../serializers/task-serializer';
import type { FastifyInstance } from 'fastify';

function toArray(value: TaskStatus | TaskStatus[] | undefined): TaskStatus[] | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value : [value];
}

/**
 * The user's own timezone, for bucketing.
 *
 * Read from the profile rather than taken from a request header: the answer to "is this due
 * today?" must be the same on every device the user opens, and a browser in a hotel in
 * another country would otherwise silently re-bucket their whole task list.
 */
async function timezoneFor(fastify: FastifyInstance, userId: string): Promise<string> {
  const [row] = await fastify.db
    .select({ timezone: schema.userProfiles.timezone })
    .from(schema.userProfiles)
    .where(eq(schema.userProfiles.userId, userId))
    .limit(1);
  return row?.timezone ?? 'UTC';
}

export const taskRoutes: FastifyPluginAsyncTypebox = async (fastify) => {
  fastify.get(
    '/',
    {
      schema: {
        tags: ['tasks'],
        summary: 'Tasks across every garage the caller belongs to',
        querystring: ListTasksQuery,
        response: { 200: Type.Array(Task), ...StandardErrors },
      },
    },
    async (request) => {
      const actor = await fastify.requireAuth(request);

      const rows = await listTasks(fastify.db, {
        garageIds: actor.memberships.map((membership) => membership.garageId),
        garageId: request.query.garageId,
        vehicleId: request.query.vehicleId,
        statuses: toArray(request.query.status),
        priority: request.query.priority,
        assigneeId: request.query.assigneeId,
        openOnly: request.query.openOnly,
      });

      return rows.map(serializeTask);
    },
  );

  fastify.get(
    '/buckets',
    {
      schema: {
        tags: ['tasks'],
        summary: 'The task centre: overdue, today, this week, upcoming',
        description:
          "Bucketed against the user's own timezone, so the same task is not 'today' on one " +
          'device and overdue on another.',
        response: { 200: TaskBuckets, ...StandardErrors },
      },
    },
    async (request) => {
      const actor = await fastify.requireAuth(request);

      const [rows, timezone] = await Promise.all([
        listTasks(fastify.db, {
          garageIds: actor.memberships.map((membership) => membership.garageId),
          openOnly: true,
        }),
        timezoneFor(fastify, actor.userId),
      ]);

      const today = localDateIn(timezone, new Date());
      const buckets = bucketTasks(rows, today);
      const serialize = (list: TaskRow[]) => list.map(serializeTask);

      return {
        overdue: serialize(buckets.overdue),
        today: serialize(buckets.today),
        thisWeek: serialize(buckets.thisWeek),
        upcoming: serialize(buckets.upcoming),
        someday: serialize(buckets.someday),
        counts: {
          overdue: buckets.overdue.length,
          today: buckets.today.length,
          thisWeek: buckets.thisWeek.length,
          upcoming: buckets.upcoming.length,
          someday: buckets.someday.length,
        },
      };
    },
  );

  fastify.post(
    '/',
    {
      schema: {
        tags: ['tasks'],
        summary: 'Create a task',
        body: CreateTask,
        response: { 201: Task, ...StandardErrors },
      },
    },
    async (request, reply) => {
      const actor = fastify.requireCapability(request, 'task.write', request.body.garageId);
      const task = await createTask(fastify.db, actor, request.body);
      return reply.status(201).send(serializeTask(task));
    },
  );

  fastify.get(
    '/:taskId',
    {
      schema: {
        tags: ['tasks'],
        summary: 'One task',
        params: TaskIdParam,
        response: { 200: Task, ...StandardErrors },
      },
    },
    async (request) => {
      const actor = await fastify.requireAuth(request);
      const task = await findTaskById(
        fastify.db,
        request.params.taskId,
        actor.memberships.map((membership) => membership.garageId),
      );
      if (!task) throw new NotFoundError('Task');
      return serializeTask(task);
    },
  );

  fastify.patch(
    '/:taskId',
    {
      schema: {
        tags: ['tasks'],
        summary: 'Update a task',
        description: 'Completing one stamps `completedAt`; re-opening clears it.',
        params: TaskIdParam,
        body: UpdateTask,
        response: { 200: Task, ...StandardErrors },
      },
    },
    async (request) => {
      const actor = await fastify.requireAuth(request);

      /*
       * The garage comes from the task row, then the capability is checked against it. The
       * lookup is membership-scoped, so a task in a garage the caller does not belong to is
       * a 404 before any capability question is asked.
       */
      const existing = await findTaskById(
        fastify.db,
        request.params.taskId,
        actor.memberships.map((membership) => membership.garageId),
      );
      if (!existing) throw new NotFoundError('Task');

      fastify.requireCapability(request, 'task.write', existing.garageId);
      const task = await editTask(fastify.db, actor, request.params.taskId, request.body);
      return serializeTask(task);
    },
  );

  fastify.delete(
    '/:taskId',
    {
      schema: {
        tags: ['tasks'],
        summary: 'Delete a task',
        params: TaskIdParam,
        response: { 204: Type.Null(), ...StandardErrors },
      },
    },
    async (request, reply) => {
      const actor = await fastify.requireAuth(request);

      const existing = await findTaskById(
        fastify.db,
        request.params.taskId,
        actor.memberships.map((membership) => membership.garageId),
      );
      if (!existing) throw new NotFoundError('Task');

      fastify.requireCapability(request, 'task.delete', existing.garageId);
      await removeTask(fastify.db, actor, request.params.taskId);
      return reply.status(204).send(null);
    },
  );
};
