import { Type, type Static } from '@sinclair/typebox';
import { CurrencyCode, DistanceUnit, IsoDate, Nullable, Uuid, VehicleTypeSchema } from './common';

/**
 * Natural-language questions about the caller's own vehicles (PRD §35, Architecture.md §41).
 *
 * The model is an intelligence layer, never the system of record. It answers by calling
 * read-only domain tools and summarising what they return; every claim it makes should be
 * traceable to a row this application already holds (§42).
 *
 * It may also *propose* a change — a vehicle bought, an entry to log, a garage to rename — but
 * a proposal is data returned to the person, never a write. Approving it is the person's own
 * request to the ordinary, authorised endpoint.
 */

/** The kinds of change the person allows GarajAI to propose, from their settings. */
export const AI_ABILITIES = ['log', 'plan', 'vehicles', 'garages', 'delete'] as const;
export type AiAbility = (typeof AI_ABILITIES)[number];

/** A file the person attached for the model to read: a receipt, a photo, a paper. */
export const AiAttachment = Type.Object(
  {
    mimeType: Type.Union([
      Type.Literal('image/jpeg'),
      Type.Literal('image/png'),
      Type.Literal('image/webp'),
      Type.Literal('application/pdf'),
    ]),
    /** Base64, without a data-URL prefix. About 3 MB of file at most. */
    data: Type.String({ minLength: 1, maxLength: 4_000_000 }),
  },
  { additionalProperties: false },
);
export type AiAttachment = Static<typeof AiAttachment>;

export const AskQuestion = Type.Object(
  {
    question: Type.String({ minLength: 3, maxLength: 500 }),
    /** Optional focus. The model can still resolve "the Octavia" by listing vehicles. */
    vehicleId: Type.Optional(Uuid),
    /** One of `AiModels.choices`; anything else is refused. Omitted means the default. */
    model: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
    /** The changes it may propose. Omitted or empty: it only answers. */
    allow: Type.Optional(
      Type.Array(Type.Union(AI_ABILITIES.map((ability) => Type.Literal(ability))), {
        maxItems: AI_ABILITIES.length,
      }),
    ),
    attachments: Type.Optional(Type.Array(AiAttachment, { maxItems: 4 })),
  },
  { additionalProperties: false },
);
export type AskQuestion = Static<typeof AskQuestion>;

/** The models a person may pick for their questions; the operator sets the list. */
export const AiModels = Type.Object({
  default: Type.String(),
  choices: Type.Array(Type.String()),
});
export type AiModels = Static<typeof AiModels>;

/**
 * What the answer was built from (§43).
 *
 * Provenance is part of the response, not a debug aid: an answer nobody can check against
 * the underlying records is exactly the guess this design exists to prevent.
 */
export const AiSource = Type.Object({
  tool: Type.String(),
  vehicleId: Nullable(Uuid),
});

export const AI_ACTIONS = [
  'add_vehicle',
  'edit_vehicle',
  'archive_vehicle',
  'add_garage',
  'edit_garage',
  'delete_garage',
  'log_entry',
  'edit_entry',
  'delete_entry',
  'plan',
] as const;
export type AiAction = (typeof AI_ACTIONS)[number];

/**
 * A change the model proposes, for the person to check and approve.
 *
 * `fields` are the model's values, in the shape of its `propose_*` tool, with every id in them
 * already checked against the caller's own garages. They prefill a form; the form is what the
 * person approves, and the endpoint it calls validates again.
 */
export const AiProposal = Type.Object({
  action: Type.Union(AI_ACTIONS.map((action) => Type.Literal(action))),
  /** One sentence: what approving it does. */
  summary: Type.String(),
  fields: Type.Record(Type.String(), Type.Unknown()),
});
export type AiProposal = Static<typeof AiProposal>;

/** A question back to the person, with the answers to tap rather than type. */
export const AiChoice = Type.Object({
  question: Type.String(),
  options: Type.Array(Type.Object({ label: Type.String(), detail: Type.Optional(Type.String()) })),
});
export type AiChoice = Static<typeof AiChoice>;

export const AiAnswer = Type.Object({
  answer: Type.String(),
  sources: Type.Array(AiSource),
  /** The model that wrote it, so an answer can be attributed after the default changes. */
  model: Type.String(),
  /** Present when the line asked for a change rather than an answer. */
  proposal: Type.Optional(AiProposal),
  /** Present when the model needs the person to pick before it can go on. */
  choices: Type.Optional(AiChoice),
});
export type AiAnswer = Static<typeof AiAnswer>;

/**
 * A line, and any photos or papers with it, to read as a vehicle for the add-vehicle form.
 * Nothing is written: the draft goes back into the form, where every field can be seen and
 * changed before the ordinary create request.
 */
export const DraftVehicle = Type.Object(
  {
    text: Type.String({ minLength: 3, maxLength: 1000 }),
    attachments: Type.Optional(Type.Array(AiAttachment, { maxItems: 4 })),
  },
  { additionalProperties: false },
);
export type DraftVehicle = Static<typeof DraftVehicle>;

/**
 * What was read, in the create contract's names and already inside its bounds. Anything not
 * said is absent. Specs are only those the type has fields for, so they are empty until the
 * type is known.
 */
export const VehicleDraft = Type.Object({
  vehicleType: Type.Optional(VehicleTypeSchema),
  make: Type.Optional(Type.String()),
  model: Type.Optional(Type.String()),
  variant: Type.Optional(Type.String()),
  year: Type.Optional(Type.Integer()),
  nickname: Type.Optional(Type.String()),
  color: Type.Optional(Type.String()),
  identificationNumber: Type.Optional(Type.String()),
  registrationIdentifier: Type.Optional(Type.String()),
  purchaseDate: Type.Optional(IsoDate),
  /** In major units, as said: 98000, not cents. */
  purchasePrice: Type.Optional(Type.Number()),
  purchaseCurrency: Type.Optional(CurrencyCode),
  currentOdometer: Type.Optional(Type.Integer()),
  odometerUnit: Type.Optional(DistanceUnit),
  currentEngineHours: Type.Optional(Type.Integer()),
  specs: Type.Record(Type.String(), Type.Union([Type.String(), Type.Number()])),
});
export type VehicleDraft = Static<typeof VehicleDraft>;

/** A vehicle already identified, to look up the factory specs nobody typed. */
export const LookUpVehicle = Type.Object(
  {
    vehicleType: VehicleTypeSchema,
    make: Type.String({ minLength: 1, maxLength: 120 }),
    model: Type.String({ minLength: 1, maxLength: 120 }),
    variant: Type.Optional(Type.String({ maxLength: 120 })),
    year: Type.Optional(Type.Integer({ minimum: 1885, maximum: 2100 })),
  },
  { additionalProperties: false },
);
export type LookUpVehicle = Static<typeof LookUpVehicle>;

/** The specs found, held to the type's own fields, and the pages they came from. */
export const VehicleLookup = Type.Object({
  specs: Type.Record(Type.String(), Type.Union([Type.String(), Type.Number()])),
  sources: Type.Array(Type.Object({ title: Type.String(), url: Type.String() })),
});
export type VehicleLookup = Static<typeof VehicleLookup>;
