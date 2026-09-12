import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventList } from "@/features/events/EventList";
import type { EventRow } from "@/lib/db/queries/events";
import { useEventStore } from "@/stores/eventStore";

// Keeps the SQL plugin out of the test; the list only reads store state.
vi.mock("@/lib/ipc/database", () => ({
  execute: vi.fn().mockResolvedValue(undefined),
  select: vi.fn().mockResolvedValue([]),
}));

const seekMs = vi.fn();
vi.mock("@/lib/playback", () => ({
  playback: { seekMs: (ms: number) => seekMs(ms) },
}));

/**
 * A shot tagged at 1:25 shows 1:25, not 1:17.
 *
 * The clip range starts 8 s earlier because of the default pre-roll, which is
 * correct — but the moment is what the list must show, and what a click must
 * seek to. This is a regression guard for exactly that confusion.
 */
const event: EventRow = {
  id: 20,
  anchorMs: 85_701,
  startMs: 77_701,
  endMs: 97_701,
  notes: null,
  tagId: 4,
  tagName: "Shot",
  tagColor: "#4C8DFF",
  categoryName: "ATTACK",
  teamId: 2,
  teamName: "MU",
  playerId: null,
  playerName: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  useEventStore.setState({ events: [event], lastCapturedId: null, undoStack: [], error: null });
});

describe("EventList", () => {
  it("shows the tagged moment, not the start of the clip", () => {
    render(<EventList />);

    expect(screen.getByText(/01:25\.701/)).toBeInTheDocument();
    // The clip start must not be presented as the tag's time anywhere visible.
    expect(screen.queryByText(/01:17\.701/)).toBeNull();
  });

  it("keeps the clip range available as a tooltip rather than losing it", () => {
    render(<EventList />);

    expect(screen.getByRole("button", { name: "Jump to 01:25.701" })).toHaveAttribute(
      "title",
      expect.stringContaining("clip 01:17.701 → 01:37.701"),
    );
  });

  it("seeks to the moment when the event is clicked", async () => {
    render(<EventList />);

    await userEvent.click(screen.getByRole("button", { name: "Jump to 01:25.701" }));

    expect(seekMs).toHaveBeenCalledWith(85_701);
  });
});
