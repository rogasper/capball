import type { AnnotationStyle, Geometry, TimeWindow } from "@/lib/annotate/types";
import type { EventRow } from "@/lib/db/queries/events";
import type { Video } from "@/lib/db/queries/videos";

/**
 * The analysis file (FR-10.3, FR-10.4, FR-40.3).
 *
 * One documented, human-readable JSON document holding a match, the taxonomy it
 * refers to, its events, and — from version 2 — the drawings, the calibration
 * and the positions that belong to those events. Tags and videos are referenced
 * **by name** rather than by id, because ids mean nothing on another machine and
 * a file that only makes sense in one database is not portable.
 *
 * Version 2 stays readable by a person: a drawing is named fields rather than a
 * blob, and an event is addressed by a key made of things a reader can see
 * (its video's file name, its tag, and the moment).
 */

export const ANALYSIS_FORMAT = "capball.analysis";
export const ANALYSIS_VERSION = 2;

export type AnalysisTag = {
  name: string;
  color: string | null;
  shortcutKey: string | null;
  /** Names its parent tag, so a nested vocabulary survives the trip. */
  parent: string | null;
};

export type AnalysisCategory = {
  name: string;
  color: string | null;
  tags: AnalysisTag[];
};

export type AnalysisVideo = {
  fileName: string;
  durationMs: number;
  width: number | null;
  height: number | null;
  fpsNum: number | null;
  fpsDen: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  container: string | null;
};

export type AnalysisEvent = {
  videoFileName: string;
  category: string;
  tag: string;
  team: string | null;
  player: string | null;
  anchorMs: number;
  startMs: number;
  endMs: number;
  notes: string | null;
};

/** A calibration's reference point, named the way the app names it. */
export type AnalysisCalibrationPoint = {
  feature: string;
  imageU: number;
  imageV: number;
  xM: number;
  yM: number;
};

export type AnalysisCalibration = {
  videoFileName: string;
  fromMs: number;
  pitchLengthM: number;
  pitchWidthM: number;
  rmsErrorPx: number;
  points: AnalysisCalibrationPoint[];
};

export type AnalysisAnnotation = {
  /** Client-generated identity, which makes a repeated import a no-op (D21). */
  uid: string;
  eventKey: string;
  kind: string;
  windowMode: string;
  windowMs: number;
  /**
   * A drawing's own on-screen range (FR-20.16), or null when it follows its
   * event. **Additive**: a file written before this release has no such field and
   * imports with no range, and a reader that does not know it ignores it — which
   * is why it rides in the existing version rather than forcing a bump alone.
   */
  ownWindow?: TimeWindow | null;
  geometry: Geometry;
  style: AnnotationStyle;
  label: string | null;
  z: number;
};

export type AnalysisPosition = {
  uid: string;
  eventKey: string;
  teamName: string;
  playerName: string;
  shirtNumber: number | null;
  /** What the user asserted, in metres from the centre of the pitch. */
  xM: number;
  yM: number;
  /** The click that produced it, kept as provenance. */
  imageU: number;
  imageV: number;
};

export type AnalysisFile = {
  format: string;
  version: number;
  exportedAt: string;
  match: {
    homeTeam: string;
    awayTeam: string;
    competition: string | null;
    season: string | null;
    kickoffAt: number | null;
    venue: string | null;
    notes: string | null;
  };
  taxonomy: AnalysisCategory[];
  videos: AnalysisVideo[];
  events: AnalysisEvent[];
  calibrations: AnalysisCalibration[];
  annotations: AnalysisAnnotation[];
  positions: AnalysisPosition[];
};

export type TaxonomyFile = {
  format: string;
  version: number;
  exportedAt: string;
  taxonomy: AnalysisCategory[];
};

/**
 * How an annotation or a position names the event it belongs to.
 *
 * `videoFileName|tag|anchorMs`. A person can read it, and it survives the trip
 * to another machine, where row ids mean nothing. `|` cannot appear in a file
 * name on any platform the app runs on, so a split on the first and last
 * separator is unambiguous even if a tag contains one.
 */
export function eventKeyOf(videoFileName: string, tag: string, anchorMs: number): string {
  return `${videoFileName}|${tag}|${Math.round(anchorMs)}`;
}

export function parseEventKey(key: string): {
  videoFileName: string;
  tag: string;
  anchorMs: number;
} | null {
  const first = key.indexOf("|");
  const last = key.lastIndexOf("|");
  if (first <= 0 || last <= first) return null;

  const anchorMs = Number(key.slice(last + 1));
  if (!Number.isFinite(anchorMs)) return null;

  return {
    videoFileName: key.slice(0, first),
    tag: key.slice(first + 1, last),
    anchorMs: Math.round(anchorMs),
  };
}

