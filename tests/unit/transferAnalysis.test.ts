import { describe, expect, it } from "vitest";
import type { EventRow } from "@/lib/db/queries/events";
import type { Video } from "@/lib/db/queries/videos";
import {
  ANALYSIS_FORMAT,
  ANALYSIS_VERSION,
  type AnalysisFile,
  buildAnalysisFile,
  buildTaxonomyFile,
  describeImport,
  isAnalysisFile,
  parseAnalysisFile,
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
});

describe("isAnalysisFile", () => {
  it("tells a whole match from a taxonomy", () => {
    const taxonomy = buildTaxonomyFile([]);
    const analysis = { ...taxonomy, match: {} } as unknown as AnalysisFile;

    expect(isAnalysisFile(taxonomy)).toBe(false);
    expect(isAnalysisFile(analysis)).toBe(true);
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
