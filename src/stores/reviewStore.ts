import { create } from "zustand";
import type { EventRow } from "@/lib/db/queries/events";
import { playback } from "@/lib/playback";

/**
 * Review mode (FR-14): play the current selection back to back.
 *
 * Only the queue and its position live here. The playhead itself stays in the
 * playback controller, and the runner subscribes to it, so advancing between
 * clips never goes through React state.
 */

export type ReviewItem = {
  id: number;
  tagName: string;
  anchorMs: number;
  startMs: number;
  endMs: number;
};

type ReviewState = {
  active: boolean;
  queue: ReviewItem[];
  index: number;
  error: string | null;

  start: (events: EventRow[]) => void;
  stop: () => void;
  next: () => void;
  previous: () => void;
  /** Called by the runner when the playhead passes the current clip's end. */
  advance: () => void;
  clearError: () => void;
};

function toItem(event: EventRow): ReviewItem {
  return {
    id: event.id,
    tagName: event.tagName,
    anchorMs: event.anchorMs,
    startMs: event.startMs,
    endMs: event.endMs,
  };
}

function play(item: ReviewItem): void {
  playback.seekMs(item.startMs);
  void playback.play();
}

export const useReviewStore = create<ReviewState>((set, get) => ({
  active: false,
  queue: [],
  index: 0,
  error: null,

  start(events) {
    if (events.length === 0) {
      set({
        active: false,
        queue: [],
        index: 0,
        error: "Nothing to review here. Tag something, or clear the filter.",
      });
      return;
    }

    const queue = [...events].sort((a, b) => a.anchorMs - b.anchorMs).map(toItem);
    set({ active: true, queue, index: 0, error: null });
    play(queue[0] as ReviewItem);
  },

  stop() {
    playback.pause();
    set({ active: false, queue: [], index: 0 });
  },

  next() {
    const { queue, index } = get();
    const following = queue[index + 1];
    if (!following) {
      playback.pause();
      set({ active: false, queue: [], index: 0 });
      return;
    }

    set({ index: index + 1 });
    play(following);
  },

  previous() {
    const { queue, index } = get();
    const earlier = queue[index - 1];
    if (!earlier) {
      // Already at the first clip: replay it rather than doing nothing.
      const current = queue[index];
      if (current) play(current);
      return;
    }

    set({ index: index - 1 });
    play(earlier);
  },

  advance() {
    get().next();
  },

  clearError() {
    set({ error: null });
  },
}));
