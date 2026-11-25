ALTER TABLE "documents" ADD COLUMN "part_id" uuid;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_part_id_vehicle_parts_id_fk" FOREIGN KEY ("part_id") REFERENCES "public"."vehicle_parts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "documents_part_idx" ON "documents" USING btree ("part_id") WHERE "documents"."part_id" is not null;