import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Integration test: the phase SQL we ship, run against real SQLite.
 *
 * The unit tests prove the rules; this proves the storage keeps them. The
 * partial unique index is the interesting one — "one open phase per team" is a
 * constraint rather than a convention only if the database refuses a second
 * insert, and only real SQLite can answer that.
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

const phasesQuery = await import("@/lib/db/queries/phases");
const eventsQuery = await import("@/lib/db/queries/events");
const taxonomyQuery = await import("@/lib/db/queries/taxonomy");
const teamsQuery = await import("@/lib/db/queries/teams");
const matchesQuery = await import("@/lib/db/queries/matches");
const videosQuery = await import("@/lib/db/queries/videos");

let matchId = 0;
let videoId = 0;
let phaseTagId = 0;
let momentTagId = 0;
let homeTeamId = 0;

/** A phase: an event that starts as an instant and grows when it stops. */
async function makePhase(anchorMs: number): Promise<number> {
  return eventsQuery.createEvent({
    matchId,
    videoId,
    tagId: phaseTagId,
    teamId: homeTeamId,
    anchorMs,
    startMs: anchorMs,
    endMs: anchorMs,
  });
}

beforeEach(async () => {
  const { resetDatabase } = await import("./sqlite-harness");
  resetDatabase();

  const home = await teamsQuery.ensureTeam({ name: "Manchester United" });
  const away = await teamsQuery.ensureTeam({ name: "Sabah" });
  homeTeamId = home.id;
  matchId = await matchesQuery.createMatch({ homeTeamId: home.id, awayTeamId: away.id });

  videoId = (
    await videosQuery.addVideo({
      matchId,
      path: "/tmp/samples/match.mp4",
      fileName: "match.mp4",
      durationMs: 861_737,
      width: 1920,
      height: 1080,
      videoCodec: "h264",
      audioCodec: "aac",
      container: "mov,mp4,m4a,3gp,3g2,mj2",
    })
  ).id;

  const attack = await taxonomyQuery.createCategory("ATTACK", "#4C8DFF");
  const phase = await taxonomyQuery.createTag({
    categoryId: attack.id,
    name: "Attacking",
    shortcutKey: "1",
  });
  const moment = await taxonomyQuery.createTag({
    categoryId: attack.id,
    name: "Pass",
    shortcutKey: "2",
  });
  phaseTagId = phase.id;
  momentTagId = moment.id;
});

describe("which tags are phases", () => {
  it("is a row's presence, so marking and unmarking is an insert and a delete", async () => {
    expect(await phasesQuery.listPhaseTagIds()).toEqual([]);

    await phasesQuery.setTagPhase(phaseTagId, true);
    expect(await phasesQuery.listPhaseTagIds()).toEqual([phaseTagId]);

    // Marking twice is the same fact, not an error.
    await phasesQuery.setTagPhase(phaseTagId, true);
    expect(await phasesQuery.listPhaseTagIds()).toEqual([phaseTagId]);

    await phasesQuery.setTagPhase(phaseTagId, false);
    expect(await phasesQuery.listPhaseTagIds()).toEqual([]);
  });
});

describe("one open phase per stream", () => {
  it("refuses a second open phase for the same team", async () => {
    const first = await makePhase(10_000);
    const second = await makePhase(20_000);

    await phasesQuery.openSession({
      eventId: first,
      streamKey: `team:${homeTeamId}`,
      openedAtMs: 10_000,
    });

    // The database, not the store, is what makes FR-55.2 true.
    await expect(
      phasesQuery.openSession({
        eventId: second,
        streamKey: `team:${homeTeamId}`,
        openedAtMs: 20_000,
      }),
    ).rejects.toThrow();
  });

  it("allows two teams to run at the same time", async () => {
    const home = await makePhase(10_000);
    const away = await makePhase(12_000);

    await phasesQuery.openSession({
      eventId: home,
      streamKey: `team:${homeTeamId}`,
      openedAtMs: 10_000,
    });
    await phasesQuery.openSession({ eventId: away, streamKey: "team:2", openedAtMs: 12_000 });

    const sessions = await phasesQuery.listSessions(matchId);
    expect(sessions.filter((session) => session.closedBy === null)).toHaveLength(2);
  });

  it("lets the stream open again once the phase is closed", async () => {
    const first = await makePhase(10_000);
    const second = await makePhase(60_000);
    const streamKey = `team:${homeTeamId}`;

    await phasesQuery.openSession({ eventId: first, streamKey, openedAtMs: 10_000 });
    await eventsQuery.updateEventRange(first, 10_000, 55_000, 10_000);
    await phasesQuery.closeSession(first, "user");
    await phasesQuery.openSession({ eventId: second, streamKey, openedAtMs: 60_000 });

    const sessions = await phasesQuery.listSessions(matchId);
    expect(sessions.map((session) => [session.eventId, session.closedBy])).toEqual([
      [first, "user"],
      [second, null],
    ]);
  });

  it("keeps the last observed position, which is what an interrupted phase closes at", async () => {
    const phase = await makePhase(10_000);
    await phasesQuery.openSession({
      eventId: phase,
      streamKey: `team:${homeTeamId}`,
      openedAtMs: 10_000,
    });
    await phasesQuery.touchSession(phase, 44_000);

    const [session] = await phasesQuery.listSessions(matchId);
    expect(session?.openedAtMs).toBe(10_000);
    expect(session?.lastSeenMs).toBe(44_000);
    expect(session?.tagId).toBe(phaseTagId);
    expect(session?.teamId).toBe(homeTeamId);
  });
});

