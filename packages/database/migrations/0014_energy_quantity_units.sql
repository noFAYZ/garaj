CREATE TYPE "public"."quantity_unit" AS ENUM('LITER', 'US_GALLON', 'IMP_GALLON', 'KWH', 'KG');--> statement-breakpoint
-- `USING`, which drizzle-kit does not emit: Postgres will not cast between two enum types on
-- its own, and without it this fails at deploy rather than here. Every existing value is a
-- member of the new type, so the round trip through text is lossless.
ALTER TABLE "expenses" ALTER COLUMN "quantity_unit" SET DATA TYPE quantity_unit USING "quantity_unit"::text::quantity_unit;
