CREATE TABLE `content_photo_edit` (
	`id` text PRIMARY KEY,
	`content_item_id` text NOT NULL,
	`name` text NOT NULL,
	`source_asset_id` text,
	`original_key` text NOT NULL,
	`original_name` text NOT NULL,
	`original_size` integer NOT NULL,
	`current_version_id` text,
	`created_by_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_content_photo_edit_content_item_id_content_item_id_fk` FOREIGN KEY (`content_item_id`) REFERENCES `content_item`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_content_photo_edit_source_asset_id_content_asset_id_fk` FOREIGN KEY (`source_asset_id`) REFERENCES `content_asset`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_content_photo_edit_created_by_id_user_id_fk` FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON DELETE RESTRICT,
	CONSTRAINT "content_photo_edit_name_valid" CHECK(length("name") BETWEEN 1 AND 200),
	CONSTRAINT "content_photo_edit_original_size_valid" CHECK("original_size" > 0)
);
--> statement-breakpoint
CREATE TABLE `content_photo_edit_version` (
	`id` text PRIMARY KEY,
	`edit_id` text NOT NULL,
	`number` integer NOT NULL,
	`author_kind` text NOT NULL,
	`created_by_id` text NOT NULL,
	`settings_size` integer NOT NULL,
	`preview_size` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_content_photo_edit_version_edit_id_content_photo_edit_id_fk` FOREIGN KEY (`edit_id`) REFERENCES `content_photo_edit`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_content_photo_edit_version_created_by_id_user_id_fk` FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON DELETE RESTRICT,
	CONSTRAINT "content_photo_edit_version_author_kind_valid" CHECK("author_kind" IN ('user', 'agent')),
	CONSTRAINT "content_photo_edit_version_number_valid" CHECK("number" >= 1),
	CONSTRAINT "content_photo_edit_version_sizes_valid" CHECK("settings_size" > 0 AND "preview_size" > 0)
);
--> statement-breakpoint
CREATE INDEX `content_photo_edit_content_item_id_idx` ON `content_photo_edit` (`content_item_id`);--> statement-breakpoint
CREATE INDEX `content_photo_edit_source_asset_id_idx` ON `content_photo_edit` (`source_asset_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `content_photo_edit_version_edit_number_idx` ON `content_photo_edit_version` (`edit_id`,`number`);