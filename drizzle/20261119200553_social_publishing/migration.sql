-- Social publishing: add tiktok & youtube channels, video & short formats,
-- and the social_connection + social_publish_job tables.
--
-- D1 ignores `PRAGMA foreign_keys=OFF` inside migrations, so dropping
-- `content_item` to widen its CHECK constraints would cascade-delete
-- `content_asset`, `content_design` and `content_design_version`. Those rows
-- are parked in plain tables first and restored afterwards.
CREATE TABLE `__content_design_version_backup` AS SELECT * FROM `content_design_version`;
--> statement-breakpoint
CREATE TABLE `__content_design_backup` AS SELECT * FROM `content_design`;
--> statement-breakpoint
CREATE TABLE `__content_asset_backup` AS SELECT * FROM `content_asset`;
--> statement-breakpoint
DROP TABLE `content_design_version`;
--> statement-breakpoint
DROP TABLE `content_design`;
--> statement-breakpoint
DROP TABLE `content_asset`;
--> statement-breakpoint
CREATE TABLE `__new_content_item` (
	`id` text PRIMARY KEY,
	`organization_id` text NOT NULL,
	`title` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`channel` text NOT NULL,
	`format` text NOT NULL,
	`status` text DEFAULT 'idea' NOT NULL,
	`scheduled_at` integer,
	`published_at` integer,
	`published_url` text,
	`notes` text DEFAULT '' NOT NULL,
	`asset_links` text DEFAULT '[]' NOT NULL,
	`assignee_id` text,
	`created_by_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_content_item_organization_id_organization_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE RESTRICT,
	CONSTRAINT `fk_content_item_assignee_id_user_id_fk` FOREIGN KEY (`assignee_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_content_item_created_by_id_user_id_fk` FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON DELETE RESTRICT,
	CONSTRAINT "content_item_channel_valid" CHECK("channel" IN ('x', 'linkedin', 'instagram', 'tiktok', 'youtube', 'blog')),
	CONSTRAINT "content_item_format_valid" CHECK("format" IN ('post', 'thread', 'carousel', 'reel', 'story', 'video', 'short', 'article')),
	CONSTRAINT "content_item_status_valid" CHECK("status" IN ('idea', 'draft', 'ready', 'scheduled', 'published')),
	CONSTRAINT "content_item_scheduled_has_date" CHECK("status" <> 'scheduled' OR "scheduled_at" IS NOT NULL),
	CONSTRAINT "content_item_published_has_date" CHECK("status" <> 'published' OR "published_at" IS NOT NULL)
);
--> statement-breakpoint
INSERT INTO `__new_content_item`(`id`, `organization_id`, `title`, `body`, `channel`, `format`, `status`, `scheduled_at`, `published_at`, `published_url`, `notes`, `asset_links`, `assignee_id`, `created_by_id`, `created_at`, `updated_at`)
SELECT `id`, `organization_id`, `title`, `body`, `channel`, `format`, `status`, `scheduled_at`, `published_at`, `published_url`, `notes`, `asset_links`, `assignee_id`, `created_by_id`, `created_at`, `updated_at`
FROM `content_item`;
--> statement-breakpoint
DROP TABLE `content_item`;
--> statement-breakpoint
ALTER TABLE `__new_content_item` RENAME TO `content_item`;
--> statement-breakpoint
CREATE TABLE `content_asset` (
	`id` text PRIMARY KEY,
	`content_item_id` text NOT NULL,
	`filename` text NOT NULL,
	`content_type` text NOT NULL,
	`size` integer NOT NULL,
	`attribution` text,
	`created_by_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_content_asset_content_item_id_content_item_id_fk` FOREIGN KEY (`content_item_id`) REFERENCES `content_item`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_content_asset_created_by_id_user_id_fk` FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON DELETE RESTRICT
);
--> statement-breakpoint
INSERT INTO `content_asset` (`id`, `content_item_id`, `filename`, `content_type`, `size`, `attribution`, `created_by_id`, `created_at`)
SELECT `id`, `content_item_id`, `filename`, `content_type`, `size`, `attribution`, `created_by_id`, `created_at`
FROM `__content_asset_backup`;
--> statement-breakpoint
DROP TABLE `__content_asset_backup`;
--> statement-breakpoint
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
INSERT INTO `content_design` (`id`, `content_item_id`, `name`, `width_px`, `height_px`, `preset`, `current_version_id`, `created_by_id`, `created_at`, `updated_at`)
SELECT `id`, `content_item_id`, `name`, `width_px`, `height_px`, `preset`, `current_version_id`, `created_by_id`, `created_at`, `updated_at`
FROM `__content_design_backup`;
--> statement-breakpoint
DROP TABLE `__content_design_backup`;
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
INSERT INTO `content_design_version` (`id`, `design_id`, `number`, `author_kind`, `created_by_id`, `source_size`, `preview_size`, `created_at`)
SELECT `id`, `design_id`, `number`, `author_kind`, `created_by_id`, `source_size`, `preview_size`, `created_at`
FROM `__content_design_version_backup`;
--> statement-breakpoint
DROP TABLE `__content_design_version_backup`;
--> statement-breakpoint
CREATE TABLE `social_connection` (
	`id` text PRIMARY KEY,
	`organization_id` text NOT NULL,
	`channel` text NOT NULL,
	`provider` text DEFAULT 'treg' NOT NULL,
	`external_secret_id` integer,
	`external_tool_name` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`pending_state` text,
	`account_id` text,
	`account_name` text,
	`account_meta` text DEFAULT '{}' NOT NULL,
	`connected_by_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_social_connection_organization_id_organization_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE RESTRICT,
	CONSTRAINT `fk_social_connection_connected_by_id_user_id_fk` FOREIGN KEY (`connected_by_id`) REFERENCES `user`(`id`) ON DELETE RESTRICT,
	CONSTRAINT "social_connection_channel_valid" CHECK("channel" IN ('instagram', 'tiktok', 'youtube', 'linkedin', 'x')),
	CONSTRAINT "social_connection_provider_valid" CHECK("provider" IN ('treg')),
	CONSTRAINT "social_connection_status_valid" CHECK("status" IN ('pending', 'needs_resource', 'connected', 'error'))
);
--> statement-breakpoint
CREATE TABLE `social_publish_job` (
	`id` text PRIMARY KEY,
	`organization_id` text NOT NULL,
	`content_item_id` text NOT NULL,
	`connection_id` text,
	`channel` text NOT NULL,
	`trigger` text NOT NULL,
	`triggered_by_id` text,
	`schedule_key` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`stage` text DEFAULT 'preparing' NOT NULL,
	`options` text DEFAULT '{}' NOT NULL,
	`provider_state` text DEFAULT '{}' NOT NULL,
	`remote_post_id` text,
	`published_url` text,
	`error_message` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_poll_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`finished_at` integer,
	CONSTRAINT `fk_social_publish_job_organization_id_organization_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE RESTRICT,
	CONSTRAINT `fk_social_publish_job_content_item_id_content_item_id_fk` FOREIGN KEY (`content_item_id`) REFERENCES `content_item`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_social_publish_job_connection_id_social_connection_id_fk` FOREIGN KEY (`connection_id`) REFERENCES `social_connection`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_social_publish_job_triggered_by_id_user_id_fk` FOREIGN KEY (`triggered_by_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT "social_publish_job_channel_valid" CHECK("channel" IN ('instagram', 'tiktok', 'youtube', 'linkedin', 'x')),
	CONSTRAINT "social_publish_job_trigger_valid" CHECK("trigger" IN ('manual', 'scheduled', 'mcp')),
	CONSTRAINT "social_publish_job_status_valid" CHECK("status" IN ('pending', 'processing', 'published', 'failed'))
);
--> statement-breakpoint
CREATE INDEX `content_item_organization_id_idx` ON `content_item` (`organization_id`);--> statement-breakpoint
CREATE INDEX `content_item_scheduled_at_idx` ON `content_item` (`scheduled_at`);--> statement-breakpoint
CREATE INDEX `content_item_status_idx` ON `content_item` (`status`);--> statement-breakpoint
CREATE INDEX `content_item_assignee_id_idx` ON `content_item` (`assignee_id`);--> statement-breakpoint
CREATE INDEX `content_asset_content_item_id_idx` ON `content_asset` (`content_item_id`);--> statement-breakpoint
CREATE INDEX `content_design_content_item_id_idx` ON `content_design` (`content_item_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `content_design_version_design_number_idx` ON `content_design_version` (`design_id`,`number`);--> statement-breakpoint
CREATE UNIQUE INDEX `social_connection_org_channel_idx` ON `social_connection` (`organization_id`,`channel`);--> statement-breakpoint
CREATE INDEX `social_connection_status_idx` ON `social_connection` (`status`);--> statement-breakpoint
CREATE INDEX `social_publish_job_item_idx` ON `social_publish_job` (`content_item_id`);--> statement-breakpoint
CREATE INDEX `social_publish_job_org_idx` ON `social_publish_job` (`organization_id`);--> statement-breakpoint
CREATE INDEX `social_publish_job_status_poll_idx` ON `social_publish_job` (`status`,`next_poll_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `social_publish_job_schedule_key_idx` ON `social_publish_job` (`schedule_key`);
