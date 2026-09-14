import { useEffect } from "react";
import { playback } from "@/lib/playback";
import { usePhaseStore } from "@/stores/phaseStore";

/**
 * The two things an open phase needs from the clock (FR-55.4).
 *
 * 1. **The last position it was seen at**, written at most every five seconds,
 *    so an interrupted phase can be closed at what was observed rather than at
 *    the end of the video.
 * 2. **The end of the footage**, which closes whatever is still open — there is
 *    no time left to record, and a phase that stayed open would be a duration
 *    nobody observed.
 *
 * Both are subscriptions and neither publishes to a store, which is what keeps
 * playback time out of React state (architecture rule 4). This is bookkeeping:
 * the growing bar is the timeline's own frame write, because it owns the element.
 */
export function usePhaseClock(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;

    const offFrame = playback.onFrame((timeMs) => {
      const { open, touch } = usePhaseStore.getState();
      for (const phase of open) touch(phase.eventId, timeMs);
    });

    const offState = playback.onState((state) => {
      if (!state.ended) return;
      const { open, closeAllForVideoEnd } = usePhaseStore.getState();
      if (open.length > 0) void closeAllForVideoEnd(state.durationMs);
    });

    return () => {
      offFrame();
      offState();
    };
  }, [enabled]);
}
