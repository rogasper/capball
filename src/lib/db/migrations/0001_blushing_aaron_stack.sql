ALTER TABLE `events` ADD `anchor_ms` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `videos` ADD `faststart` integer;--> statement-breakpoint
-- Events captured before this column existed used the fixed 8 s pre-roll that
-- shipped with the capture engine and could not be changed, so the tagged
-- moment is recoverable exactly rather than approximately.
UPDATE `events` SET `anchor_ms` = `start_ms` + 8000 WHERE `anchor_ms` = 0;