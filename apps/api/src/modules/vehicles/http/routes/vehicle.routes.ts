import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { assertWithinLimit } from '../../../../plugins/plan-access';
import { countVehiclesOwnedBy } from '../../../garages/infrastructure/repositories/garage-repository';
import { Type } from '@sinclair/typebox';
import { DecodeVinRequest, VinDecodeResult } from '@vehicle-os/contracts';
import { env } from '@vehicle-os/config';
import { ValidationError } from '../../../../infrastructure/errors';
import { decodeVin, isVin, normaliseVin } from '../../../../infrastructure/vin';
import {
  CreateVehicle,
  ListVehiclesQuery,
  Paginated,
  StandardErrors,
  UpdateVehicle,
  Vehicle,
  VehicleIdParam,
  VehicleTypeDescriptor,
} from '@vehicle-os/contracts';
import {
  VEHICLE_TYPES,
  VEHICLE_TYPE_CAPABILITIES,
  primaryUsageMeter,
  specFieldsFor,
} from '@vehicle-os/domain';
import {
  decodeKeysetCursor,
  encodeCursor,
  normaliseLimit,
  toPage,
} from '../../../../infrastructure/pagination';
import { createVehicle } from '../../application/commands/create-vehicle';
import { archive, updateVehicle } from '../../application/commands/update-vehicle';
import {
  listVehicles,
  type VehicleWithPhoto,
} from '../../infrastructure/repositories/vehicle-repository';
import { serializeVehicle } from '../serializers/vehicle-serializer';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { PHOTO_URL_TTL_SECONDS } from '../../../../infrastructure/storage/storage-port';

function commandMeta(request: FastifyRequest) {
  return {
    requestId: request.id,
    ipAddress: request.ip,
    actorEmail: request.actor?.email ?? null,
  };
}

/**
 * Mints a signed URL for the primary photo when there is one.
 *
 * Done per vehicle rather than in the serializer so the storage call stays visible at the
 * route level — a list of 25 vehicles issues at most 25 signings, and if that ever shows up
 * in the p95 it is obvious where to batch.
 */
async function withPhotoUrl(fastify: FastifyInstance, vehicle: VehicleWithPhoto) {
  const photo = vehicle.primaryPhoto;
  if (!photo) return serializeVehicle(vehicle, null);

  const [url, thumbnailUrl] = await Promise.all([
    fastify.storage.createDownloadUrl(photo.storageKey, PHOTO_URL_TTL_SECONDS),
    // One extra signing only once a cutout exists, so a garage of un-processed photos
    // still signs one URL per vehicle.
    photo.cutoutKey
      ? fastify.storage.createDownloadUrl(photo.cutoutKey, PHOTO_URL_TTL_SECONDS)
      : null,
  ]);
  return serializeVehicle(vehicle, url, thumbnailUrl ?? url);
}

