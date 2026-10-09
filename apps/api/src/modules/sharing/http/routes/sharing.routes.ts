import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import { and, desc, eq, sql } from 'drizzle-orm';
import { schema } from '@vehicle-os/database';
import {
  CreateShareLink,
  PassportTokenParam,
  ShareLink,
  ShareLinkParams,
  StandardErrors,
  VehicleIdParam,
  VehiclePassport,
} from '@vehicle-os/contracts';
import { env, isEnabled } from '@vehicle-os/config';
import { PASSPORT_SECTIONS, type PassportSection } from '@vehicle-os/domain';
import { NotFoundError } from '../../../../infrastructure/errors';
import { recordAudit } from '../../../../infrastructure/audit';
import { generateToken, hashToken, isUsable } from '../../domain/token';
import { buildPassport } from '../../application/services/passport';
import type { FastifyRequest } from 'fastify';

type LinkRow = typeof schema.shareLinks.$inferSelect;

function serialize(link: LinkRow, token?: string) {
  return {
    id: link.id,
    vehicleId: link.vehicleId,
    scope: link.scope,
    label: link.label,
    sections: sectionsOf(link),
    expiresAt: link.expiresAt?.toISOString() ?? null,
    revokedAt: link.revokedAt?.toISOString() ?? null,
    viewCount: link.viewCount,
    lastViewedAt: link.lastViewedAt?.toISOString() ?? null,
    createdAt: link.createdAt.toISOString(),
    ...(token ? { token } : {}),
  };
}

/**
 * The stored choice, narrowed to sections this build knows. A value from a future release
 * read by an older one is dropped rather than shown — failing closed is the direction a
 * disclosure setting should fail in.
 */
function sectionsOf(link: LinkRow): PassportSection[] {
  return link.sections.filter((section): section is PassportSection =>
    (PASSPORT_SECTIONS as readonly string[]).includes(section),
  );
}

/**
 * The server decides (§94). Off, sharing is refused on both sides — creating a link and
 * reading one — so flipping the flag in a client's devtools buys nothing.
 */
function assertPassportEnabled(): void {
  if (!isEnabled(env(), 'passport')) throw new NotFoundError('Passport');
}

function commandMeta(request: FastifyRequest) {
  return { requestId: request.id, ipAddress: request.ip };
}

