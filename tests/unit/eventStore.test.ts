import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EventRow } from "@/lib/db/queries/events";
import * as eventsQuery from "@/lib/db/queries/events";
import { type CaptureInput, insertInOrder, useEventStore } from "@/stores/eventStore";

// The query module is the only thing this store touches, so mocking it keeps the
// capture rules testable without a database.
vi.mock("@/lib/db/queries/events", () => ({
  createEvent: vi.fn(),
  deleteEvent: vi.fn(),
  updateEventRange: vi.fn(),
  updateEventNotes: vi.fn(),
  listEvents: vi.fn(),
  getEvent: vi.fn(),
}));

const createEvent = vi.mocked(eventsQuery.createEvent);
const deleteEvent = vi.mocked(eventsQuery.deleteEvent);
const updateEventRange = vi.mocked(eventsQuery.updateEventRange);

function row(id: number, startMs: number, tagName = "High Press"): EventRow {
  return {
    id,
    anchorMs: startMs + 8_000,
    startMs,
    endMs: startMs + 20_000,
    notes: null,
    tagId: 1,
    tagName,
    tagColor: "#34D399",
    categoryName: "DEFENSE",
    teamId: null,
    teamName: null,
    playerId: null,
    playerName: null,
  };
}

function captureInput(overrides: Partial<CaptureInput> = {}): CaptureInput {
  return {
    matchId: 1,
    videoId: 1,
    tagId: 1,
    tagName: "High Press",
    tagColor: "#34D399",
    categoryName: "DEFENSE",
    teamId: 7,
    teamName: "Manchester United",
    playerId: 21,
    playerName: "Saka",
    anchorMs: 100_000,
    preRollMs: 8_000,
    postRollMs: 12_000,
    durationMs: 600_000,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useEventStore.setState({ events: [], lastCapturedId: null, undoStack: [], error: null });
});

describe("insertInOrder", () => {
  it("keeps events sorted by start time", () => {
    const list = insertInOrder([row(1, 100), row(3, 300)], row(2, 200));
    expect(list.map((event) => event.id)).toEqual([1, 2, 3]);
  });

  it("appends when the event is the latest", () => {
    expect(insertInOrder([row(1, 100)], row(2, 500)).map((e) => e.id)).toEqual([1, 2]);
  });

  it("breaks ties by id, matching the database order", () => {
    expect(insertInOrder([row(2, 100)], row(1, 100)).map((e) => e.id)).toEqual([1, 2]);
  });
});

describe("capture", () => {
  it("stores the pre-roll and post-roll range around the moment", async () => {
    createEvent.mockResolvedValue(11);

    await useEventStore.getState().capture(captureInput());

    expect(createEvent).toHaveBeenCalledWith(
      expect.objectContaining({ startMs: 92_000, endMs: 112_000 }),
    );
  });

  it("clamps the range to the video bounds", async () => {
    createEvent.mockResolvedValue(12);

    await useEventStore.getState().capture(captureInput({ anchorMs: 2_000, durationMs: 5_000 }));

    expect(createEvent).toHaveBeenCalledWith(expect.objectContaining({ startMs: 0, endMs: 5_000 }));
  });

  it("stamps the active team and player onto the event", async () => {
    createEvent.mockResolvedValue(13);

    await useEventStore.getState().capture(captureInput());

    expect(createEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        teamId: 7,
        playerId: 21,
        matchId: 1,
        videoId: 1,
        tagId: 1,
      }),
    );
  });

  it("stores the tagged moment as well as the range around it", async () => {
    createEvent.mockResolvedValue(15);

    await useEventStore.getState().capture(captureInput({ anchorMs: 401_340 }));

    expect(createEvent).toHaveBeenCalledWith(
      expect.objectContaining({ anchorMs: 401_340, startMs: 393_340, endMs: 413_340 }),
    );
    expect(useEventStore.getState().events[0]?.anchorMs).toBe(401_340);
  });

  it("shows the event immediately and remembers it for undo", async () => {
    createEvent.mockResolvedValue(14);

    await useEventStore.getState().capture(captureInput());

    const state = useEventStore.getState();
    expect(state.events.map((event) => event.id)).toEqual([14]);
    expect(state.lastCapturedId).toBe(14);
    expect(state.undoStack).toEqual([14]);
    expect(state.events[0]?.teamName).toBe("Manchester United");
  });

  it("reports a failure instead of pretending the moment was captured", async () => {
    createEvent.mockRejectedValue(new Error("disk is full"));

    await useEventStore.getState().capture(captureInput());

    const state = useEventStore.getState();
    expect(state.events).toEqual([]);
    expect(state.lastCapturedId).toBeNull();
    expect(state.error).toMatch(/disk is full/);
  });
});

describe("undoLast", () => {
  it("removes the most recent capture and its stored row", async () => {
    createEvent.mockResolvedValue(21);
    deleteEvent.mockResolvedValue(undefined);
    await useEventStore.getState().capture(captureInput());

    await useEventStore.getState().undoLast();

    expect(deleteEvent).toHaveBeenCalledWith(21);
    expect(useEventStore.getState().events).toEqual([]);
    expect(useEventStore.getState().undoStack).toEqual([]);
  });

  it("does nothing when there is nothing to undo", async () => {
    await useEventStore.getState().undoLast();
    expect(deleteEvent).not.toHaveBeenCalled();
  });

  it("puts the event back when the delete fails", async () => {
    createEvent.mockResolvedValue(22);
    deleteEvent.mockRejectedValue(new Error("locked"));
    await useEventStore.getState().capture(captureInput());

    await useEventStore.getState().undoLast();

    expect(useEventStore.getState().events.map((event) => event.id)).toEqual([22]);
    expect(useEventStore.getState().error).toMatch(/locked/);
  });
});

describe("adjustEnd", () => {
  it("extends the end of the last event", async () => {
    createEvent.mockResolvedValue(31);
    updateEventRange.mockResolvedValue(undefined);
    await useEventStore.getState().capture(captureInput());

    await useEventStore.getState().adjustEnd(31, 1_000);

    expect(updateEventRange).toHaveBeenCalledWith(31, 92_000, 113_000);
    expect(useEventStore.getState().events[0]?.endMs).toBe(113_000);
  });

  it("never lets the end fall before the start", async () => {
    createEvent.mockResolvedValue(32);
    updateEventRange.mockResolvedValue(undefined);
    await useEventStore.getState().capture(captureInput());

    await useEventStore.getState().adjustEnd(32, -999_000);

    expect(useEventStore.getState().events[0]?.endMs).toBe(92_000);
  });
});
