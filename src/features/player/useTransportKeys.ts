import { useEffect } from "react";
import { isTypingTarget } from "@/lib/keyboard/typing";
import { playback } from "@/lib/playback";
import { frameDurationMs } from "@/lib/time/timecode";
import { useLibraryStore } from "@/stores/libraryStore";

const NUDGE_MS = 5_000;

/** True when the keystroke is being typed at the tab row rather than the player. */
function isInsideTabList(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('[role="tablist"]') !== null;
}

/**
 * Transport shortcuts (FR-2, NFR-9).
 *
 * Number keys are deliberately left alone: they belong to tagging (M3), and a
 * key that means two different things is worse than no shortcut at all.
 *
 * The tab row is the other exception, and it exists because of a real report:
 * seeking with the arrow keys while a tab had focus moved and **selected** the
 * neighbouring tab, so the panel walked sideways during playback. Inside the tab
 * list the arrows belong to the tabs (WAI-ARIA expects it); everywhere else they
 * belong to the transport.
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

      // Space plays from anywhere, tab row included: it is this app's primary
      // key, and a tab can still be selected with Enter.
      if (event.code === "Space") {
        event.preventDefault();
        playback.toggle();
        return;
      }

      // The arrows are the tabs' while the tab row has focus.
      if (isInsideTabList(event.target)) return;

      switch (event.code) {
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
