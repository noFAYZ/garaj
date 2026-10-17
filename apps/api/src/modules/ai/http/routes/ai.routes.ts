import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { eq } from 'drizzle-orm';
import { schema } from '@vehicle-os/database';
import { env, isEnabled, isProduction } from '@vehicle-os/config';
import {
  AiAnswer,
  AiModels,
  AskQuestion,
  DraftEntry,
  DraftVehicle,
  EntryDraft,
  LookUpVehicle,
  StandardErrors,
  VehicleDraft,
  VehicleLookup,
} from '@vehicle-os/contracts';
import { localDateIn } from '../../../tasks/domain/buckets';
import { ask } from '../../application/services/ask';
import { draftEntry } from '../../application/services/draft-entry';
import { draftVehicle, lookUpVehicle } from '../../application/services/draft-vehicle';
import { AiUnavailableError, type AiProviderPort } from '../../infrastructure/ai-port';
import { ServiceUnavailableError, ValidationError } from '../../../../infrastructure/errors';
import type { FastifyInstance, FastifyRequest } from 'fastify';

async function timezoneFor(fastify: FastifyInstance, userId: string): Promise<string> {
  const [row] = await fastify.db
    .select({ timezone: schema.userProfiles.timezone })
    .from(schema.userProfiles)
    .where(eq(schema.userProfiles.userId, userId))
    .limit(1);
  return row?.timezone ?? 'UTC';
}

/**
 * One feature's use of the model: refused here when its flag is off — `ai`, or `ocr` for reading
 * receipts — metered through a wrapper so every turn is summed into one `ai_requests` row for the
 * admin console, and the provider being down reported as a 503 rather than a 500.
 */
async function withAi<T>(
  fastify: FastifyInstance,
  request: FastifyRequest,
  userId: string,
  feature: string,
  chosen: string | undefined,
  work: (provider: AiProviderPort) => Promise<T>,
  flag: 'ai' | 'ocr' = 'ai',
): Promise<T> {
  /*
   * The flag is checked here as well as at startup (§94): a client that hides the UI
   * on a disabled flag is a courtesy, and this is the part that actually holds.
   */
  if (!isEnabled(env(), flag)) {
    throw new ServiceUnavailableError(
      flag === 'ocr'
        ? 'Receipt reading is not on for this deployment.'
        : 'AI is not configured on this deployment.',
      'AI_UNAVAILABLE',
    );
  }

  // `model` follows the turns, so a row answered by the fallback says so.
  const meter = { model: chosen ?? fastify.ai.model, turns: 0, inputTokens: 0, outputTokens: 0 };
  const metered: AiProviderPort = {
    model: fastify.ai.model,
    async generate(input) {
      const turn = await fastify.ai.generate(input);
      meter.model = turn.model ?? meter.model;
      meter.turns += 1;
      meter.inputTokens += turn.usage?.inputTokens ?? 0;
      meter.outputTokens += turn.usage?.outputTokens ?? 0;
      return turn;
    },
  };
  const started = Date.now();
  const record = (error?: unknown) =>
    fastify.db
      .insert(schema.aiRequests)
      .values({
        userId,
        feature,
        status: error ? 'error' : 'ok',
        ...meter,
        latencyMs: Date.now() - started,
        error: error ? String(error instanceof Error ? error.message : error).slice(0, 500) : null,
      })
      // A usage row is not worth failing the answer over.
      .catch((err: unknown) => request.log.warn({ err }, 'AI usage not recorded'));

  try {
    const result = await work(metered);
    await record();
    return result;
  } catch (error) {
    await record(error);
    if (error instanceof AiUnavailableError) {
      // The provider being down is not the caller's fault and not a 500: it is a
      // dependency this request cannot proceed without, named as such.
      throw new ServiceUnavailableError(error.message, 'AI_UNAVAILABLE');
    }
    throw error;
  }
}

