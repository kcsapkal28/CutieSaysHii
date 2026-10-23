CREATE TABLE `events` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` text NOT NULL,
	`type` text NOT NULL,
	`stage` text,
	`at` integer NOT NULL,
	`payload_json` text NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `events_job_seq_idx` ON `events` (`job_id`,`seq`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`brief_json` text NOT NULL,
	`choices_json` text NOT NULL,
	`owner_id` text NOT NULL,
	`heartbeat_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`error_json` text,
	`usage_json` text NOT NULL,
	`dist_dir` text
);
--> statement-breakpoint
CREATE INDEX `jobs_created_at_idx` ON `jobs` (`created_at`);--> statement-breakpoint
CREATE INDEX `jobs_status_idx` ON `jobs` (`status`);--> statement-breakpoint
CREATE TABLE `stages` (
	`job_id` text NOT NULL,
	`stage` text NOT NULL,
	`iteration` integer NOT NULL,
	`status` text NOT NULL,
	`input_hash` text NOT NULL,
	`artifact_path` text,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`duration_ms` integer,
	`backoff_ms` integer NOT NULL,
	`attempts` integer NOT NULL,
	`usage_json` text NOT NULL,
	`summary_json` text,
	`error_json` text,
	PRIMARY KEY(`job_id`, `stage`, `iteration`),
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
