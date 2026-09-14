import { and, eq } from "drizzle-orm";
import { DEFAULT_STYLE, isGeometry, isShapeKind, isWindowMode } from "@/lib/annotate/types";
import { db } from "@/lib/db/client";
import { setAnnotationWindow } from "@/lib/db/queries/annotations";
import {
  annotations,
  calibrationPoints,
  calibrations,
  events,
  matches,
  players,
  positions,
  tagCategories,
  tags,
  teams,
  videos,
} from "@/lib/db/schema";
import {
  type AnalysisCategory,
  type AnalysisFile,
  eventKeyOf,
  parseEventKey,
} from "@/lib/transfer/analysis";

/**
 * Importing a capball file (FR-10.4, FR-40.3).
 *
 * Everything is matched by name, and nothing is overwritten: an existing team,
 * tag or event is reused rather than replaced, and anything that cannot be
 * imported is reported instead of dropped silently. Importing the same file
 * twice therefore adds nothing the second time.
 *
 * From version 2 the file also carries drawings, positions and calibrations.
 * Drawings and positions are idempotent by their client-generated `uid` — the
 * reason that column exists (D21) — so a repeated import is a no-op rather than
 * a second copy. A calibration has no uid, so the natural key does the job: one
 * calibration per video per start time, which is the unique index.
 */

export type ImportSummary = {
  teamsCreated: number;
  categoriesCreated: number;
  tagsCreated: number;
  tagsKept: number;
  playersCreated: number;
  eventsCreated: number;
  eventsSkipped: number;
  calibrationsCreated: number;
  calibrationsSkipped: number;
  annotationsCreated: number;
  annotationsSkipped: number;
  positionsCreated: number;
  positionsSkipped: number;
  matchId: number | null;
  notes: string[];
};

const emptySummary = (): ImportSummary => ({
  teamsCreated: 0,
  categoriesCreated: 0,
  tagsCreated: 0,
  tagsKept: 0,
  playersCreated: 0,
  eventsCreated: 0,
  eventsSkipped: 0,
  calibrationsCreated: 0,
  calibrationsSkipped: 0,
  annotationsCreated: 0,
  annotationsSkipped: 0,
  positionsCreated: 0,
  positionsSkipped: 0,
  matchId: null,
  notes: [],
});

async function ensureTeamByName(name: string, summary: ImportSummary): Promise<number> {
  const existing = await db.select().from(teams).where(eq(teams.name, name)).limit(1);
  if (existing[0]) return existing[0].id;

  const [row] = await db.insert(teams).values({ name }).returning({ id: teams.id });
  summary.teamsCreated += 1;
  return row.id;
}

async function ensurePlayerByName(
  teamId: number,
  name: string,
  summary: ImportSummary,
): Promise<number | null> {
  const existing = await db
    .select()
    .from(players)
    .where(and(eq(players.teamId, teamId), eq(players.name, name)))
    .limit(1);
  if (existing[0]) return existing[0].id;

  const [row] = await db.insert(players).values({ teamId, name }).returning({ id: players.id });
  summary.playersCreated += 1;
  return row.id;
}

/** Merges a taxonomy, keeping whatever the user already has (FR-10.4). */
export async function mergeTaxonomy(
  taxonomy: AnalysisCategory[],
  summary: ImportSummary = emptySummary(),
): Promise<ImportSummary> {
  for (const category of taxonomy) {
    let categoryId: number;

    const existingCategory = await db
      .select()
      .from(tagCategories)
      .where(eq(tagCategories.name, category.name))
      .limit(1);
    if (existingCategory[0]) {
      categoryId = existingCategory[0].id;
    } else {
      const [row] = await db
        .insert(tagCategories)
        .values({ name: category.name, color: category.color })
        .returning({ id: tagCategories.id });
      categoryId = row.id;
      summary.categoriesCreated += 1;
    }

    const byName = new Map<string, number>();

    for (const tag of category.tags) {
      const existingTag = await db
        .select()
        .from(tags)
        .where(and(eq(tags.categoryId, categoryId), eq(tags.name, tag.name)))
        .limit(1);

      if (existingTag[0]) {
        byName.set(tag.name, existingTag[0].id);
        summary.tagsKept += 1;
        continue;
      }

      // A shortcut key only travels if nothing here already uses it.
      let shortcutKey: string | null = tag.shortcutKey;
      if (shortcutKey) {
        const clash = await db
          .select()
          .from(tags)
          .where(eq(tags.shortcutKey, shortcutKey))
          .limit(1);
        if (clash[0]) {
          shortcutKey = null;
          summary.notes.push(
            `Key ${tag.shortcutKey} for "${tag.name}" is already taken here, so it arrived unbound.`,
          );
        }
      }

      const [row] = await db
        .insert(tags)
        .values({ categoryId, name: tag.name, color: tag.color, shortcutKey })
        .returning({ id: tags.id });
      byName.set(tag.name, row.id);
      summary.tagsCreated += 1;
    }

    // Nesting is applied after every tag exists, so order in the file is free.
    for (const tag of category.tags) {
      if (!tag.parent) continue;
      const parentId = byName.get(tag.parent);
      const tagId = byName.get(tag.name);
      if (parentId && tagId) {
        await db.update(tags).set({ parentId }).where(eq(tags.id, tagId));
      }
    }
  }

  return summary;
}

