CREATE TABLE "content_asset" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"content_item_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"size" bigint NOT NULL,
	"created_by_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "content_asset_content_item_id_idx" ON "content_asset" ("content_item_id");--> statement-breakpoint
ALTER TABLE "content_asset" ADD CONSTRAINT "content_asset_content_item_id_content_item_id_fkey" FOREIGN KEY ("content_item_id") REFERENCES "content_item"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "content_asset" ADD CONSTRAINT "content_asset_created_by_id_user_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "user"("id") ON DELETE RESTRICT;