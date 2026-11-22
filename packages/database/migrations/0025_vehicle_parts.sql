CREATE TYPE "public"."part_action" AS ENUM('REPLACED', 'TOPPED_UP');--> statement-breakpoint
CREATE TYPE "public"."part_unit" AS ENUM('PIECE', 'LITER', 'QUART', 'US_GALLON', 'IMP_GALLON');--> statement-breakpoint
CREATE TABLE "vehicle_parts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"event_id" uuid,
	"position" text NOT NULL,
	"action" "part_action" DEFAULT 'REPLACED' NOT NULL,
	"brand" text,
	"name" text,
	"spec" text,
	"part_number" text,
	"quantity" numeric(10, 3),
	"unit" "part_unit",
	"cost_amount_minor" bigint,
	"cost_currency" char(3),
	"fitted_at" timestamp with time zone,
	"odometer" integer,
	"odometer_unit" "distance_unit",
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vehicle_parts_cost_complete" CHECK (("vehicle_parts"."cost_amount_minor" is null) = ("vehicle_parts"."cost_currency" is null)),
	CONSTRAINT "vehicle_parts_reading_unit" CHECK ("vehicle_parts"."odometer" is null or "vehicle_parts"."odometer_unit" is not null),
	CONSTRAINT "vehicle_parts_dated_once" CHECK ("vehicle_parts"."event_id" is null or ("vehicle_parts"."fitted_at" is null and "vehicle_parts"."odometer" is null))
);
--> statement-breakpoint
ALTER TABLE "vehicle_parts" ADD CONSTRAINT "vehicle_parts_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_parts" ADD CONSTRAINT "vehicle_parts_event_id_vehicle_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."vehicle_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_parts" ADD CONSTRAINT "vehicle_parts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "vehicle_parts_vehicle_position_idx" ON "vehicle_parts" USING btree ("vehicle_id","position");--> statement-breakpoint
CREATE INDEX "vehicle_parts_event_id_idx" ON "vehicle_parts" USING btree ("event_id");