/**
 * Vehicle access resolution.
 *
 * Every vehicle-scoped route needs the same two steps: find which garage the vehicle is in,
 * then check the caller's capability *in that garage*. Doing it here rather than in each
 * route means the tenant check cannot be forgotten on a new endpoint, and the garage id is
 * always the one from the database rather than one the client supplied.
 */

import fp from 'fastify-plugin';
import type { FastifyRequest } from 'fastify';
import type { ActorContext, Capability } from '@vehicle-os/domain';
import { NotFoundError } from '../infrastructure/errors';
import {
  findVehicleById,
  type VehicleWithPhoto,
} from '../modules/vehicles/infrastructure/repositories/vehicle-repository';

export interface VehicleAccess {
  readonly actor: ActorContext;
  readonly vehicleId: string;
  readonly garageId: string;
  /**
   * The vehicle row the check was made against.
   *
   * Handed back rather than thrown away: the guard has to read the vehicle to know which
   * garage it is in, and most routes then want the odometer or the unit off the same row.
   * Fetching it twice is a second round trip to the database for a row already in memory —
   * which, against a hosted Postgres, is most of what those endpoints spend.
   */
  readonly vehicle: VehicleWithPhoto;
}

declare module 'fastify' {
  interface FastifyInstance {
    requireVehicleAccess: (
      request: FastifyRequest,
      vehicleId: string,
      capability: Capability,
    ) => Promise<VehicleAccess>;
  }
}

export default fp(
  (fastify) => {
    fastify.decorate(
      'requireVehicleAccess',
      async (request: FastifyRequest, vehicleId: string, capability: Capability) => {
        const vehicle = await findVehicleById(fastify.db, vehicleId);
        /*
         * A missing vehicle and a vehicle in someone else's garage both answer 404 — the
         * second falls through to `requireCapability`, which returns 404 for a non-member
         * (PRD §75). A 403 here would confirm the id exists.
         */
        if (!vehicle) throw new NotFoundError('Vehicle');

        const actor = fastify.requireCapability(request, capability, vehicle.garageId);
        return { actor, vehicleId, garageId: vehicle.garageId, vehicle };
      },
    );
  },
  { name: 'vehicle-access', dependencies: ['actor-context', 'database'] },
);
