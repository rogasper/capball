import { useEffect } from "react";
import type { Tag } from "@/lib/db/queries/taxonomy";
import { isTypingTarget } from "@/lib/keyboard/typing";
import { playback } from "@/lib/playback";
import { findTagByShortcut } from "@/lib/taxonomy/rules";
import { clipRange } from "@/lib/time/timecode";
import { useEventStore } from "@/stores/eventStore";
import { useLibraryStore } from "@/stores/libraryStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useTagStore } from "@/stores/tagStore";
import { buildEventDraft } from "./captureContext";

/**
 * One keystroke, one event (FR-5).
 *
 * The tag map comes from the database, not from a hardcoded list, and the
 * player's live position comes from the playback controller rather than React
 * state — so a capture records the moment the key was pressed, not the moment
 * the UI last rendered.
 */
async function captureNow(tag: Tag): Promise<void> {
  const { insert, reportError } = useEventStore.getState();
  const settings = useSettingsStore.getState();
  const durationMs = useLibraryStore.getState().probe?.durationMs ?? playback.durationMs;

  // One reading of the playhead, so the moment and the range around it agree.
  const anchorMs = playback.timeMs;
  const times = {
    anchorMs,
    ...clipRange(anchorMs, settings.preRollMs, settings.postRollMs, durationMs),
  };

  try {
    await insert(buildEventDraft(tag, times));
  } catch (error) {
    reportError(error instanceof Error ? error.message : String(error));
  }
}

export function useCaptureKeys(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;

      // Undo the last capture, even if that same letter is also bound to a tag.
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        void useEventStore.getState().undoLast();
        return;
      }

      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const tag = findTagByShortcut(useTagStore.getState().tags, event.key);
      if (!tag) return;

      event.preventDefault();
      void captureNow(tag);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
}
