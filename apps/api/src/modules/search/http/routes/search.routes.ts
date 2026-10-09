import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { SearchQuery, SearchResponse, StandardErrors } from '@vehicle-os/contracts';
import { displayName } from '../../../vehicles/domain/entities/vehicle';
import { search } from '../../infrastructure/repositories/search-repository';

export const searchRoutes: FastifyPluginAsyncTypebox = async (fastify) => {
  fastify.get(
    '/',
    {
      schema: {
        tags: ['search'],
        summary: 'Search everything the caller can see',
        description:
          'One list across vehicles, timeline events, tasks, maintenance, documents, ' +
          'expenses and ideas, scoped to the caller’s garages inside the query itself (§83).',
        querystring: SearchQuery,
        response: { 200: SearchResponse, ...StandardErrors },
      },
    },
    async (request) => {
      const actor = await fastify.requireAuth(request);

      const term = request.query.q.trim();
      const hits = await search(fastify.db, {
        garageIds: actor.memberships.map((membership) => membership.garageId),
        term,
        type: request.query.type,
        limit: request.query.limit ?? 20,
        displayName,
      });

      const counts: Record<string, number> = {};
      for (const hit of hits) counts[hit.type] = (counts[hit.type] ?? 0) + 1;

      return {
        query: term,
        results: hits.map((hit) => ({
          type: hit.type,
          id: hit.id,
          title: hit.title,
          subtitle: hit.subtitle,
          vehicleId: hit.vehicleId,
          vehicleName: hit.vehicleName,
          // A `date` column comes back as `YYYY-MM-DD`; a timestamp as a Date. Both leave
          // as an ISO instant so one client formatter handles every result.
          date:
            hit.date === null
              ? null
              : hit.date instanceof Date
                ? hit.date.toISOString()
                : new Date(`${hit.date}T00:00:00Z`).toISOString(),
          relevance: hit.relevance,
        })),
        counts,
      };
    },
  );
};
