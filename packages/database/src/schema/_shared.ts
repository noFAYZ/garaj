/**
 * Column conventions shared by every table (Architecture.md §16).
 *
 * Defined once so a new table cannot accidentally use `timestamp without time zone`, a
 * float for money, or a client-supplied primary key.
 */

import { sql } from 'drizzle-orm';
import { integer, pgEnum, timestamp, uuid } from 'drizzle-orm/pg-core';
import { DISTANCE_UNITS, QUANTITY_UNITS, VOLUME_UNITS } from '@vehicle-os/domain';
import { newId } from '@vehicle-os/utils';

/**
 * UUIDv7, generated in the application rather than by the database.
 *
 * Postgres has no built-in v7, and `gen_random_uuid()` is v4 — random keys scatter inserts
 * across the index. Generating here also means the id exists before the INSERT, so an
 * object-storage key can be built inside the same transaction that writes the row.
 */
export const primaryId = () =>
  uuid('id')
    .primaryKey()
    .$defaultFn(() => newId());

export const referenceId = (name: string) => uuid(name);

export const createdAt = () =>
  timestamp('created_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .default(sql`now()`);

export const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .default(sql`now()`)
    .$onUpdate(() => new Date());

/** Soft delete. Applied only to the tables listed in Architecture.md §103, never by default. */
export const deletedAt = () => timestamp('deleted_at', { withTimezone: true, mode: 'date' });

export const timestamps = () => ({
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const distanceUnitEnum = pgEnum('distance_unit', DISTANCE_UNITS);
export const volumeUnitEnum = pgEnum('volume_unit', VOLUME_UNITS);

/**
 * What a fill was measured in — litres, kilowatt-hours or kilograms (GAPS §11).
 *
 * Wider than `volume_unit`, which stays as it is: that one is a *preference* for how a person
 * likes liquids shown, and an account default of "kilowatt-hours" would be meaningless.
 */
export const quantityUnitEnum = pgEnum('quantity_unit', QUANTITY_UNITS);

/**
 * Money, always as a pair (§16): `<name>_amount_minor bigint` + `<name>_currency char(3)`.
 *
 * Declared inline on each table rather than through a helper — a helper that builds column
 * names from a prefix returns a type Drizzle cannot infer, and losing column typing to save
 * two lines is a bad trade.
 *
 * `bigint` so the database can never truncate, read back as a JS number: safe integers
 * cover ±9.0e15 minor units, and the domain's `money()` throws above that rather than
 * rounding silently. The ISO 4217 code carries the exponent, so JPY (0 decimals) and KWD
 * (3) store correctly with no per-row scale column.
 */

/** An odometer or engine-hour reading never travels without the unit it was taken in. */
export const odometerColumns = () => ({
  odometer: integer('odometer'),
  odometerUnit: distanceUnitEnum('odometer_unit'),
  engineHours: integer('engine_hours'),
});
