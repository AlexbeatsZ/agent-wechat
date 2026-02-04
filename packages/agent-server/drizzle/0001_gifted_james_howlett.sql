ALTER TABLE `chats` ADD `image_hash` text;--> statement-breakpoint
ALTER TABLE `chats` ADD `is_muted` integer DEFAULT false;--> statement-breakpoint
CREATE INDEX `idx_chats_image_hash` ON `chats` (`image_hash`);