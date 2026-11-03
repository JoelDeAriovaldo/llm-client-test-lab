CREATE TABLE `calls` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`experiment_model_id` integer NOT NULL,
	`is_trial` integer DEFAULT false NOT NULL,
	`dataset_version` integer NOT NULL,
	`answer_id` text NOT NULL,
	`question_id` text NOT NULL,
	`repeat` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`prompt` text,
	`raw_output` text,
	`parsed_lines` text,
	`reason` text,
	`unreadable_reason` text,
	`finish_reason` text,
	`latency_ms` integer,
	`input_tokens` integer,
	`output_tokens` integer,
	`cost_usd` real,
	`error` text,
	`batch_id` integer,
	`result_id` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`experiment_model_id`) REFERENCES `experiment_models`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `calls_unique` ON `calls` (`experiment_model_id`,`is_trial`,`answer_id`,`repeat`);--> statement-breakpoint
CREATE TABLE `connections` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`base_url` text NOT NULL,
	`api_key_env_var` text,
	`locality` text NOT NULL,
	`concurrency` integer NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `connections_name_unique` ON `connections` (`name`);--> statement-breakpoint
CREATE TABLE `dataset_cache` (
	`version` integer NOT NULL,
	`kind` text NOT NULL,
	`external_id` text NOT NULL,
	`body` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dataset_cache_unique` ON `dataset_cache` (`version`,`kind`,`external_id`);--> statement-breakpoint
CREATE TABLE `experiment_models` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`experiment_id` integer NOT NULL,
	`connection_id` integer NOT NULL,
	`model_name` text NOT NULL,
	`model_settings` text NOT NULL,
	`input_price_per_million` real,
	`output_price_per_million` real,
	`use_response_format` integer DEFAULT true NOT NULL,
	`run_id` integer,
	`status` text DEFAULT 'pending' NOT NULL,
	`close_requested` integer DEFAULT false NOT NULL,
	`withdraw_reason` text,
	`error` text,
	FOREIGN KEY (`experiment_id`) REFERENCES `experiments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`connection_id`) REFERENCES `connections`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `experiments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`notes` text,
	`harness_version_id` integer NOT NULL,
	`repeats` integer DEFAULT 1 NOT NULL,
	`allow_real_on_cloud` integer DEFAULT false NOT NULL,
	`answer_filter` text NOT NULL,
	`spend_limit_usd` real,
	`dataset_version` integer,
	`answer_count` integer,
	`git_commit` text,
	`dirty` integer,
	`status` text DEFAULT 'draft' NOT NULL,
	`trial_status` text DEFAULT 'none' NOT NULL,
	`trial_size` integer DEFAULT 10 NOT NULL,
	`error` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`harness_version_id`) REFERENCES `harness_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `harness_versions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`harness_id` integer NOT NULL,
	`version` integer NOT NULL,
	`prompt_template` text NOT NULL,
	`used_marking_scheme` integer NOT NULL,
	`parser` text NOT NULL,
	`hash` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`harness_id`) REFERENCES `harnesses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `harness_versions_unique` ON `harness_versions` (`harness_id`,`version`);--> statement-breakpoint
CREATE TABLE `harnesses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `harnesses_name_unique` ON `harnesses` (`name`);--> statement-breakpoint
CREATE TABLE `score_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`experiment_model_id` integer NOT NULL,
	`run_id` integer NOT NULL,
	`score` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`experiment_model_id`) REFERENCES `experiment_models`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `submission_batches` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`experiment_model_id` integer NOT NULL,
	`status` text NOT NULL,
	`call_count` integer NOT NULL,
	`run_results_before` integer NOT NULL,
	`result_ids` text,
	`error` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`experiment_model_id`) REFERENCES `experiment_models`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `worker_heartbeat` (
	`id` integer PRIMARY KEY NOT NULL,
	`pid` integer NOT NULL,
	`beat_at` integer NOT NULL
);
