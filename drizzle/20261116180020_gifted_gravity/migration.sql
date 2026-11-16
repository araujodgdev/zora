CREATE TABLE `account` (
	`id` text PRIMARY KEY,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_account_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL UNIQUE,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	CONSTRAINT `fk_session_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`email` text NOT NULL UNIQUE,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `content_asset` (
	`id` text PRIMARY KEY,
	`content_item_id` text NOT NULL,
	`filename` text NOT NULL,
	`content_type` text NOT NULL,
	`size` integer NOT NULL,
	`created_by_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_content_asset_content_item_id_content_item_id_fk` FOREIGN KEY (`content_item_id`) REFERENCES `content_item`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_content_asset_created_by_id_user_id_fk` FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE `content_item` (
	`id` text PRIMARY KEY,
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
	CONSTRAINT `fk_content_item_assignee_id_user_id_fk` FOREIGN KEY (`assignee_id`) REFERENCES `user`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_content_item_created_by_id_user_id_fk` FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON DELETE RESTRICT,
	CONSTRAINT "content_item_channel_valid" CHECK("channel" IN ('x', 'linkedin', 'instagram', 'blog')),
	CONSTRAINT "content_item_format_valid" CHECK("format" IN ('post', 'thread', 'carousel', 'reel', 'story', 'article')),
	CONSTRAINT "content_item_status_valid" CHECK("status" IN ('idea', 'draft', 'ready', 'scheduled', 'published')),
	CONSTRAINT "content_item_scheduled_has_date" CHECK("status" <> 'scheduled' OR "scheduled_at" IS NOT NULL),
	CONSTRAINT "content_item_published_has_date" CHECK("status" <> 'published' OR "published_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX `account_userId_idx` ON `account` (`user_id`);--> statement-breakpoint
CREATE INDEX `session_userId_idx` ON `session` (`user_id`);--> statement-breakpoint
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);--> statement-breakpoint
CREATE INDEX `content_asset_content_item_id_idx` ON `content_asset` (`content_item_id`);--> statement-breakpoint
CREATE INDEX `content_item_scheduled_at_idx` ON `content_item` (`scheduled_at`);--> statement-breakpoint
CREATE INDEX `content_item_status_idx` ON `content_item` (`status`);--> statement-breakpoint
CREATE INDEX `content_item_assignee_id_idx` ON `content_item` (`assignee_id`);