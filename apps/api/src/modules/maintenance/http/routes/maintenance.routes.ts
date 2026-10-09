import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import {
  CompleteMaintenance,
  CreateMaintenancePlan,
  DueItem,
  ListMaintenanceQuery,
  LogMaintenance,
  MaintenanceCompletion,
  MaintenancePlan,
  MaintenanceRecord,
  PlanParams,
  StandardErrors,
  UpdateMaintenancePlan,
  VehicleIdParam,
} from '@vehicle-os/contracts';
import { NotFoundError } from '../../../../infrastructure/errors';
import { displayName } from '../../../vehicles/domain/entities/vehicle';
import { findVehicleById } from '../../../vehicles/infrastructure/repositories/vehicle-repository';
import { completeMaintenance } from '../../application/commands/complete-maintenance';
import { createPlan, editPlan, removePlan } from '../../application/commands/manage-plans';
import {
  findPlanById,
  listDuePlansForGarages,
  listPlans,
  listRecords,
} from '../../infrastructure/repositories/maintenance-repository';
import { serializePlan, serializeRecord } from '../serializers/maintenance-serializer';
import type { FastifyRequest } from 'fastify';

function commandMeta(request: FastifyRequest) {
  return {
    requestId: request.id,
    ipAddress: request.ip,
    actorEmail: request.actor?.email ?? null,
  };
}

/** Overdue first, then soonest — the order the work should actually be done in. */
const STATUS_ORDER = { OVERDUE: 0, DUE_SOON: 1, OK: 2, UNSCHEDULED: 3 } as const;

