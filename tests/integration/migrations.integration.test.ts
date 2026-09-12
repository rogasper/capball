import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

/**
 * Migrations run once, against data that already exists, so they get their own
 * test rather than being covered incidentally by the query tests.
 *
 * The harness applies every migration to an empty database, which means a
 * backfill like the one in 0001 would never actually touch a row. Here the
 * migrations are applied one at a time, with a legacy row in between.
 */

const dir = join(process.cwd(), "src/lib/db/migrations");
const files = readdirSync(dir)
  .filter((name) => name.endsWith(".sql"))
  .sort();

function apply(db: DatabaseSync, file: string): void {
  const body = readFileSync(join(dir, file), "utf8");
  for (const statement of body.split("--> statement-breakpoint")) {
    const trimmed = statement.trim();
    if (trimmed) db.exec(trimmed);
  }
}

function freshDatabase(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  return db;
}

const LEGACY_EVENT = `
  INSERT INTO teams (id, name) VALUES (1, 'Manchester United'), (2, 'Sabah');
  INSERT INTO matches (id, home_team_id, away_team_id) VALUES (1, 1, 2);
  INSERT INTO videos (id, match_id, path, file_name, duration_ms)
    VALUES (1, 1, '/x.mp4', 'x.mp4', 861737);
  INSERT INTO tag_categories (id, name) VALUES (1, 'DEFENSE');
  INSERT INTO tags (id, category_id, name, shortcut_key) VALUES (1, 1, 'High Press', '1');
  INSERT INTO events (id, match_id, video_id, tag_id, start_ms, end_ms)
    VALUES (1, 1, 1, 1, 30134, 50134);
`;

describe("migrations", () => {
  it("ships at least the two we expect, in order", () => {
    expect(files.length).toBeGreaterThanOrEqual(2);
    expect(files[0]).toMatch(/^0000_/);
    expect(files[1]).toMatch(/^0001_/);
  });

  it("recovers the tagged moment for events captured before the column existed", () => {
    const db = freshDatabase();
    apply(db, files[0] as string);
    db.exec(LEGACY_EVENT);

    apply(db, files[1] as string);

    const row = db.prepare("SELECT anchor_ms, start_ms FROM events WHERE id = 1").get() as {
      anchor_ms: number;
      start_ms: number;
    };
    // 30.134 s was the 8 s before the moment, and the pre-roll could not be
    // changed at the time, so the moment is exactly recoverable.
    expect(row.start_ms).toBe(30_134);
    expect(row.anchor_ms).toBe(38_134);
  });

  it("leaves older rows unchecked for the index placement, so they are probed once", () => {
    const db = freshDatabase();
    apply(db, files[0] as string);
    db.exec(LEGACY_EVENT);

    apply(db, files[1] as string);

    const row = db.prepare("SELECT faststart FROM videos WHERE id = 1").get() as {
      faststart: number | null;
    };
    // Null is meaningful: it means "not known yet", which triggers one probe
    // when the match is next opened.
    expect(row.faststart).toBeNull();
  });

  it("adds the anchor as required, defaulting new rows to zero rather than null", () => {
    const db = freshDatabase();
    apply(db, files[0] as string);
    apply(db, files[1] as string);
    db.exec(LEGACY_EVENT);

    const row = db.prepare("SELECT anchor_ms FROM events WHERE id = 1").get() as {
      anchor_ms: number;
    };
    // The backfill only rewrites rows that are still zero, so a fresh insert
    // keeps its explicit value and nothing is silently overwritten.
    expect(row.anchor_ms).toBe(0);
  });
});
