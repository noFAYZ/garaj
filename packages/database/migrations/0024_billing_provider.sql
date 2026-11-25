CREATE TYPE "public"."billing_provider" AS ENUM('STRIPE', 'REVENUECAT');--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "provider" "billing_provider" DEFAULT 'STRIPE' NOT NULL;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "store" text;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "management_url" text;--> statement-breakpoint
CREATE INDEX "notifications_user_created_idx" ON "notifications" USING btree ("user_id","created_at" DESC NULLS LAST);