export const aiRoutes: FastifyPluginAsyncTypebox = async (fastify) => {
  /*
   * What a person may pick in Co-driver settings: the configured default, then the operator's
   * list. An allowlist, not a free field — every model is a bill and a behaviour someone chose.
   */
  const modelChoices = () => [
    ...new Set([
      fastify.ai.model,
      ...env()
        .AI_MODEL_CHOICES.split(',')
        .map((choice) => choice.trim())
        .filter(Boolean),
    ]),
  ];

  fastify.get(
    '/models',
    {
      schema: {
        tags: ['ai'],
        summary: 'The models a person may choose for their questions',
        response: { 200: AiModels, ...StandardErrors },
      },
    },
    async (request) => {
      await fastify.requireAuth(request);
      return { default: fastify.ai.model, choices: modelChoices() };
    },
  );

  fastify.post(
    '/ask',
    {
      schema: {
        tags: ['ai'],
        summary: 'Ask a question about your vehicles',
        description:
          'The model answers by calling read-only domain tools scoped to the caller’s own ' +
          'garages, then summarising what they returned. It is never given database ' +
          'access, and the tools it used come back as `sources`.',
        body: AskQuestion,
        response: { 200: AiAnswer, ...StandardErrors, 503: StandardErrors[400] },
      },
      /*
       * Per person, not the global 300: each question is up to four paid model calls, so the
       * API-wide limit would let one account spend a provider quota everyone shares. Loose
       * outside production, like the global limit, so a test suite can ask freely.
       */
      config: { rateLimit: { max: isProduction() ? 6 : 1000, timeWindow: '1 minute' } },
      // Room for up to four attached files (about 3 MB each once encoded); the app default is 1 MB.
      bodyLimit: 16_777_216,
    },
    async (request) => {
      const actor = await fastify.requireAuth(request);
      const chosen = request.body.model;
      if (chosen && !modelChoices().includes(chosen)) {
        throw new ValidationError('That model is not offered here.', {
          model: 'Choose one of the offered models.',
        });
      }

      const timezone = await timezoneFor(fastify, actor.userId);

      return withAi(fastify, request, actor.userId, 'ask', chosen, (provider) =>
        ask(
          provider,
          {
            db: fastify.db,
            userId: actor.userId,
            // The whole authorisation boundary, resolved once: no tool can reach a garage
            // this caller does not belong to, whatever the model asks for.
            garageIds: actor.memberships.map((membership) => membership.garageId),
            today: localDateIn(timezone, new Date()),
          },
          request.body.question,
          {
            vehicleId: request.body.vehicleId,
            model: chosen,
            allow: request.body.allow,
            attachments: request.body.attachments,
          },
        ),
      );
    },
  );

  fastify.post(
    '/vehicle-draft',
    {
      schema: {
        tags: ['ai'],
        summary: 'Read a description of a vehicle into the add form',
        description:
          'One model turn reads the line (and any photos or papers) into the fields of ' +
          '`CreateVehicle`, held to its bounds. Nothing is written: the form shows the draft ' +
          'for the person to check before the ordinary create request.',
        body: DraftVehicle,
        response: { 200: VehicleDraft, ...StandardErrors, 503: StandardErrors[400] },
      },
      // The same per-person ceiling as a question: each draft is a paid model call.
      config: { rateLimit: { max: isProduction() ? 6 : 1000, timeWindow: '1 minute' } },
      bodyLimit: 16_777_216,
    },
    async (request) => {
      const actor = await fastify.requireAuth(request);
      const timezone = await timezoneFor(fastify, actor.userId);
      return withAi(fastify, request, actor.userId, 'vehicle-draft', undefined, (provider) =>
        draftVehicle(provider, {
          text: request.body.text,
          attachments: request.body.attachments,
          today: localDateIn(timezone, new Date()),
        }),
      );
    },
  );

  fastify.post(
    '/entry-draft',
    {
      schema: {
        tags: ['ai'],
        summary: 'Read a receipt or a dashboard into a quick entry',
        description:
          'One model turn reads the photo into the quick entry’s fields — the total, the ' +
          'litres, the station or workshop, the day, the odometer — held to the event ' +
          'contract’s bounds. Nothing is written: the form shows the draft to check before ' +
          'the ordinary create request. Behind the `ocr` flag.',
        body: DraftEntry,
        response: { 200: EntryDraft, ...StandardErrors, 503: StandardErrors[400] },
      },
      // A paid model call each, like a question; a little looser, as a pump visit may retake one.
      config: { rateLimit: { max: isProduction() ? 10 : 1000, timeWindow: '1 minute' } },
      bodyLimit: 16_777_216,
    },
    async (request) => {
      const actor = await fastify.requireAuth(request);
      const timezone = await timezoneFor(fastify, actor.userId);
      return withAi(
        fastify,
        request,
        actor.userId,
        'entry-draft',
        undefined,
        (provider) =>
          draftEntry(provider, { ...request.body, today: localDateIn(timezone, new Date()) }),
        'ocr',
      );
    },
  );

  fastify.post(
    '/vehicle-lookup',
    {
      schema: {
        tags: ['ai'],
        summary: 'Look up the factory specs of an identified vehicle',
        description:
          'Searches the web for the vehicle and fills the spec fields its type has, with the ' +
          'pages used as `sources`. Nothing is written: the form shows the figures to check.',
        body: LookUpVehicle,
        response: { 200: VehicleLookup, ...StandardErrors, 503: StandardErrors[400] },
      },
      // Two paid turns, one of them searched: the same per-person ceiling as a question.
      config: { rateLimit: { max: isProduction() ? 6 : 1000, timeWindow: '1 minute' } },
    },
    async (request) => {
      const actor = await fastify.requireAuth(request);
      return withAi(fastify, request, actor.userId, 'vehicle-lookup', undefined, (provider) =>
        lookUpVehicle(provider, request.body),
      );
    },
  );
};
