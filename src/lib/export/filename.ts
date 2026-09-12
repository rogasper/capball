import { formatTimecode } from "@/lib/time/timecode";

/**
 * Export file naming (FR-9.4).
 *
 * Pure, because a name that collides or contains a path separator is a data-loss
 * bug rather than a cosmetic one: the export refuses to overwrite, so the plan
 * has to be computed before anything touches the disk.
 */

export const DEFAULT_TEMPLATE = "{match}_{tag}_{time}";
export const AVAILABLE_PLACEHOLDERS = ["match", "tag", "time", "competition", "index"] as const;

export type NamingContext = {
  homeTeam: string;
  awayTeam: string;
  competition: string | null;
};

export type NamingRequest = {
  id: number;
  tag: string;
  anchorMs: number;
};

export type PlannedName = {
  id: number;
  fileName: string;
  /** The earlier event this name collides with, within the same batch. */
  duplicateOf: number | null;
};

/** Control characters are invisible in a file name and some are illegal outright. */
function stripControlCharacters(text: string): string {
  return [...text]
    .filter((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127)
    .join("");
}

/** Removes anything a filesystem would object to, and keeps names readable. */
export function sanitizeSegment(text: string, maxLength = 60): string {
  const cleaned = stripControlCharacters(text)
    // Path separators become dashes, so "../etc/passwd" reads as "etc-passwd"
    // rather than losing the word boundary.
    .replace(/[/\\]+/g, "-")
    .replace(/[:*?"<>|]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+/, "")
    .replace(/[-.]+$/, "")
    .slice(0, maxLength)
    .replace(/[-.]+$/, "");

  return cleaned || "untitled";
}

/** Colons and dots are unreadable or illegal in file names, so they become dashes. */
export function timecodeForFilename(ms: number): string {
  return formatTimecode(Math.max(0, Math.round(ms))).replace(/[:.]/g, "-");
}

export function renderFilename(
  template: string,
  context: NamingContext,
  request: NamingRequest,
  index: number,
): string {
  const values: Record<string, string> = {
    match: sanitizeSegment(`${context.homeTeam}-vs-${context.awayTeam}`),
    tag: sanitizeSegment(request.tag),
    time: timecodeForFilename(request.anchorMs),
    competition: sanitizeSegment(context.competition ?? "match"),
    index: String(index),
  };

  const rendered = template.replace(/\{(\w+)\}/g, (whole, key: string) => values[key] ?? whole);

  // One sanitising pass over the result, then the extension, which is ours and
  // must survive whatever the template produced.
  return `${sanitizeSegment(rendered, 120)}.mp4`;
}

/**
 * Names every request up front, flagging collisions inside the batch.
 *
 * A template without `{index}` can repeat itself — two events of the same tag at
 * the same moment, say. Those are reported rather than auto-suffixed, because
 * silently renaming someone's clip is the same class of surprise as overwriting it.
 */
export function planNames(
  requests: NamingRequest[],
  template: string,
  context: NamingContext,
): PlannedName[] {
  const seen = new Map<string, number>();

  return requests.map((request, position) => {
    const fileName = renderFilename(template, context, request, position + 1);
    const previous = seen.get(fileName) ?? null;
    if (previous === null) seen.set(fileName, request.id);

    return { id: request.id, fileName, duplicateOf: previous };
  });
}

export function describeConflicts(planned: PlannedName[], existing: Set<string>): string[] {
  const problems: string[] = [];

  for (const item of planned) {
    if (item.duplicateOf !== null) {
      problems.push(`${item.fileName} is produced twice in this export.`);
    } else if (existing.has(item.fileName)) {
      problems.push(`${item.fileName} already exists in that folder.`);
    }
  }

  return problems;
}
