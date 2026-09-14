import { describe, expect, it } from "vitest";
import { DEFAULT_STYLE } from "@/lib/annotate/types";
import type { EventRow } from "@/lib/db/queries/events";
import type { Video } from "@/lib/db/queries/videos";
import type { AnalysisAnnotation } from "@/lib/transfer/analysis";
import {
  ANALYSIS_FORMAT,
  ANALYSIS_VERSION,
  type AnalysisFile,
  buildAnalysisFile,
  buildTaxonomyFile,
  describeImport,
  eventKeyOf,
  isAnalysisFile,
  parseAnalysisFile,
  parseEventKey,
} from "@/lib/transfer/analysis";

const video = {
  id: 7,
  matchId: 1,
  path: "/matches/first-half.mp4",
  playbackPath: null,
  fileName: "first-half.mp4",
  sizeBytes: 1,
  durationMs: 600_000,
  width: 1920,
  height: 1080,
  fpsNum: 30,
  fpsDen: 1,
  videoCodec: "h264",
  audioCodec: "aac",
  container: "mp4",
  faststart: true,
  createdAt: 0,
} satisfies Video;

const event = {
  id: 1,
  videoId: 7,
  anchorMs: 100_000,
  startMs: 92_000,
  endMs: 112_000,
  notes: "second phase",
  tagId: 3,
  tagName: "High Press",
  tagColor: "#34D399",
  categoryName: "DEFENSE",
  teamId: 1,
  teamName: "Manchester United",
  playerId: 2,
  playerName: "Saka",
} satisfies EventRow;

describe("buildAnalysisFile", () => {
  const file = buildAnalysisFile({
    match: {
      homeTeam: "Manchester United",
      awayTeam: "Sabah",
      competition: "Champions League",
      season: null,
      kickoffAt: 1,
      venue: null,
      notes: null,
    },
    videos: [video],
    events: [event],
    taxonomy: [{ name: "DEFENSE", color: "#34D399", tags: [] }],
    now: new Date("2026-09-12T00:00:00.000Z"),
  });

  it("identifies itself, so a wrong file is refused rather than misread", () => {
    expect(file.format).toBe(ANALYSIS_FORMAT);
    expect(file.version).toBe(ANALYSIS_VERSION);
  });

  it("names the video an event belongs to, by file name rather than by id", () => {
    expect(file.events[0]?.videoFileName).toBe("first-half.mp4");
  });

  it("keeps the event's own times and note", () => {
    expect(file.events[0]).toMatchObject({
      anchorMs: 100_000,
      startMs: 92_000,
      endMs: 112_000,
      notes: "second phase",
      team: "Manchester United",
      player: "Saka",
    });
  });

  it("leaves out what only means something on this machine", () => {
    const serialized = JSON.stringify(file);
    expect(serialized).not.toContain("/matches/first-half.mp4");
    expect(serialized).not.toContain("playbackPath");
  });
});

describe("parseAnalysisFile", () => {
  const valid = buildTaxonomyFile([{ name: "ATTACK", color: null, tags: [] }]);

  it("reads back what was written", () => {
    expect(parseAnalysisFile(JSON.stringify(valid))).toEqual(valid);
  });

  it("refuses something that is not JSON", () => {
    expect(() => parseAnalysisFile("not json")).toThrow(/not valid JSON/i);
  });

  it("refuses another program's JSON", () => {
    expect(() => parseAnalysisFile('{"format":"something.else","version":1}')).toThrow(
      /not written by capball/i,
    );
  });

  it("refuses a file from a newer version", () => {
    expect(() =>
      parseAnalysisFile(JSON.stringify({ ...valid, version: ANALYSIS_VERSION + 1 })),
    ).toThrow(/newer version/i);
  });

  it("refuses a file with no taxonomy", () => {
    expect(() =>
      parseAnalysisFile(JSON.stringify({ format: ANALYSIS_FORMAT, version: 1 })),
    ).toThrow(/no taxonomy/i);
  });

  it("fills the version 2 sections with nothing when a version 1 file has none", () => {
    const v1 = {
      format: ANALYSIS_FORMAT,
      version: 1,
      exportedAt: "2026-09-12T00:00:00.000Z",
      match: {
        homeTeam: "Manchester United",
        awayTeam: "Sabah",
        competition: null,
        season: null,
        kickoffAt: null,
        venue: null,
        notes: null,
      },
      taxonomy: [],
      videos: [],
      events: [],
    };

    expect(parseAnalysisFile(JSON.stringify(v1))).toMatchObject({
      calibrations: [],
      annotations: [],
      positions: [],
    });
  });
});

