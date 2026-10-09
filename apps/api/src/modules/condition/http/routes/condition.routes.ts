import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import { and, desc, eq, inArray, lt, or, sql } from 'drizzle-orm';
import { schema } from '@vehicle-os/database';
import {
  ConditionAssessment,
  ConditionParams,
  ConditionSummary,
  CreateConditionAssessment,
  ListConditionQuery,
  Paginated,
  StandardErrors,
  UpdateConditionAssessment,
  VehicleIdParam,
} from '@vehicle-os/contracts';
import { NotFoundError } from '../../../../infrastructure/errors';
import { recordAudit } from '../../../../infrastructure/audit';
import {
  decodeKeysetCursor,
  encodeCursor,
  normaliseLimit,
  toPage,
} from '../../../../infrastructure/pagination';
import { raiseOdometer } from '../../../vehicles/infrastructure/repositories/vehicle-repository';
import { latestByCategory, overallScore } from '../../domain/condition';
import type { Executor } from '@vehicle-os/database';
import type { FastifyRequest } from 'fastify';

function commandMeta(request: FastifyRequest) {
  return { requestId: request.id, ipAddress: request.ip };
}

type AssessmentRow = typeof schema.conditionAssessments.$inferSelect;
type ItemRow = typeof schema.conditionItems.$inferSelect;

function normaliseItems(
  items: readonly { category: ItemRow['category']; score?: number; notes?: string }[],
) {
  return items.map((item) => ({
    category: item.category,
    score: item.score ?? null,
    notes: item.notes?.trim() || null,
  }));
}

/** Scoped to the vehicle, so an id from another garage is not reachable through one the caller can see. */
async function findAssessment(
  db: Executor,
  vehicleId: string,
  assessmentId: string,
): Promise<AssessmentRow> {
  const [row] = await db
    .select()
    .from(schema.conditionAssessments)
    .where(
      and(
        eq(schema.conditionAssessments.id, assessmentId),
        eq(schema.conditionAssessments.vehicleId, vehicleId),
      ),
    )
    .limit(1);
  if (!row) throw new NotFoundError('Condition assessment');
  return row;
}

function serialize(assessment: AssessmentRow, items: readonly ItemRow[]) {
  return {
    id: assessment.id,
    vehicleId: assessment.vehicleId,
    assessedAt: assessment.assessedAt.toISOString(),
    overallScore: assessment.overallScore,
    notes: assessment.notes,
    odometer: assessment.odometer,
    odometerUnit: assessment.odometerUnit,
    items: items.map((item) => ({
      category: item.category,
      score: item.score,
      notes: item.notes,
    })),
    createdAt: assessment.createdAt.toISOString(),
  };
}

