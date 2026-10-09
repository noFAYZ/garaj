CREATE TYPE "public"."valuation_source" AS ENUM('USER_ESTIMATE', 'DEALER', 'MARKET_DATA', 'INSURANCE', 'APPRAISAL', 'MARKETPLACE', 'OTHER');--> statement-breakpoint
CREATE TABLE "condition_assessments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"assessed_at" timestamp with time zone NOT NULL,
	"overall_score" integer,
	"notes" text,
	"odometer" integer,
	"odometer_unit" "distance_unit",
	"engine_hours" integer,
	"assessed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "condition_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"assessment_id" uuid NOT NULL,
	"category" "condition_category" NOT NULL,
	"score" integer,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "valuations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"estimated_value_amount_minor" bigint NOT NULL,
	"estimated_value_currency" char(3) NOT NULL,
	"valuation_date" date NOT NULL,
	"source" "valuation_source" DEFAULT 'USER_ESTIMATE' NOT NULL,
	"confidence" integer,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "condition_assessments" ADD CONSTRAINT "condition_assessments_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "condition_assessments" ADD CONSTRAINT "condition_assessments_assessed_by_users_id_fk" FOREIGN KEY ("assessed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "condition_items" ADD CONSTRAINT "condition_items_assessment_id_condition_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."condition_assessments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valuations" ADD CONSTRAINT "valuations_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valuations" ADD CONSTRAINT "valuations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "condition_vehicle_assessed_idx" ON "condition_assessments" USING btree ("vehicle_id","assessed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "condition_items_assessment_idx" ON "condition_items" USING btree ("assessment_id");--> statement-breakpoint
CREATE INDEX "valuations_vehicle_date_idx" ON "valuations" USING btree ("vehicle_id","valuation_date" DESC NULLS LAST);