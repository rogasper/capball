import type { JobMode, MediaProbe } from "@/lib/ipc";

/**
 * Decides how an imported file must be prepared before a WebView can play it
 * (FR-1.4). Playback support belongs to the OS WebView, so the rule is: play it
 * directly when the container and codecs are known-good, remux when only the
 * container is the problem, and transcode when a codec cannot be copied.
 *
 * Pure on purpose — this is the kind of decision that must be testable without
 * a video file or a running app.
 */

export type PlaybackPlan =
  | { kind: "direct"; reason: string }
  | { kind: "prepare"; mode: JobMode; reason: string };

/** Video codecs the macOS WebView plays, and that can be stream-copied. */
const COPYABLE_VIDEO = new Set(["h264", "hevc"]);

/** Audio codecs that survive a stream copy into MP4 and play in the WebView. */
const COPYABLE_AUDIO = new Set(["aac", "mp3", "alac"]);

const PLAYABLE_CONTAINER = /(^|,)(mp4|m4v|mov|m4a)(,|$)/;

export function planPlayback(probe: MediaProbe): PlaybackPlan {
  const container = (probe.container ?? "").toLowerCase();
  const video = (probe.videoCodec ?? "").toLowerCase();
  const audio = (probe.audioCodec ?? "").toLowerCase();

  const containerIsPlayable = PLAYABLE_CONTAINER.test(container);
  const videoIsCopyable = COPYABLE_VIDEO.has(video);
  const audioIsCopyable = audio === "" || COPYABLE_AUDIO.has(audio);

  if (containerIsPlayable && videoIsCopyable && audioIsCopyable) {
    return {
      kind: "direct",
      reason: `${video.toUpperCase()} in a container the player supports`,
    };
  }

  if (videoIsCopyable && audioIsCopyable) {
    return {
      kind: "prepare",
      mode: "remux",
      reason: `${probe.container ?? "this container"} is not playable directly; copying the streams into MP4`,
    };
  }

  const blockers: string[] = [];
  if (!videoIsCopyable) blockers.push(`video codec ${probe.videoCodec ?? "unknown"}`);
  if (!audioIsCopyable) blockers.push(`audio codec ${probe.audioCodec ?? "unknown"}`);

  return {
    kind: "prepare",
    mode: "transcode",
    reason: `${blockers.join(" and ")} cannot be copied; re-encoding`,
  };
}
