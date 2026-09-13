import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Geometry } from "@/lib/annotate/types";
import { DEFAULT_STYLE } from "@/lib/annotate/types";
import type { AnalysisFile } from "@/lib/transfer/analysis";

/**
 * Integration test: a version 2 analysis file against real SQLite (FR-40.3).
 *
 * The transfer format is where R0's "never overwrite" promise is easiest to
 * break, and the `uid` rule is the mechanism that keeps it — so it is checked by
 * importing the same file twice and counting rows, not by reading the code. The
 * cascades, the calibration's natural key and the foreign keys are all real here.
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

const { resetDatabase, select } = await import("./sqlite-harness");
const importQuery = await import("@/lib/db/queries/import");
const matchesQuery = await import("@/lib/db/queries/matches");
const teamsQuery = await import("@/lib/db/queries/teams");
const videosQuery = await import("@/lib/db/queries/videos");
const { ANALYSIS_FORMAT, eventKeyOf } = await import("@/lib/transfer/analysis");

const KEY = eventKeyOf("match.mp4", "High Press", 100_000);

const CALIBRATION: NonNullable<AnalysisFile["calibrations"]>[number] = {
  videoFileName: "match.mp4",
  fromMs: 0,
  pitchLengthM: 105,
  pitchWidthM: 68,
  rmsErrorPx: 1.8,
  points: [
    { feature: "centre-spot", imageU: 0.5, imageV: 0.5, xM: 0, yM: 0 },
    { feature: "left-penalty-spot", imageU: 0.2, imageV: 0.5, xM: -41.5, yM: 0 },
  ],
};

const ANNOTATION: NonNullable<AnalysisFile["annotations"]>[number] = {
  uid: "annotation-1",
  eventKey: KEY,
  kind: "arrow",
  windowMode: "moment",
  windowMs: 2_000,
  geometry: { x: 0.1, y: 0.2, w: 0.3, h: 0.1, rotation: 0 },
  style: { ...DEFAULT_STYLE },
  label: null,
  z: 0,
};

const POSITION: NonNullable<AnalysisFile["positions"]>[number] = {
  uid: "position-1",
  eventKey: KEY,
  teamName: "Manchester United",
  playerName: "Bruno Fernandes",
  shirtNumber: 8,
  xM: -14.25,
  yM: 6.75,
  imageU: 0.42,
  imageV: 0.58,
};

function fileWith(patch: Partial<AnalysisFile> = {}): AnalysisFile {
  return {
    format: ANALYSIS_FORMAT,
    version: 2,
    exportedAt: "2026-09-13T00:00:00.000Z",
    match: {
      homeTeam: "Manchester United",
      awayTeam: "Sabah",
      competition: null,
      season: null,
      kickoffAt: null,
      venue: null,
      notes: null,
    },
    taxonomy: [
      {
        name: "DEFENSE",
        color: null,
        tags: [{ name: "High Press", color: null, shortcutKey: null, parent: null }],
      },
    ],
    videos: [
      {
        fileName: "match.mp4",
        durationMs: 861_737,
        width: 1920,
        height: 1080,
        fpsNum: 30,
        fpsDen: 1,
        videoCodec: "h264",
        audioCodec: "aac",
        container: "mp4",
      },
    ],
    events: [
      {
        videoFileName: "match.mp4",
        category: "DEFENSE",
        tag: "High Press",
        team: "Manchester United",
        player: "Bruno Fernandes",
        anchorMs: 100_000,
        startMs: 92_000,
        endMs: 112_000,
        notes: null,
      },
    ],
    calibrations: [CALIBRATION],
    annotations: [ANNOTATION],
    positions: [POSITION],
    ...patch,
  };
}

async function count(table: string): Promise<number> {
  const rows = await select(`SELECT count(*) AS n FROM ${table}`);
  return Number(rows[0]?.n ?? 0);
}

beforeEach(async () => {
  resetDatabase();

  const home = await teamsQuery.ensureTeam({ name: "Manchester United" });
  const away = await teamsQuery.ensureTeam({ name: "Sabah" });
  const matchId = await matchesQuery.createMatch({ homeTeamId: home.id, awayTeamId: away.id });

  // The video has to be in the library first: a path from another machine is
  // meaningless, which is why the file names it rather than pointing at it.
  await videosQuery.addVideo({
    matchId,
    path: "/tmp/samples/match.mp4",
    fileName: "match.mp4",
    durationMs: 861_737,
    width: 1920,
    height: 1080,
  });
});

describe("a version 2 analysis file against real SQLite", () => {
  it("brings the drawings, the calibration and the positions with it", async () => {
    const summary = await importQuery.importAnalysis(fileWith());

    expect(summary.calibrationsCreated).toBe(1);
    expect(summary.annotationsCreated).toBe(1);
    expect(summary.positionsCreated).toBe(1);
    expect(await count("calibrations")).toBe(1);
    expect(await count("calibration_points")).toBe(2);
    expect(await count("annotations")).toBe(1);
    expect(await count("positions")).toBe(1);
  });

  it("adds nothing the second time, and does not duplicate an event", async () => {
    await importQuery.importAnalysis(fileWith());
    const second = await importQuery.importAnalysis(fileWith());

    expect(second.eventsCreated).toBe(0);
    expect(second.annotationsCreated).toBe(0);
    expect(second.positionsCreated).toBe(0);
    expect(second.calibrationsCreated).toBe(0);
    expect(await count("events")).toBe(1);
    expect(await count("annotations")).toBe(1);
    expect(await count("positions")).toBe(1);
    expect(await count("calibrations")).toBe(1);
  });

  it("skips a calibration whose video is not here, and says so", async () => {
    const summary = await importQuery.importAnalysis(
      fileWith({ calibrations: [{ ...CALIBRATION, videoFileName: "absent.mp4" }] }),
    );

    expect(summary.calibrationsCreated).toBe(0);
    expect(summary.calibrationsSkipped).toBe(1);
    expect(summary.notes.join(" ")).toMatch(/absent\.mp4 is not in the library/i);
    expect(await count("calibrations")).toBe(0);
  });

  it("keeps one position per player per event rather than trusting the file", async () => {
    await importQuery.importAnalysis(fileWith());
    const again = await importQuery.importAnalysis(
      fileWith({
        positions: [
          {
            uid: "position-1",
            eventKey: KEY,
            teamName: "Manchester United",
            playerName: "Bruno Fernandes",
            shirtNumber: 8,
            xM: 1,
            yM: 2,
            imageU: 0.4,
            imageV: 0.6,
          },
        ],
      }),
    );

    expect(again.positionsSkipped).toBe(1);
    expect(await count("positions")).toBe(1);
  });

  it("refuses a drawing whose geometry cannot be read, and reports it", async () => {
    const summary = await importQuery.importAnalysis(
      fileWith({
        annotations: [
          {
            uid: "annotation-bad",
            eventKey: KEY,
            kind: "arrow",
            windowMode: "moment",
            windowMs: 2_000,
            geometry: { x: 0 } as unknown as Geometry,
            style: { ...DEFAULT_STYLE },
            label: null,
            z: 0,
          },
        ],
      }),
    );

    expect(summary.annotationsCreated).toBe(0);
    expect(summary.annotationsSkipped).toBe(1);
    expect(summary.notes.join(" ")).toMatch(/geometry is not readable/i);
    expect(await count("annotations")).toBe(0);
  });

  it("still imports a version 1 file, where the new sections are absent", async () => {
    // What `parseAnalysisFile` hands the importer for an R0 file.
    const summary = await importQuery.importAnalysis(
      fileWith({ calibrations: [], annotations: [], positions: [] }),
    );

    expect(summary.eventsCreated).toBe(1);
    expect(summary.annotationsCreated).toBe(0);
    expect(await count("annotations")).toBe(0);
  });

  it("lists every source path the cache policy must keep", async () => {
    expect(await videosQuery.listAllVideoPaths()).toEqual(["/tmp/samples/match.mp4"]);
  });
});
