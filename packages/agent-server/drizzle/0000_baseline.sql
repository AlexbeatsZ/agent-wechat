CREATE TABLE `chats` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text,
	`name` text NOT NULL,
	`avatar_description` text,
	`last_message_preview` text,
	`last_message_sender` text,
	`last_activity_at` text,
	`unread_count` integer DEFAULT 0,
	`is_group` integer DEFAULT false,
	`is_pinned` integer DEFAULT false,
	`search_terms` text,
	`scroll_position_hint` integer,
	`created_at` text DEFAULT '(datetime(''now''))',
	`updated_at` text DEFAULT '(datetime(''now''))',
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_chats_name` ON `chats` (`name`);--> statement-breakpoint
CREATE INDEX `idx_chats_session` ON `chats` (`session_id`);--> statement-breakpoint
CREATE TABLE `context` (
	`session_id` text PRIMARY KEY NOT NULL,
	`app_state` text NOT NULL,
	`updated_at` text DEFAULT '(datetime(''now''))',
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text,
	`chat_id` text NOT NULL,
	`content_type` text NOT NULL,
	`content_text` text,
	`sender_name` text,
	`is_outgoing` integer DEFAULT false,
	`timestamp_display` text,
	`timestamp_parsed` text,
	`adjacent_text_before` text,
	`adjacent_text_after` text,
	`is_downloaded` integer DEFAULT false,
	`download_path` text,
	`metadata` text,
	`created_at` text DEFAULT '(datetime(''now''))',
	`updated_at` text DEFAULT '(datetime(''now''))',
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_messages_chat` ON `messages` (`chat_id`);--> statement-breakpoint
CREATE INDEX `idx_messages_time` ON `messages` (`chat_id`,`timestamp_parsed`);--> statement-breakpoint
CREATE INDEX `idx_messages_session` ON `messages` (`session_id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`linux_user` text NOT NULL,
	`display` text NOT NULL,
	`dbus_address` text,
	`vnc_port` integer,
	`status` text DEFAULT 'stopped' NOT NULL,
	`login_state` text DEFAULT 'logged_out' NOT NULL,
	`wechat_pid` integer,
	`xvfb_pid` integer,
	`dbus_pid` integer,
	`error_message` text,
	`created_at` text DEFAULT '(datetime(''now''))',
	`updated_at` text DEFAULT '(datetime(''now''))'
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_name_unique` ON `sessions` (`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_linux_user_unique` ON `sessions` (`linux_user`);--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_display_unique` ON `sessions` (`display`);--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_vnc_port_unique` ON `sessions` (`vnc_port`);--> statement-breakpoint
CREATE INDEX `idx_sessions_status` ON `sessions` (`status`);--> statement-breakpoint
CREATE INDEX `idx_sessions_name` ON `sessions` (`name`);--> statement-breakpoint
CREATE TABLE `sync_state` (
	`session_id` text,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`updated_at` text DEFAULT '(datetime(''now''))',
	PRIMARY KEY(`session_id`, `key`),
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action
);
