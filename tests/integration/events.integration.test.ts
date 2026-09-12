import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Integration test: the SQL we ship, executed against real SQLite.
 *
 * The unit tests mock the query layer, so this is the only place the generated
 * SQL runs for real. Both database entry points are redirected to a Node SQLite
 * database: the Drizzle client, and the raw bridge used by the tag-subtree
 * queries. It also exercises the assumption in `src/lib/db/client.ts` that row
 * objects map to positional values in SELECT order, because this driver returns
 * keyed rows exactly like the Tauri plugin does.
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
const playersQuery = await import("@/lib/db/queries/players");

let matchId = 0;
let videoId = 0;
let tagId = 0;

beforeEach(async () => {
  resetDatabase();

  const home = await teamsQuery.ensureTeam({ name: "Manchester United" });
  const away = await teamsQuery.ensureTeam({ name: "Sabah" });
  matchId = await matchesQuery.createMatch({ homeTeamId: home.id, awayTeamId: away.id });

  const video = await videosQuery.addVideo({
    matchId,
    path: "/tmp/samples/match.mp4",
    fileName: "match.mp4",
    durationMs: 861_737,
    width: 1920,
    height: 1080,
    fpsNum: 60_000,
    fpsDen: 1001,
    videoCodec: "h264",
    audioCodec: "aac",
    container: "mov,mp4,m4a,3gp,3g2,mj2",
  });
  videoId = video.id;

  const category = await taxonomyQuery.createCategory("DEFENSE", "#34D399");
  const tag = await taxonomyQuery.createTag({
    categoryId: category.id,
    name: "High Press",
    shortcutKey: "1",
  });
  tagId = tag.id;
});

describe("events against real SQLite", () => {
  it("stores a capture and reads it back with its names resolved", async () => {
    const team = await teamsQuery.ensureTeam({ name: "Manchester United" });
    const player = await playersQuery.createPlayer({
      teamId: team.id,
      name: "Saka",
      shirtNumber: 7,
    });

    const id = await eventsQuery.createEvent({
      matchId,
      videoId,
      tagId,
      teamId: team.id,
      playerId: player.id,
      anchorMs: 100_000,
      startMs: 92_000,
      endMs: 112_000,
    });

    const rows = await eventsQuery.listEvents(matchId);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id,
      anchorMs: 100_000,
      startMs: 92_000,
      endMs: 112_000,
      tagName: "High Press",
      categoryName: "DEFENSE",
      teamName: "Manchester United",
      playerName: "Saka",
    });
  });

  it("keeps the tagged moment distinct from the clip range", async () => {
    // The whole point of the anchor: the range can be recomputed from new
    // pre-roll and post-roll settings, but the moment itself must survive.
    await eventsQuery.createEvent({
      matchId,
      videoId,
      tagId,
      anchorMs: 401_340,
      startMs: 393_340,
      endMs: 413_340,
    });

    const [row] = await eventsQuery.listEvents(matchId);
    expect(row?.anchorMs).toBe(401_340);
    expect(row?.startMs).toBe(393_340);
    expect(row?.endMs).toBe(413_340);
  });

  it("returns events in chronological order", async () => {
    for (const start of [300_000, 100_000, 200_000]) {
      await eventsQuery.createEvent({
        matchId,
        videoId,
        tagId,
        anchorMs: start,
        startMs: start,
        endMs: start + 1,
      });
    }

    const rows = await eventsQuery.listEvents(matchId);
    expect(rows.map((row) => row.startMs)).toEqual([100_000, 200_000, 300_000]);
  });

  it("accepts an event with no team or player", async () => {
    await eventsQuery.createEvent({
      matchId,
      videoId,
      tagId,
      anchorMs: 0,
      startMs: 0,
      endMs: 1_000,
    });

    const [row] = await eventsQuery.listEvents(matchId);
    expect(row?.teamName).toBeNull();
    expect(row?.playerName).toBeNull();
    expect(row?.tagName).toBe("High Press");
  });

  it("adjusts the range of a stored event", async () => {
    const id = await eventsQuery.createEvent({
      matchId,
      videoId,
      tagId,
      anchorMs: 15_000,
      startMs: 10_000,
      endMs: 20_000,
    });

    await eventsQuery.updateEventRange(id, 10_000, 33_000);

    const [row] = await eventsQuery.listEvents(matchId);
    expect(row?.startMs).toBe(10_000);
    expect(row?.endMs).toBe(33_000);
  });

  it("keeps a note", async () => {
    const id = await eventsQuery.createEvent({
      matchId,
      videoId,
      tagId,
      anchorMs: 0,
      startMs: 0,
      endMs: 1,
    });

    await eventsQuery.updateEventNotes(id, "second phase press");

    const [row] = await eventsQuery.listEvents(matchId);
    expect(row?.notes).toBe("second phase press");
  });

  it("removes the event on undo", async () => {
    const id = await eventsQuery.createEvent({
      matchId,
      videoId,
      tagId,
      anchorMs: 0,
      startMs: 0,
      endMs: 1,
    });

    await eventsQuery.deleteEvent(id);

    expect(await eventsQuery.listEvents(matchId)).toEqual([]);
  });

  it("counts the events a tag owns, including its sub-tags", async () => {
    const category = await taxonomyQuery.createCategory("DEFENSE 2");
    const child = await taxonomyQuery.createTag({
      categoryId: category.id,
      parentId: tagId,
      name: "Counter Press",
    });

    await eventsQuery.createEvent({ matchId, videoId, tagId, anchorMs: 0, startMs: 0, endMs: 1 });
    await eventsQuery.createEvent({
      matchId,
      videoId,
      tagId: child.id,
      anchorMs: 2,
      startMs: 2,
      endMs: 3,
    });

    expect(await taxonomyQuery.countEventsForTagSubtree(tagId)).toBe(2);
    expect(await taxonomyQuery.countEventsForTagSubtree(child.id)).toBe(1);
  });

  it("deletes a tag's events with it, by cascade", async () => {
    await eventsQuery.createEvent({ matchId, videoId, tagId, anchorMs: 0, startMs: 0, endMs: 1 });

    await taxonomyQuery.deleteTag(tagId);

    expect(await eventsQuery.listEvents(matchId)).toEqual([]);
  });

  it("moves a tag's events elsewhere before deleting it", async () => {
    const attack = await taxonomyQuery.createCategory("ATTACK");
    const destination = await taxonomyQuery.createTag({ categoryId: attack.id, name: "Build Up" });
    await eventsQuery.createEvent({ matchId, videoId, tagId, anchorMs: 0, startMs: 0, endMs: 1 });
    await eventsQuery.createEvent({ matchId, videoId, tagId, anchorMs: 5, startMs: 5, endMs: 6 });

    const moved = await taxonomyQuery.reassignTagEvents(tagId, destination.id);
    await taxonomyQuery.deleteTag(tagId);

    expect(moved).toBe(2);
    const rows = await eventsQuery.listEvents(matchId);
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.tagName === "Build Up")).toBe(true);
  });
});

describe("matches against real SQLite", () => {
  it("resolves both team names and counts videos", async () => {
    await videosQuery.addVideo({
      matchId,
      path: "/tmp/samples/second.mp4",
      fileName: "second.mp4",
      durationMs: 1_000,
    });

    const rows = await matchesQuery.listMatches();
    const row = rows.find((candidate) => candidate.id === matchId);

    // Both names come from the same table, so this fails if the aliases in
    // listMatches ever go missing.
    expect(row).toMatchObject({
      homeTeam: "Manchester United",
      awayTeam: "Sabah",
      videoCount: 2,
    });
  });
});