export async function importAnalysis(file: AnalysisFile): Promise<ImportSummary> {
  const summary = await mergeTaxonomy(file.taxonomy);

  const homeTeamId = await ensureTeamByName(file.match.homeTeam, summary);
  const awayTeamId = await ensureTeamByName(file.match.awayTeam, summary);

  const existingMatch = await db
    .select()
    .from(matches)
    .where(and(eq(matches.homeTeamId, homeTeamId), eq(matches.awayTeamId, awayTeamId)))
    .limit(1);

  let matchId: number;
  if (existingMatch[0]) {
    matchId = existingMatch[0].id;
    summary.notes.push("That match is already here; its events were merged into it.");
  } else {
    const [row] = await db
      .insert(matches)
      .values({
        homeTeamId,
        awayTeamId,
        competition: file.match.competition,
        season: file.match.season,
        kickoffAt: file.match.kickoffAt,
        venue: file.match.venue,
        notes: file.match.notes,
      })
      .returning({ id: matches.id });
    matchId = row.id;
  }
  summary.matchId = matchId;

  // Events need a video, and a path from another machine is meaningless, so the
  // video is looked up by file name across the library.
  const libraryVideos = await db.select().from(videos);
  const videoByName = new Map(libraryVideos.map((video) => [video.fileName, video]));

  const allTags = await db.select().from(tags);

  // eventKey → row id, so the drawings and positions that follow can find their
  // event whether it was created just now or was already here.
  const eventIds = new Map<string, number>();

  for (const event of file.events) {
    const video = videoByName.get(event.videoFileName);
    if (!video) {
      summary.eventsSkipped += 1;
      summary.notes.push(
        `Skipped ${event.tag} at ${Math.round(event.anchorMs / 1000)}s: ${event.videoFileName || "its video"} is not in the library yet. Add the video, then import again.`,
      );
      continue;
    }

    const tag = allTags.find((candidate) => candidate.name === event.tag);
    if (!tag) {
      summary.eventsSkipped += 1;
      continue;
    }

    const key = eventKeyOf(event.videoFileName, event.tag, event.anchorMs);

    // Idempotence: the same tag at the same moment on the same video is the
    // same event, so a repeated import does not duplicate it.
    const duplicate = await db
      .select({ id: events.id })
      .from(events)
      .where(
        and(
          eq(events.videoId, video.id),
          eq(events.tagId, tag.id),
          eq(events.anchorMs, Math.round(event.anchorMs)),
        ),
      )
      .limit(1);
    if (duplicate[0]) {
      summary.eventsSkipped += 1;
      eventIds.set(key, duplicate[0].id);
      continue;
    }

    const teamId = event.team ? await ensureTeamByName(event.team, summary) : null;
    const playerId =
      event.player && teamId !== null
        ? await ensurePlayerByName(teamId, event.player, summary)
        : null;

    const [row] = await db
      .insert(events)
      .values({
        matchId,
        videoId: video.id,
        tagId: tag.id,
        teamId,
        playerId,
        anchorMs: Math.round(event.anchorMs),
        startMs: Math.round(event.startMs),
        endMs: Math.round(event.endMs),
        notes: event.notes,
      })
      .returning({ id: events.id });
    summary.eventsCreated += 1;
    eventIds.set(key, row.id);
  }

  await importCalibrations(file, videoByName, summary);
  await importAnnotations(file, eventIds, summary);
  await importPositions(file, eventIds, summary);

  return summary;
}

