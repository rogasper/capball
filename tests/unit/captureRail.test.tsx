import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CaptureRail } from "@/features/tagging/CaptureRail";
import type { EventRow } from "@/lib/db/queries/events";
import { useEventStore } from "@/stores/eventStore";
import { useLibraryStore } from "@/stores/libraryStore";

// The rail only reads store state; the database and playback are not involved.
vi.mock("@/lib/ipc/database", () => ({
  execute: vi.fn().mockResolvedValue(undefined),
  select: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/playback", () => ({
  playback: { onFrame: () => () => {}, timeMs: 0, durationMs: 861_737 },
}));

const captured: EventRow = {
  id: 20,
  anchorMs: 85_701,
  startMs: 77_701,
  endMs: 97_701,
  notes: null,
  tagId: 4,
  tagName: "Shot",
  tagColor: "#4C8DFF",
  categoryName: "ATTACK",
  teamId: null,
  teamName: null,
  playerId: null,
  playerName: null,
};

beforeEach(() => {
  useEventStore.setState({
    events: [captured],
    lastCapturedId: captured.id,
    undoStack: [captured.id],
    error: null,
  });
  useLibraryStore.setState({ activeVideoId: 1 });
});

describe("CaptureRail", () => {
  it("separates the tagged moment from where the clip starts", () => {
    render(<CaptureRail />);

    // The label is what stops "clip starts 01:17.701" being read as the tag time.
    expect(screen.getByText("tagged")).toBeInTheDocument();
    expect(screen.getByText("01:25.701")).toBeInTheDocument();
    expect(screen.getByText(/clip starts 01:17\.701/)).toBeInTheDocument();
  });

  it("offers undo and end adjustment for the newest capture", () => {
    render(<CaptureRail />);

    expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Shorten the end by one second" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Extend the end by one second" }),
    ).toBeInTheDocument();
  });

  it("tells the user what to do when no video is loaded", () => {
    useLibraryStore.setState({ activeVideoId: null });
    render(<CaptureRail />);

    expect(screen.getByText(/add a video to start capturing/i)).toBeInTheDocument();
  });
});
