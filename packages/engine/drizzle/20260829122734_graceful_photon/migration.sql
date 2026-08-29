CREATE TABLE `projection_checkpoints` (
	`investigation_id` text NOT NULL,
	`projection_id` text NOT NULL,
	`projection_version` integer NOT NULL,
	`last_sequence` integer NOT NULL,
	`state_json` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT `projection_checkpoints_pk` PRIMARY KEY(`investigation_id`, `projection_id`),
	CONSTRAINT `fk_projection_checkpoints_investigation_id_investigations_id_fk` FOREIGN KEY (`investigation_id`) REFERENCES `investigations`(`id`)
);
