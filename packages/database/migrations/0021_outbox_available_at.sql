DROP INDEX "outbox_pending_idx";--> statement-breakpoint
ALTER TABLE "outbox_messages" ADD COLUMN "available_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX "outbox_pending_idx" ON "outbox_messages" USING btree ("available_at") WHERE processed_at is null and dead_lettered_at is null;