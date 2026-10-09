/**
 * Vehicles (Architecture.md §18, §19).
 *
 * The columns here are the identity fields every supported type genuinely shares. Anything
 * type-specific — displacement, groupset, hull type, propeller — lives in `specs`, because
 * a column per type would leave a bicycle row with forty nulls and still not cover the next
 * type added.
 */

import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uuid,
} from 'drizzle-orm/pg-core';
import { date } from 'drizzle-orm/pg-core';
import { bigint, char } from 'drizzle-orm/pg-core';
import { vehicleStatusEnum, vehicleTypeEnum } from './enums';
import { deletedAt, distanceUnitEnum, primaryId, timestamps } from './_shared';
import { garageMembers, garages } from './garages';
import { users } from './auth';

export const vehicles = pgTable(
  'vehicles',
  {
    id: primaryId(),
    garageId: uuid('garage_id')
      .notNull()
      .references(() => garages.id, { onDelete: 'cascade' }),

    vehicleType: vehicleTypeEnum('vehicle_type').notNull(),
    status: vehicleStatusEnum('status').notNull().default('ACTIVE'),

    nickname: text('nickname'),
    make: text('make'),
    model: text('model'),
    variant: text('variant'),
    year: integer('year'),
    color: text('color'),

    // VIN for a car, frame number for a bicycle, hull identification for a boat. One
    // column because the role is identical and no vehicle carries two of them.
    identificationNumber: text('identification_number'),
    registrationIdentifier: text('registration_identifier'),

    purchaseDate: date('purchase_date'),
    purchasePriceAmountMinor: bigint('purchase_price_amount_minor', { mode: 'number' }),
    purchasePriceCurrency: char('purchase_price_currency', { length: 3 }),

    // Current reading, maintained as events arrive. The authoritative history is the
    // odometer on each event row; this is the cached latest value for list screens.
    currentOdometer: integer('current_odometer'),
    odometerUnit: distanceUnitEnum('odometer_unit').notNull().default('KM'),
    currentEngineHours: integer('current_engine_hours'),

    primaryPhotoId: uuid('primary_photo_id'),

    /** Type-specific fields, validated at the API boundary against the type's descriptor. */
    specs: jsonb('specs').$type<Record<string, unknown>>().notNull().default({}),

    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps(),
    deletedAt: deletedAt(),
  },
  (table) => [
    index('vehicles_garage_status_idx').on(table.garageId, table.status),
    index('vehicles_identification_idx').on(table.identificationNumber),
  ],
);

/**
 * Photos (Architecture.md §31). A photo can hang off a vehicle alone, or additionally off
 * an event, condition assessment or component — hence the nullable parent columns rather
 * than one polymorphic `(parent_type, parent_id)` pair, which no foreign key can protect.
 */
export const vehiclePhotos = pgTable(
  'vehicle_photos',
  {
    id: primaryId(),
    vehicleId: uuid('vehicle_id')
      .notNull()
      .references(() => vehicles.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id'),
    /*
     * No foreign key, like `event_id`: `condition.ts` already imports this file, and the
     * assessment delete clears the column in the same transaction instead.
     */
    conditionAssessmentId: uuid('condition_assessment_id'),

    storageKey: text('storage_key').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    checksum: text('checksum'),
    width: integer('width'),
    height: integer('height'),
    caption: text('caption'),
    category: text('category'),

    capturedAt: date('captured_at'),
    /*
     * EXIF GPS is stripped on ingest and only re-attached when the uploader opts in (§31).
     * A shared garage would otherwise leak a member's home address through a photo of a
     * parked car, silently and permanently.
     */
    locationShared: boolean('location_shared').notNull().default(false),
    latitude: text('latitude'),
    longitude: text('longitude'),

    // Set once the image-processing worker has produced thumb/card/full variants; until
    // then clients render the original rather than a 404 for a variant that does not exist.
    processedAt: date('processed_at'),

    /*
     * The background-removed cutout, produced for a vehicle's primary photo only — it is
     * what a card wants and what a receipt or an engine-bay shot does not. Null until the
     * worker has made one, or forever where no remover is configured; the thumbnail falls
     * back to the original either way.
     */
    cutoutKey: text('cutout_key'),

    uploadedBy: uuid('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps(),
    deletedAt: deletedAt(),
  },
  (table) => [
    index('vehicle_photos_vehicle_id_idx').on(table.vehicleId),
    index('vehicle_photos_event_id_idx').on(table.eventId),
    index('vehicle_photos_condition_assessment_idx').on(table.conditionAssessmentId),
  ],
);

/**
 * Who drives which vehicle: a membership, not a user, so leaving the garage ends every
 * assignment in it, and a vehicle may have several drivers as a driver may have several vehicles.
 *
 * Nothing stops a row outliving a vehicle's move to another garage; reads join through
 * `vehicles.garage_id` to the member's own garage, so such a row is never shown, and the next
 * assignment for that member clears it.
 */
export const vehicleDrivers = pgTable(
  'vehicle_drivers',
  {
    vehicleId: uuid('vehicle_id')
      .notNull()
      .references(() => vehicles.id, { onDelete: 'cascade' }),
    memberId: uuid('member_id')
      .notNull()
      .references(() => garageMembers.id, { onDelete: 'cascade' }),
    ...timestamps(),
  },
  (table) => [
    primaryKey({ columns: [table.vehicleId, table.memberId] }),
    index('vehicle_drivers_member_id_idx').on(table.memberId),
  ],
);
