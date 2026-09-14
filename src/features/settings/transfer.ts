import { listAnnotations, listAnnotationWindows } from "@/lib/db/queries/annotations";
import { listCalibrations } from "@/lib/db/queries/calibrations";
import type { EventRow } from "@/lib/db/queries/events";
import { listEvents } from "@/lib/db/queries/events";
import { type ImportSummary, importAnalysis, mergeTaxonomy } from "@/lib/db/queries/import";
import { getMatch, listMatches } from "@/lib/db/queries/matches";
import { listPositions } from "@/lib/db/queries/positions";
import { listCategories, listTags } from "@/lib/db/queries/taxonomy";
import { listTeams } from "@/lib/db/queries/teams";
import { listVideos, type Video } from "@/lib/db/queries/videos";
import { ipc } from "@/lib/ipc";
import {
  type AnalysisAnnotation,
  type AnalysisCalibration,
  type AnalysisCategory,
  type AnalysisPosition,
  buildAnalysisFile,
  buildTaxonomyFile,
  eventKeyOf,
  isAnalysisFile,
  parseAnalysisFile,
} from "@/lib/transfer/analysis";

/** Exporting and importing analysis files (FR-10.3, FR-10.4). */

function safeName(text: string): string {
  return (
    text
      .replace(/[/\\:*?"<>|]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 60) || "capball"
  );
}

export async function readTaxonomyExport(): Promise<AnalysisCategory[]> {
  const [categories, tags] = await Promise.all([listCategories(), listTags()]);
  const nameOf = new Map(tags.map((tag) => [tag.id, tag.name]));

  return categories.map((category) => ({
    name: category.name,
    color: category.color,
    tags: tags
      .filter((tag) => tag.categoryId === category.id)
      .map((tag) => ({
        name: tag.name,
        color: tag.color,
        shortcutKey: tag.shortcutKey,
        parent: tag.parentId === null ? null : (nameOf.get(tag.parentId) ?? null),
      })),
  }));
}

async function writeJson(defaultName: string, contents: string): Promise<string> {
  const path = await ipc.saveJsonFile(defaultName);
  if (!path) return "Nothing was written.";

  await ipc.writeTextFile(path, contents);
  return `Wrote ${path}.`;
}

/** A complete, human-readable copy of one match. */
export async function exportMatchAnalysis(matchId: number): Promise<string> {
  const [match, summaries, videos, events, taxonomy] = await Promise.all([
    getMatch(matchId),
    listMatches(),
    listVideos(matchId),
    listEvents(matchId),
    readTaxonomyExport(),
  ]);
  if (!match) throw new Error("That match is no longer in the library.");

  // The drawings, positions and calibrations that belong to this match's events
  // travel with it (FR-40.3). Calibrations hang off the video, not the event,
  // because one calibration serves every event in it.
  const [calibrations, annotations, positions] = await Promise.all([
    collectCalibrations(videos),
    collectAnnotations(videos, events),
    collectPositions(videos, events),
  ]);

  const summary = summaries.find((candidate) => candidate.id === matchId);
  const file = buildAnalysisFile({
    match: {
      homeTeam: summary?.homeTeam ?? "Home",
      awayTeam: summary?.awayTeam ?? "Away",
      competition: match.competition,
      season: match.season,
      kickoffAt: match.kickoffAt,
      venue: match.venue,
      notes: match.notes,
    },
    videos,
    events,
    taxonomy,
    calibrations,
    annotations,
    positions,
  });

  return writeJson(
    `${safeName(`${file.match.homeTeam}-vs-${file.match.awayTeam}`)}-analysis.json`,
    JSON.stringify(file, null, 2),
  );
}

async function collectCalibrations(videos: Video[]): Promise<AnalysisCalibration[]> {
  const groups = await Promise.all(
    videos.map(async (video) => {
      const stored = await listCalibrations(video.id);
      return stored.map((calibration) => ({
        videoFileName: video.fileName,
        fromMs: calibration.fromMs,
        pitchLengthM: calibration.pitchLengthM,
        pitchWidthM: calibration.pitchWidthM,
        rmsErrorPx: calibration.rmsErrorPx,
        points: calibration.points.map((point) => ({
          feature: point.feature,
          imageU: point.imageU,
          imageV: point.imageV,
          xM: point.xM,
          yM: point.yM,
        })),
      }));
    }),
  );
  return groups.flat();
}

/** How a drawing or a position names the event it belongs to, on the way out. */
function eventKeys(videos: Video[], events: EventRow[]): Map<number, string> {
  const nameById = new Map(videos.map((video) => [video.id, video.fileName]));
  return new Map(
    events.map((event) => [
      event.id,
      eventKeyOf(nameById.get(event.videoId) ?? "", event.tagName, event.anchorMs),
    ]),
  );
}

async function collectAnnotations(
  videos: Video[],
  events: EventRow[],
): Promise<AnalysisAnnotation[]> {
  const keys = eventKeys(videos, events);
  const groups = await Promise.all(
    events.map(async (event) => {
      const [rows, windows] = await Promise.all([
        listAnnotations(event.id),
        listAnnotationWindows(event.id),
      ]);
      const eventKey = keys.get(event.id) ?? "";
      return rows.map((row) => ({
        uid: row.uid,
        eventKey,
        kind: row.kind,
        windowMode: row.windowMode,
        windowMs: row.windowMs,
        // Carried so a drawing's own time survives a transfer; absent in a file
        // written before FR-20.16, which reads back as no range.
        ownWindow: windows.get(row.id) ?? null,
        geometry: row.geometry,
        style: row.style,
        label: row.label,
        z: row.z,
      }));
    }),
  );
  return groups.flat();
}

async function collectPositions(videos: Video[], events: EventRow[]): Promise<AnalysisPosition[]> {
  const keys = eventKeys(videos, events);
  const groups = await Promise.all(
    events.map(async (event) => {
      const rows = await listPositions(event.id);
      const eventKey = keys.get(event.id) ?? "";
      return rows.map((row) => ({
        uid: row.uid,
        eventKey,
        teamName: row.teamName,
        playerName: row.playerName,
        shirtNumber: row.shirtNumber,
        xM: row.xM,
        yM: row.yM,
        imageU: row.imageU,
        imageV: row.imageV,
      }));
    }),
  );
  return groups.flat();
}

/** Just the vocabulary, so it can be passed to another person. */
export async function exportTaxonomy(): Promise<string> {
  const file = buildTaxonomyFile(await readTaxonomyExport());
  return writeJson("capball-taxonomy.json", JSON.stringify(file, null, 2));
}

export function describeImportOutcome(summary: ImportSummary): string {
  const parts: string[] = [];
  if (summary.teamsCreated > 0) parts.push(`${summary.teamsCreated} new teams`);
  if (summary.categoriesCreated > 0) parts.push(`${summary.categoriesCreated} new categories`);
  if (summary.tagsCreated > 0) parts.push(`${summary.tagsCreated} new tags`);
  if (summary.tagsKept > 0) parts.push(`${summary.tagsKept} tags already here`);
  if (summary.eventsCreated > 0) parts.push(`${summary.eventsCreated} events imported`);
  if (summary.eventsSkipped > 0) parts.push(`${summary.eventsSkipped} events skipped`);
  if (summary.calibrationsCreated > 0) parts.push(`${summary.calibrationsCreated} calibrations`);
  if (summary.annotationsCreated > 0) parts.push(`${summary.annotationsCreated} drawings`);
  if (summary.positionsCreated > 0) parts.push(`${summary.positionsCreated} positions`);

  return parts.length > 0 ? `Merged: ${parts.join(", ")}.` : "Nothing new to merge.";
}

export type ImportReport = { message: string; notes: string[] };

export async function importFile(): Promise<ImportReport | null> {
  const path = await ipc.pickJsonFile();
  if (!path) return null;

  const file = parseAnalysisFile(await ipc.readTextFile(path));
  const summary = isAnalysisFile(file)
    ? await importAnalysis(file)
    : await mergeTaxonomy(file.taxonomy);

  return { message: describeImportOutcome(summary), notes: summary.notes };
}

/** Teams already in the library, for the preview line the panel shows. */
export async function libraryTeamNames(): Promise<string[]> {
  return (await listTeams()).map((team) => team.name);
}
