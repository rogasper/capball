import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Integration test: the calibration SQL against real SQLite.
 *
 * The store's tests mock the query layer, so this is where the migration, the
 * cascades, the unique index and the replace-on-save behaviour actually run.
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

const { execute, resetDatabase, select } = await import("./sqlite-harness");
const calibrationsQuery = await import("@/lib/db/queries/calibrations");
const matchesQuery = await import("@/lib/db/queries/matches");
const teamsQuery = await import("@/lib/db/queries/teams");
const videosQuery = await import("@/lib/db/queries/videos");

let videoId = 0;
let otherVideoId = 0;

function draft(patch: Partial<Parameters<typeof calibrationsQuery.saveCalibration>[0]> = {}) {
  return {
    videoId,
    fromMs: 0,
    pitchLengthM: 105,
    pitchWidthM: 68,
    rmsErrorPx: 1.4,
    points: [
      { feature: "centre-spot", imageU: 0.5, imageV: 0.5, xM: 0, yM: 0 },
      { feature: "left-penalty-spot", imageU: 0.2, imageV: 0.5, xM: -41.5, yM: 0 },
      { feature: "right-penalty-spot", imageU: 0.8, imageV: 0.5, xM: 41.5, yM: 0 },
      { feature: "left-pa-front-top", imageU: 0.15, imageV: 0.25, xM: -36, yM: -20.16 },
    ],
    ...patch,
  };
}

beforeEach(async () => {
  resetDatabase();

  const home = await teamsQuery.ensureTeam({ name: "Manchester United" });
  const away = await teamsQuery.ensureTeam({ name: "Sabah" });
  const matchId = await matchesQuery.createMatch({ homeTeamId: home.id, awayTeamId: away.id });

  const first = await videosQuery.addVideo({
    matchId,
    path: "/tmp/samples/first.mp4",
    fileName: "first.mp4",
    durationMs: 2_700_000,
    width: 1920,
    height: 1080,
  });
  const second = await videosQuery.addVideo({
    matchId,
    path: "/tmp/samples/second.mp4",
    fileName: "second.mp4",
    durationMs: 2_700_000,
    width: 1920,
    height: 1080,
  });

  videoId = first.id;
  otherVideoId = second.id;
});

describe("calibrations against real SQLite", () => {
  it("stores a calibration with its reference points in order", async () => {
    await calibrationsQuery.saveCalibration(draft());

    const [stored] = await calibrationsQuery.listCalibrations(videoId);

    expect(stored.videoId).toBe(videoId);
    expect(stored.fromMs).toBe(0);
    expect(stored.pitchLengthM).toBeCloseTo(105);
    expect(stored.rmsErrorPx).toBeCloseTo(1.4);
    expect(stored.points.map((point) => point.feature)).toEqual([
      "centre-spot",
      "left-penalty-spot",
      "right-penalty-spot",
      "left-pa-front-top",
    ]);
    // Real numbers survive the round trip, not integers.
    expect(stored.points[3].yM).toBeCloseTo(-20.16);
    expect(stored.points[1].xM).toBeCloseTo(-41.5);
  });

  it("replaces the calibration at the same start time instead of piling up", async () => {
    await calibrationsQuery.saveCalibration(draft());
    await calibrationsQuery.saveCalibration(
      draft({
        rmsErrorPx: 3.2,
        points: [{ feature: "centre-spot", imageU: 0.51, imageV: 0.49, xM: 0, yM: 0 }],
      }),
    );

    const stored = await calibrationsQuery.listCalibrations(videoId);
    expect(stored).toHaveLength(1);
    expect(stored[0].rmsErrorPx).toBeCloseTo(3.2);
    // The old points are gone rather than merged.
    expect(stored[0].points).toHaveLength(1);
    expect(stored[0].points[0].imageU).toBeCloseTo(0.51);
  });

  it("keeps a later calibration alongside the first", async () => {
    await calibrationsQuery.saveCalibration(draft({ fromMs: 0, rmsErrorPx: 1 }));
    await calibrationsQuery.saveCalibration(draft({ fromMs: 2_700_000, rmsErrorPx: 2 }));

    const stored = await calibrationsQuery.listCalibrations(videoId);
    expect(stored.map((row) => row.fromMs)).toEqual([0, 2_700_000]);
  });

  it("lets a second video hold its own calibrations", async () => {
    await calibrationsQuery.saveCalibration(draft());
    await calibrationsQuery.saveCalibration(draft({ videoId: otherVideoId }));

    expect(await calibrationsQuery.listCalibrations(videoId)).toHaveLength(1);
    expect(await calibrationsQuery.listCalibrations(otherVideoId)).toHaveLength(1);
    expect(await calibrationsQuery.listCalibrations(videoId + otherVideoId + 99)).toEqual([]);
  });

  it("refuses two calibrations starting at the same moment, through the schema itself", async () => {
    await calibrationsQuery.saveCalibration(draft());
    await expect(
      execute(
        "INSERT INTO calibrations (video_id, from_ms, pitch_length_m, pitch_width_m, rms_error_px) VALUES (?, 0, 105, 68, 1)",
        [videoId],
      ),
    ).rejects.toThrow();
  });

  it("takes its points with it when the calibration is deleted", async () => {
    const id = await calibrationsQuery.saveCalibration(draft());
    await calibrationsQuery.deleteCalibration(id);

    expect(await calibrationsQuery.listCalibrations(videoId)).toEqual([]);
    const orphans = await select("SELECT count(*) AS c FROM calibration_points");
    expect(Number(orphans[0].c)).toBe(0);
  });

  it("goes with the video when the video is removed", async () => {
    await calibrationsQuery.saveCalibration(draft());

    await videosQuery.removeVideo(videoId);

    expect(await calibrationsQuery.listCalibrations(videoId)).toEqual([]);
    const rows = await select("SELECT count(*) AS c FROM calibration_points");
    expect(Number(rows[0].c)).toBe(0);
  });

  it("reports a point-less calibration rather than pretending it is usable", async () => {
    const id = await calibrationsQuery.saveCalibration(draft());
    await execute("DELETE FROM calibration_points WHERE calibration_id = ?", [id]);

    const [stored] = await calibrationsQuery.listCalibrations(videoId);
    expect(stored.points).toEqual([]);
  });
});
