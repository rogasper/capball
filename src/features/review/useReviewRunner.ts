import { useEffect } from "react";
import { playback } from "@/lib/playback";
import { useReviewStore } from "@/stores/reviewStore";

/**
 * Drives review mode from the playhead.
 *
 * Subscribing to the controller rather than watching React state is what keeps
 * the advance check off the render path: it runs on the same animation frame as
 * the playhead and only touches the store when a clip actually finishes.
 */
export function useReviewRunner(): void {
  useEffect(
    () =>
      playback.onFrame((timeMs) => {
        const state = useReviewStore.getState();
        if (!state.active) return;

        const current = state.queue[state.index];
        if (!current) return;

        if (timeMs >= current.endMs) state.advance();
      }),
    [],
  );
}
