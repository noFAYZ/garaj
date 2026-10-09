import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import { eq } from 'drizzle-orm';
import { schema } from '@vehicle-os/database';
import {
  DocumentDownload,
  DocumentParams,
  DocumentUploadTicket,
  ExpiringDocument,
  FinalizeDocumentUpload,
  ListDocumentsQuery,
  Paginated,
  RequestDocumentUpload,
  StandardErrors,
  UpdateDocument,
  VehicleDocument,
  VehicleIdParam,
} from '@vehicle-os/contracts';
import { NotFoundError } from '../../../../infrastructure/errors';
import {
  decodeKeysetCursor,
  encodeCursor,
  normaliseLimit,
  toPage,
} from '../../../../infrastructure/pagination';
import { displayName } from '../../../vehicles/domain/entities/vehicle';
import { EXPIRY_HORIZON_DAYS, daysUntil, localDateIn } from '../../domain/expiry';
import {
  downloadUrlFor,
  editDocument,
  finalizeDocumentUpload,
  removeDocument,
  requestDocumentUpload,
} from '../../application/commands/upload-document';
import {
  findDocumentById,
  listDocuments,
  listExpiringDocuments,
} from '../../infrastructure/repositories/document-repository';
import { serializeDocument } from '../serializers/document-serializer';
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
 * The caller's own timezone, for "today".
 *
 * An expiry is a calendar date, so whether a certificate expires today depends on where the
 * person asking is — read from the profile rather than a header, for the same reason the
 * task centre does (§29): the answer must not change when they open a laptop abroad.
 */
async function timezoneFor(fastify: FastifyInstance, userId: string): Promise<string> {
  const [row] = await fastify.db
    .select({ timezone: schema.userProfiles.timezone })
    .from(schema.userProfiles)
    .where(eq(schema.userProfiles.userId, userId))
    .limit(1);
  return row?.timezone ?? 'UTC';
}

/** Image types every browser can draw, so a signed URL to them works as an `<img>` preview. */
const PREVIEWABLE_IMAGES = new Set(['image/jpeg', 'image/png', 'image/webp']);

