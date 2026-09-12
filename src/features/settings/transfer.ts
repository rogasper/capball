import { listEvents } from "@/lib/db/queries/events";
import { type ImportSummary, importAnalysis, mergeTaxonomy } from "@/lib/db/queries/import";
import { getMatch, listMatches } from "@/lib/db/queries/matches";
import { listCategories, listTags } from "@/lib/db/queries/taxonomy";
import { listTeams } from "@/lib/db/queries/teams";
import { listVideos } from "@/lib/db/queries/videos";
import { ipc } from "@/lib/ipc";
import {
  type AnalysisCategory,
  buildAnalysisFile,
  buildTaxonomyFile,
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
  });

  return writeJson(
    `${safeName(`${file.match.homeTeam}-vs-${file.match.awayTeam}`)}-analysis.json`,
    JSON.stringify(file, null, 2),
  );
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
