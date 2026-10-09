ALTER TABLE "expenses" ADD COLUMN "latitude" numeric(9, 6);--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "longitude" numeric(9, 6);--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_location_complete" CHECK (("expenses"."latitude" is null) = ("expenses"."longitude" is null));