export const vehicleRoutes: FastifyPluginAsyncTypebox = async (fastify) => {
  fastify.get(
    '/types',
    {
      schema: {
        tags: ['vehicles'],
        summary: 'Vehicle types and their capability-derived spec fields',
        description:
          'Drives the add-vehicle form: which fields exist for a type and how to render them.',
        security: [],
        response: { 200: Type.Array(VehicleTypeDescriptor) },
      },
    },
    () =>
      VEHICLE_TYPES.map((vehicleType) => ({
        vehicleType,
        capabilities: [...VEHICLE_TYPE_CAPABILITIES[vehicleType]],
        // Spread copies the field but keeps `options` as the same readonly array, which
        // the response schema types as mutable; the inner spread is what actually copies it.
        specFields: specFieldsFor(vehicleType).map((field) => ({
          ...field,
          options: field.options ? [...field.options] : undefined,
        })),
        primaryUsageMeter: primaryUsageMeter(vehicleType),
      })),
  );

  fastify.post(
    '/decode-vin',
    {
      schema: {
        tags: ['vehicles'],
        summary: 'What a VIN says about a vehicle',
        description:
          'Candidate values for the add-vehicle form, from NHTSA vPIC. Nothing is stored. ' +
          '`decoded: false` is a normal answer — vPIC is US-market and many other VINs ' +
          'return nothing useful.',
        body: DecodeVinRequest,
        response: { 200: VinDecodeResult, ...StandardErrors },
      },
    },
    async (request) => {
      await fastify.requireAuth(request);

      const vin = normaliseVin(request.body.vin);
      if (!isVin(vin)) {
        throw new ValidationError('Invalid request', {
          vin: 'A VIN is 17 letters and digits, without I, O or Q.',
        });
      }

      const decoded = await decodeVin(env().VPIC_URL, vin, request.log);
      // Only a make is not a decode worth offering: it is what the first three characters
      // say about any VIN, and filling one field of a form looks like the feature failed.
      const useful = decoded && (decoded.model || decoded.year);

      return useful
        ? { ...decoded, decoded: true, specs: { ...decoded.specs } }
        : {
            vin,
            decoded: false,
            make: decoded?.make ?? null,
            model: null,
            year: null,
            variant: null,
            specs: {},
            warning: decoded?.warning ?? null,
          };
    },
  );

  fastify.get(
    '/',
    {
      schema: {
        tags: ['vehicles'],
        summary: 'Vehicles across every garage the caller belongs to',
        querystring: ListVehiclesQuery,
        response: { 200: Paginated(Vehicle), ...StandardErrors },
      },
    },
    async (request) => {
      const actor = await fastify.requireAuth(request);
      const limit = normaliseLimit(request.query.limit);

      /*
       * The tenant filter comes from the actor's memberships, not the query string. A
       * `garageId` in the query narrows that set; it can never widen it, so passing
       * someone else's garage id returns nothing rather than their vehicles.
       */
      const garageIds = actor.memberships.map((membership) => membership.garageId);

      const cursor = request.query.cursor ? decodeKeysetCursor(request.query.cursor) : undefined;
      const rows = await listVehicles(fastify.db, {
        garageIds,
        garageId: request.query.garageId,
        vehicleType: request.query.vehicleType,
        status: request.query.status,
        limit,
        cursor: cursor ? { createdAt: cursor.at, id: cursor.id } : undefined,
      });

      const page = toPage(rows, limit, (row) => encodeCursor([row.createdAt, row.id]));
      return {
        data: await Promise.all(page.data.map((row) => withPhotoUrl(fastify, row))),
        pagination: page.pagination,
      };
    },
  );

  fastify.post(
    '/',
    {
      schema: {
        tags: ['vehicles'],
        summary: 'Add a vehicle to a garage',
        body: CreateVehicle,
        response: { 201: Vehicle, ...StandardErrors },
      },
    },
    async (request, reply) => {
      const actor = fastify.requireCapability(request, 'vehicle.write', request.body.garageId);
      /*
       * Counted against whoever is billed for the garage, over every garage they own —
       * otherwise one paid plan spread over six free garages is the plan.
       */
      const plan = await fastify.planForGarage(request, request.body.garageId);
      assertWithinLimit(
        plan,
        'vehicles',
        await countVehiclesOwnedBy(fastify.db, plan.userId),
        'vehicles',
      );
      const vehicle = await createVehicle(fastify.db, actor, request.body, commandMeta(request));
      return reply.status(201).send(await withPhotoUrl(fastify, vehicle));
    },
  );

  fastify.get(
    '/:vehicleId',
    {
      schema: {
        tags: ['vehicles'],
        summary: 'One vehicle',
        params: VehicleIdParam,
        response: { 200: Vehicle, ...StandardErrors },
      },
    },
    async (request) => {
      // The guard already read this row to find its garage; reading it again would be a
      // second round trip for a row that is in memory.
      const { vehicle } = await fastify.requireVehicleAccess(
        request,
        request.params.vehicleId,
        'vehicle.read',
      );
      return withPhotoUrl(fastify, vehicle);
    },
  );

  fastify.patch(
    '/:vehicleId',
    {
      schema: {
        tags: ['vehicles'],
        summary: 'Update a vehicle',
        description:
          'Specs are merged, not replaced: send only the fields you are changing, and null ' +
          'to clear one. The vehicle type is immutable.',
        params: VehicleIdParam,
        body: UpdateVehicle,
        response: { 200: Vehicle, ...StandardErrors },
      },
    },
    async (request) => {
      const { actor } = await fastify.requireVehicleAccess(
        request,
        request.params.vehicleId,
        'vehicle.write',
      );
      const vehicle = await updateVehicle(
        fastify.db,
        actor,
        request.params.vehicleId,
        request.body,
        commandMeta(request),
      );
      return withPhotoUrl(fastify, vehicle);
    },
  );

  fastify.delete(
    '/:vehicleId',
    {
      schema: {
        tags: ['vehicles'],
        summary: 'Archive a vehicle',
        description: 'A soft delete: the vehicle leaves every list, and its history is preserved.',
        params: VehicleIdParam,
        response: { 204: Type.Null(), ...StandardErrors },
      },
    },
    async (request, reply) => {
      const { actor } = await fastify.requireVehicleAccess(
        request,
        request.params.vehicleId,
        'vehicle.delete',
      );
      await archive(fastify.db, actor, request.params.vehicleId, commandMeta(request));
      return reply.status(204).send(null);
    },
  );
};
