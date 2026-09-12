import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";

/**
 * The only module allowed to import `@tauri-apps/*`.
 *
 * Everything else imports from here, so features stay testable without a
 * running Tauri shell and the IPC surface stays in one reviewable place.
 * Types mirror the Rust structs in `src-tauri/src/`.
 */

export type ToolStatus = {
  ffmpeg: boolean;
  ffprobe: boolean;
  ffmpegVersion: string | null;
};

export type FileStatus = {
  exists: boolean;
  sizeBytes: number | null;
};

export type MediaProbe = {
  path: string;
  sizeBytes: number;
  container: string | null;
  durationMs: number;
  width: number | null;
  height: number | null;
  fpsNum: number | null;
  fpsDen: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  /** Index before media data. Null when it does not apply or is unknown. */
  faststart: boolean | null;
};

export type JobState = "running" | "done" | "failed" | "cancelled";
export type ExportMode = "fast" | "accurate";
export type JobMode = "remux" | "transcode";

export type JobEvent = {
  jobId: string;
  kind: string;
  state: JobState;
  outTimeMs: number;
  totalMs: number;
  message: string | null;
};

export type MediaJob = {
  jobId: string;
  output: string;
  /** True when an already-prepared file was reused and nothing was started. */
  reused: boolean;
};

const JOB_EVENT = "capball://job";

const VIDEO_EXTENSIONS = ["mp4", "m4v", "mov", "mkv", "webm", "avi", "ts", "mpg", "mpeg"];

export const ipc = {
  /** Let the asset protocol serve one user-chosen file. */
  registerAssetPath(path: string): Promise<void> {
    return invoke("register_asset_path", { path });
  },

  checkMediaTools(): Promise<ToolStatus> {
    return invoke("check_media_tools");
  },

  fileStatus(path: string): Promise<FileStatus> {
    return invoke("file_status", { path });
  },

  probeMedia(path: string): Promise<MediaProbe> {
    return invoke("probe_media", { path });
  },

  startMediaJob(input: string, mode: JobMode, totalMs: number): Promise<MediaJob> {
    return invoke("start_media_job", { input, mode, totalMs });
  },

  cancelJob(jobId: string): Promise<void> {
    return invoke("cancel_job", { jobId });
  },

  /** Cuts one clip to a destination the user chose. Refuses to overwrite. */
  startExport(
    input: string,
    output: string,
    startMs: number,
    endMs: number,
    mode: ExportMode,
  ): Promise<MediaJob> {
    return invoke("start_export", { input, output, startMs, endMs, mode });
  },

  /** Joins rendered clips into one file, in the order given. */
  startConcat(inputs: string[], output: string, totalMs: number): Promise<MediaJob> {
    return invoke("start_concat", { inputs, output, totalMs });
  },

  /** Opens a URL in the user's browser, e.g. the FFmpeg download page. */
  openExternal(url: string): Promise<void> {
    return openUrl(url);
  },

  /** Shows a written file in Finder, so the user can see what was produced. */
  revealInFolder(path: string): Promise<void> {
    return revealItemInDir(path);
  },

  /** Where clips go unless the user chooses elsewhere. Created on demand. */
  defaultExportDir(): Promise<string> {
    return invoke("default_export_dir");
  },

  pickFolder(): Promise<string | null> {
    return open({
      directory: true,
      multiple: false,
      title: "Choose where to save clips",
    }) as Promise<string | null>;
  },

  /**
   * Renders one frame to a cached JPEG and returns its path. The path is keyed
   * by the source file and the timestamp, so asking twice costs nothing.
   */
  extractThumbnail(input: string, atMs: number): Promise<string> {
    return invoke("extract_thumbnail", { input, atMs });
  },

  pickVideoFile(): Promise<string | null> {
    return open({
      multiple: false,
      directory: false,
      title: "Choose a match video",
      filters: [{ name: "Video", extensions: VIDEO_EXTENSIONS }],
    }) as Promise<string | null>;
  },

  /** A URL the WebView can load for a file registered above. */
  assetUrl(path: string): string {
    return convertFileSrc(path);
  },

  onJobEvent(handler: (event: JobEvent) => void): Promise<UnlistenFn> {
    return listen<JobEvent>(JOB_EVENT, (event) => handler(event.payload));
  },
};
