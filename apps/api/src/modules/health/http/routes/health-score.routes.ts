import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { and, eq, isNotNull, isNull, notInArray } from 'drizzle-orm';
import { schema } from '@vehicle-os/database';
import { StandardErrors, VehicleHealth, VehicleIdParam } from '@vehicle-os/contracts';
import { computeNextDue } from '../../../maintenance/domain/next-due';
import { listPlans } from '../../../maintenance/infrastructure/repositories/maintenance-repository';
import { localDateIn } from '../../../tasks/domain/buckets';
import { freshStandings, latestByCategory } from '../../../condition/domain/condition';
import { computeHealth } from '../../domain/health';
import type { FastifyInstance } from 'fastify';

async function timezoneFor(fastify: FastifyInstance, userId: string): Promise<string> {
  const [row] = await fastify.db
    .select({ timezone: schema.userProfiles.timezone })
    .from(schema.userProfiles)
    .where(eq(schema.userProfiles.userId, userId))
    .limit(1);
  return row?.timezone ?? 'UTC';
}

export const healthRoutes: FastifyPluginAsyncTypebox = async (fastify) => {
  fastify.get(
    '/:vehicleId/health',
    {
      schema: {
        tags: ['health'],
        summary: 'A vehicle’s health score, with the reasons for it',
        description:
          'Derived on every read and never stored (§33). The factors are the whole ' +
          'explanation — the arithmetic can be checked by hand from them.',
        params: VehicleIdParam,
        response: { 200: VehicleHealth, ...StandardErrors },
      },
    },
    async (request) => {
      const access = await fastify.requireVehicleAccess(
        request,
        request.params.vehicleId,
        'vehicle.read',
      );
      const vehicle = access.vehicle;

      /*
       * The three inputs in parallel. They are independent, and against a hosted database
       * three sequential reads is three times the wait for the same answer.
       */
      const [plans, tasks, documents, conditionRows, timezone] = await Promise.all([
        listPlans(fastify.db, request.params.vehicleId, false),
        fastify.db
          .select({
            title: schema.tasks.title,
            dueDate: schema.tasks.dueDate,
            priority: schema.tasks.priority,
          })
          .from(schema.tasks)
          .where(
            and(
              eq(schema.tasks.vehicleId, request.params.vehicleId),
              isNull(schema.tasks.deletedAt),
              notInArray(schema.tasks.status, ['COMPLETED', 'CANCELLED']),
            ),
          ),
        fastify.db
          .select({ title: schema.documents.title, expiresOn: schema.documents.expiresOn })
          .from(schema.documents)
          .where(
            and(
              eq(schema.documents.vehicleId, request.params.vehicleId),
              isNull(schema.documents.deletedAt),
              isNotNull(schema.documents.expiresOn),
              isNotNull(schema.documents.uploadedAt),
            ),
          ),
        fastify.db
          .select({
            category: schema.conditionItems.category,
            score: schema.conditionItems.score,
            assessedAt: schema.conditionAssessments.assessedAt,
          })
          .from(schema.conditionItems)
          .innerJoin(
            schema.conditionAssessments,
            eq(schema.conditionAssessments.id, schema.conditionItems.assessmentId),
          )
          .where(eq(schema.conditionAssessments.vehicleId, request.params.vehicleId)),
        timezoneFor(fastify, access.actor.userId),
      ]);

      const now = new Date();
      const result = computeHealth({
        // The same `computeNextDue` the maintenance tab reads, so a plan the user sees as
        // overdue is exactly the one costing this vehicle points.
        plans: plans.map((plan) => ({
          title: plan.title,
          status: computeNextDue(plan, vehicle, now).status,
        })),
        tasks,
        documents: documents.map((document) => ({
          title: document.title,
          expiresOn: document.expiresOn!,
        })),
        // Only categories assessed within the year: a judgement about tyres from two years
        // ago is not evidence about the tyres now.
        condition: freshStandings(latestByCategory(conditionRows, now)).map((standing) => ({
          category: standing.category,
          score: standing.score!,
          ageDays: standing.ageDays,
        })),
        today: localDateIn(timezone, now),
      });

      return {
        vehicleId: request.params.vehicleId,
        overall: result.overall,
        categories: [...result.categories],
        factors: [...result.factors],
        summary: result.summary,
        calculatedAt: now.toISOString(),
      };
    },
  );
};
