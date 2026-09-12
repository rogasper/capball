-- R1 rebuilds `annotations` (FR-20).
--
-- R0 reserved this table for telestration and never wrote a row to it — nothing
-- in the codebase referenced it outside the schema, so recreating it is honest
-- rather than destructive. The reserved shape shared nothing with what a shape
-- needs: geometry is normalised and heterogeneous, style is separate from
-- geometry, and the time window is a mode rather than a single moment. Carrying
-- `t_ms` and `data_json` forward would have meant four dead columns forever.
--
-- Drizzle Kit could not emit this diff non-interactively: it sees a renamed
-- column set and asks, per column, whether to rename or to add and drop. Because
-- the table is provably empty, the answer is neither — so this file is written
-- by hand and will never be regenerated. `meta/0002_snapshot.json` was updated
-- to match, so the next `bun run db:generate` diffs from the right state.
--
-- Every statement is idempotent on purpose. The runner executes a file statement
-- by statement and records it only after the last one succeeds, so an
-- interruption leaves the file unrecorded and it is retried on the next launch.
-- A plain `DROP TABLE` would then fail forever on the already-dropped table and
-- the app could not open its library at all — which is exactly what happened once
-- during development. `IF EXISTS` / `IF NOT EXISTS` make the retry a recovery.
DROP TABLE IF EXISTS `annotations`;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `annotations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`uid` text NOT NULL,
	`event_id` integer NOT NULL,
	`kind` text NOT NULL,
	`window_mode` text DEFAULT 'moment' NOT NULL,
	`window_ms` integer DEFAULT 2500 NOT NULL,
	`geometry_json` text NOT NULL,
	`style_json` text NOT NULL,
	`label` text,
	`z` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `annotations_uid_unique` ON `annotations` (`uid`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `annotations_event_idx` ON `annotations` (`event_id`);
