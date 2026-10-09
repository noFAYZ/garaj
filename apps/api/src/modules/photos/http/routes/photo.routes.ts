import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { schema } from '@vehicle-os/database';
import {
  FinalizePhotoUpload,
  PhotoParams,
  PhotoUploadTicket,
  RequestPhotoUpload,
  StandardErrors,
  VehicleIdParam,
  VehiclePhoto,
} from '@vehicle-os/contracts';
import {
  deletePhoto,
  finalizeUpload,
  requestUpload,
} from '../../application/commands/upload-photo';
import { PHOTO_URL_TTL_SECONDS } from '../../../../infrastructure/storage/storage-port';

export const photoRoutes: FastifyPluginAsyncTypebox = async (fastify) => {
  fastify.get(
    '/:vehicleId/photos',
    {
      schema: {
        tags: ['photos'],
        summary: 'Vehicle gallery',
        params: VehicleIdParam,
        response: { 200: Type.Array(VehiclePhoto), ...StandardErrors },
      },
    },
    async (request) => {
      await fastify.requireVehicleAccess(request, request.params.vehicleId, 'photo.read');

      const rows = await fastify.db
        .select()
        .from(schema.vehiclePhotos)
        .where(
          and(
            eq(schema.vehiclePhotos.vehicleId, request.params.vehicleId),
            isNull(schema.vehiclePhotos.deletedAt),
          ),
        )
        .orderBy(desc(schema.vehiclePhotos.createdAt));

      return Promise.all(
        rows.map(async (photo) => {
          // Minted per request and short-lived. Nothing in the bucket is public, so this is
          // the only way to read the bytes and it expires on its own.
          const url = await fastify.storage.createDownloadUrl(
            photo.storageKey,
            PHOTO_URL_TTL_SECONDS,
          );
          return {
            id: photo.id,
            vehicleId: photo.vehicleId,
            eventId: photo.eventId,
            conditionAssessmentId: photo.conditionAssessmentId,
            url,
            // The cutout exists for the vehicle's primary photo only; every other row's
            // thumbnail is its own original, and the same link serves both.
            thumbnailUrl: photo.cutoutKey
              ? await fastify.storage.createDownloadUrl(photo.cutoutKey, PHOTO_URL_TTL_SECONDS)
              : url,
            isCutout: photo.cutoutKey !== null,
            mimeType: photo.mimeType,
            sizeBytes: photo.sizeBytes,
            width: photo.width,
            height: photo.height,
            caption: photo.caption,
            category: photo.category,
            capturedAt: photo.capturedAt,
            createdAt: photo.createdAt.toISOString(),
          };
        }),
      );
    },
  );

  fastify.post(
    '/:vehicleId/photos/upload-url',
    {
      schema: {
        tags: ['photos'],
        summary: 'Get a signed URL to upload a photo directly to storage',
        description:
          'PUT the file to the returned URL, then call finalize. The bytes never pass ' +
          'through the API.',
        params: VehicleIdParam,
        body: RequestPhotoUpload,
        response: { 201: PhotoUploadTicket, ...StandardErrors },
      },
    },
    async (request, reply) => {
      const { actor, garageId } = await fastify.requireVehicleAccess(
        request,
        request.params.vehicleId,
        'photo.write',
      );
      const ticket = await requestUpload(
        fastify.db,
        fastify.storage,
        actor,
        request.params.vehicleId,
        garageId,
        request.body,
      );
      return reply.status(201).send(ticket);
    },
  );

  fastify.post(
    '/:vehicleId/photos/:photoId/finalize',
    {
      schema: {
        tags: ['photos'],
        summary: 'Confirm an upload completed and attach its metadata',
        params: PhotoParams,
        body: FinalizePhotoUpload,
        response: { 204: Type.Null(), ...StandardErrors, 409: StandardErrors[400] },
      },
    },
    async (request, reply) => {
      await fastify.requireVehicleAccess(request, request.params.vehicleId, 'photo.write');
      await finalizeUpload(
        fastify.db,
        fastify.storage,
        request.params.vehicleId,
        request.params.photoId,
        request.body,
      );
      return reply.status(204).send(null);
    },
  );

  fastify.delete(
    '/:vehicleId/photos/:photoId',
    {
      schema: {
        tags: ['photos'],
        summary: 'Delete a photo',
        params: PhotoParams,
        response: { 204: Type.Null(), ...StandardErrors },
      },
    },
    async (request, reply) => {
      await fastify.requireVehicleAccess(request, request.params.vehicleId, 'photo.delete');
      await deletePhoto(fastify.db, request.params.vehicleId, request.params.photoId);
      return reply.status(204).send(null);
    },
  );
};
