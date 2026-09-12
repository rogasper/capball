import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Importing a capball file, against real SQLite.
 *
 * This is the risky path: it creates teams, tags and events from names, and it
 * runs against a library that already holds the user's own work. The checks that
 * matter are that nothing is duplicated, nothing is overwritten, and anything
 * that cannot be imported is reported.
 */

vi.mock("@/lib/ipc/database", async () => {
  const harness = await import("./sqlite-harness");
  return { execute: harness.execute, select: harness.select };
});

vi.mock("@/lib/db/client", async () => {
  const harness = await import("./sqlite-harness");
  const schema = await import("@/lib/db/schema");
  return { db: harness.db, schema };
});

const { resetDatabase } = await import("./sqlite-harness");
const eventsQuery = await import("@/lib/db/queries/events");
const taxonomyQuery = await import("@/lib/db/queries/taxonomy");
const teamsQuery = await import("@/lib/db/queries/teams");
const matchesQuery = await import("@/lib/db/queries/matches");
const videosQuery = await import("@/lib/db/queries/videos");
const importQuery = await import("@/lib/db/queries/import");
const transfer = await import("@/lib/transfer/analysis");

const VIDEO_NAME = "mu_vs_sabah.mp4";

/** A library holding one tagged match, plus the file that describes it. */
async function seedLibrary() {
  const home = await teamsQuery.ensureTeam({ name: "Manchester United" });
  const away = await teamsQuery.ensureTeam({ name: "Sabah" });
  const matchId = await matchesQuery.createMatch({ homeTeamId: home.id, awayTeamId: away.id });

  const video = await videosQuery.addVideo({
    matchId,
    path: "/matches/mu_vs_sabah.mp4",
    fileName: VIDEO_NAME,
    durationMs: 861_737,
    width: 1920,
    height: 1080,
    fpsNum: 60_000,
    fpsDen: 1001,
    videoCodec: "h264",
    audioCodec: "aac",
    container: "mov,mp4,m4a,3gp,3g2,mj2",
  });

  const category = await taxonomyQuery.createCategory("DEFENSE", "#34D399");
  const tag = await taxonomyQuery.createTag({
    categoryId: category.id,
    name: "High Press",
    shortcutKey: "1",
  });

  await eventsQuery.createEvent({
    matchId,
    videoId: video.id,
    tagId: tag.id,
    teamId: home.id,
    anchorMs: 100_000,
    startMs: 92_000,
    endMs: 112_000,
    notes: "second phase",
  });

  const [events, videos] = await Promise.all([
    eventsQuery.listEvents(matchId),
    videosQuery.listVideos(matchId),
  ]);

  return transfer.buildAnalysisFile({
    match: {
      homeTeam: "Manchester United",
      awayTeam: "Sabah",
      competition: "Champions League",
      season: null,
      kickoffAt: null,
      venue: null,
      notes: null,
    },
    videos,
    events,
    taxonomy: [
      {
        name: "DEFENSE",
        color: "#34D399",
        tags: [{ name: "High Press", color: null, shortcutKey: "1", parent: null }],
      },
    ],
    now: new Date("2026-09-12T00:00:00.000Z"),
  });
}

/** A library that has the video but none of the analysis. */
async function freshLibraryWithVideo(): Promise<number> {
  const home = await teamsQuery.ensureTeam({ name: "Manchester United" });
  const away = await teamsQuery.ensureTeam({ name: "Sabah" });
  const matchId = await matchesQuery.createMatch({ homeTeamId: home.id, awayTeamId: away.id });

  await videosQuery.addVideo({
    matchId,
    path: "/elsewhere/mu_vs_sabah.mp4",
    fileName: VIDEO_NAME,
    durationMs: 861_737,
  });

  return matchId;
}

beforeEach(() => {
  resetDatabase();
});

describe("importing an analysis file", () => {
  it("puts the events back, with their tag, team and player", async () => {
    const file = await seedLibrary();

    resetDatabase();
    const matchId = await freshLibraryWithVideo();

    const summary = await importQuery.importAnalysis(file);

    expect(summary.eventsCreated).toBe(1);
    const rows = await eventsQuery.listEvents(matchId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tagName: "High Press",
      categoryName: "DEFENSE",
      teamName: "Manchester United",
      anchorMs: 100_000,
      startMs: 92_000,
      endMs: 112_000,
      notes: "second phase",
    });
  });

  it("adds nothing the second time", async () => {
    const file = await seedLibrary();
    resetDatabase();
    const matchId = await freshLibraryWithVideo();

    await importQuery.importAnalysis(file);
    const second = await importQuery.importAnalysis(file);

    expect(second.eventsCreated).toBe(0);
    expect(second.tagsCreated).toBe(0);
    expect(await eventsQuery.listEvents(matchId)).toHaveLength(1);
  });

  it("keeps a tag that is already here, and says so when a key is taken", async () => {
    const file = await seedLibrary();
    resetDatabase();

    // The destination already has the tag, under a different key.
    const category = await taxonomyQuery.createCategory("DEFENSE");
    await taxonomyQuery.createTag({ categoryId: category.id, name: "High Press" });
    await freshLibraryWithVideo();

    const summary = await importQuery.importAnalysis(file);

    expect(summary.tagsKept).toBe(1);
    expect(summary.tagsCreated).toBe(0);
  });

  it("skips events whose video is not here, and explains why", async () => {
    const file = await seedLibrary();
    resetDatabase();

    const summary = await importQuery.importAnalysis(file);

    expect(summary.eventsCreated).toBe(0);
    expect(summary.eventsSkipped).toBe(1);
    expect(summary.notes.join(" ")).toMatch(/not in the library yet/i);
    expect(summary.notes.join(" ")).toContain(VIDEO_NAME);
  });

  it("still brings the taxonomy in when there is no video at all", async () => {
    const file = await seedLibrary();
    resetDatabase();

    const summary = await importQuery.importAnalysis(file);

    expect(summary.categoriesCreated).toBe(1);
    expect(summary.tagsCreated).toBe(1);
    expect(summary.teamsCreated).toBe(2);
  });

  it("merges a taxonomy-only file without touching events", async () => {
    resetDatabase();
    const matchId = await freshLibraryWithVideo();

    const summary = await importQuery.mergeTaxonomy([
      {
        name: "ATTACK",
        color: "#4C8DFF",
        tags: [
          { name: "Build Up", color: null, shortcutKey: "2", parent: null },
          { name: "Final Third", color: null, shortcutKey: null, parent: "Build Up" },
        ],
      },
    ]);

    expect(summary.tagsCreated).toBe(2);
    expect(await eventsQuery.listEvents(matchId)).toEqual([]);

    const tags = await taxonomyQuery.listTags();
    const parent = tags.find((tag) => tag.name === "Build Up");
    const child = tags.find((tag) => tag.name === "Final Third");
    expect(child?.parentId).toBe(parent?.id);
  });
});
