CREATE TYPE "public"."cost_reporting_mode" AS ENUM('STRICT', 'CONVERTED');--> statement-breakpoint
ALTER TABLE "garages" ADD COLUMN "cost_reporting" "cost_reporting_mode" DEFAULT 'STRICT' NOT NULL;