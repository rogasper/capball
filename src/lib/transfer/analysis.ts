import type { EventRow } from "@/lib/db/queries/events";
import type { Video } from "@/lib/db/queries/videos";

/**
 * The analysis file (FR-10.3, FR-10.4).
 *
 * One documented, human-readable JSON document holding a match, the taxonomy it
 * refers to, and its events. Tags and videos are referenced **by name** rather
 * than by id, because ids mean nothing on another machine and a file that only
 * makes sense in one database is not portable.
 */

export const ANALYSIS_FORMAT = "capball.analysis";
export const ANALYSIS_VERSION = 1;

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
};

export type TaxonomyFile = {
  format: string;
  version: number;
  exportedAt: string;
  taxonomy: AnalysisCategory[];
};

export function buildAnalysisFile(input: {
  match: AnalysisFile["match"];
  videos: Video[];
  events: EventRow[];
  taxonomy: AnalysisCategory[];
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

  return candidate as AnalysisFile;
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
  } else {
    notes.push(`${file.taxonomy.length} categories will be merged into your taxonomy.`);
    notes.push("Tags you already have keep their own colours and keys.");
  }

  return notes;
}

export function matchKey(match: AnalysisFile["match"]): string {
  return `${match.homeTeam}|${match.awayTeam}|${match.kickoffAt ?? ""}`;
}
