import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { eq } from 'drizzle-orm';
import { schema } from '@vehicle-os/database';
import { Dashboard, StandardErrors } from '@vehicle-os/contracts';
import { localDateIn } from '../../../tasks/domain/buckets';
import { buildDashboard } from '../../application/services/dashboard';
import type { FastifyInstance } from 'fastify';

async function timezoneFor(fastify: FastifyInstance, userId: string): Promise<string> {
  const [row] = await fastify.db
    .select({ timezone: schema.userProfiles.timezone })
    .from(schema.userProfiles)
    .where(eq(schema.userProfiles.userId, userId))
    .limit(1);
  return row?.timezone ?? 'UTC';
}

export const dashboardRoutes: FastifyPluginAsyncTypebox = async (fastify) => {
  fastify.get(
    '/',
    {
      schema: {
        tags: ['dashboard'],
        summary: 'Everything the home screen shows, in one response',
        description:
          'Summary, what needs attention, recent activity and the briefing (PRD §25). One ' +
          'request rather than five, and every total computed where all the inputs are.',
        response: { 200: Dashboard, ...StandardErrors },
      },
    },
    async (request) => {
      const actor = await fastify.requireAuth(request);
      const timezone = await timezoneFor(fastify, actor.userId);

      return buildDashboard(
        fastify.db,
        actor.memberships.map((membership) => membership.garageId),
        // "Overdue" and "due today" are calendar questions, answered in the reader's own
        // zone for the same reason the task centre is (§29).
        localDateIn(timezone, new Date()),
        new Date(),
        actor.userId,
      );
    },
  );
};
