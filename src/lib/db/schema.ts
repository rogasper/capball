import { sql } from "drizzle-orm";
import {
  type AnySQLiteColumn,
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/**
 * The capball library schema (plans/technical-design.md §7).
 *
 * Times that describe footage are integer milliseconds (`_ms`); bookkeeping
 * timestamps are Unix seconds. Foreign keys cascade where the domain says a
 * child cannot outlive its parent, and foreign key enforcement is on because
 * sqlx enables `PRAGMA foreign_keys` by default.
 */

const createdAt = integer("created_at").notNull().default(sql`(unixepoch())`);

export const teams = sqliteTable(
  "teams",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    shortName: text("short_name"),
    color: text("color"),
    createdAt,
  },
  (table) => [uniqueIndex("teams_name_unique").on(table.name)],
);

export const players = sqliteTable(
  "players",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    teamId: integer("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    shirtNumber: integer("shirt_number"),
    position: text("position"),
    createdAt,
  },
  (table) => [
    uniqueIndex("players_team_name_unique").on(table.teamId, table.name),
    index("players_team_idx").on(table.teamId),
  ],
);

export const matches = sqliteTable(
  "matches",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    homeTeamId: integer("home_team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "restrict" }),
    awayTeamId: integer("away_team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "restrict" }),
    competition: text("competition"),
    season: text("season"),
    kickoffAt: integer("kickoff_at"),
    venue: text("venue"),
    notes: text("notes"),
    createdAt,
    updatedAt: integer("updated_at").notNull().default(sql`(unixepoch())`),
  },
  (table) => [index("matches_kickoff_idx").on(table.kickoffAt)],
);

export const videos = sqliteTable(
  "videos",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    matchId: integer("match_id")
      .notNull()
      .references(() => matches.id, { onDelete: "cascade" }),
    /** Where the user's file lives. */
    path: text("path").notNull(),
    /** A prepared copy in the app cache, when the original cannot be played. */
    playbackPath: text("playback_path"),
    /**
     * Whether the index (`moov`) precedes the media data (`mdat`). Null when it
     * does not apply, or when the file was imported before this was recorded.
     * With the index at the end, seeking is slow over a protocol that serves
     * small byte ranges.
     */
    faststart: integer("faststart", { mode: "boolean" }),
    fileName: text("file_name").notNull(),
    sizeBytes: integer("size_bytes"),
    durationMs: integer("duration_ms").notNull().default(0),
    width: integer("width"),
    height: integer("height"),
    fpsNum: integer("fps_num"),
    fpsDen: integer("fps_den"),
    videoCodec: text("video_codec"),
    audioCodec: text("audio_codec"),
    container: text("container"),
    createdAt,
  },
  (table) => [index("videos_match_idx").on(table.matchId)],
);

export const tagCategories = sqliteTable(
  "tag_categories",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    color: text("color"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt,
  },
  (table) => [uniqueIndex("tag_categories_name_unique").on(table.name)],
);

export const tags = sqliteTable(
  "tags",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    categoryId: integer("category_id")
      .notNull()
      .references(() => tagCategories.id, { onDelete: "cascade" }),
    parentId: integer("parent_id").references((): AnySQLiteColumn => tags.id, {
      onDelete: "cascade",
    }),
    name: text("name").notNull(),
    color: text("color"),
    /** The key that creates an event with this tag; unique across the taxonomy. */
    shortcutKey: text("shortcut_key"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt,
  },
  (table) => [
    uniqueIndex("tags_shortcut_unique").on(table.shortcutKey),
    index("tags_category_idx").on(table.categoryId),
    index("tags_parent_idx").on(table.parentId),
  ],
);

export const events = sqliteTable(
  "events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    matchId: integer("match_id")
      .notNull()
      .references(() => matches.id, { onDelete: "cascade" }),
    videoId: integer("video_id")
      .notNull()
      .references(() => videos.id, { onDelete: "cascade" }),
    /** Deleting a tag deletes its events — decided in PRD OQ-6. */
    tagId: integer("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
    teamId: integer("team_id").references(() => teams.id, { onDelete: "set null" }),
    playerId: integer("player_id").references(() => players.id, { onDelete: "set null" }),
    /**
     * The moment the user actually tagged. `startMs` and `endMs` are the clip
     * range around it, so without this the moment would be lost the moment the
     * pre-roll or post-roll defaults changed.
     */
    anchorMs: integer("anchor_ms").notNull().default(0),
    startMs: integer("start_ms").notNull(),
    endMs: integer("end_ms").notNull(),
    notes: text("notes"),
    createdAt,
    updatedAt: integer("updated_at").notNull().default(sql`(unixepoch())`),
  },
  (table) => [
    index("events_match_start_idx").on(table.matchId, table.startMs),
    index("events_tag_idx").on(table.tagId),
    index("events_team_idx").on(table.teamId),
  ],
);

