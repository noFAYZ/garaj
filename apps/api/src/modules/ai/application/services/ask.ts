/**
 * The ask loop (Architecture.md §42).
 *
 * Question → the model chooses tools → real rows → the model summarises those rows. The
 * database stays authoritative; the model's only job is turning the rows into a sentence.
 */

import type { AiAbility, AiAnswer, AiAttachment, AiChoice } from '@vehicle-os/contracts';
import { AI_SYSTEM_PROMPT, AI_TOOLS, CHOOSE_TOOL, PROPOSE_TOOLS } from '../../domain/tools';
import type { AiMessage, AiProviderPort, AiToolResult } from '../../infrastructure/ai-port';
import { checkProposal, guardGuess, runTool, type ToolContext } from './tool-runner';

/**
 * How many times the model may call tools before it has to answer.
 *
 * Four is enough for the deepest real chain — list vehicles, read the profile, read the
 * costs, read the timeline — and it is a hard ceiling on what one question can spend. A
 * loop with no bound is a model that can bill indefinitely on one request.
 */
const MAX_ROUNDS = 5;

export interface AskOptions {
  /** The vehicle in view; the model can still name another. */
  readonly vehicleId?: string;
  /** Checked against the allowed list by the route; omitted means the provider default. */
  readonly model?: string;
  /** The kinds of change it may propose. Empty: it only answers. */
  readonly allow?: readonly AiAbility[];
  /** Files for the model to read with the line. */
  readonly attachments?: readonly AiAttachment[];
}

export async function ask(
  provider: AiProviderPort,
  context: ToolContext,
  question: string,
  options: AskOptions = {},
): Promise<AiAnswer> {
  const sources: AiAnswer['sources'] = [];
  // The model that answered last: a fallback mid-question is the one that wrote the answer.
  let model = options.model ?? provider.model;
  const allow = options.allow ?? [];
  const tools = [
    ...AI_TOOLS,
    CHOOSE_TOOL,
    ...PROPOSE_TOOLS.filter((tool) => allow.includes(tool.ability)),
  ].map(({ name, description, parameters }) => ({
    name,
    description,
    parameters: { ...parameters },
  }));

  const messages: AiMessage[] = [
    {
      role: 'user',
      // The focus is stated rather than pre-fetched: the model still decides whether it
      // needs the profile, the costs or the timeline to answer. Today is said so a proposal
      // can date "yesterday" without a clock of its own.
      text: [
        question,
        options.vehicleId ? `(About vehicle_id ${options.vehicleId}.)` : null,
        `(Today is ${context.today}.)`,
      ]
        .filter(Boolean)
        .join('\n\n'),
      attachments: options.attachments,
    },
  ];

  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const turn = await provider.generate({
      system: AI_SYSTEM_PROMPT,
      messages,
      tools,
      model: options.model,
    });

    model = turn.model ?? model;

    if (turn.calls.length === 0) {
      return {
        answer: turn.text?.trim() || 'I could not answer that from your records.',
        sources,
        model,
      };
    }

    /*
     * A proposal ends the turn: checked, then handed back for the person to approve. One that
     * fails the check goes back to the model as an error, with the turn's other calls answered
     * as usual, so it can look the id up properly and try again.
     */
    const results: AiToolResult[] = [];
    for (const call of turn.calls) {
      // A question back ends the turn too: its options become buttons, not prose to retype.
      if (call.name === CHOOSE_TOOL.name) {
        const choices = readChoices(call.args);
        if (choices) return { answer: choices.question, sources, model, choices };
        results.push({ name: call.name, result: { error: 'Give a question and 2 to 8 options.' } });
        continue;
      }
      if (call.name.startsWith('propose_')) {
        const checked = await checkProposal(context, call);
        if ('proposal' in checked) {
          const guarded = await guardGuess(context, question, options.vehicleId, checked.proposal);
          if ('choices' in guarded) {
            return { answer: guarded.choices.question, sources, model, choices: guarded.choices };
          }
          return {
            answer: guarded.proposal.summary || turn.text?.trim() || 'Here is what I would record.',
            sources,
            model,
            proposal: guarded.proposal,
          };
        }
        results.push({ name: call.name, result: { error: checked.error } });
        continue;
      }
      const outcome = await runTool(context, call);
      results.push({ name: call.name, result: outcome.result });
      sources.push({ tool: call.name, vehicleId: outcome.vehicleId });
    }

    messages.push({ role: 'model', calls: turn.calls }, { role: 'tool', results });
  }

  /*
   * Out of rounds. Returned as an answer rather than an error: the user asked a question
   * and deserves a sentence, and the sources still show what was actually read.
   */
  return {
    answer:
      'I could not settle that from your records within the number of lookups allowed for ' +
      'one question. Try asking about a single vehicle.',
    sources,
    model,
  };
}

/** The model's `ask_to_choose` arguments, kept to what a person can tap: 2 to 8 labelled options. */
function readChoices(args: Record<string, unknown>): AiChoice | null {
  const question = typeof args.question === 'string' ? args.question.trim() : '';
  const options = (Array.isArray(args.options) ? args.options : [])
    .map((option: unknown) => {
      const { label, detail } = (option ?? {}) as { label?: unknown; detail?: unknown };
      return typeof label === 'string' && label.trim()
        ? {
            label: label.trim(),
            ...(typeof detail === 'string' && detail.trim() ? { detail: detail.trim() } : {}),
          }
        : null;
    })
    .filter((option): option is AiChoice['options'][number] => option !== null)
    .slice(0, 8);
  return question && options.length >= 2 ? { question, options } : null;
}
