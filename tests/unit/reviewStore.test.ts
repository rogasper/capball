import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EventRow } from "@/lib/db/queries/events";

/** Review mode plays a queue of clips, so the playback side is mocked. */
const seekMs = vi.fn();
const play = vi.fn();
const pause = vi.fn();

vi.mock("@/lib/playback", () => ({
  playback: {
    seekMs: (ms: number) => seekMs(ms),
    play: () => play(),
    pause: () => pause(),
  },
}));

async function loadStore() {
  vi.resetModules();
  return import("@/stores/reviewStore");
}

function row(id: number, tagName: string, anchorMs: number): EventRow {
  return {
    id,
    videoId: 1,
    anchorMs,
    startMs: anchorMs - 8_000,
    endMs: anchorMs + 2_000,
    notes: null,
    tagId: 1,
    tagName,
    tagColor: "#4C8DFF",
    categoryName: "ATTACK",
    teamId: null,
    teamName: null,
    playerId: null,
    playerName: null,
  };
}

const events = [row(2, "Mid Block", 103_062), row(1, "Shot", 85_701)];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("review mode", () => {
  it("plays the queue in chronological order", async () => {
    const { useReviewStore } = await loadStore();

    useReviewStore.getState().start(events);

    const state = useReviewStore.getState();
    expect(state.active).toBe(true);
    expect(state.queue.map((item) => item.id)).toEqual([1, 2]);
    expect(seekMs).toHaveBeenCalledWith(77_701);
    expect(play).toHaveBeenCalled();
  });

  it("stops and explains when there is nothing to review", async () => {
    const { useReviewStore } = await loadStore();

    useReviewStore.getState().start([]);

    expect(useReviewStore.getState().active).toBe(false);
    expect(useReviewStore.getState().error).toMatch(/nothing to review/i);
    expect(play).not.toHaveBeenCalled();
  });

  it("moves to the next clip", async () => {
    const { useReviewStore } = await loadStore();
    useReviewStore.getState().start(events);

    useReviewStore.getState().next();

    expect(useReviewStore.getState().index).toBe(1);
    expect(seekMs).toHaveBeenLastCalledWith(95_062);
  });

  it("stops after the last clip rather than looping", async () => {
    const { useReviewStore } = await loadStore();
    useReviewStore.getState().start(events);

    useReviewStore.getState().next();
    useReviewStore.getState().next();

    expect(useReviewStore.getState().active).toBe(false);
    expect(useReviewStore.getState().queue).toEqual([]);
    expect(pause).toHaveBeenCalled();
  });

  it("goes back a clip, and replays the first one at the start", async () => {
    const { useReviewStore } = await loadStore();
    useReviewStore.getState().start(events);
    useReviewStore.getState().next();

    useReviewStore.getState().previous();
    expect(useReviewStore.getState().index).toBe(0);
    expect(seekMs).toHaveBeenLastCalledWith(77_701);

    // At the first clip, going back replays it instead of doing nothing.
    seekMs.mockClear();
    useReviewStore.getState().previous();
    expect(seekMs).toHaveBeenCalledWith(77_701);
  });

  it("advances when the runner reports the clip has finished", async () => {
    const { useReviewStore } = await loadStore();
    useReviewStore.getState().start(events);

    useReviewStore.getState().advance();

    expect(useReviewStore.getState().index).toBe(1);
  });

  it("stops on demand and clears the queue", async () => {
    const { useReviewStore } = await loadStore();
    useReviewStore.getState().start(events);

    useReviewStore.getState().stop();

    expect(useReviewStore.getState().active).toBe(false);
    expect(useReviewStore.getState().queue).toEqual([]);
    expect(pause).toHaveBeenCalled();
  });

  it("clears a previous error when a real review starts", async () => {
    const { useReviewStore } = await loadStore();
    useReviewStore.getState().start([]);
    expect(useReviewStore.getState().error).not.toBeNull();

    useReviewStore.getState().start(events);

    expect(useReviewStore.getState().error).toBeNull();
  });
});
