import { render } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCaptureKeys } from "@/features/tagging/useCaptureKeys";
import * as eventsQuery from "@/lib/db/queries/events";
import type { Tag } from "@/lib/db/queries/taxonomy";
import { useAnnotationStore } from "@/stores/annotationStore";
import { useEventStore } from "@/stores/eventStore";
import { useLibraryStore } from "@/stores/libraryStore";
import { useTagStore } from "@/stores/tagStore";

/**
 * FR-20.7 / NFR-25: drawing must not fight the keyboard.
 *
 * The capture engine and the annotation editor both listen on `window`, so the
 * rules for who owns a keystroke have to be explicit — otherwise drawing a zone
 * creates events, or undoing a drawing deletes a capture.
 */

vi.mock("@/lib/db/queries/events", () => ({
  createEvent: vi.fn().mockResolvedValue(30),
  deleteEvent: vi.fn().mockResolvedValue(undefined),
  updateEventRange: vi.fn(),
  updateEventNotes: vi.fn(),
  listEvents: vi.fn(),
  getEvent: vi.fn(),
}));

vi.mock("@/lib/playback", () => ({
  playback: { timeMs: 100_000, durationMs: 861_737 },
}));

const createEvent = vi.mocked(eventsQuery.createEvent);
const deleteEvent = vi.mocked(eventsQuery.deleteEvent);

const tag: Tag = {
  id: 4,
  categoryId: 1,
  parentId: null,
  name: "Shot",
  color: "#4C8DFF",
  shortcutKey: "1",
  sortOrder: 0,
  createdAt: 0,
};

function Harness() {
  useCaptureKeys(true);
  return null;
}

beforeEach(() => {
  vi.clearAllMocks();

  useTagStore.setState({
    tags: [tag],
    categories: [{ id: 1, name: "ATTACK", color: null, sortOrder: 0, createdAt: 0 }],
    activeTeamId: null,
    activePlayerId: null,
  });
  useLibraryStore.setState({ currentMatchId: 1, activeVideoId: 1 });
  useEventStore.setState({
    events: [],
    lastCapturedId: null,
    undoStack: [20],
    error: null,
    filters: { tagIds: [], teamId: null, playerId: null },
  });
  useAnnotationStore.setState({ eventId: null, selectedId: null, tool: null, annotations: [] });
});

describe("capture keys", () => {
  it("creates an event from a bound key", async () => {
    render(<Harness />);
    await userEvent.keyboard("1");

    expect(createEvent).toHaveBeenCalledTimes(1);
    expect(createEvent.mock.calls[0][0]).toMatchObject({ tagId: 4, anchorMs: 100_000 });
  });

  it("creates nothing while a drawing tool is in hand", async () => {
    useAnnotationStore.setState({ eventId: 7, tool: "rect" });

    render(<Harness />);
    await userEvent.keyboard("1");

    expect(createEvent).not.toHaveBeenCalled();
  });

  it("still creates events once the tool is put down", async () => {
    useAnnotationStore.setState({ eventId: 7, tool: null, selectedId: null });

    render(<Harness />);
    await userEvent.keyboard("1");

    expect(createEvent).toHaveBeenCalledTimes(1);
  });

  it("undoes the last capture when nothing in the editor is selected", async () => {
    render(<Harness />);
    await userEvent.keyboard("{Meta>}z{/Meta}");

    expect(deleteEvent).toHaveBeenCalledWith(20);
  });

  it("leaves undo to the drawing once a shape is selected", async () => {
    useAnnotationStore.setState({ eventId: 7, selectedId: 5 });

    render(<Harness />);
    await userEvent.keyboard("{Meta>}z{/Meta}");

    expect(deleteEvent).not.toHaveBeenCalled();
  });
});