describe("event keys", () => {
  it("round-trips a video name, a tag and a moment", () => {
    expect(parseEventKey(eventKeyOf("match.mp4", "High Press", 100_000))).toEqual({
      videoFileName: "match.mp4",
      tag: "High Press",
      anchorMs: 100_000,
    });
  });

  it("keeps a tag that contains the separator readable", () => {
    // Splitting on the first and last separator leaves the tag intact.
    expect(parseEventKey(eventKeyOf("match.mp4", "Press | Trap", 1_000))).toEqual({
      videoFileName: "match.mp4",
      tag: "Press | Trap",
      anchorMs: 1_000,
    });
  });

  it("refuses a key that is not one, rather than reading it wrongly", () => {
    expect(parseEventKey("nonsense")).toBeNull();
    expect(parseEventKey("a|b|not-a-number")).toBeNull();
    expect(parseEventKey("|tag|1000")).toBeNull();
  });
});

describe("isAnalysisFile", () => {
  it("tells a whole match from a taxonomy", () => {
    const taxonomy = buildTaxonomyFile([]);
    const analysis = { ...taxonomy, match: {} } as unknown as AnalysisFile;

    expect(isAnalysisFile(taxonomy)).toBe(false);
    expect(isAnalysisFile(analysis)).toBe(true);
  });
});