async function importCalibrations(
  file: AnalysisFile,
  videoByName: Map<string, typeof videos.$inferSelect>,
  summary: ImportSummary,
): Promise<void> {
  for (const calibration of file.calibrations) {
    const video = videoByName.get(calibration.videoFileName);
    if (!video) {
      summary.calibrationsSkipped += 1;
      summary.notes.push(
        `Skipped a pitch calibration: ${calibration.videoFileName || "its video"} is not in the library yet.`,
      );
      continue;
    }

    const fromMs = Math.round(calibration.fromMs);
    const existing = await db
      .select({ id: calibrations.id })
      .from(calibrations)
      .where(and(eq(calibrations.videoId, video.id), eq(calibrations.fromMs, fromMs)))
      .limit(1);
    if (existing[0]) {
      summary.calibrationsSkipped += 1;
      continue;
    }

    const [row] = await db
      .insert(calibrations)
      .values({
        videoId: video.id,
        fromMs,
        pitchLengthM: calibration.pitchLengthM,
        pitchWidthM: calibration.pitchWidthM,
        rmsErrorPx: calibration.rmsErrorPx,
      })
      .returning({ id: calibrations.id });

    if (calibration.points.length > 0) {
      await db.insert(calibrationPoints).values(
        calibration.points.map((point, index) => ({
          calibrationId: row.id,
          feature: point.feature,
          sortOrder: index,
          imageU: point.imageU,
          imageV: point.imageV,
          xM: point.xM,
          yM: point.yM,
        })),
      );
    }
    summary.calibrationsCreated += 1;
  }
}

async function importAnnotations(
  file: AnalysisFile,
  eventIds: Map<string, number>,
  summary: ImportSummary,
): Promise<void> {
  for (const annotation of file.annotations) {
    if (!isShapeKind(annotation.kind) || !isWindowMode(annotation.windowMode)) {
      summary.annotationsSkipped += 1;
      continue;
    }
    if (!isGeometry(annotation.geometry)) {
      summary.annotationsSkipped += 1;
      summary.notes.push(`Skipped a ${annotation.kind} drawing: its geometry is not readable.`);
      continue;
    }

    const existing = await db
      .select({ id: annotations.id })
      .from(annotations)
      .where(eq(annotations.uid, annotation.uid))
      .limit(1);
    if (existing[0]) {
      summary.annotationsSkipped += 1;
      continue;
    }

    const key = parseEventKey(annotation.eventKey);
    const eventId = key
      ? eventIds.get(eventKeyOf(key.videoFileName, key.tag, key.anchorMs))
      : undefined;
    if (eventId === undefined) {
      summary.annotationsSkipped += 1;
      summary.notes.push("Skipped a drawing: the moment it belongs to is not in the library.");
      continue;
    }

    const [created] = await db
      .insert(annotations)
      .values({
        uid: annotation.uid,
        eventId,
        kind: annotation.kind,
        windowMode: annotation.windowMode,
        windowMs: Math.round(annotation.windowMs),
        geometryJson: JSON.stringify(annotation.geometry),
        styleJson: JSON.stringify({ ...DEFAULT_STYLE, ...annotation.style }),
        label: annotation.label,
        z: annotation.z,
      })
      .returning({ id: annotations.id });

    // A drawing's own range travels with it (FR-20.16). Read defensively: an
    // older file has no such field, and a malformed one must not fail the import
    // of the drawing it belongs to.
    const own = annotation.ownWindow;
    if (
      created?.id !== undefined &&
      own &&
      Number.isFinite(own.startMs) &&
      Number.isFinite(own.endMs)
    ) {
      await setAnnotationWindow(created.id, own.startMs, own.endMs);
    }

    summary.annotationsCreated += 1;
  }
}

async function importPositions(
  file: AnalysisFile,
  eventIds: Map<string, number>,
  summary: ImportSummary,
): Promise<void> {
  for (const position of file.positions) {
    const existing = await db
      .select({ id: positions.id })
      .from(positions)
      .where(eq(positions.uid, position.uid))
      .limit(1);
    if (existing[0]) {
      summary.positionsSkipped += 1;
      continue;
    }

    const key = parseEventKey(position.eventKey);
    const eventId = key
      ? eventIds.get(eventKeyOf(key.videoFileName, key.tag, key.anchorMs))
      : undefined;
    if (eventId === undefined) {
      summary.positionsSkipped += 1;
      continue;
    }

    const teamId = await ensureTeamByName(position.teamName, summary);
    const playerId = await ensurePlayerByName(teamId, position.playerName, summary);
    if (playerId === null) {
      summary.positionsSkipped += 1;
      continue;
    }

    // One player has one position at one event; a second is a correction, not a
    // new row, so the unique index is what decides this rather than an error.
    const clash = await db
      .select({ id: positions.id })
      .from(positions)
      .where(and(eq(positions.eventId, eventId), eq(positions.playerId, playerId)))
      .limit(1);
    if (clash[0]) {
      summary.positionsSkipped += 1;
      continue;
    }

    await db.insert(positions).values({
      uid: position.uid,
      eventId,
      playerId,
      teamId,
      calibrationId: null,
      imageU: position.imageU,
      imageV: position.imageV,
      xM: position.xM,
      yM: position.yM,
    });
    summary.positionsCreated += 1;
  }
}
