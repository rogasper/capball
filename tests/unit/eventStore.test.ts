import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EventRow } from "@/lib/db/queries/events";
import * as eventsQuery from "@/lib/db/queries/events";
import {
  applyFilters,
  type EventDraft,
  insertInOrder,
  isFilterActive,
  NO_FILTERS,
  useEventStore,
} from "@/stores/eventStore";
import { useLibraryStore } from "@/stores/libraryStore";

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
    videoId: 1,
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

function draft(overrides: Partial<EventDraft> = {}): EventDraft {
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
    startMs: 92_000,
    endMs: 112_000,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useEventStore.setState({
    events: [],
    lastCapturedId: null,
    undoStack: [],
    error: null,
    filters: { tagIds: [], teamId: null, playerId: null },
  });
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

describe("insert", () => {
  it("stores the draft's own range, so a timeline selection is kept exactly", async () => {
    createEvent.mockResolvedValue(11);

    await useEventStore
      .getState()
      .insert(draft({ anchorMs: 401_340, startMs: 320_000, endMs: 420_000 }));

    expect(createEvent).toHaveBeenCalledWith(
      expect.objectContaining({ anchorMs: 401_340, startMs: 320_000, endMs: 420_000 }),
    );
    expect(useEventStore.getState().events[0]?.anchorMs).toBe(401_340);
  });

  it("carries the team and player context onto the event", async () => {
    createEvent.mockResolvedValue(13);

    await useEventStore.getState().insert(draft());

    expect(createEvent).toHaveBeenCalledWith(
      expect.objectContaining({ teamId: 7, playerId: 21, matchId: 1, videoId: 1, tagId: 1 }),
    );
  });

  it("shows the event immediately and remembers it for undo", async () => {
    createEvent.mockResolvedValue(14);

    await useEventStore.getState().insert(draft());

    const state = useEventStore.getState();
    expect(state.events.map((event) => event.id)).toEqual([14]);
    expect(state.lastCapturedId).toBe(14);
    expect(state.undoStack).toEqual([14]);
    expect(state.events[0]?.teamName).toBe("Manchester United");
  });

  it("reports a failure instead of pretending the moment was captured", async () => {
    createEvent.mockRejectedValue(new Error("disk is full"));

    await useEventStore.getState().insert(draft());

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
    await useEventStore.getState().insert(draft());

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
    await useEventStore.getState().insert(draft());

    await useEventStore.getState().undoLast();

    expect(useEventStore.getState().events.map((event) => event.id)).toEqual([22]);
    expect(useEventStore.getState().error).toMatch(/locked/);
  });
});

describe("adjustEnd", () => {
  it("extends the end of the last event", async () => {
    createEvent.mockResolvedValue(31);
    updateEventRange.mockResolvedValue(undefined);
    await useEventStore.getState().insert(draft());

    await useEventStore.getState().adjustEnd(31, 1_000);

    // The anchor is written with the range, always: adjusting the end past the
    // moment would otherwise leave a stored anchor outside its own clip.
    expect(updateEventRange).toHaveBeenCalledWith(31, 92_000, 113_000, 100_000);
    expect(useEventStore.getState().events[0]?.endMs).toBe(113_000);
  });

  it("never lets the end fall before the start", async () => {
    createEvent.mockResolvedValue(32);
    updateEventRange.mockResolvedValue(undefined);
    await useEventStore.getState().insert(draft());

    await useEventStore.getState().adjustEnd(32, -999_000);

    expect(useEventStore.getState().events[0]?.endMs).toBe(92_000);
  });
});

describe("filters", () => {
  const list: EventRow[] = [
    { ...row(1, 100), tagId: 1, teamId: 7, playerId: 21 },
    { ...row(2, 200), tagId: 2, teamId: 8, playerId: 22 },
    { ...row(3, 300), tagId: 1, teamId: null, playerId: null },
  ];

  it("lets everything through when nothing is set", () => {
    expect(applyFilters(list, NO_FILTERS)).toHaveLength(3);
    expect(isFilterActive(NO_FILTERS)).toBe(false);
  });

  it("narrows to the chosen tags", () => {
    const filtered = applyFilters(list, { ...NO_FILTERS, tagIds: [1] });
    expect(filtered.map((event) => event.id)).toEqual([1, 3]);
  });

  it("accepts several tags at once", () => {
    const filtered = applyFilters(list, { ...NO_FILTERS, tagIds: [1, 2] });
    expect(filtered).toHaveLength(3);
  });

  it("narrows by team, ignoring events with no team", () => {
    const filtered = applyFilters(list, { ...NO_FILTERS, teamId: 7 });
    expect(filtered.map((event) => event.id)).toEqual([1]);
  });

  it("narrows by player", () => {
    const filtered = applyFilters(list, { ...NO_FILTERS, playerId: 22 });
    expect(filtered.map((event) => event.id)).toEqual([2]);
  });

  it("combines the criteria", () => {
    const filtered = applyFilters(list, { tagIds: [1], teamId: 7, playerId: 21 });
    expect(filtered.map((event) => event.id)).toEqual([1]);
    expect(isFilterActive({ tagIds: [1], teamId: 7, playerId: 21 })).toBe(true);
  });

  it("returns the same array when nothing is filtered, so memoised lists stay stable", () => {
    expect(applyFilters(list, NO_FILTERS)).toBe(list);
  });

  it("clears back to everything", () => {
    useEventStore.setState({ filters: { tagIds: [2], teamId: 8, playerId: 22 } });
    useEventStore.getState().clearFilters();
    expect(useEventStore.getState().filters).toEqual(NO_FILTERS);
  });
});

describe("splitting an event", () => {
  it("makes two events at the split, and the first half keeps the drawings", async () => {
    // A new half has to belong to a match, and a row does not carry its own.
    useLibraryStore.setState({
      currentMatch: {
        id: 1,
        homeTeamId: 7,
        awayTeamId: 8,
        competition: null,
        season: null,
        kickoffAt: null,
        venue: null,
        notes: null,
        createdAt: 0,
        updatedAt: 0,
      },
    });
    let nextId = 31;
    createEvent.mockImplementation(async () => nextId++);
    updateEventRange.mockResolvedValue(undefined);
    await useEventStore.getState().insert(draft());

    await useEventStore.getState().splitEvent(31, 105_000);

    // The original is trimmed to the split; its moment is still inside it.
    expect(updateEventRange).toHaveBeenCalledWith(31, 92_000, 105_000, 100_000);

    const events = useEventStore.getState().events;
    expect(events).toHaveLength(2);
    const second = events.find((event) => event.id !== 31);
    expect(second).toMatchObject({
      startMs: 105_000,
      endMs: 112_000,
      anchorMs: 105_000,
      // Nothing has to be re-tagged to carry on with the second half.
      tagName: "High Press",
      teamName: "Manchester United",
      playerName: "Saka",
    });
    // Drawings and positions belong to the first half, which is why it keeps its id.
    expect(events[0]?.id === 31 || events[1]?.id === 31).toBe(true);
  });

  it("refuses a split outside the clip, and says why", async () => {
    createEvent.mockResolvedValue(31);
    await useEventStore.getState().insert(draft());

    await useEventStore.getState().splitEvent(31, 200_000);

    expect(useEventStore.getState().events).toHaveLength(1);
    expect(useEventStore.getState().error).toMatch(/inside its own clip range/i);
  });
});
