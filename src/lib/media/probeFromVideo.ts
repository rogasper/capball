import type { Video } from "@/lib/db/queries/videos";
import type { MediaProbe } from "@/lib/ipc";

/**
 * A stored video row rendered back into the shape the player and the transport
 * expect, so nothing downstream needs to know where the metadata came from.
 */
export function probeFromVideo(video: Video): MediaProbe {
  return {
    path: video.path,
    sizeBytes: video.sizeBytes ?? 0,
    container: video.container,
    durationMs: video.durationMs,
    width: video.width,
    height: video.height,
    fpsNum: video.fpsNum,
    fpsDen: video.fpsDen,
    videoCodec: video.videoCodec,
    audioCodec: video.audioCodec,
    faststart: video.faststart,
  };
}
