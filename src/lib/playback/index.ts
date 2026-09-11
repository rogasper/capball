import { PlaybackController } from "./controller";

export type { PlaybackState } from "./controller";
export { PlaybackController };

/** One player per window; the app only ever shows a single match video. */
export const playback = new PlaybackController();
