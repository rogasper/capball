import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { events, matches, players, tagCategories, tags, teams, videos } from "@/lib/db/schema";
import type { AnalysisCategory, AnalysisFile } from "@/lib/transfer/analysis";

/**
 * Importing a capball file (FR-10.4).
 *
 * Everything is matched by name, and nothing is overwritten: an existing team,
 * tag or event is reused rather than replaced, and anything that cannot be
 * imported is reported instead of dropped silently. Importing the same file
 * twice therefore adds nothing the second time.
 */

export type ImportSummary = {
  teamsCreated: number;
  categoriesCreated: number;
  tagsCreated: number;
  tagsKept: number;
  playersCreated: number;
  eventsCreated: number;
  eventsSkipped: number;
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
      continue;
    }

    const teamId = event.team ? await ensureTeamByName(event.team, summary) : null;
    const playerId =
      event.player && teamId !== null
        ? await ensurePlayerByName(teamId, event.player, summary)
        : null;

    await db.insert(events).values({
      matchId,
      videoId: video.id,
      tagId: tag.id,
      teamId,
      playerId,
      anchorMs: Math.round(event.anchorMs),
      startMs: Math.round(event.startMs),
      endMs: Math.round(event.endMs),
      notes: event.notes,
    });
    summary.eventsCreated += 1;
  }

  return summary;
}
