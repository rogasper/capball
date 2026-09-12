import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Integration test: the annotation SQL we ship, run against real SQLite.
 *
 * The store's own tests mock the query layer, so this is where the migration,
 * the JSON columns, the cascade and the uid uniqueness are actually executed.
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

const { execute, resetDatabase } = await import("./sqlite-harness");
const annotationsQuery = await import("@/lib/db/queries/annotations");
const eventsQuery = await import("@/lib/db/queries/events");
const taxonomyQuery = await import("@/lib/db/queries/taxonomy");
const teamsQuery = await import("@/lib/db/queries/teams");
const matchesQuery = await import("@/lib/db/queries/matches");
const videosQuery = await import("@/lib/db/queries/videos");
const { boxGeometry, pathGeometry } = await import("@/lib/annotate/geometry");
const { DEFAULT_STYLE } = await import("@/lib/annotate/types");

let eventId = 0;
let otherEventId = 0;
let tagId = 0;

async function makeEvent(anchorMs: number): Promise<number> {
  const match = await matchesQuery.listMatches();
  const video = (await videosQuery.listVideos(match[0].id))[0];
  return eventsQuery.createEvent({
    matchId: match[0].id,
    videoId: video.id,
    tagId,
    anchorMs,
    startMs: anchorMs - 8_000,
    endMs: anchorMs + 12_000,
  });
}

beforeEach(async () => {
  resetDatabase();

  const home = await teamsQuery.ensureTeam({ name: "Manchester United" });
  const away = await teamsQuery.ensureTeam({ name: "Sabah" });
  const matchId = await matchesQuery.createMatch({ homeTeamId: home.id, awayTeamId: away.id });

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
  });

  const category = await taxonomyQuery.createCategory("DEFENSE", "#34D399");
  const tag = await taxonomyQuery.createTag({
    categoryId: category.id,
    name: "High Press",
    shortcutKey: "1",
  });
  tagId = tag.id;

  eventId = await makeEvent(100_000);
  otherEventId = await makeEvent(200_000);
});

async function addShape(
  targetEventId: number,
  patch: Partial<Parameters<typeof annotationsQuery.createAnnotation>[0]> = {},
) {
  return annotationsQuery.createAnnotation({
    uid: crypto.randomUUID(),
    eventId: targetEventId,
    kind: "arrow",
    windowMode: "moment",
    windowMs: 2_500,
    geometry: boxGeometry([0.2, 0.2], [0.6, 0.6]),
    style: { ...DEFAULT_STYLE },
    label: null,
    z: 0,
    ...patch,
  });
}

describe("annotations against real SQLite", () => {
  it("round-trips geometry and style through their JSON columns", async () => {
    const geometry = pathGeometry([
      [0.1, 0.2],
      [0.3, 0.4],
      [0.5, 0.2],
    ]);
    const created = await addShape(eventId, {
      kind: "freehand",
      geometry,
      style: { ...DEFAULT_STYLE, stroke: "#FF8800", fill: "#112233", width: 0.004 },
      label: "Press trigger",
    });

    const [row] = await annotationsQuery.listAnnotations(eventId);

    expect(row.id).toBe(created.id);
    expect(row.kind).toBe("freehand");
    expect(row.label).toBe("Press trigger");
    expect(row.style.stroke).toBe("#FF8800");
    expect(row.style.fill).toBe("#112233");
    expect(row.style.width).toBeCloseTo(0.004);
    expect(row.geometry.points).toHaveLength(3);
    expect(row.geometry.points?.[1][0]).toBeCloseTo(0.5);
  });

  it("orders the layer stack by z, then by id", async () => {
    await addShape(eventId, { uid: "b", z: 5 });
    await addShape(eventId, { uid: "a", z: 1 });
    await addShape(eventId, { uid: "c", z: 1 });

    const rows = await annotationsQuery.listAnnotations(eventId);
    expect(rows.map((row) => row.uid)).toEqual(["a", "c", "b"]);
  });

  it("keeps one event's drawings out of another's", async () => {
    await addShape(eventId);
    await addShape(otherEventId);

    expect(await annotationsQuery.listAnnotations(eventId)).toHaveLength(1);
    expect(await annotationsQuery.listAnnotations(otherEventId)).toHaveLength(1);
  });

  it("refuses two shapes with the same uid", async () => {
    await addShape(eventId, { uid: "duplicate" });
    await expect(addShape(eventId, { uid: "duplicate" })).rejects.toThrow();
  });

  it("counts what an event would take with it", async () => {
    await addShape(eventId);
    await addShape(eventId);
    await addShape(otherEventId);

    expect(await annotationsQuery.countAnnotations(eventId)).toBe(2);
    expect(await annotationsQuery.countAnnotations(otherEventId)).toBe(1);
  });

  it("goes with its event when the event is deleted", async () => {
    await addShape(eventId);
    await addShape(otherEventId);

    await eventsQuery.deleteEvent(eventId);

    expect(await annotationsQuery.countAnnotations(eventId)).toBe(0);
    expect(await annotationsQuery.countAnnotations(otherEventId)).toBe(1);
  });

  it("goes when the tag is deleted, which deletes the events", async () => {
    await addShape(eventId);
    await taxonomyQuery.deleteTag(tagId);

    const [row] = await annotationsQuery.listAnnotations(eventId);
    expect(row).toBeUndefined();
  });

  it("rewrites paint order, and leaves another event's shapes alone", async () => {
    const first = await addShape(eventId, { uid: "first", z: 0 });
    const second = await addShape(eventId, { uid: "second", z: 1 });
    const stranger = await addShape(otherEventId, { uid: "stranger", z: 9 });

    await annotationsQuery.reorderAnnotations(eventId, [second.id, first.id, stranger.id]);

    const rows = await annotationsQuery.listAnnotations(eventId);
    expect(rows.map((row) => row.uid)).toEqual(["second", "first"]);
    const [untouched] = await annotationsQuery.listAnnotations(otherEventId);
    expect(untouched.z).toBe(9);
  });

  it("deletes one shape without touching the others", async () => {
    const keep = await addShape(eventId, { uid: "keep" });
    const drop = await addShape(eventId, { uid: "drop" });

    await annotationsQuery.deleteAnnotation(drop.id);

    const rows = await annotationsQuery.listAnnotations(eventId);
    expect(rows.map((row) => row.id)).toEqual([keep.id]);
  });

  it("names the row when its stored geometry cannot be read", async () => {
    const broken = await addShape(eventId, { uid: "broken" });
    await execute("UPDATE annotations SET geometry_json = ? WHERE id = ?", [
      "{not json",
      broken.id,
    ]);

    await expect(annotationsQuery.listAnnotations(eventId)).rejects.toThrow(
      new RegExp(`Annotation ${broken.id}`),
    );
  });
});
