CREATE TABLE `mcp_workspace_state` (
	`user_id` text PRIMARY KEY,
	`organization_id` text NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_mcp_workspace_state_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_mcp_workspace_state_organization_id_organization_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX `mcp_workspace_state_org_idx` ON `mcp_workspace_state` (`organization_id`);