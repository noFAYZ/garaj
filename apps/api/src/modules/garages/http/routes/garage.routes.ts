import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import {
  AddGarageMember,
  AssignMemberVehicles,
  AssignVehicleDrivers,
  CreateGarage,
  Garage,
  GarageIdParam,
  GarageMember,
  GarageMemberParams,
  GarageVehicleParams,
  StandardErrors,
  UpdateGarage,
  UpdateGarageMember,
} from '@vehicle-os/contracts';
import { createGarage, type CommandMeta } from '../../application/commands/create-garage';
import { removeGarage, updateGarage } from '../../application/commands/update-garage';
import {
  addMember,
  assignDrivers,
  assignVehicles,
  changeMemberRole,
  removeMember,
} from '../../application/commands/manage-members';
import {
  findById,
  listForUser,
  listMembers,
} from '../../infrastructure/repositories/garage-repository';
import { serializeGarage, serializeMember } from '../serializers/garage-serializer';
import { NotFoundError } from '../../../../infrastructure/errors';
import type { FastifyRequest } from 'fastify';
import { assertWithinLimit } from '../../../../plugins/plan-access';
import {
  countGaragesOwnedBy,
  countMembers,
} from '../../infrastructure/repositories/garage-repository';

function commandMeta(request: FastifyRequest): CommandMeta {
  return {
    requestId: request.id,
    ipAddress: request.ip,
    // Denormalised onto the audit row so the trail stays readable after the account is
    // deleted and `actor_id` is nulled out.
    actorEmail: request.actor?.email ?? null,
  };
}

