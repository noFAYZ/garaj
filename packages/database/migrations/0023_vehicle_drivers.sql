CREATE TABLE "vehicle_drivers" (
	"vehicle_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vehicle_drivers_vehicle_id_member_id_pk" PRIMARY KEY("vehicle_id","member_id")
);
--> statement-breakpoint
ALTER TABLE "vehicle_drivers" ADD CONSTRAINT "vehicle_drivers_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_drivers" ADD CONSTRAINT "vehicle_drivers_member_id_garage_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."garage_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "vehicle_drivers_member_id_idx" ON "vehicle_drivers" USING btree ("member_id");