export const conditionRoutes: FastifyPluginAsyncTypebox = async (fastify) => {
  fastify.get(
    '/:vehicleId/condition',
    {
      schema: {
        tags: ['condition'],
        summary: 'Condition assessments, newest first',
        params: VehicleIdParam,
        querystring: ListConditionQuery,
        response: { 200: Paginated(ConditionAssessment), ...StandardErrors },
      },
    },
    async (request) => {
      await fastify.requireVehicleAccess(request, request.params.vehicleId, 'condition.read');

      const limit = normaliseLimit(request.query.limit);
      const cursor = request.query.cursor ? decodeKeysetCursor(request.query.cursor) : undefined;

      const rows = await fastify.db
        .select()
        .from(schema.conditionAssessments)
        .where(
          and(
            eq(schema.conditionAssessments.vehicleId, request.params.vehicleId),
            // Keyset on (assessed_at, id): two assessments filed from one inspection share a
            // timestamp, and a timestamp-only cursor repeats one across pages.
            ...(cursor
              ? [
                  or(
                    lt(schema.conditionAssessments.assessedAt, cursor.at),
                    and(
                      eq(schema.conditionAssessments.assessedAt, cursor.at),
                      lt(schema.conditionAssessments.id, cursor.id),
                    ),
                  )!,
                ]
              : []),
          ),
        )
        .orderBy(desc(schema.conditionAssessments.assessedAt), desc(schema.conditionAssessments.id))
        .limit(limit + 1);

      const page = toPage(rows, limit, (row) => encodeCursor([row.assessedAt, row.id]));

      // One query for the whole page's items, not one per assessment.
      const items = page.data.length
        ? await fastify.db
            .select()
            .from(schema.conditionItems)
            .where(
              inArray(
                schema.conditionItems.assessmentId,
                page.data.map((row) => row.id),
              ),
            )
        : [];

      const byAssessment = new Map<string, ItemRow[]>();
      for (const item of items) {
        const list = byAssessment.get(item.assessmentId) ?? [];
        list.push(item);
        byAssessment.set(item.assessmentId, list);
      }

      return {
        data: page.data.map((row) => serialize(row, byAssessment.get(row.id) ?? [])),
        pagination: page.pagination,
      };
    },
  );

  fastify.get(
    '/:vehicleId/condition/summary',
    {
      schema: {
        tags: ['condition'],
        summary: 'The latest score for each category, and how old each one is',
        description:
          'Not the newest assessment. Tyres checked last week and a frame checked two ' +
          'years ago are both current knowledge about their own category.',
        params: VehicleIdParam,
        response: { 200: ConditionSummary, ...StandardErrors },
      },
    },
    async (request) => {
      await fastify.requireVehicleAccess(request, request.params.vehicleId, 'condition.read');

      const rows = await fastify.db
        .select({
          category: schema.conditionItems.category,
          score: schema.conditionItems.score,
          notes: schema.conditionItems.notes,
          assessedAt: schema.conditionAssessments.assessedAt,
        })
        .from(schema.conditionItems)
        .innerJoin(
          schema.conditionAssessments,
          eq(schema.conditionAssessments.id, schema.conditionItems.assessmentId),
        )
        .where(eq(schema.conditionAssessments.vehicleId, request.params.vehicleId));

      const standings = latestByCategory(rows, new Date());

      const [counted] = await fastify.db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.conditionAssessments)
        .where(eq(schema.conditionAssessments.vehicleId, request.params.vehicleId));

      return {
        vehicleId: request.params.vehicleId,
        // The mean of the *current* standings, not of one assessment — that is what "the
        // condition of this vehicle" means once categories were checked on different days.
        overallScore: overallScore(standings),
        categories: standings.map((standing) => ({
          category: standing.category,
          score: standing.score,
          notes: standing.notes,
          assessedAt: standing.assessedAt.toISOString(),
          ageDays: standing.ageDays,
        })),
        assessmentCount: Number(counted?.count ?? 0),
      };
    },
  );

  fastify.post(
    '/:vehicleId/condition',
    {
      schema: {
        tags: ['condition'],
        summary: 'Record an assessment',
        params: VehicleIdParam,
        body: CreateConditionAssessment,
        response: { 201: ConditionAssessment, ...StandardErrors },
      },
    },
    async (request, reply) => {
      const access = await fastify.requireVehicleAccess(
        request,
        request.params.vehicleId,
        'condition.write',
      );

      const items = normaliseItems(request.body.items);

      const result = await fastify.db.transaction(async (tx) => {
        const [assessment] = await tx
          .insert(schema.conditionAssessments)
          .values({
            vehicleId: request.params.vehicleId,
            assessedAt: new Date(request.body.assessedAt),
            // Written at assessment time: unlike a due status this never drifts, because
            // the items it averages are facts about a moment that has passed.
            overallScore: overallScore(items),
            notes: request.body.notes?.trim() || null,
            odometer: request.body.odometer ?? null,
            odometerUnit: request.body.odometerUnit ?? null,
            assessedBy: access.actor.userId,
          })
          .returning();
        if (!assessment) throw new Error('Condition assessment insert returned no row');

        const inserted = await tx
          .insert(schema.conditionItems)
          .values(items.map((item) => ({ assessmentId: assessment.id, ...item })))
          .returning();

        // An inspection is a reading like any other, and `raiseOdometer` only moves forward.
        if (request.body.odometer !== undefined) {
          await raiseOdometer(tx, request.params.vehicleId, request.body.odometer);
        }

        await recordAudit(tx, {
          actorId: access.actor.userId,
          actorEmail: access.actor.email,
          garageId: access.garageId,
          action: 'condition.recorded',
          resourceType: 'condition_assessment',
          resourceId: assessment.id,
          metadata: {
            vehicleId: request.params.vehicleId,
            overallScore: assessment.overallScore,
            categories: items.map((item) => item.category),
          },
          ...commandMeta(request),
        });

        return { assessment, items: inserted };
      });

      return reply.status(201).send(serialize(result.assessment, result.items));
    },
  );

  fastify.patch(
    '/:vehicleId/condition/:assessmentId',
    {
      schema: {
        tags: ['condition'],
        summary: 'Correct an assessment',
        description:
          'Only the fields sent change. `items`, when sent, replaces the whole set and the ' +
          'overall score is recomputed from it.',
        params: ConditionParams,
        body: UpdateConditionAssessment,
        response: { 200: ConditionAssessment, ...StandardErrors },
      },
    },
    async (request) => {
      const { vehicleId, assessmentId } = request.params;
      const access = await fastify.requireVehicleAccess(request, vehicleId, 'condition.write');
      const existing = await findAssessment(fastify.db, vehicleId, assessmentId);
      const body = request.body;

      const result = await fastify.db.transaction(async (tx) => {
        const changes: Partial<typeof schema.conditionAssessments.$inferInsert> = {
          updatedAt: new Date(),
        };
        if (body.assessedAt !== undefined) changes.assessedAt = new Date(body.assessedAt);
        if (body.notes !== undefined) changes.notes = body.notes.trim() || null;
        if (body.odometer !== undefined) changes.odometer = body.odometer;
        if (body.odometerUnit !== undefined) changes.odometerUnit = body.odometerUnit;

        let items: ItemRow[];
        if (body.items) {
          const next = normaliseItems(body.items);
          changes.overallScore = overallScore(next);
          await tx
            .delete(schema.conditionItems)
            .where(eq(schema.conditionItems.assessmentId, assessmentId));
          items = await tx
            .insert(schema.conditionItems)
            .values(next.map((item) => ({ assessmentId, ...item })))
            .returning();
        } else {
          items = await tx
            .select()
            .from(schema.conditionItems)
            .where(eq(schema.conditionItems.assessmentId, assessmentId));
        }

        const [assessment] = await tx
          .update(schema.conditionAssessments)
          .set(changes)
          .where(eq(schema.conditionAssessments.id, assessmentId))
          .returning();

        // A corrected reading can still only move the vehicle's odometer forward.
        if (body.odometer !== undefined) await raiseOdometer(tx, vehicleId, body.odometer);

        await recordAudit(tx, {
          actorId: access.actor.userId,
          actorEmail: access.actor.email,
          garageId: access.garageId,
          action: 'condition.updated',
          resourceType: 'condition_assessment',
          resourceId: assessmentId,
          metadata: {
            vehicleId,
            fields: Object.keys(body),
            overallScore: { from: existing.overallScore, to: assessment!.overallScore },
          },
          ...commandMeta(request),
        });

        return { assessment: assessment!, items };
      });

      return serialize(result.assessment, result.items);
    },
  );

  fastify.delete(
    '/:vehicleId/condition/:assessmentId',
    {
      schema: {
        tags: ['condition'],
        summary: 'Delete an assessment',
        description: 'Its items go with it — an assessment is the unit, not the rows under it.',
        params: ConditionParams,
        response: { 204: Type.Null(), ...StandardErrors },
      },
    },
    async (request, reply) => {
      const access = await fastify.requireVehicleAccess(
        request,
        request.params.vehicleId,
        'condition.write',
      );

      const existing = await findAssessment(
        fastify.db,
        request.params.vehicleId,
        request.params.assessmentId,
      );

      await fastify.db.transaction(async (tx) => {
        // `condition_items` cascades on the foreign key. Photos have no key to cascade on;
        // they stay in the gallery, no longer attached to anything.
        await tx
          .update(schema.vehiclePhotos)
          .set({ conditionAssessmentId: null })
          .where(eq(schema.vehiclePhotos.conditionAssessmentId, request.params.assessmentId));
        await tx
          .delete(schema.conditionAssessments)
          .where(eq(schema.conditionAssessments.id, request.params.assessmentId));

        await recordAudit(tx, {
          actorId: access.actor.userId,
          actorEmail: access.actor.email,
          garageId: access.garageId,
          action: 'condition.deleted',
          resourceType: 'condition_assessment',
          resourceId: request.params.assessmentId,
          metadata: {
            vehicleId: request.params.vehicleId,
            assessedAt: existing.assessedAt.toISOString(),
            overallScore: existing.overallScore,
          },
          ...commandMeta(request),
        });
      });

      return reply.status(204).send(null);
    },
  );
};
