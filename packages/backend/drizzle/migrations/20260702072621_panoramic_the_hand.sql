CREATE TABLE `ai_connections` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`provider` text NOT NULL,
	`api_key` text,
	`base_url` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `chat_messages` (
	`id` text PRIMARY KEY,
	`session_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	CONSTRAINT `fk_chat_messages_session_id_chat_sessions_id_fk` FOREIGN KEY (`session_id`) REFERENCES `chat_sessions`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `chat_sessions` (
	`id` text PRIMARY KEY,
	`notebook_id` text NOT NULL,
	`title` text NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	CONSTRAINT `fk_chat_sessions_notebook_id_notebooks_id_fk` FOREIGN KEY (`notebook_id`) REFERENCES `notebooks`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `global_settings` (
	`id` text PRIMARY KEY DEFAULT 'default',
	`storage_provider` text DEFAULT 'r2-binding' NOT NULL,
	`storage_config` text,
	`updated_by` text,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	CONSTRAINT "single_row" CHECK("id" = 'default')
);
--> statement-breakpoint
CREATE TABLE `invitations` (
	`id` text PRIMARY KEY,
	`token` text NOT NULL UNIQUE,
	`email` text NOT NULL,
	`invited_by` text NOT NULL,
	`expires_at` text NOT NULL,
	`used_at` text,
	`used_by` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	CONSTRAINT `fk_invitations_invited_by_users_id_fk` FOREIGN KEY (`invited_by`) REFERENCES `users`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_invitations_used_by_users_id_fk` FOREIGN KEY (`used_by`) REFERENCES `users`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `notebooks` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`ai_provider` text,
	`ai_api_key` text,
	`ai_base_url` text,
	`ai_embedding_model` text,
	`model_chat` text,
	`model_summarization` text,
	`mcp_token` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `notes` (
	`id` text PRIMARY KEY,
	`notebook_id` text NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	CONSTRAINT `fk_notes_notebook_id_notebooks_id_fk` FOREIGN KEY (`notebook_id`) REFERENCES `notebooks`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	CONSTRAINT `fk_sessions_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `source_chunks` (
	`id` text PRIMARY KEY,
	`source_id` text NOT NULL,
	`notebook_id` text NOT NULL,
	`content` text NOT NULL,
	`page_number` integer,
	CONSTRAINT `fk_source_chunks_source_id_sources_id_fk` FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_source_chunks_notebook_id_notebooks_id_fk` FOREIGN KEY (`notebook_id`) REFERENCES `notebooks`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `source_images` (
	`id` text PRIMARY KEY,
	`source_id` text NOT NULL,
	`notebook_id` text NOT NULL,
	`r2_key` text NOT NULL,
	`page_number` integer,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	CONSTRAINT `fk_source_images_source_id_sources_id_fk` FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_source_images_notebook_id_notebooks_id_fk` FOREIGN KEY (`notebook_id`) REFERENCES `notebooks`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `sources` (
	`id` text PRIMARY KEY,
	`notebook_id` text NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`r2_key` text,
	`hash` text,
	`status` text NOT NULL,
	`display_order` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	CONSTRAINT `fk_sources_notebook_id_notebooks_id_fk` FOREIGN KEY (`notebook_id`) REFERENCES `notebooks`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `user_settings` (
	`user_id` text PRIMARY KEY,
	`ai_provider` text,
	`ai_api_key` text,
	`ai_base_url` text,
	`ai_embedding_model` text DEFAULT '@cf/baai/bge-large-en-v1.5' NOT NULL,
	`model_chat` text DEFAULT '@cf/meta/llama-3.1-8b-instruct-fast' NOT NULL,
	`model_summarization` text DEFAULT '@cf/meta/llama-3.1-8b-instruct-fast' NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`name` text,
	`is_admin` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_chat_messages_session_created` ON `chat_messages` (`session_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_chat_sessions_notebook_created` ON `chat_sessions` (`notebook_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_notebooks_mcp_token` ON `notebooks` (`mcp_token`) WHERE mcp_token IS NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_notes_notebook_created` ON `notes` (`notebook_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_source_chunks_source` ON `source_chunks` (`source_id`);--> statement-breakpoint
CREATE INDEX `idx_source_chunks_notebook` ON `source_chunks` (`notebook_id`);--> statement-breakpoint
CREATE INDEX `idx_source_images_source` ON `source_images` (`source_id`);--> statement-breakpoint
CREATE INDEX `idx_source_images_notebook` ON `source_images` (`notebook_id`);--> statement-breakpoint
CREATE INDEX `idx_sources_notebook_display_order` ON `sources` (`notebook_id`,`display_order`);--> statement-breakpoint
CREATE INDEX `idx_sources_notebook_status` ON `sources` (`notebook_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_sources_notebook_hash` ON `sources` (`notebook_id`,`hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_users_email` ON `users` (`email`);