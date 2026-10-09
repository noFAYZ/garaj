/**
 * Gemini, over its REST API.
 *
 * `fetch` rather than a vendor SDK, as with every other outbound call in this codebase: the
 * request is one JSON document, the SDK would be a dependency to keep current for it, and
 * the port above means a different provider is this file rewritten, not a migration.
 */

import {
  AiUnavailableError,
  type AiMessage,
  type AiProviderPort,
  type AiToolCall,
  type AiToolSpec,
  type AiTurn,
} from './ai-port';

interface GeminiPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
  functionCall?: { name: string; args?: Record<string, unknown> };
  /** Gemini 3 rejects a replayed `functionCall` without the signature it came with. */
  thoughtSignature?: string;
  functionResponse?: { name: string; response: Record<string, unknown> };
}

interface GeminiResponse {
  candidates?: {
    content?: { parts?: GeminiPart[] };
    finishReason?: string;
    groundingMetadata?: { groundingChunks?: { web?: { uri?: string; title?: string } }[] };
  }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
  };
}

export function createGeminiProvider(config: {
  apiKey: string;
  baseUrl: string;
  model: string;
  /** Asked when `model` fails. Unset or equal to `model` means no second attempt. */
  fallbackModel?: string;
}): AiProviderPort {
  return {
    model: config.model,

    async generate({ system, messages, tools, model: chosen, force, search }) {
      const payload = JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: messages.map(toContent),
        tools: [
          ...(tools.length ? [{ functionDeclarations: tools.map(toDeclaration) }] : []),
          // Grounding with Google Search: the model searches, reads, and cites what it used.
          ...(search ? [{ googleSearch: {} }] : []),
        ],
        ...(force
          ? {
              toolConfig: { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: [force] } },
            }
          : {}),
        generationConfig: {
          // The answer is a sentence or two and a short list; the ceiling is here so a
          // model that starts listing every service cannot run up one request's bill.
          maxOutputTokens: 1024,
          temperature: 0.2,
        },
      });
      const send = async (model: string) => {
        const response = await fetch(
          `${config.baseUrl}/models/${encodeURIComponent(model)}:generateContent`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.apiKey },
            body: payload,
            // A hung provider would otherwise hold the request, and its socket, indefinitely.
            signal: AbortSignal.timeout(30_000),
          },
        ).catch((error: unknown) => {
          // Timeouts and network failures are the provider being unavailable: a 503, not a 500.
          throw new AiUnavailableError(`AI provider unreachable (${model}): ${String(error)}`);
        });
        if (!response.ok) {
          const detail = await response.text().catch(() => '');
          throw new AiUnavailableError(
            `AI provider returned ${response.status} (${model}): ${detail.slice(0, 200)}`,
          );
        }
        return response;
      };

      /*
       * Gemini sheds load and retires models one model at a time, so a second model is the
       * cheapest cure for both: no wait, and a conversation started on one model continues on
       * the other (its thought signatures are accepted across models).
       */
      let model = chosen ?? config.model;
      const response = await send(model).catch(async (error: unknown) => {
        if (!config.fallbackModel || config.fallbackModel === model) throw error;
        model = config.fallbackModel;
        return send(model).catch((fallbackError: unknown) => {
          // `send` only throws AiUnavailableError, so both carry a message worth logging.
          throw new AiUnavailableError(
            `${(error as Error).message} | ${(fallbackError as Error).message}`,
          );
        });
      });

      const body = (await response.json()) as GeminiResponse;
      if (body.promptFeedback?.blockReason) {
        throw new AiUnavailableError(
          `The provider declined the request: ${body.promptFeedback.blockReason}`,
        );
      }

      const parts = body.candidates?.[0]?.content?.parts ?? [];
      const calls: AiToolCall[] = parts
        .filter((part): part is GeminiPart & { functionCall: { name: string } } =>
          Boolean(part.functionCall?.name),
        )
        .map((part) => ({
          name: part.functionCall.name,
          args: part.functionCall.args ?? {},
          signature: part.thoughtSignature,
        }));

      // Several text parts in one turn are one answer split by the provider, not several
      // answers — joined rather than taking the first, which would truncate silently.
      const text = parts
        .map((part) => part.text)
        .filter((value): value is string => Boolean(value))
        .join('')
        .trim();

      const usage = body.usageMetadata;
      const sources = (body.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [])
        .map((chunk) => ({ title: chunk.web?.title ?? '', url: chunk.web?.uri ?? '' }))
        .filter((source) => source.title && source.url);
      return {
        text: text || null,
        model,
        calls,
        ...(sources.length ? { sources } : {}),
        // A thinking model's reasoning is billed as output, so it counts as output here.
        usage: usage && {
          inputTokens: usage.promptTokenCount ?? 0,
          outputTokens: (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0),
        },
      } satisfies AiTurn;
    },
  };
}

function toContent(message: AiMessage) {
  switch (message.role) {
    case 'user':
      return {
        role: 'user',
        parts: [
          { text: message.text },
          ...(message.attachments ?? []).map((file) => ({
            inlineData: { mimeType: file.mimeType, data: file.data },
          })),
        ],
      };
    case 'model':
      return {
        role: 'model',
        parts: message.calls.map((call) => ({
          functionCall: { name: call.name, args: call.args },
          thoughtSignature: call.signature,
        })),
      };
    case 'tool':
      /*
       * Tool results go back with the `user` role — Gemini has no separate tool role, and
       * the association with the call is carried by the name inside `functionResponse`.
       * The result is wrapped in an object because the field is declared as a struct: a
       * bare array is rejected.
       */
      return {
        role: 'user',
        parts: message.results.map((result) => ({
          functionResponse: { name: result.name, response: { result: result.result } },
        })),
      };
  }
}

function toDeclaration(tool: AiToolSpec) {
  return { name: tool.name, description: tool.description, parameters: tool.parameters };
}

/**
 * What stands in when no key is configured.
 *
 * A port that throws a named error beats one that is null everywhere: the route turns this
 * into a 503 that says the feature is not configured, rather than a 500 nobody can read.
 */
export function createUnconfiguredAiProvider(): AiProviderPort {
  return {
    model: 'unconfigured',
    generate() {
      return Promise.reject(
        new AiUnavailableError('No AI provider is configured. Set AI_API_KEY to enable it.'),
      );
    },
  };
}
