CREATE TYPE "public"."trip_purpose" AS ENUM('BUSINESS', 'PERSONAL', 'COMMUTE');--> statement-breakpoint
ALTER TABLE "vehicle_events" ADD COLUMN "trip_purpose" "trip_purpose";--> statement-breakpoint
ALTER TABLE "vehicle_events" ADD COLUMN "trip_start_odometer" integer;--> statement-breakpoint
ALTER TABLE "vehicle_events" ADD COLUMN "trip_distance" integer;--> statement-breakpoint
ALTER TABLE "vehicle_events" ADD COLUMN "mileage_rate_minor" bigint;--> statement-breakpoint
ALTER TABLE "vehicle_events" ADD COLUMN "mileage_rate_currency" char(3);