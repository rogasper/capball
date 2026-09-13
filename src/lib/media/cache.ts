import { listAllVideoPaths } from "@/lib/db/queries/videos";
import { ipc } from "@/lib/ipc";

/**
 * The cache policy (NFR-22, carried from M6).
 *
 * Everything the app derives from a video lives in the app cache, never beside
 * the footage: a prepared playback copy, extracted frames, thumbnails, and the
 * overlay PNGs an annotated export is built from. A library used for months
 * would otherwise grow without bound, so the policy is stated rather than
 * implied:
 *
 * - **Keyed by the source file** — prepared copies, frames, thumbnails — is kept
 *   exactly while the library still references that source. Remove the video and
 *   its derived copies go too; open it again and they are rebuilt on demand.
 * - **Export scratch** has no reference to check, so age is the only honest
 *   test. A day is far longer than any export run.
 */

/** How long export scratch — overlay PNGs, concat lists — may sit before it goes. */
export const SCRATCH_MAX_AGE_SECONDS = 24 * 60 * 60;

export type CacheReport = { removedFiles: number; freedBytes: number };

/** Asks Rust to apply the policy; Rust does the file work, this says what to keep. */
export async function pruneCaches(): Promise<CacheReport> {
  return ipc.pruneCache(await listAllVideoPaths(), SCRATCH_MAX_AGE_SECONDS);
}

export function describeCacheReport(report: CacheReport): string {
  if (report.removedFiles === 0) return "The cache was already tidy — nothing to remove.";
  return `Removed ${report.removedFiles} file${report.removedFiles === 1 ? "" : "s"}, freeing ${formatBytes(report.freedBytes)}.`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
