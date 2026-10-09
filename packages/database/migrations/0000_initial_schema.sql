CREATE TYPE "public"."distance_unit" AS ENUM('KM', 'MI');--> statement-breakpoint
CREATE TYPE "public"."volume_unit" AS ENUM('LITER', 'US_GALLON', 'IMP_GALLON');--> statement-breakpoint
CREATE TYPE "public"."condition_category" AS ENUM('EXTERIOR', 'INTERIOR', 'MECHANICAL', 'ELECTRICAL', 'TIRES', 'BRAKES', 'BODY', 'FRAME', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."document_type" AS ENUM('REGISTRATION', 'INSURANCE', 'PURCHASE_AGREEMENT', 'SERVICE_INVOICE', 'REPAIR_INVOICE', 'INSPECTION_REPORT', 'WARRANTY', 'MANUAL', 'RECEIPT', 'IMPORT_DOCUMENT', 'MODIFICATION_CERTIFICATE', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."event_type" AS ENUM('PURCHASE', 'MAINTENANCE', 'REPAIR', 'MODIFICATION', 'INSPECTION', 'ACCIDENT', 'FUEL', 'CHARGE', 'CLEANING', 'REGISTRATION', 'INSURANCE', 'TRIP', 'EXPENSE', 'NOTE', 'VALUATION', 'CONDITION_CHECK', 'DOCUMENT_ADDED', 'PART_INSTALLED', 'PART_REMOVED', 'SALE');--> statement-breakpoint
CREATE TYPE "public"."expense_category" AS ENUM('PURCHASE', 'MAINTENANCE', 'REPAIR', 'FUEL', 'CHARGING', 'INSURANCE', 'REGISTRATION', 'TAX', 'MODIFICATION', 'PART', 'ACCESSORY', 'STORAGE', 'CLEANING', 'TRANSPORT', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."garage_role" AS ENUM('OWNER', 'ADMIN', 'MEMBER', 'DRIVER', 'VIEWER');--> statement-breakpoint
CREATE TYPE "public"."idea_status" AS ENUM('IDEA', 'RESEARCH', 'PLANNED', 'ORDERED', 'INSTALLED', 'ABANDONED');--> statement-breakpoint
CREATE TYPE "public"."notification_channel" AS ENUM('IN_APP', 'EMAIL', 'PUSH');--> statement-breakpoint
CREATE TYPE "public"."notification_type" AS ENUM('MAINTENANCE_DUE', 'MAINTENANCE_OVERDUE', 'TASK_DUE', 'TASK_OVERDUE', 'DOCUMENT_EXPIRING', 'REGISTRATION_EXPIRING', 'INSURANCE_EXPIRING', 'WARRANTY_EXPIRING', 'HEALTH_CHANGED', 'GARAGE_BRIEFING', 'MEMBER_INVITED');--> statement-breakpoint
CREATE TYPE "public"."record_source" AS ENUM('USER', 'IMPORT', 'OCR', 'AI', 'TELEMETRY', 'PROVIDER');--> statement-breakpoint
CREATE TYPE "public"."task_category" AS ENUM('MAINTENANCE', 'REPAIR', 'ADMINISTRATIVE', 'PURCHASE', 'MODIFICATION', 'CLEANING', 'INSPECTION', 'RESEARCH', 'IDEA');--> statement-breakpoint
CREATE TYPE "public"."task_priority" AS ENUM('LOW', 'MEDIUM', 'HIGH', 'URGENT');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('TODO', 'IN_PROGRESS', 'BLOCKED', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."vehicle_status" AS ENUM('ACTIVE', 'STORED', 'SOLD', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."vehicle_type" AS ENUM('CAR', 'MOTORCYCLE', 'SCOOTER', 'BICYCLE', 'BOAT', 'ATV', 'TRAILER', 'VAN', 'RV', 'OTHER');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"id_token" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user_profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"locale" text DEFAULT 'en-US' NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"default_currency" text DEFAULT 'USD' NOT NULL,
	"distance_unit" "distance_unit" DEFAULT 'KM' NOT NULL,
	"volume_unit" "volume_unit" DEFAULT 'LITER' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_profiles_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "garage_members" (
	"id" uuid PRIMARY KEY NOT NULL,
	"garage_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "garage_role" DEFAULT 'MEMBER' NOT NULL,
	"invited_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "garage_members_garage_user_unique" UNIQUE("garage_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "garages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"owner_id" uuid NOT NULL,
	"default_currency" text DEFAULT 'USD' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicle_photos" (
	"id" uuid PRIMARY KEY NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"event_id" uuid,
	"storage_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"checksum" text,
	"width" integer,
	"height" integer,
	"caption" text,
	"category" text,
	"captured_at" date,
	"location_shared" boolean DEFAULT false NOT NULL,
	"latitude" text,
	"longitude" text,
	"processed_at" date,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "vehicles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"garage_id" uuid NOT NULL,
	"vehicle_type" "vehicle_type" NOT NULL,
	"status" "vehicle_status" DEFAULT 'ACTIVE' NOT NULL,
	"nickname" text,
	"make" text,
	"model" text,
	"variant" text,
	"year" integer,
	"color" text,
	"identification_number" text,
	"registration_identifier" text,
	"purchase_date" date,
	"purchase_price_amount_minor" bigint,
	"purchase_price_currency" char(3),
	"current_odometer" integer,
	"odometer_unit" "distance_unit" DEFAULT 'KM' NOT NULL,
	"current_engine_hours" integer,
	"primary_photo_id" uuid,
	"specs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "vehicle_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"event_type" "event_type" NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"odometer" integer,
	"odometer_unit" "distance_unit",
	"engine_hours" integer,
	"cost_amount_minor" bigint,
	"cost_currency" char(3),
	"provider" text,
	"source" "record_source" DEFAULT 'USER' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "maintenance_plans" (
	"id" uuid PRIMARY KEY NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"priority" "task_priority" DEFAULT 'MEDIUM' NOT NULL,
	"interval_distance" integer,
	"interval_distance_unit" "distance_unit",
	"interval_months" integer,
	"interval_engine_hours" integer,
	"last_performed_at" timestamp with time zone,
	"last_performed_odometer" integer,
	"last_performed_engine_hours" integer,
	"next_due_date" date,
	"next_due_odometer" integer,
	"next_due_engine_hours" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "maintenance_records" (
	"id" uuid PRIMARY KEY NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"plan_id" uuid,
	"event_id" uuid,
	"title" text NOT NULL,
	"work_performed" text,
	"notes" text,
	"provider" text,
	"performed_at" timestamp with time zone NOT NULL,
	"odometer" integer,
	"odometer_unit" "distance_unit",
	"engine_hours" integer,
	"parts_cost_amount_minor" bigint,
	"labor_cost_amount_minor" bigint,
	"total_cost_amount_minor" bigint,
	"cost_currency" char(3),
	"next_recommended_date" date,
	"next_recommended_odometer" integer,
	"source" "record_source" DEFAULT 'USER' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ideas" (
	"id" uuid PRIMARY KEY NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" "idea_status" DEFAULT 'IDEA' NOT NULL,
	"estimated_cost_amount_minor" bigint,
	"cost_currency" char(3),
	"reference_url" text,
	"promoted_task_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"garage_id" uuid NOT NULL,
	"vehicle_id" uuid,
	"maintenance_plan_id" uuid,
	"title" text NOT NULL,
	"description" text,
	"status" "task_status" DEFAULT 'TODO' NOT NULL,
	"priority" "task_priority" DEFAULT 'MEDIUM' NOT NULL,
	"category" "task_category" DEFAULT 'MAINTENANCE' NOT NULL,
	"due_date" date,
	"due_odometer" integer,
	"assignee_id" uuid,
	"estimated_cost_amount_minor" bigint,
	"actual_cost_amount_minor" bigint,
	"cost_currency" char(3),
	"completed_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"event_id" uuid,
	"category" "expense_category" NOT NULL,
	"description" text NOT NULL,
	"vendor" text,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"odometer" integer,
	"odometer_unit" "distance_unit",
	"engine_hours" integer,
	"quantity" numeric(12, 4),
	"quantity_unit" "volume_unit",
	"energy_kwh" numeric(12, 4),
	"is_full_tank" integer,
	"source" "record_source" DEFAULT 'USER' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"event_id" uuid,
	"document_type" "document_type" NOT NULL,
	"title" text NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"storage_key" text NOT NULL,
	"checksum" text,
	"issued_on" date,
	"expires_on" date,
	"notes" text,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "documents_storage_key_unique" UNIQUE("storage_key")
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"notification_type" "notification_type" NOT NULL,
	"channel" "notification_channel" NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_preferences_unique" UNIQUE("user_id","notification_type","channel")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"garage_id" uuid,
	"vehicle_id" uuid,
	"notification_type" "notification_type" NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dedupe_key" text NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_user_dedupe_unique" UNIQUE("user_id","dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"actor_id" uuid,
	"actor_email" text,
	"garage_id" uuid,
	"action" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"request_id" text,
	"ip_address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbox_messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"queue" text NOT NULL,
	"job_name" text NOT NULL,
	"payload" jsonb NOT NULL,
	"job_key" text NOT NULL,
	"processed_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"dead_lettered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "garage_members" ADD CONSTRAINT "garage_members_garage_id_garages_id_fk" FOREIGN KEY ("garage_id") REFERENCES "public"."garages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "garage_members" ADD CONSTRAINT "garage_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "garage_members" ADD CONSTRAINT "garage_members_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "garages" ADD CONSTRAINT "garages_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_photos" ADD CONSTRAINT "vehicle_photos_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_photos" ADD CONSTRAINT "vehicle_photos_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_garage_id_garages_id_fk" FOREIGN KEY ("garage_id") REFERENCES "public"."garages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_events" ADD CONSTRAINT "vehicle_events_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_events" ADD CONSTRAINT "vehicle_events_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_plans" ADD CONSTRAINT "maintenance_plans_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_records" ADD CONSTRAINT "maintenance_records_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_records" ADD CONSTRAINT "maintenance_records_plan_id_maintenance_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."maintenance_plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_records" ADD CONSTRAINT "maintenance_records_event_id_vehicle_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."vehicle_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_records" ADD CONSTRAINT "maintenance_records_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_promoted_task_id_tasks_id_fk" FOREIGN KEY ("promoted_task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_garage_id_garages_id_fk" FOREIGN KEY ("garage_id") REFERENCES "public"."garages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_maintenance_plan_id_maintenance_plans_id_fk" FOREIGN KEY ("maintenance_plan_id") REFERENCES "public"."maintenance_plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_event_id_vehicle_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."vehicle_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_event_id_vehicle_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."vehicle_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_garage_id_garages_id_fk" FOREIGN KEY ("garage_id") REFERENCES "public"."garages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_garage_id_garages_id_fk" FOREIGN KEY ("garage_id") REFERENCES "public"."garages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_user_id_idx" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_token_idx" ON "sessions" USING btree ("token");--> statement-breakpoint
CREATE INDEX "users_email_idx" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "verifications_identifier_idx" ON "verifications" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "garage_members_user_id_idx" ON "garage_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "garage_members_garage_id_idx" ON "garage_members" USING btree ("garage_id");--> statement-breakpoint
CREATE INDEX "garages_owner_id_idx" ON "garages" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "vehicle_photos_vehicle_id_idx" ON "vehicle_photos" USING btree ("vehicle_id");--> statement-breakpoint
CREATE INDEX "vehicle_photos_event_id_idx" ON "vehicle_photos" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "vehicles_garage_id_idx" ON "vehicles" USING btree ("garage_id");--> statement-breakpoint
CREATE INDEX "vehicles_garage_status_idx" ON "vehicles" USING btree ("garage_id","status");--> statement-breakpoint
CREATE INDEX "vehicles_identification_idx" ON "vehicles" USING btree ("identification_number");--> statement-breakpoint
CREATE INDEX "vehicle_events_vehicle_occurred_idx" ON "vehicle_events" USING btree ("vehicle_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "vehicle_events_vehicle_type_idx" ON "vehicle_events" USING btree ("vehicle_id","event_type");--> statement-breakpoint
CREATE INDEX "vehicle_events_occurred_at_idx" ON "vehicle_events" USING btree ("occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "maintenance_plans_vehicle_id_idx" ON "maintenance_plans" USING btree ("vehicle_id");--> statement-breakpoint
CREATE INDEX "maintenance_plans_due_idx" ON "maintenance_plans" USING btree ("is_active","next_due_date");--> statement-breakpoint
CREATE INDEX "maintenance_records_vehicle_idx" ON "maintenance_records" USING btree ("vehicle_id","performed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "maintenance_records_plan_idx" ON "maintenance_records" USING btree ("plan_id","performed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ideas_vehicle_status_idx" ON "ideas" USING btree ("vehicle_id","status");--> statement-breakpoint
CREATE INDEX "tasks_garage_status_due_idx" ON "tasks" USING btree ("garage_id","status","due_date");--> statement-breakpoint
CREATE INDEX "tasks_vehicle_idx" ON "tasks" USING btree ("vehicle_id");--> statement-breakpoint
CREATE INDEX "tasks_assignee_idx" ON "tasks" USING btree ("assignee_id","status");--> statement-breakpoint
CREATE INDEX "expenses_vehicle_occurred_idx" ON "expenses" USING btree ("vehicle_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "expenses_vehicle_category_idx" ON "expenses" USING btree ("vehicle_id","category");--> statement-breakpoint
CREATE INDEX "documents_vehicle_idx" ON "documents" USING btree ("vehicle_id");--> statement-breakpoint
CREATE INDEX "documents_expires_on_idx" ON "documents" USING btree ("expires_on");--> statement-breakpoint
CREATE INDEX "documents_type_idx" ON "documents" USING btree ("vehicle_id","document_type");--> statement-breakpoint
CREATE INDEX "notifications_user_unread_idx" ON "notifications" USING btree ("user_id","read_at");--> statement-breakpoint
CREATE INDEX "audit_logs_garage_created_idx" ON "audit_logs" USING btree ("garage_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_logs_resource_idx" ON "audit_logs" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "audit_logs_actor_idx" ON "audit_logs" USING btree ("actor_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "outbox_pending_idx" ON "outbox_messages" USING btree ("created_at") WHERE processed_at is null and dead_lettered_at is null;