import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { videos } from "@/lib/db/schema";

export type Video = typeof videos.$inferSelect;

export async function listVideos(matchId: number): Promise<Video[]> {
  return db
    .select()
    .from(videos)
    .where(eq(videos.matchId, matchId))
    .orderBy(asc(videos.createdAt), asc(videos.id));
}

/** Every source path in the library, for the cache policy (NFR-22). */
export async function listAllVideoPaths(): Promise<string[]> {
  const rows = await db
    .select({ path: videos.path, playbackPath: videos.playbackPath })
    .from(videos);

  return rows.flatMap((row) =>
    row.playbackPath && row.playbackPath !== row.path ? [row.path, row.playbackPath] : [row.path],
  );
}

export async function getVideo(id: number): Promise<Video | undefined> {
  const rows = await db.select().from(videos).where(eq(videos.id, id)).limit(1);
  return rows[0];
}

export async function addVideo(input: {
  matchId: number;
  path: string;
  fileName: string;
  playbackPath?: string | null;
  sizeBytes?: number | null;
  durationMs: number;
  width?: number | null;
  height?: number | null;
  fpsNum?: number | null;
  fpsDen?: number | null;
  videoCodec?: string | null;
  audioCodec?: string | null;
  container?: string | null;
  faststart?: boolean | null;
}): Promise<Video> {
  const [row] = await db
    .insert(videos)
    .values({
      matchId: input.matchId,
      path: input.path,
      fileName: input.fileName,
      playbackPath: input.playbackPath ?? null,
      sizeBytes: input.sizeBytes ?? null,
      durationMs: input.durationMs,
      width: input.width ?? null,
      height: input.height ?? null,
      fpsNum: input.fpsNum ?? null,
      fpsDen: input.fpsDen ?? null,
      videoCodec: input.videoCodec ?? null,
      audioCodec: input.audioCodec ?? null,
      container: input.container ?? null,
      faststart: input.faststart ?? null,
    })
    .returning();
  return row;
}

/**
 * Records the index placement for a file imported before it was checked, so the
 * probe only has to run once per legacy row.
 */
export async function setVideoFaststart(id: number, faststart: boolean | null): Promise<void> {
  await db.update(videos).set({ faststart }).where(eq(videos.id, id));
}

export async function setPlaybackPath(id: number, playbackPath: string): Promise<void> {
  await db.update(videos).set({ playbackPath }).where(eq(videos.id, id));
}

export async function removeVideo(id: number): Promise<void> {
  await db.delete(videos).where(eq(videos.id, id));
}
