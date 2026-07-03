ALTER TABLE `notebooks` ADD `model_ocr` text;--> statement-breakpoint
ALTER TABLE `user_settings` ADD `model_ocr` text DEFAULT 'workers-ai:@cf/meta/llama-3.2-11b-vision-instruct' NOT NULL;