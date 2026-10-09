/**
 * The AI provider port (Architecture.md §41, §92).
 *
 * The application layer depends on this, never on a vendor SDK. A different provider is one
 * adapter — the tool catalogue, the authorisation boundary and the orchestration below it
 * do not know which model answered.
 */

export interface AiToolSpec {
  readonly name: string;
  readonly description: string;
  /** JSON Schema for the arguments. Passed to the provider as-is. */
  readonly parameters: Record<string, unknown>;
}

export interface AiToolCall {
  readonly name: string;
  readonly args: Record<string, unknown>;
  /** Opaque provider state that must go back with the call on the next turn (Gemini 3's thought signature). */
  readonly signature?: string;
}

export interface AiToolResult {
  readonly name: string;
  /** Whatever the tool returned, or `{ error }` when it refused. */
  readonly result: unknown;
}

/**
 * One turn of the conversation, in the provider-neutral shape.
 *
 * `tool` carries the results of the calls in the preceding `model` turn — every provider
 * requires them paired that way, and flattening them into text loses the association.
 */
export type AiMessage =
  | {
      readonly role: 'user';
      readonly text: string;
      /** Files read with the text: receipts, photos, papers. */
      readonly attachments?: readonly { readonly mimeType: string; readonly data: string }[];
    }
  | { readonly role: 'model'; readonly calls: readonly AiToolCall[] }
  | { readonly role: 'tool'; readonly results: readonly AiToolResult[] };

export interface AiTurn {
  readonly text: string | null;
  readonly calls: readonly AiToolCall[];
  /** The model that actually answered, when the adapter can fall back from its default. */
  readonly model?: string;
  /** What the provider billed for this turn, when it says. Read by the admin console's usage log. */
  readonly usage?: { readonly inputTokens: number; readonly outputTokens: number };
  /** The pages a searched turn drew on, when the provider says. */
  readonly sources?: readonly { readonly title: string; readonly url: string }[];
}

export class AiUnavailableError extends Error {}

export interface AiProviderPort {
  /** Reported back in the answer, so a response can be attributed after a model change. */
  readonly model: string;

  generate(input: {
    readonly system: string;
    readonly messages: readonly AiMessage[];
    readonly tools: readonly AiToolSpec[];
    /** A model chosen by the person, already checked against the allowed list. */
    readonly model?: string;
    /** The one tool the model must call, for a turn whose answer is that call rather than prose. */
    readonly force?: string;
    /** Let the model search the web for this turn, for facts that are not in the person's records. */
    readonly search?: boolean;
  }): Promise<AiTurn>;
}