export function buildAnalysisFile(input: {
  match: AnalysisFile["match"];
  videos: Video[];
  events: EventRow[];
  taxonomy: AnalysisCategory[];
  calibrations?: AnalysisCalibration[];
  annotations?: AnalysisAnnotation[];
  positions?: AnalysisPosition[];
  now?: Date;
}): AnalysisFile {
  return {
    format: ANALYSIS_FORMAT,
    version: ANALYSIS_VERSION,
    exportedAt: (input.now ?? new Date()).toISOString(),
    match: input.match,
    taxonomy: input.taxonomy,
    videos: input.videos.map((video) => ({
      fileName: video.fileName,
      durationMs: video.durationMs,
      width: video.width,
      height: video.height,
      fpsNum: video.fpsNum,
      fpsDen: video.fpsDen,
      videoCodec: video.videoCodec,
      audioCodec: video.audioCodec,
      container: video.container,
    })),
    events: input.events.map((event) => ({
      videoFileName: input.videos.find((video) => video.id === event.videoId)?.fileName ?? "",
      category: event.categoryName,
      tag: event.tagName,
      team: event.teamName,
      player: event.playerName,
      anchorMs: event.anchorMs,
      startMs: event.startMs,
      endMs: event.endMs,
      notes: event.notes,
    })),
    calibrations: input.calibrations ?? [],
    annotations: input.annotations ?? [],
    positions: input.positions ?? [],
  };
}

export function buildTaxonomyFile(taxonomy: AnalysisCategory[], now = new Date()): TaxonomyFile {
  return {
    format: ANALYSIS_FORMAT,
    version: ANALYSIS_VERSION,
    exportedAt: now.toISOString(),
    taxonomy,
  };
}

/** Throws with a plain explanation rather than half-reading a file. */
export function parseAnalysisFile(text: string): AnalysisFile | TaxonomyFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("That file is not valid JSON.");
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("That file does not look like a capball export.");
  }

  const candidate = parsed as Partial<AnalysisFile>;
  if (candidate.format !== ANALYSIS_FORMAT) {
    throw new Error("That file was not written by capball.");
  }
  if (typeof candidate.version !== "number" || candidate.version > ANALYSIS_VERSION) {
    throw new Error(
      `That file was written by a newer version of capball (${String(candidate.version)}).`,
    );
  }
  if (!Array.isArray(candidate.taxonomy)) {
    throw new Error("That file has no taxonomy in it.");
  }

  // A taxonomy file carries no events, so there is nothing for the R1 sections
  // to belong to and it is returned as it stands.
  if (!("match" in candidate)) return candidate as TaxonomyFile;

  // A version 1 analysis file has no drawings, calibration or positions. Absent
  // means empty rather than an error, which is what keeps R0's files importable.
  return {
    ...(candidate as AnalysisFile),
    calibrations: Array.isArray(candidate.calibrations) ? candidate.calibrations : [],
    annotations: Array.isArray(candidate.annotations) ? candidate.annotations : [],
    positions: Array.isArray(candidate.positions) ? candidate.positions : [],
  };
}

export function isAnalysisFile(file: AnalysisFile | TaxonomyFile): file is AnalysisFile {
  return "match" in file;
}

/** What an import would do, said plainly before it does anything. */
export function describeImport(
  file: AnalysisFile | TaxonomyFile,
  existing: { teamNames: string[]; matchKeys: string[] },
): string[] {
  const notes: string[] = [];
  const teams = new Set(existing.teamNames);

  if (isAnalysisFile(file)) {
    const key = matchKey(file.match);
    if (existing.matchKeys.includes(key)) {
      notes.push(`${file.match.homeTeam} vs ${file.match.awayTeam} is already in the library.`);
    }
    for (const name of [file.match.homeTeam, file.match.awayTeam]) {
      if (!teams.has(name)) notes.push(`${name} will be added as a new team.`);
    }
    notes.push(
      `${file.events.length} event${file.events.length === 1 ? "" : "s"} and ${file.taxonomy.length} categories will be merged.`,
    );
    if (file.annotations.length > 0) {
      notes.push(
        `${file.annotations.length} drawing${file.annotations.length === 1 ? "" : "s"} and ${file.positions.length} position${file.positions.length === 1 ? "" : "s"} travel with them.`,
      );
    }
    if (file.calibrations.length > 0) {
      const videos = new Set(file.calibrations.map((calibration) => calibration.videoFileName));
      notes.push(
        `${videos.size} video${videos.size === 1 ? "" : "s"} carr${videos.size === 1 ? "ies" : "y"} a pitch calibration.`,
      );
    }
  } else {
    notes.push(`${file.taxonomy.length} categories will be merged into your taxonomy.`);
    notes.push("Tags you already have keep their own colours and keys.");
  }

  return notes;
}

export function matchKey(match: AnalysisFile["match"]): string {
  return `${match.homeTeam}|${match.awayTeam}|${match.kickoffAt ?? ""}`;
}
