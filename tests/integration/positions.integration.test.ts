import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Integration test: the position SQL against real SQLite.
 *
 * The joined select is the reason this file exists: `players.name` and
 * `teams.name` are both called `name`, and only executing the shipped SQL against
 * a driver that keys rows by column name proves the aliases hold (AGENTS.md rule
 * 8). The cascades and the one-position-per-player rule are checked here too.
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

const { resetDatabase, execute } = await import("./sqlite-harness");
const positionsQuery = await import("@/lib/db/queries/positions");
const calibrationsQuery = await import("@/lib/db/queries/calibrations");
const eventsQuery = await import("@/lib/db/queries/events");
const taxonomyQuery = await import("@/lib/db/queries/taxonomy");
const teamsQuery = await import("@/lib/db/queries/teams");
const playersQuery = await import("@/lib/db/queries/players");
const matchesQuery = await import("@/lib/db/queries/matches");
const videosQuery = await import("@/lib/db/queries/videos");

let eventId = 0;
let otherEventId = 0;
let videoId = 0;
let homeId = 0;
let awayId = 0;
let homePlayerId = 0;
let awayPlayerId = 0;

beforeEach(async () => {
  resetDatabase();

  const home = await teamsQuery.ensureTeam({ name: "Manchester United" });
  const away = await teamsQuery.ensureTeam({ name: "Sabah" });
  homeId = home.id;
  awayId = away.id;
  // The squad panel does not edit colours yet, so the fixture sets one directly:
  // the pitch view shows a colour beside the team name, never colour alone.
  await execute("UPDATE teams SET color = ? WHERE id = ?", ["#DA291C", home.id]);
  await execute("UPDATE teams SET color = ? WHERE id = ?", ["#0057B8", away.id]);

  const matchId = await matchesQuery.createMatch({ homeTeamId: home.id, awayTeamId: away.id });
  const video = await videosQuery.addVideo({
    matchId,
    path: "/tmp/samples/match.mp4",
    fileName: "match.mp4",
    durationMs: 861_737,
    width: 1920,
    height: 1080,
  });
  videoId = video.id;

  const homePlayer = await playersQuery.createPlayer({
    teamId: home.id,
    name: "Bruno Fernandes",
    shirtNumber: 8,
  });
  const awayPlayer = await playersQuery.createPlayer({
    teamId: away.id,
    name: "Saddil Ramdani",
    shirtNumber: 7,
  });
  homePlayerId = homePlayer.id;
  awayPlayerId = awayPlayer.id;

  const category = await taxonomyQuery.createCategory("ATTACK", "#4C8DFF");
  const tag = await taxonomyQuery.createTag({ categoryId: category.id, name: "Shot" });

  eventId = await eventsQuery.createEvent({
    matchId,
    videoId,
    tagId: tag.id,
    anchorMs: 100_000,
    startMs: 92_000,
    endMs: 112_000,
  });
  otherEventId = await eventsQuery.createEvent({
    matchId,
    videoId,
    tagId: tag.id,
    anchorMs: 200_000,
    startMs: 192_000,
    endMs: 212_000,
  });
});

async function marker(patch: Partial<Parameters<typeof positionsQuery.savePosition>[0]> = {}) {
  return positionsQuery.savePosition({
    uid: crypto.randomUUID(),
    eventId,
    playerId: homePlayerId,
    teamId: homeId,
    calibrationId: null,
    imageU: 0.42,
    imageV: 0.58,
    xM: -14.25,
    yM: 6.75,
    ...patch,
  });
}

describe("positions against real SQLite", () => {
  it("reads a position back with its player and team resolved", async () => {
    await marker();

    const [row] = await positionsQuery.listPositions(eventId);

    // Both names survive: this is where a missing alias would show up.
    expect(row.playerName).toBe("Bruno Fernandes");
    expect(row.teamName).toBe("Manchester United");
    expect(row.teamColor).toBe("#DA291C");
    expect(row.shirtNumber).toBe(8);
    expect(row.xM).toBeCloseTo(-14.25);
    expect(row.yM).toBeCloseTo(6.75);
    expect(row.imageU).toBeCloseTo(0.42);
  });

  it("keeps two teams' positions apart and orders them by squad number", async () => {
    await marker({ playerId: awayPlayerId, teamId: awayId, xM: 10 });
    await marker({ playerId: homePlayerId, teamId: homeId, xM: -10 });

    const rows = await positionsQuery.listPositions(eventId);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.playerName)).toEqual(["Bruno Fernandes", "Saddil Ramdani"]);
  });

  it("treats a second marker on the same player as a correction", async () => {
    const first = await marker({ xM: -10 });
    const second = await marker({ xM: -12.5 });

    expect(second).toBe(first);
    const rows = await positionsQuery.listPositions(eventId);
    expect(rows).toHaveLength(1);
    expect(rows[0].xM).toBeCloseTo(-12.5);
  });

  it("refuses a duplicate that bypasses the query layer", async () => {
    await marker();
    await expect(
      execute(
        "INSERT INTO positions (uid, event_id, player_id, team_id, image_u, image_v, x_m, y_m) VALUES (?, ?, ?, ?, 0.4, 0.5, 0, 0)",
        ["duplicate", eventId, homePlayerId, homeId],
      ),
    ).rejects.toThrow();
  });

  it("goes with its event when the event is deleted", async () => {
    await marker();
    await marker({ eventId: otherEventId, playerId: awayPlayerId, teamId: awayId });

    await eventsQuery.deleteEvent(eventId);

    expect(await positionsQuery.countPositions(eventId)).toBe(0);
    expect(await positionsQuery.countPositions(otherEventId)).toBe(1);
  });

  it("goes when the player is deleted", async () => {
    await marker();
    await playersQuery.deletePlayer(homePlayerId);
    expect(await positionsQuery.countPositions(eventId)).toBe(0);
  });

  it("keeps the position but forgets the calibration when the calibration goes", async () => {
    const calibrationId = await calibrationsQuery.saveCalibration({
      videoId,
      fromMs: 0,
      pitchLengthM: 105,
      pitchWidthM: 68,
      rmsErrorPx: 1.2,
      points: [{ feature: "centre-spot", imageU: 0.5, imageV: 0.5, xM: 0, yM: 0 }],
    });
    await marker({ calibrationId });

    await calibrationsQuery.deleteCalibration(calibrationId);

    const [row] = await positionsQuery.listPositions(eventId);
    // The user's assertion outlives the calibration that produced it.
    expect(row.calibrationId).toBeNull();
    expect(row.xM).toBeCloseTo(-14.25);
  });

  it("counts what an event would take with it", async () => {
    await marker();
    await marker({ playerId: awayPlayerId, teamId: awayId });
    await marker({ eventId: otherEventId, playerId: homePlayerId });

    expect(await positionsQuery.countPositions(eventId)).toBe(2);
    expect(await positionsQuery.countPositions(otherEventId)).toBe(1);
  });

  it("lists the events of a match that carry positions", async () => {
    await marker();
    await marker({ eventId: otherEventId, playerId: awayPlayerId, teamId: awayId });

    const matchId = (await matchesQuery.listMatches())[0].id;
    const withPositions = await positionsQuery.eventsWithPositions(matchId);
    expect(withPositions.sort()).toEqual([eventId, otherEventId].sort());
  });

  it("removes one position without touching another", async () => {
    const keep = await marker();
    const drop = await marker({ playerId: awayPlayerId, teamId: awayId });

    await positionsQuery.deletePosition(drop);

    const rows = await positionsQuery.listPositions(eventId);
    expect(rows.map((row) => row.id)).toEqual([keep]);
  });
});