describe("the actions inside a phase", () => {
  it("links an action to its phase, and the same link twice is one fact", async () => {
    const phase = await makePhase(10_000);
    const action = await eventsQuery.createEvent({
      matchId,
      videoId,
      tagId: momentTagId,
      anchorMs: 12_000,
      startMs: 12_000,
      endMs: 12_000,
    });

    await phasesQuery.linkParent(action, phase);
    await phasesQuery.linkParent(action, phase);

    expect(await phasesQuery.countActionsOfPhase(phase)).toBe(1);
    expect(await phasesQuery.listLinksForMatch(matchId)).toEqual([
      { childId: action, parentId: phase },
    ]);
  });

  it("lets an action belong to two phases, which a column could not express", async () => {
    const attack = await makePhase(10_000);
    const defence = await makePhase(10_500);
    const action = await eventsQuery.createEvent({
      matchId,
      videoId,
      tagId: momentTagId,
      anchorMs: 12_000,
      startMs: 12_000,
      endMs: 12_000,
    });

    await phasesQuery.linkParent(action, attack);
    await phasesQuery.linkParent(action, defence);

    expect((await phasesQuery.listLinksForMatch(matchId)).length).toBe(2);
  });

  it("keeps the actions when the phase is deleted, and drops only the link", async () => {
    const phase = await makePhase(10_000);
    const action = await eventsQuery.createEvent({
      matchId,
      videoId,
      tagId: momentTagId,
      anchorMs: 12_000,
      startMs: 12_000,
      endMs: 12_000,
    });
    await phasesQuery.linkParent(action, phase);

    await eventsQuery.deleteEvent(phase);

    // FR-55.5: the action is an observation of its own, not a child to orphan.
    expect(await phasesQuery.listLinksForMatch(matchId)).toEqual([]);
    expect(await eventsQuery.getEvent(action)).toBeDefined();
  });

  it("takes the link with the action when the action is deleted", async () => {
    const phase = await makePhase(10_000);
    const action = await eventsQuery.createEvent({
      matchId,
      videoId,
      tagId: momentTagId,
      anchorMs: 12_000,
      startMs: 12_000,
      endMs: 12_000,
    });
    await phasesQuery.linkParent(action, phase);

    await eventsQuery.deleteEvent(action);

    expect(await phasesQuery.countActionsOfPhase(phase)).toBe(0);
  });

  it("only reports the links of the match being read", async () => {
    const phase = await makePhase(10_000);
    const action = await eventsQuery.createEvent({
      matchId,
      videoId,
      tagId: momentTagId,
      anchorMs: 12_000,
      startMs: 12_000,
      endMs: 12_000,
    });
    await phasesQuery.linkParent(action, phase);

    const otherHome = await teamsQuery.ensureTeam({ name: "Arsenal" });
    const otherAway = await teamsQuery.ensureTeam({ name: "Chelsea" });
    const otherMatch = await matchesQuery.createMatch({
      homeTeamId: otherHome.id,
      awayTeamId: otherAway.id,
    });

    expect(await phasesQuery.listLinksForMatch(otherMatch)).toEqual([]);
  });
});

describe("a phase is an event like any other", () => {
  it("carries its own span once it stops, and that span is what a duration counts", async () => {
    const phase = await makePhase(10_000);
    await eventsQuery.updateEventRange(phase, 10_000, 55_000, 10_000);

    const row = await eventsQuery.getEvent(phase);
    expect(row?.startMs).toBe(10_000);
    expect(row?.endMs).toBe(55_000);
    // The anchor stays at the opening press, so the moment is where it started.
    expect(row?.anchorMs).toBe(10_000);
  });
});
