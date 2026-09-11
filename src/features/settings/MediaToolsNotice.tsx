import { TriangleAlert } from "lucide-react";
import { useSettingsStore } from "@/stores/settingsStore";

/**
 * First-run guidance (FR-9.6 / ADR 0003): the app depends on FFmpeg being
 * present, so say so plainly instead of failing later at export time.
 */
export function MediaToolsNotice() {
  const tools = useSettingsStore((state) => state.tools);
  if (!tools || (tools.ffmpeg && tools.ffprobe)) return null;

  return (
    <div
      role="alert"
      className="flex items-start gap-3 border-b border-warning/40 bg-warning/10 px-4 py-3 text-body"
    >
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
      <div className="space-y-1">
        <p className="font-medium">FFmpeg was not found on this computer</p>
        <p className="text-muted-foreground">
          capball uses FFmpeg to read video details and to prepare files the player cannot open
          directly. Install it, then reopen the app:
        </p>
        <p className="font-mono text-label text-muted-foreground">brew install ffmpeg</p>
      </div>
    </div>
  );
}
