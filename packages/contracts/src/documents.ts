import { Type, type Static } from '@sinclair/typebox';
import { DOCUMENT_TYPES } from '@vehicle-os/domain';
import { IsoDate, IsoDateTime, Nullable, PaginationQuery, Uuid } from './common';

export const DocumentTypeSchema = Type.Union(DOCUMENT_TYPES.map((type) => Type.Literal(type)));

/**
 * A document's metadata. The bytes are never in the response.
 *
 * Nothing in the bucket is public, so opening a file means asking for a short-lived signed
 * URL through `/download`, minted at the moment of the click.
 */
export const VehicleDocument = Type.Object({
  /**
   * A preview for image documents (a photographed receipt, a scanned registration), so the
   * documents grid can show the page instead of a generic icon. A signed URL that expires in
   * minutes, like the photo gallery's; null for anything a browser cannot draw as an image —
   * PDFs and office files get a file tile. Only the vehicle's own document list fills it.
   */
  thumbnailUrl: Nullable(Type.String()),

  id: Uuid,
  vehicleId: Uuid,
  eventId: Nullable(Uuid),

  documentType: DocumentTypeSchema,
  title: Type.String(),
  filename: Type.String(),
  mimeType: Type.String(),
  sizeBytes: Type.Integer(),

  issuedOn: Nullable(IsoDate),
  expiresOn: Nullable(IsoDate),
  notes: Nullable(Type.String()),

  /** Null until the upload has been confirmed against storage. */
  uploadedAt: Nullable(IsoDateTime),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type VehicleDocument = Static<typeof VehicleDocument>;

/**
 * What may be uploaded.
 *
 * A closed list rather than anything the browser offers: the bucket is served back to
 * people, and an arbitrary MIME type is how a stored `text/html` becomes a page hosted on a
 * signed URL. PDFs, images and the office formats a receipt actually arrives in.
 */
export const RequestDocumentUpload = Type.Object(
  {
    filename: Type.String({ minLength: 1, maxLength: 255 }),
    mimeType: Type.Union([
      Type.Literal('application/pdf'),
      Type.Literal('image/jpeg'),
      Type.Literal('image/png'),
      Type.Literal('image/webp'),
      Type.Literal('image/heic'),
      Type.Literal('application/msword'),
      Type.Literal('application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
      Type.Literal('application/vnd.ms-excel'),
      Type.Literal('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
      Type.Literal('text/plain'),
    ]),
    sizeBytes: Type.Integer({ minimum: 1, maximum: 25 * 1024 * 1024 }),
  },
  { additionalProperties: false },
);
export type RequestDocumentUpload = Static<typeof RequestDocumentUpload>;

export const DocumentUploadTicket = Type.Object({
  documentId: Uuid,
  uploadUrl: Type.String(),
  storageKey: Type.String(),
  expiresInSeconds: Type.Integer(),
});
export type DocumentUploadTicket = Static<typeof DocumentUploadTicket>;

export const FinalizeDocumentUpload = Type.Object(
  {
    documentType: DocumentTypeSchema,
    title: Type.String({ minLength: 1, maxLength: 200 }),
    issuedOn: Type.Optional(IsoDate),
    /** What the "expiring soon" scan reads. A registration with no date can never warn. */
    expiresOn: Type.Optional(IsoDate),
    notes: Type.Optional(Type.String({ maxLength: 2000 })),
    eventId: Type.Optional(Uuid),
  },
  { additionalProperties: false },
);
export type FinalizeDocumentUpload = Static<typeof FinalizeDocumentUpload>;

/** Metadata only. Replacing the file itself means uploading a new document. */
export const UpdateDocument = Type.Object(
  {
    documentType: Type.Optional(DocumentTypeSchema),
    title: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
    issuedOn: Type.Optional(Nullable(IsoDate)),
    expiresOn: Type.Optional(Nullable(IsoDate)),
    notes: Type.Optional(Nullable(Type.String({ maxLength: 2000 }))),
    eventId: Type.Optional(Nullable(Uuid)),
  },
  { additionalProperties: false },
);
export type UpdateDocument = Static<typeof UpdateDocument>;

export const ListDocumentsQuery = Type.Composite([
  PaginationQuery,
  Type.Object({
    documentType: Type.Optional(DocumentTypeSchema),
    /** Only those with an expiry date that has passed or is within the next 60 days. */
    expiringOnly: Type.Optional(Type.Boolean()),
  }),
]);
export type ListDocumentsQuery = Static<typeof ListDocumentsQuery>;

export const DocumentParams = Type.Object({ vehicleId: Uuid, documentId: Uuid });

export const DocumentDownload = Type.Object({
  url: Type.String(),
  expiresInSeconds: Type.Integer(),
  filename: Type.String(),
  mimeType: Type.String(),
});
export type DocumentDownload = Static<typeof DocumentDownload>;

/** An expiring document with enough context for a dashboard row to name the vehicle. */
export const ExpiringDocument = Type.Object({
  document: VehicleDocument,
  vehicleId: Uuid,
  vehicleName: Type.String(),
  /** Negative once it has expired. */
  daysRemaining: Type.Integer(),
});
export type ExpiringDocument = Static<typeof ExpiringDocument>;