export const clips = sqliteTable(
  "clips",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    eventId: integer("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    startMs: integer("start_ms").notNull(),
    endMs: integer("end_ms").notNull(),
    status: text("status").notNull().default("pending"),
    error: text("error"),
    createdAt,
  },
  (table) => [index("clips_event_idx").on(table.eventId)],
);

/**
 * A shape drawn on an event (R1, FR-20).
 *
 * Geometry is normalised to the video's content rect, not to the window, and
 * points are stored inside the shape's own box (technical-design-R1 §5.3).
 * `window_mode` is stored rather than resolved times because `'event'` must
 * follow the event's range if it is edited and `'clip'` cannot be resolved
 * until export time.
 */
export const annotations = sqliteTable(
  "annotations",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** Client-generated identity, which is what makes transfer idempotent. */
    uid: text("uid").notNull(),
    eventId: integer("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    /** `moment` | `event` | `clip`. */
    windowMode: text("window_mode").notNull().default("moment"),
    /** Duration used when the mode is `moment`. */
    windowMs: integer("window_ms").notNull().default(2500),
    geometryJson: text("geometry_json").notNull(),
    styleJson: text("style_json").notNull(),
    /** Text content for a text shape, or a label for a zone. */
    label: text("label"),
    /** Paint order: the layers panel shows this order, front to back. */
    z: integer("z").notNull().default(0),
    createdAt,
    updatedAt: integer("updated_at").notNull().default(sql`(unixepoch())`),
  },
  (table) => [
    uniqueIndex("annotations_uid_unique").on(table.uid),
    index("annotations_event_idx").on(table.eventId),
  ],
);

/**
 * A calibration: where the pitch is in this video (R1, FR-30.1).
 *
 * The reference points are the record, not the matrix — the homography is
 * derived at runtime, so a better model later can be fitted from the same clicks
 * without asking the user to pick again (technical-design-R1 D19).
 */
export const calibrations = sqliteTable(
  "calibrations",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    videoId: integer("video_id")
      .notNull()
      .references(() => videos.id, { onDelete: "cascade" }),
    /** The moment this calibration applies from, so a second one can start mid-video (OQ-4). */
    fromMs: integer("from_ms").notNull().default(0),
    pitchLengthM: real("pitch_length_m").notNull().default(105),
    pitchWidthM: real("pitch_width_m").notNull().default(68),
    /** RMS reprojection error of the fit, in video pixels. */
    rmsErrorPx: real("rms_error_px").notNull().default(0),
    createdAt,
  },
  (table) => [
    uniqueIndex("calibrations_video_from_unique").on(table.videoId, table.fromMs),
    index("calibrations_video_idx").on(table.videoId),
  ],
);

/** A reference point: which named pitch feature was clicked, and where. */
export const calibrationPoints = sqliteTable(
  "calibration_points",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    calibrationId: integer("calibration_id")
      .notNull()
      .references(() => calibrations.id, { onDelete: "cascade" }),
    /** The feature's stable key, e.g. `right-penalty-spot`. */
    feature: text("feature").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    /** Normalised to the frame, like every other stored coordinate. */
    imageU: real("image_u").notNull(),
    imageV: real("image_v").notNull(),
    /** The feature's real position, in metres from the centre of the pitch. */
    xM: real("x_m").notNull(),
    yM: real("y_m").notNull(),
    createdAt,
  },
  (table) => [index("calibration_points_calibration_idx").on(table.calibrationId)],
);

/**
 * Where a player was, at the moment of an event (R1, FR-30.3).
 *
 * The pitch coordinates are what the user asserted, and the click is kept beside
 * them as provenance: a calibration change must never silently reinterpret a
 * stored position (FR-30.2), so `xM`/`yM` are neither derived on read nor
 * rewritten when the calibration is adjusted.
 *
 * There is no `t_ms`: a position belongs to its event and uses the event's
 * anchor, which keeps it with the moment if that moment is corrected. One
 * position per player per event is enforced by the unique index.
 */
export const positions = sqliteTable(
  "positions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** Client-generated identity, which is what makes transfer idempotent. */
    uid: text("uid").notNull(),
    eventId: integer("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    playerId: integer("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    /**
     * The team as it was on the day. A player can move clubs, and the shape of a
     * play must stay what it was rather than following a later transfer.
     */
    teamId: integer("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    /** Which calibration produced this, or null if that calibration was deleted. */
    calibrationId: integer("calibration_id").references(() => calibrations.id, {
      onDelete: "set null",
    }),
    /** The clicked point, normalised to the frame, kept for provenance. */
    imageU: real("image_u").notNull(),
    imageV: real("image_v").notNull(),
    /** The position on the pitch, in metres from the centre. */
    xM: real("x_m").notNull(),
    yM: real("y_m").notNull(),
    createdAt,
  },
  (table) => [
    uniqueIndex("positions_uid_unique").on(table.uid),
    uniqueIndex("positions_event_player_unique").on(table.eventId, table.playerId),
    index("positions_event_idx").on(table.eventId),
  ],
);

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});