export const garageRoutes: FastifyPluginAsyncTypebox = async (fastify) => {
  fastify.get(
    '/',
    {
      schema: {
        tags: ['garages'],
        summary: 'Garages the caller belongs to',
        response: { 200: Type.Array(Garage), ...StandardErrors },
      },
    },
    async (request) => {
      const actor = await fastify.requireAuth(request);
      const garages = await listForUser(fastify.db, actor.userId);
      return garages.map(serializeGarage);
    },
  );

  fastify.post(
    '/',
    {
      schema: {
        tags: ['garages'],
        summary: 'Create a garage',
        description: 'The caller becomes its owner.',
        body: CreateGarage,
        response: { 201: Garage, ...StandardErrors },
      },
    },
    async (request, reply) => {
      const actor = await fastify.requireAuth(request);
      const plan = await fastify.planFor(request, actor.userId);
      assertWithinLimit(
        plan,
        'garages',
        await countGaragesOwnedBy(fastify.db, actor.userId),
        'garages',
      );
      const garage = await createGarage(fastify.db, actor, request.body, commandMeta(request));
      return reply.status(201).send(serializeGarage(garage));
    },
  );

  fastify.get(
    '/:garageId',
    {
      schema: {
        tags: ['garages'],
        summary: 'One garage',
        params: GarageIdParam,
        response: { 200: Garage, ...StandardErrors },
      },
    },
    async (request) => {
      const actor = fastify.requireCapability(request, 'garage.read', request.params.garageId);
      const garage = await findById(fastify.db, request.params.garageId, actor.userId);
      if (!garage) throw new NotFoundError('Garage');
      return serializeGarage(garage);
    },
  );

  fastify.patch(
    '/:garageId',
    {
      schema: {
        tags: ['garages'],
        summary: 'Update garage settings',
        params: GarageIdParam,
        body: UpdateGarage,
        response: { 200: Garage, ...StandardErrors },
      },
    },
    async (request) => {
      const actor = fastify.requireCapability(
        request,
        'garage.manage_settings',
        request.params.garageId,
      );
      const garage = await updateGarage(
        fastify.db,
        actor,
        request.params.garageId,
        request.body,
        commandMeta(request),
      );
      return serializeGarage(garage);
    },
  );

  fastify.delete(
    '/:garageId',
    {
      schema: {
        tags: ['garages'],
        summary: 'Delete a garage and everything in it',
        description: 'Owner only. Cascades to vehicles, events, expenses and documents.',
        params: GarageIdParam,
        response: { 204: Type.Null(), ...StandardErrors },
      },
    },
    async (request, reply) => {
      const actor = fastify.requireCapability(request, 'garage.delete', request.params.garageId);
      await removeGarage(fastify.db, actor, request.params.garageId, commandMeta(request));
      return reply.status(204).send(null);
    },
  );

  // --- Members --------------------------------------------------------------

  fastify.get(
    '/:garageId/members',
    {
      schema: {
        tags: ['garages'],
        summary: 'Garage members',
        params: GarageIdParam,
        response: { 200: Type.Array(GarageMember), ...StandardErrors },
      },
    },
    async (request) => {
      fastify.requireCapability(request, 'garage.read', request.params.garageId);
      const members = await listMembers(fastify.db, request.params.garageId);
      return members.map(serializeMember);
    },
  );

  fastify.post(
    '/:garageId/members',
    {
      schema: {
        tags: ['garages'],
        summary: 'Add a member by email',
        description: 'The person must already have a Garaj account.',
        params: GarageIdParam,
        body: AddGarageMember,
        response: { 201: GarageMember, ...StandardErrors, 409: StandardErrors[400] },
      },
    },
    async (request, reply) => {
      const actor = fastify.requireCapability(
        request,
        'garage.manage_members',
        request.params.garageId,
      );
      /*
       * Refused here rather than on the accept: the person invited has done nothing wrong,
       * and a door that closes in their face is the owner's limit, not their problem.
       */
      const plan = await fastify.planForGarage(request, request.params.garageId);
      assertWithinLimit(
        plan,
        'members',
        await countMembers(fastify.db, request.params.garageId),
        'people per garage',
      );
      const member = await addMember(
        fastify.db,
        actor,
        request.params.garageId,
        request.body,
        commandMeta(request),
      );
      return reply.status(201).send(serializeMember(member));
    },
  );

  fastify.patch(
    '/:garageId/members/:memberId',
    {
      schema: {
        tags: ['garages'],
        summary: 'Change a member role',
        params: GarageMemberParams,
        body: UpdateGarageMember,
        response: { 200: GarageMember, ...StandardErrors, 409: StandardErrors[400] },
      },
    },
    async (request) => {
      const actor = fastify.requireCapability(
        request,
        'garage.manage_members',
        request.params.garageId,
      );
      const member = await changeMemberRole(
        fastify.db,
        actor,
        request.params.garageId,
        request.params.memberId,
        request.body.role,
        commandMeta(request),
      );
      return serializeMember(member);
    },
  );

  fastify.put(
    '/:garageId/members/:memberId/vehicles',
    {
      schema: {
        tags: ['garages'],
        summary: 'Set the vehicles a member drives',
        description: 'Replaces the whole set. Every vehicle must be in this garage.',
        params: GarageMemberParams,
        body: AssignMemberVehicles,
        response: { 200: GarageMember, ...StandardErrors },
      },
    },
    async (request) => {
      const actor = fastify.requireCapability(
        request,
        'garage.manage_members',
        request.params.garageId,
      );
      const member = await assignVehicles(
        fastify.db,
        actor,
        request.params.garageId,
        request.params.memberId,
        request.body.vehicleIds,
        commandMeta(request),
      );
      return serializeMember(member);
    },
  );

  fastify.put(
    '/:garageId/vehicles/:vehicleId/drivers',
    {
      schema: {
        tags: ['garages'],
        summary: 'Set who drives a vehicle',
        description:
          'Replaces the whole set. Every id must be a member of this garage. Returns the members.',
        params: GarageVehicleParams,
        body: AssignVehicleDrivers,
        response: { 200: Type.Array(GarageMember), ...StandardErrors },
      },
    },
    async (request) => {
      const actor = fastify.requireCapability(
        request,
        'garage.manage_members',
        request.params.garageId,
      );
      const members = await assignDrivers(
        fastify.db,
        actor,
        request.params.garageId,
        request.params.vehicleId,
        request.body.memberIds,
        commandMeta(request),
      );
      return members.map(serializeMember);
    },
  );

  fastify.delete(
    '/:garageId/members/:memberId',
    {
      schema: {
        tags: ['garages'],
        summary: 'Remove a member',
        params: GarageMemberParams,
        response: { 204: Type.Null(), ...StandardErrors, 409: StandardErrors[400] },
      },
    },
    async (request, reply) => {
      const actor = fastify.requireCapability(
        request,
        'garage.manage_members',
        request.params.garageId,
      );
      await removeMember(
        fastify.db,
        actor,
        request.params.garageId,
        request.params.memberId,
        commandMeta(request),
      );
      return reply.status(204).send(null);
    },
  );
};
