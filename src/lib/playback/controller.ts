/**
 * Owns the `<video>` element and the playhead.
 *
 * Playback position is deliberately not in Zustand: it changes many times per
 * second, and a global store would re-render the tree every frame
 * (plans/technical-design.md §8.1). Consumers that need the live position
 * subscribe to `onFrame` and write to the DOM; only discrete changes are
 * published to the store through `onState`.
 */

export type PlaybackState = {
  ready: boolean;
  paused: boolean;
  durationMs: number;
  rate: number;
  /**
   * True once the video reached its end.
   *
   * Published as state rather than derived from the playhead, because "the
   * footage ran out" is a different fact from "the playhead is near the end" —
   * an open phase closes on the first and must not close on a seek (FR-55.4).
   */
  ended: boolean;
  error: string | null;
};

const INITIAL_STATE: PlaybackState = {
  ready: false,
  paused: true,
  durationMs: 0,
  rate: 1,
  ended: false,
  error: null,
};

export class PlaybackController {
  private video: HTMLVideoElement | null = null;
  private frameListeners = new Set<(timeMs: number) => void>();
  private stateListeners = new Set<(state: PlaybackState) => void>();
  private frameRequest = 0;
  private state: PlaybackState = INITIAL_STATE;

  attach(video: HTMLVideoElement): void {
    this.detach();
    this.video = video;
    video.addEventListener("loadedmetadata", this.handleMetadata);
    video.addEventListener("durationchange", this.handleMetadata);
    video.addEventListener("play", this.handleTransport);
    video.addEventListener("pause", this.handleTransport);
    video.addEventListener("ratechange", this.handleTransport);
    video.addEventListener("seeked", this.handleSeeked);
    video.addEventListener("ended", this.handleEnded);
    video.addEventListener("error", this.handleError);
  }

  detach(): void {
    const video = this.video;
    if (!video) return;
    video.removeEventListener("loadedmetadata", this.handleMetadata);
    video.removeEventListener("durationchange", this.handleMetadata);
    video.removeEventListener("play", this.handleTransport);
    video.removeEventListener("pause", this.handleTransport);
    video.removeEventListener("ratechange", this.handleTransport);
    video.removeEventListener("seeked", this.handleSeeked);
    video.removeEventListener("ended", this.handleEnded);
    video.removeEventListener("error", this.handleError);
    this.video = null;
    this.stopFrames();
  }

  /** Live playhead position; read directly, never stored in React state. */
  get timeMs(): number {
    return (this.video?.currentTime ?? 0) * 1000;
  }

  get durationMs(): number {
    const duration = this.video?.duration;
    return Number.isFinite(duration) ? (duration as number) * 1000 : 0;
  }

  getState(): PlaybackState {
    return this.state;
  }

  onFrame(listener: (timeMs: number) => void): () => void {
    this.frameListeners.add(listener);
    return () => this.frameListeners.delete(listener);
  }

  onState(listener: (state: PlaybackState) => void): () => void {
    this.stateListeners.add(listener);
    listener(this.state);
    return () => this.stateListeners.delete(listener);
  }

  async play(): Promise<void> {
    try {
      await this.video?.play();
    } catch (error) {
      this.publish({ error: error instanceof Error ? error.message : String(error) });
    }
  }

  pause(): void {
    this.video?.pause();
  }

  toggle(): void {
    if (this.video?.paused) void this.play();
    else this.pause();
  }

  seekMs(timeMs: number): void {
    const video = this.video;
    if (!video) return;
    const limit = this.durationMs || Number.MAX_SAFE_INTEGER;
    video.currentTime = Math.min(Math.max(0, timeMs), limit) / 1000;
  }

  nudge(deltaMs: number): void {
    this.seekMs(this.timeMs + deltaMs);
  }

  setRate(rate: number): void {
    if (this.video) this.video.playbackRate = rate;
  }

  private publish(patch: Partial<PlaybackState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.stateListeners) listener(this.state);
  }

  private emitFrame(): void {
    const timeMs = this.timeMs;
    for (const listener of this.frameListeners) listener(timeMs);
  }

  private runFrames = (): void => {
    this.emitFrame();
    this.frameRequest = requestAnimationFrame(this.runFrames);
  };

  private startFrames(): void {
    if (this.frameRequest === 0) this.frameRequest = requestAnimationFrame(this.runFrames);
  }

  private stopFrames(): void {
    if (this.frameRequest !== 0) {
      cancelAnimationFrame(this.frameRequest);
      this.frameRequest = 0;
    }
  }

  private handleMetadata = (): void => {
    this.publish({ ready: true, durationMs: this.durationMs, error: null });
    this.emitFrame();
  };

  private handleTransport = (): void => {
    const paused = this.video?.paused ?? true;
    this.publish({
      paused,
      rate: this.video?.playbackRate ?? 1,
      // Playing or seeking clears it; `ended` reads the element, so a pause at
      // the very end does not report "still playing".
      ended: this.video?.ended ?? false,
    });
    if (paused) this.stopFrames();
    else this.startFrames();
  };

  private handleEnded = (): void => {
    this.publish({ paused: true, ended: true });
    this.stopFrames();
  };

  private handleSeeked = (): void => {
    this.publish({ ended: this.video?.ended ?? false });
    this.emitFrame();
  };

  private handleError = (): void => {
    const mediaError = this.video?.error;
    this.publish({
      ready: false,
      paused: true,
      error: mediaError?.message || `playback failed (code ${mediaError?.code ?? "unknown"})`,
    });
    this.stopFrames();
  };
}