function addDays(date: string, days: number): string {
  const shifted = new Date(`${date}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

/**
 * The cross-garage view, mounted at `/documents` rather than under `/vehicles`: it is not
 * about one vehicle, and hanging it off the vehicle prefix would make its path claim
 * otherwise.
 */
export const documentSummaryRoutes: FastifyPluginAsyncTypebox = async (fastify) => {
  fastify.get(
    '/expiring',
    {
      schema: {
        tags: ['documents'],
        summary: 'Documents expiring across every garage the caller belongs to',
        description: `Anything already expired, or expiring within ${EXPIRY_HORIZON_DAYS} days.`,
        response: { 200: Type.Array(ExpiringDocument), ...StandardErrors },
      },
    },
    async (request) => {
      const actor = await fastify.requireAuth(request);
      const timezone = await timezoneFor(fastify, actor.userId);
      const today = localDateIn(timezone, new Date());

      const rows = await listExpiringDocuments(
        fastify.db,
        actor.memberships.map((membership) => membership.garageId),
        addDays(today, EXPIRY_HORIZON_DAYS),
      );

      return rows.map((row) => ({
        document: serializeDocument(row.document),
        vehicleId: row.vehicleId,
        vehicleName: displayName({
          nickname: row.nickname,
          year: row.year,
          make: row.make,
          model: row.model,
          vehicleType: row.vehicleType,
        }),
        // Computed here, not stored: it changes every midnight without anything being
        // written, so a cached value would be wrong by definition.
        daysRemaining: daysUntil(row.document.expiresOn!, today),
      }));
    },
  );
};

export const documentRoutes: FastifyPluginAsyncTypebox = async (fastify) => {
  fastify.get(
    '/:vehicleId/documents',
    {
      schema: {
        tags: ['documents'],
        summary: 'Documents held for a vehicle',
        params: VehicleIdParam,
        querystring: ListDocumentsQuery,
        response: { 200: Paginated(VehicleDocument), ...StandardErrors },
      },
    },
    async (request) => {
      const access = await fastify.requireVehicleAccess(
        request,
        request.params.vehicleId,
        'document.read',
      );

      const limit = normaliseLimit(request.query.limit);
      const cursor = request.query.cursor ? decodeKeysetCursor(request.query.cursor) : undefined;

      const expiringBefore = request.query.expiringOnly
        ? addDays(
            localDateIn(await timezoneFor(fastify, access.actor.userId), new Date()),
            EXPIRY_HORIZON_DAYS,
          )
        : undefined;

      const rows = await listDocuments(fastify.db, {
        vehicleId: request.params.vehicleId,
        documentType: request.query.documentType,
        expiringBefore,
        limit,
        cursor: cursor ? { createdAt: cursor.at, id: cursor.id } : undefined,
      });

      // A pending row points at an object that may never have arrived; offering a download
      // of nothing is worse than not listing it.
      const uploaded = rows.filter((row) => row.uploadedAt !== null);
      const page = toPage(uploaded, limit, (row) => encodeCursor([row.createdAt, row.id]));

      /*
       * Images carry a thumbnail: a short-lived signed URL to the file itself, the same as the
       * photo gallery. Only formats every browser draws — a HEIC preview would be a broken
       * image in Chrome. PDFs and office files have no server-side renderer here, so the client
       * draws those as file tiles.
       */
      const data = await Promise.all(
        page.data.map(async (row) =>
          serializeDocument(
            row,
            PREVIEWABLE_IMAGES.has(row.mimeType)
              ? await fastify.storage.createDownloadUrl(row.storageKey, PHOTO_URL_TTL_SECONDS)
              : null,
          ),
        ),
      );
      return { data, pagination: page.pagination };
    },
  );

  fastify.post(
    '/:vehicleId/documents/upload-url',
    {
      schema: {
        tags: ['documents'],
        summary: 'Get a signed URL to upload a document directly to storage',
        description:
          'PUT the file to the returned URL, then call finalize. The bytes never pass ' +
          'through the API.',
        params: VehicleIdParam,
        body: RequestDocumentUpload,
        response: { 201: DocumentUploadTicket, ...StandardErrors },
      },
    },
    async (request, reply) => {
      const { actor, garageId } = await fastify.requireVehicleAccess(
        request,
        request.params.vehicleId,
        'document.write',
      );

      const ticket = await requestDocumentUpload(
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
    '/:vehicleId/documents/:documentId/finalize',
    {
      schema: {
        tags: ['documents'],
        summary: 'Confirm an upload completed and attach its metadata',
        params: DocumentParams,
        body: FinalizeDocumentUpload,
        response: { 200: VehicleDocument, ...StandardErrors, 409: StandardErrors[400] },
      },
    },
    async (request) => {
      const access = await fastify.requireVehicleAccess(
        request,
        request.params.vehicleId,
        'document.write',
      );

      const document = await finalizeDocumentUpload(
        fastify.db,
        fastify.storage,
        request.params.vehicleId,
        access.garageId,
        request.params.documentId,
        request.body,
        access.actor,
        commandMeta(request),
      );
      return serializeDocument(document);
    },
  );

  fastify.get(
    '/:vehicleId/documents/:documentId/download',
    {
      schema: {
        tags: ['documents'],
        summary: 'A short-lived signed URL for the file itself',
        description:
          'Minted per request, after the authorization check. Nothing in the bucket is ' +
          'public, and the link expires on its own rather than living on wherever it was pasted.',
        params: DocumentParams,
        response: { 200: DocumentDownload, ...StandardErrors },
      },
    },
    async (request) => {
      await fastify.requireVehicleAccess(request, request.params.vehicleId, 'document.read');

      const document = await findDocumentById(
        fastify.db,
        request.params.vehicleId,
        request.params.documentId,
      );
      if (!document || document.uploadedAt === null) throw new NotFoundError('Document');

      const { url, expiresInSeconds } = await downloadUrlFor(fastify.storage, document);
      return {
        url,
        expiresInSeconds,
        filename: document.filename,
        mimeType: document.mimeType,
      };
    },
  );

  fastify.patch(
    '/:vehicleId/documents/:documentId',
    {
      schema: {
        tags: ['documents'],
        summary: 'Correct a document’s details',
        description: 'Metadata only — replacing the file means uploading a new document.',
        params: DocumentParams,
        body: UpdateDocument,
        response: { 200: VehicleDocument, ...StandardErrors },
      },
    },
    async (request) => {
      await fastify.requireVehicleAccess(request, request.params.vehicleId, 'document.write');

      const document = await editDocument(
        fastify.db,
        request.params.vehicleId,
        request.params.documentId,
        request.body,
      );
      return serializeDocument(document);
    },
  );

  fastify.delete(
    '/:vehicleId/documents/:documentId',
    {
      schema: {
        tags: ['documents'],
        summary: 'Delete a document',
        description:
          'Soft delete (§103) — an insurance certificate removed by mistake is worth being ' +
          'able to restore.',
        params: DocumentParams,
        response: { 204: Type.Null(), ...StandardErrors },
      },
    },
    async (request, reply) => {
      const access = await fastify.requireVehicleAccess(
        request,
        request.params.vehicleId,
        'document.delete',
      );

      await removeDocument(
        fastify.db,
        access.actor,
        request.params.vehicleId,
        access.garageId,
        request.params.documentId,
        commandMeta(request),
      );
      return reply.status(204).send(null);
    },
  );
};
