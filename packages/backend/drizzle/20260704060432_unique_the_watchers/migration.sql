PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_user_settings` (
	`user_id` text PRIMARY KEY,
	`ai_provider` text,
	`ai_api_key` text,
	`ai_base_url` text,
	`ai_embedding_model` text DEFAULT '@cf/baai/bge-m3' NOT NULL,
	`model_chat` text DEFAULT '@cf/meta/llama-3.1-8b-instruct-fast' NOT NULL,
	`model_summarization` text DEFAULT '@cf/meta/llama-3.1-8b-instruct-fast' NOT NULL,
	`model_ocr` text DEFAULT '@cf/meta/llama-3.2-11b-vision-instruct' NOT NULL,
	`system_prompt` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_user_settings`(`user_id`, `ai_provider`, `ai_api_key`, `ai_base_url`, `ai_embedding_model`, `model_chat`, `model_summarization`, `model_ocr`, `system_prompt`, `created_at`, `updated_at`) SELECT `user_id`, `ai_provider`, `ai_api_key`, `ai_base_url`, `ai_embedding_model`, `model_chat`, `model_summarization`, `model_ocr`, `system_prompt`, `created_at`, `updated_at` FROM `user_settings`;--> statement-breakpoint
DROP TABLE `user_settings`;--> statement-breakpoint
ALTER TABLE `__new_user_settings` RENAME TO `user_settings`;--> statement-breakpoint
PRAGMA foreign_keys=ON;