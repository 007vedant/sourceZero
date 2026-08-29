CREATE TABLE `artifacts` (
	`id` text PRIMARY KEY,
	`algorithm` text NOT NULL,
	`media_type` text NOT NULL,
	`byte_length` integer NOT NULL,
	`created_at` text NOT NULL,
	`retention_class` text NOT NULL,
	`relative_location` text NOT NULL UNIQUE,
	`format_version` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `investigation_events` (
	`investigation_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`event_id` text NOT NULL,
	`type` text NOT NULL,
	`occurred_at` text NOT NULL,
	`schema_version` integer NOT NULL,
	`producer_json` text NOT NULL,
	`causation_id` text,
	`correlation_id` text,
	`data_json` text NOT NULL,
	CONSTRAINT `investigation_events_pk` PRIMARY KEY(`investigation_id`, `sequence`),
	CONSTRAINT `fk_investigation_events_investigation_id_investigations_id_fk` FOREIGN KEY (`investigation_id`) REFERENCES `investigations`(`id`)
);
--> statement-breakpoint
CREATE TABLE `investigations` (
	`id` text PRIMARY KEY,
	`format_version` integer NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`last_sequence` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `investigation_events_event_id_unique` ON `investigation_events` (`event_id`);