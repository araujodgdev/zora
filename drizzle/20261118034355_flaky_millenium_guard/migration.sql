CREATE TABLE `content_design` (
	`id` text PRIMARY KEY,
	`content_item_id` text NOT NULL,
	`name` text NOT NULL,
	`width_px` integer NOT NULL,
	`height_px` integer NOT NULL,
	`preset` text,
	`current_version_id` text,
	`created_by_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_content_design_content_item_id_content_item_id_fk` FOREIGN KEY (`content_item_id`) REFERENCES `content_item`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_content_design_created_by_id_user_id_fk` FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON DELETE RESTRICT,
	CONSTRAINT "content_design_size_valid" CHECK("width_px" BETWEEN 1 AND 16384 AND "height_px" BETWEEN 1 AND 16384),
	CONSTRAINT "content_design_name_valid" CHECK(length("name") BETWEEN 1 AND 200)
);
--> statement-breakpoint
CREATE TABLE `content_design_version` (
	`id` text PRIMARY KEY,
	`design_id` text NOT NULL,
	`number` integer NOT NULL,
	`author_kind` text NOT NULL,
	`created_by_id` text NOT NULL,
	`source_size` integer NOT NULL,
	`preview_size` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_content_design_version_design_id_content_design_id_fk` FOREIGN KEY (`design_id`) REFERENCES `content_design`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_content_design_version_created_by_id_user_id_fk` FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON DELETE RESTRICT,
	CONSTRAINT "content_design_version_author_kind_valid" CHECK("author_kind" IN ('user', 'agent')),
	CONSTRAINT "content_design_version_number_valid" CHECK("number" >= 1),
	CONSTRAINT "content_design_version_sizes_valid" CHECK("source_size" > 0 AND "preview_size" > 0)
);
--> statement-breakpoint
CREATE INDEX `content_design_content_item_id_idx` ON `content_design` (`content_item_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `content_design_version_design_number_idx` ON `content_design_version` (`design_id`,`number`);