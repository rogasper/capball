import { useEffect } from "react";
import { playback } from "@/lib/playback";
import { frameDurationMs } from "@/lib/time/timecode";
import { useLibraryStore } from "@/stores/libraryStore";

const NUDGE_MS = 5_000;

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

/**
 * Transport shortcuts (FR-2, NFR-9).
 *
 * Number keys are deliberately left alone: they belong to tagging (M3), and a
 * key that means two different things is worse than no shortcut at all.
 */
export function useTransportKeys(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;

    const step = (direction: 1 | -1, oneFrame: boolean) => {
      if (!oneFrame) {
        playback.nudge(direction * NUDGE_MS);
        return;
      }
      const { probe } = useLibraryStore.getState();
      const frameMs = frameDurationMs(probe?.fpsNum ?? null, probe?.fpsDen ?? null);
      playback.nudge(direction * (frameMs ?? 1000 / 30));
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;

      switch (event.code) {
        case "Space":
          event.preventDefault();
          playback.toggle();
          return;
        case "ArrowLeft":
          event.preventDefault();
          step(-1, event.shiftKey);
          return;
        case "ArrowRight":
          event.preventDefault();
          step(1, event.shiftKey);
          return;
        default:
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
}