/** Owner-side: creating, listing and revoking the links for one vehicle. */
export const sharingRoutes: FastifyPluginAsyncTypebox = async (fastify) => {
  fastify.get(
    '/:vehicleId/shares',
    {
      schema: {
        tags: ['sharing'],
        summary: 'Share links for this vehicle',
        description: 'Never includes the tokens — the database holds only their hashes.',
        params: VehicleIdParam,
        response: { 200: Type.Array(ShareLink), ...StandardErrors },
      },
    },
    async (request) => {
      // Sharing a vehicle's whole history is a settings-level act, not a read.
      await fastify.requireVehicleAccess(
        request,
        request.params.vehicleId,
        'garage.manage_settings',
      );

      const rows = await fastify.db
        .select()
        .from(schema.shareLinks)
        .where(eq(schema.shareLinks.vehicleId, request.params.vehicleId))
        .orderBy(desc(schema.shareLinks.createdAt));

      return rows.map((row) => serialize(row));
    },
  );

  fastify.post(
    '/:vehicleId/shares',
    {
      schema: {
        tags: ['sharing'],
        summary: 'Create a share link',
        description:
          'The token is returned once, here, and cannot be recovered afterwards — the ' +
          'database stores only its hash. A lost link is replaced, not looked up.',
        params: VehicleIdParam,
        body: CreateShareLink,
        response: { 201: ShareLink, ...StandardErrors },
      },
    },
    async (request, reply) => {
      const access = await fastify.requireVehicleAccess(
        request,
        request.params.vehicleId,
        'garage.manage_settings',
      );

      assertPassportEnabled();
      /*
       * On creating a link, never on following one. A reader who was sent a passport is a
       * buyer, a mechanic or an insurer with no account here, and charging the *owner* again
       * every time one of them opens it would make the feature worse the more it was used.
       */
      await fastify.requireEntitlement(request, 'passport.share', access.garageId);

      const token = generateToken();
      const expiresAt = request.body.expiresInDays
        ? new Date(Date.now() + request.body.expiresInDays * 86_400_000)
        : null;

      const link = await fastify.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(schema.shareLinks)
          .values({
            vehicleId: request.params.vehicleId,
            tokenHash: hashToken(token),
            scope: 'VEHICLE_PASSPORT',
            label: request.body.label?.trim() || null,
            sections: [...new Set(request.body.sections)],
            expiresAt,
            createdBy: access.actor.userId,
          })
          .returning();
        if (!row) throw new Error('Share link insert returned no row');

        /*
         * Audited because it is the one action that hands a vehicle's history to somebody
         * outside the garage. The token is not in the entry — an audit log is exactly the
         * kind of place a bearer credential must not end up.
         */
        await recordAudit(tx, {
          actorId: access.actor.userId,
          actorEmail: access.actor.email,
          garageId: access.garageId,
          action: 'share.created',
          resourceType: 'share_link',
          resourceId: row.id,
          metadata: {
            vehicleId: request.params.vehicleId,
            scope: row.scope,
            // What was disclosed is the part of this decision someone will ask about later.
            sections: row.sections,
            expiresAt: expiresAt?.toISOString() ?? null,
          },
          ...commandMeta(request),
        });

        return row;
      });

      return reply.status(201).send(serialize(link, token));
    },
  );

  fastify.delete(
    '/:vehicleId/shares/:shareId',
    {
      schema: {
        tags: ['sharing'],
        summary: 'Revoke a share link',
        description:
          'The row stays: the owner should still see that the link existed and how often ' +
          'it was opened. It simply stops working.',
        params: ShareLinkParams,
        response: { 204: Type.Null(), ...StandardErrors },
      },
    },
    async (request, reply) => {
      const access = await fastify.requireVehicleAccess(
        request,
        request.params.vehicleId,
        'garage.manage_settings',
      );

      const [existing] = await fastify.db
        .select()
        .from(schema.shareLinks)
        .where(
          and(
            eq(schema.shareLinks.id, request.params.shareId),
            eq(schema.shareLinks.vehicleId, request.params.vehicleId),
          ),
        )
        .limit(1);
      if (!existing) throw new NotFoundError('Share link');

      await fastify.db.transaction(async (tx) => {
        await tx
          .update(schema.shareLinks)
          .set({ revokedAt: new Date() })
          .where(eq(schema.shareLinks.id, existing.id));

        await recordAudit(tx, {
          actorId: access.actor.userId,
          actorEmail: access.actor.email,
          garageId: access.garageId,
          action: 'share.revoked',
          resourceType: 'share_link',
          resourceId: existing.id,
          metadata: { vehicleId: request.params.vehicleId, viewCount: existing.viewCount },
          ...commandMeta(request),
        });
      });

      return reply.status(204).send(null);
    },
  );
};

/**
 * The public read.
 *
 * Mounted outside `/vehicles` and away from everything that assumes a session: this is the
 * only path in the system that authenticates by URL. It answers 404 for a token that is
 * unknown, revoked or expired — the same answer for all three, so the endpoint cannot be used
 * to find out whether a link ever existed.
 */
export const publicPassportRoutes: FastifyPluginAsyncTypebox = async (fastify) => {
  fastify.get(
    '/passport/:token',
    {
      schema: {
        tags: ['sharing'],
        summary: 'Read a vehicle passport with a share link',
        description:
          'No session. The token is the credential, and the response is an allowlist — no ' +
          'people, no document files, no free-text notes.',
        params: PassportTokenParam,
        response: { 200: VehiclePassport, 404: StandardErrors[404], 429: StandardErrors[429] },
      },
    },
    async (request) => {
      assertPassportEnabled();
      // Looked up by hash, so the plaintext token is never compared against the database and
      // never appears in a query log.
      const [link] = await fastify.db
        .select()
        .from(schema.shareLinks)
        .where(eq(schema.shareLinks.tokenHash, hashToken(request.params.token)))
        .limit(1);

      /*
       * One answer for unknown, revoked and expired. Distinguishing them would turn this
       * into an oracle for "did this link ever exist", which is exactly what someone
       * enumerating tokens wants to know.
       */
      if (!link || !isUsable(link)) throw new NotFoundError('Passport');

      const passport = await buildPassport(fastify.db, link.vehicleId, sectionsOf(link));
      if (!passport) throw new NotFoundError('Passport');

      /*
       * Recorded after the passport is built, and deliberately not awaited into the response
       * path's failure modes: a counter that cannot be written is not a reason to refuse
       * somebody the page they were sent.
       */
      void fastify.db
        .update(schema.shareLinks)
        .set({ viewCount: sql`${schema.shareLinks.viewCount} + 1`, lastViewedAt: new Date() })
        .where(eq(schema.shareLinks.id, link.id))
        .catch((error: unknown) => {
          fastify.log.warn({ error, shareId: link.id }, 'Could not record a passport view');
        });

      return passport;
    },
  );
};
