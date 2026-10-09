import { Type, type Static } from '@sinclair/typebox';
import { IsoDateTime, Nullable, Uuid } from './common';

/** What a hit can be (Architecture.md §82). One list, categorised by this field. */
export const SearchResultTypeSchema = Type.Union([
  Type.Literal('VEHICLE'),
  Type.Literal('EVENT'),
  Type.Literal('TASK'),
  Type.Literal('MAINTENANCE'),
  Type.Literal('DOCUMENT'),
  Type.Literal('EXPENSE'),
  Type.Literal('IDEA'),
]);
export type SearchResultType = Static<typeof SearchResultTypeSchema>;

export const SearchResult = Type.Object({
  type: SearchResultTypeSchema,
  id: Uuid,
  title: Type.String(),
  /** The line under the title — the category, the provider, the amount. */
  subtitle: Nullable(Type.String()),
  vehicleId: Nullable(Uuid),
  vehicleName: Nullable(Type.String()),
  /** Whatever date the record is about, not when the row was written. */
  date: Nullable(IsoDateTime),
  /**
   * Higher is better. A comparable number across types, not a Postgres rank: a title that
   * starts with the query beats one that merely contains it, and both beat a body match.
   */
  relevance: Type.Number(),
});
export type SearchResult = Static<typeof SearchResult>;

export const SearchQuery = Type.Object({
  q: Type.String({ minLength: 2, maxLength: 100 }),
  type: Type.Optional(SearchResultTypeSchema),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50, default: 20 })),
});
export type SearchQuery = Static<typeof SearchQuery>;

export const SearchResponse = Type.Object({
  query: Type.String(),
  results: Type.Array(SearchResult),
  /** How many of each type came back, for the category headings. */
  counts: Type.Record(Type.String(), Type.Integer()),
});
export type SearchResponse = Static<typeof SearchResponse>;
