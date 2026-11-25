CREATE TABLE `social_metric_snapshot` (
	`id` text PRIMARY KEY,
	`organization_id` text NOT NULL,
	`content_item_id` text NOT NULL,
	`publish_job_id` text,
	`channel` text NOT NULL,
	`remote_post_id` text NOT NULL,
	`views` integer,
	`reach` integer,
	`likes` integer,
	`comments` integer,
	`shares` integer,
	`saves` integer,
	`clicks` integer,
	`engagement_rate_bps` integer,
	`raw_payload` text DEFAULT '{}' NOT NULL,
	`collected_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_social_metric_snapshot_organization_id_organization_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE RESTRICT,
	CONSTRAINT `fk_social_metric_snapshot_content_item_id_content_item_id_fk` FOREIGN KEY (`content_item_id`) REFERENCES `content_item`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_social_metric_snapshot_publish_job_id_social_publish_job_id_fk` FOREIGN KEY (`publish_job_id`) REFERENCES `social_publish_job`(`id`) ON DELETE SET NULL,
	CONSTRAINT "social_metric_snapshot_channel_valid" CHECK("channel" IN ('instagram', 'tiktok', 'youtube', 'linkedin', 'x'))
);
--> statement-breakpoint
CREATE INDEX `social_metric_snapshot_org_collected_idx` ON `social_metric_snapshot` (`organization_id`,`collected_at`);--> statement-breakpoint
CREATE INDEX `social_metric_snapshot_item_collected_idx` ON `social_metric_snapshot` (`content_item_id`,`collected_at`);--> statement-breakpoint
CREATE INDEX `social_metric_snapshot_remote_idx` ON `social_metric_snapshot` (`remote_post_id`,`collected_at`);