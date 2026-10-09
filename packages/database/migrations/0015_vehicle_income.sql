CREATE TYPE "public"."income_category" AS ENUM('FARE', 'DELIVERY', 'RENTAL', 'HAULAGE', 'REIMBURSEMENT', 'SALE', 'OTHER');--> statement-breakpoint
CREATE TABLE "vehicle_income" (
	"id" uuid PRIMARY KEY NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"category" "income_category" NOT NULL,
	"description" text NOT NULL,
	"payer" text,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"odometer" integer,
	"odometer_unit" "distance_unit",
	"engine_hours" integer,
	"driver_id" uuid,
	"source" "record_source" DEFAULT 'USER' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vehicle_income" ADD CONSTRAINT "vehicle_income_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_income" ADD CONSTRAINT "vehicle_income_driver_id_garage_members_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."garage_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_income" ADD CONSTRAINT "vehicle_income_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "vehicle_income_vehicle_occurred_idx" ON "vehicle_income" USING btree ("vehicle_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "vehicle_income_driver_idx" ON "vehicle_income" USING btree ("driver_id");