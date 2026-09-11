import { create } from "zustand";
import type { PlaybackState } from "@/lib/playback";

/**
 * The discrete half of playback state. The live playhead is deliberately absent:
 * it lives in the playback controller so it never re-renders React
 * (plans/technical-design.md §8.1).
 */
type PlayerState = PlaybackState & {
  apply: (state: PlaybackState) => void;
};

export const usePlayerStore = create<PlayerState>((set) => ({
  ready: false,
  paused: true,
  durationMs: 0,
  rate: 1,
  error: null,
  apply: (state) => set(state),
}));