export const maintenanceRoutes: FastifyPluginAsyncTypebox = async (fastify) => {
  fastify.get(
    '/due',
    {
      schema: {
        tags: ['maintenance'],
        summary: 'Work due across every garage the caller belongs to',
        description: 'What the dashboard reads for its "attention required" section.',
        response: { 200: Type.Array(DueItem), ...StandardErrors },
      },
    },
    async (request) => {
      const actor = await fastify.requireAuth(request);
      const garageIds = actor.memberships.map((membership) => membership.garageId);
      const rows = await listDuePlansForGarages(fastify.db, garageIds);

      return (
        rows
          .map((row) => ({
            plan: serializePlan(row.plan, {
              currentOdometer: row.currentOdometer,
              odometerUnit: row.odometerUnit,
              currentEngineHours: row.currentEngineHours,
            }),
            vehicleId: row.vehicleId,
            vehicleName: displayName({
              nickname: row.nickname,
              year: row.year,
              make: row.make,
              model: row.model,
              vehicleType: row.vehicleType,
            }),
            vehicleType: row.vehicleType,
            odometerUnit: row.odometerUnit,
          }))
          // Sorted after computing, because the status is derived — the database cannot order
          // by a value it does not hold.
          .sort((a, b) => STATUS_ORDER[a.plan.status] - STATUS_ORDER[b.plan.status])
      );
    },
  );

  fastify.get(
    '/:vehicleId/maintenance',
    {
      schema: {
        tags: ['maintenance'],
        summary: 'Maintenance plans for a vehicle, with live due status',
        params: VehicleIdParam,
        querystring: ListMaintenanceQuery,
        response: { 200: Type.Array(MaintenancePlan), ...StandardErrors },
      },
    },
    async (request) => {
      // The vehicle comes back from the guard, which had to read it anyway.
      const { vehicle } = await fastify.requireVehicleAccess(
        request,
        request.params.vehicleId,
        'maintenance.read',
      );

      const plans = await listPlans(
        fastify.db,
        request.params.vehicleId,
        request.query.includeInactive ?? false,
      );

      const serialized = plans
        .map((plan) => serializePlan(plan, vehicle))
        .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);

      return request.query.status
        ? serialized.filter((plan) => plan.status === request.query.status)
        : serialized;
    },
  );

  fastify.post(
    '/:vehicleId/maintenance',
    {
      schema: {
        tags: ['maintenance'],
        summary: 'Schedule a recurring maintenance item',
        description:
          'Needs at least one interval. Without a supplied baseline it counts from the ' +
          "vehicle's state today.",
        params: VehicleIdParam,
        body: CreateMaintenancePlan,
        response: { 201: MaintenancePlan, ...StandardErrors },
      },
    },
    async (request, reply) => {
      const { actor, garageId } = await fastify.requireVehicleAccess(
        request,
        request.params.vehicleId,
        'maintenance.plan.write',
      );

      const plan = await createPlan(
        fastify.db,
        actor,
        request.params.vehicleId,
        garageId,
        request.body,
        commandMeta(request),
      );

      const vehicle = await findVehicleById(fastify.db, request.params.vehicleId);
      if (!vehicle) throw new NotFoundError('Vehicle');
      return reply.status(201).send(serializePlan(plan, vehicle));
    },
  );

  fastify.patch(
    '/:vehicleId/maintenance/:planId',
    {
      schema: {
        tags: ['maintenance'],
        summary: 'Edit a maintenance plan',
        params: PlanParams,
        body: UpdateMaintenancePlan,
        response: { 200: MaintenancePlan, ...StandardErrors },
      },
    },
    async (request) => {
      const { actor, garageId } = await fastify.requireVehicleAccess(
        request,
        request.params.vehicleId,
        'maintenance.plan.write',
      );

      const plan = await editPlan(
        fastify.db,
        actor,
        request.params.vehicleId,
        request.params.planId,
        garageId,
        request.body,
        commandMeta(request),
      );

      const vehicle = await findVehicleById(fastify.db, request.params.vehicleId);
      if (!vehicle) throw new NotFoundError('Vehicle');
      return serializePlan(plan, vehicle);
    },
  );

  fastify.delete(
    '/:vehicleId/maintenance/:planId',
    {
      schema: {
        tags: ['maintenance'],
        summary: 'Delete a maintenance plan',
        description: 'Its completed records stay in the vehicle history.',
        params: PlanParams,
        response: { 204: Type.Null(), ...StandardErrors },
      },
    },
    async (request, reply) => {
      const { actor, garageId } = await fastify.requireVehicleAccess(
        request,
        request.params.vehicleId,
        'maintenance.plan.write',
      );
      await removePlan(
        fastify.db,
        actor,
        request.params.vehicleId,
        request.params.planId,
        garageId,
        commandMeta(request),
      );
      return reply.status(204).send(null);
    },
  );

  fastify.post(
    '/:vehicleId/maintenance/:planId/complete',
    {
      schema: {
        tags: ['maintenance'],
        summary: 'Log a scheduled service as done',
        description:
          'Writes the record, a timeline event and — when a cost is given — an expense, in ' +
          "one transaction, then resets the plan's clock to the reading at completion.",
        params: PlanParams,
        body: CompleteMaintenance,
        response: { 201: MaintenanceCompletion, ...StandardErrors },
      },
    },
    async (request, reply) => {
      const { actor } = await fastify.requireVehicleAccess(
        request,
        request.params.vehicleId,
        'maintenance.record.write',
      );

      const result = await completeMaintenance(
        fastify.db,
        actor,
        request.params.vehicleId,
        request.params.planId,
        request.body,
      );

      const vehicle = await findVehicleById(fastify.db, request.params.vehicleId);
      if (!vehicle) throw new NotFoundError('Vehicle');

      return reply.status(201).send({
        record: serializeRecord(result.record),
        plan: result.plan ? serializePlan(result.plan, vehicle) : null,
      });
    },
  );

  fastify.post(
    '/:vehicleId/maintenance/records',
    {
      schema: {
        tags: ['maintenance'],
        summary: 'Log unscheduled work',
        description: 'A repair that was never on a plan. It still belongs in the history.',
        params: VehicleIdParam,
        body: LogMaintenance,
        response: { 201: MaintenanceCompletion, ...StandardErrors },
      },
    },
    async (request, reply) => {
      const { actor } = await fastify.requireVehicleAccess(
        request,
        request.params.vehicleId,
        'maintenance.record.write',
      );

      const result = await completeMaintenance(
        fastify.db,
        actor,
        request.params.vehicleId,
        null,
        request.body,
      );

      return reply.status(201).send({ record: serializeRecord(result.record), plan: null });
    },
  );

  fastify.get(
    '/:vehicleId/maintenance/records',
    {
      schema: {
        tags: ['maintenance'],
        summary: 'Maintenance history',
        params: VehicleIdParam,
        response: { 200: Type.Array(MaintenanceRecord), ...StandardErrors },
      },
    },
    async (request) => {
      await fastify.requireVehicleAccess(request, request.params.vehicleId, 'maintenance.read');
      const records = await listRecords(fastify.db, request.params.vehicleId);
      return records.map(serializeRecord);
    },
  );

  fastify.get(
    '/:vehicleId/maintenance/:planId',
    {
      schema: {
        tags: ['maintenance'],
        summary: 'One maintenance plan',
        params: PlanParams,
        response: { 200: MaintenancePlan, ...StandardErrors },
      },
    },
    async (request) => {
      const { vehicle } = await fastify.requireVehicleAccess(
        request,
        request.params.vehicleId,
        'maintenance.read',
      );

      const plan = await findPlanById(fastify.db, request.params.vehicleId, request.params.planId);
      if (!plan) throw new NotFoundError('Maintenance plan');

      return serializePlan(plan, vehicle);
    },
  );
};