describe("a version 2 file carries the R1 sections", () => {
  const key = eventKeyOf("first-half.mp4", "High Press", 100_000);

  it("keeps the drawings, the calibration and the positions beside the events", () => {
    const file = buildAnalysisFile({
      match: {
        homeTeam: "Manchester United",
        awayTeam: "Sabah",
        competition: null,
        season: null,
        kickoffAt: null,
        venue: null,
        notes: null,
      },
      videos: [video],
      events: [event],
      taxonomy: [],
      calibrations: [
        {
          videoFileName: "first-half.mp4",
          fromMs: 0,
          pitchLengthM: 105,
          pitchWidthM: 68,
          rmsErrorPx: 1.8,
          points: [{ feature: "centre-spot", imageU: 0.5, imageV: 0.5, xM: 0, yM: 0 }],
        },
      ],
      annotations: [
        {
          uid: "annotation-1",
          eventKey: key,
          kind: "arrow",
          windowMode: "moment",
          windowMs: 2_000,
          geometry: { x: 0.1, y: 0.2, w: 0.3, h: 0.1, rotation: 0 },
          style: { ...DEFAULT_STYLE },
          label: null,
          z: 0,
        },
      ],
      positions: [
        {
          uid: "position-1",
          eventKey: key,
          teamName: "Manchester United",
          playerName: "Saka",
          shirtNumber: 7,
          xM: -14.25,
          yM: 6.75,
          imageU: 0.42,
          imageV: 0.58,
        },
      ],
    });

    expect(file.version).toBe(2);
    expect(file.calibrations[0]?.videoFileName).toBe("first-half.mp4");
    expect(file.annotations[0]?.eventKey).toBe(key);
    expect(file.positions[0]).toMatchObject({ playerName: "Saka", xM: -14.25 });
    // Named fields, not blobs: a person can read the drawing back.
    expect(file.annotations[0]?.geometry).toEqual({ x: 0.1, y: 0.2, w: 0.3, h: 0.1, rotation: 0 });
  });

  it("carries the space inside the geometry, so a pitch shape cannot import as a frame shape", () => {
    // The space qualifies the geometry's units, so it travels with them. That is
    // also why this needs no new field in the format: `geometry` is passed
    // through whole, and an older file simply has no `space` (which means frame).
    const pitched: AnalysisAnnotation = {
      uid: "annotation-pitch",
      eventKey: key,
      kind: "polygon",
      windowMode: "event",
      windowMs: 2_000,
      geometry: {
        x: -20,
        y: -10,
        w: 40,
        h: 20,
        rotation: 0.2,
        points: [
          [0, 0],
          [1, 0],
          [0.5, 1],
        ],
        space: "pitch",
      },
      style: { ...DEFAULT_STYLE, fillPattern: "crossHatch" },
      label: "Pressing triangle",
      z: 2,
    };

    const file = buildAnalysisFile({
      match: {
        homeTeam: "Manchester United",
        awayTeam: "Sabah",
        competition: null,
        season: null,
        kickoffAt: null,
        venue: null,
        notes: null,
      },
      videos: [video],
      events: [event],
      taxonomy: [],
      annotations: [pitched],
    });

    const parsed = parseAnalysisFile(JSON.stringify(file));
    expect(parsed).toMatchObject({
      annotations: [
        {
          uid: "annotation-pitch",
          label: "Pressing triangle",
          // Metres, the rotation, and the polygon's own points all survive: the
          // transfer passes the geometry through whole rather than by field.
          geometry: {
            space: "pitch",
            x: -20,
            y: -10,
            rotation: 0.2,
            points: [
              [0, 0],
              [1, 0],
              [0.5, 1],
            ],
          },
          // The pattern is part of the style, which also travels whole.
          style: { fillPattern: "crossHatch" },
        },
      ],
    });
  });

  it("defaults the sections to empty for a caller that has none", () => {
    const file = buildAnalysisFile({
      match: {
        homeTeam: "Manchester United",
        awayTeam: "Sabah",
        competition: null,
        season: null,
        kickoffAt: null,
        venue: null,
        notes: null,
      },
      videos: [video],
      events: [event],
      taxonomy: [],
    });

    expect(file.calibrations).toEqual([]);
    expect(file.annotations).toEqual([]);
    expect(file.positions).toEqual([]);
  });
});

describe("describeImport", () => {
  const file = buildAnalysisFile({
    match: {
      homeTeam: "Manchester United",
      awayTeam: "Sabah",
      competition: null,
      season: null,
      kickoffAt: 1,
      venue: null,
      notes: null,
    },
    videos: [video],
    events: [event],
    taxonomy: [{ name: "DEFENSE", color: null, tags: [] }],
  });

  it("says the match is already here", () => {
    const notes = describeImport(file, {
      teamNames: ["Manchester United", "Sabah"],
      matchKeys: ["Manchester United|Sabah|1"],
    });
    expect(notes.join(" ")).toMatch(/already in the library/);
  });

  it("lists the teams it would add", () => {
    const notes = describeImport(file, { teamNames: [], matchKeys: [] });
    expect(notes.join(" ")).toContain("Manchester United will be added");
    expect(notes.join(" ")).toContain("Sabah will be added");
  });

  it("counts what will be merged", () => {
    const notes = describeImport(file, { teamNames: [], matchKeys: [] });
    expect(notes.join(" ")).toContain("1 event");
    expect(notes.join(" ")).toContain("1 categories");
  });

  it("explains that a taxonomy import keeps what you have", () => {
    const notes = describeImport(buildTaxonomyFile([]), { teamNames: [], matchKeys: [] });
    expect(notes.join(" ")).toMatch(/keep their own colours and keys/i);
  });
});
