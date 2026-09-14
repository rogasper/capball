import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Timeline } from "@/features/timeline/Timeline";
import type { EventRow } from "@/lib/db/queries/events";
import { NO_FILTERS, useEventStore } from "@/stores/eventStore";
import { usePhaseStore } from "@/stores/phaseStore";
import { usePlayerStore } from "@/stores/playerStore";
import { useTagStore } from "@/stores/tagStore";

/**
 * What the timeline says about phases (FR-55.1, FR-55.3, FR-50.5).
 *
 * Three facts must be visible and not merely implied: a lane that is recording
 * says so in words (NFR-34), a phase lane carries its **time** as well as its
 * count, and an action's bar names the phase it was recorded inside.
 */

vi.mock("@/lib/ipc/database", () => ({
  execute: vi.fn().mockResolvedValue(undefined),
  select: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/playback", () => ({
  playback: {
    seekMs: vi.fn(),
    onFrame: () => () => {},
    onState: () => () => {},
    durationMs: 0,
    timeMs: 0,
    pause: vi.fn(),
    play: vi.fn(),
  },
}));

function stubLaneLayout(): void {
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get: () => 600,
  });
  HTMLElement.prototype.getBoundingClientRect = () =>
    ({
      left: 0,
      top: 0,
      right: 600,
      bottom: 46,
      width: 600,
      height: 46,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect;
  Object.assign(HTMLElement.prototype, {
    setPointerCapture: vi.fn(),
    releasePointerCapture: vi.fn(),
    hasPointerCapture: () => true,
  });
}

function event(overrides: Partial<EventRow>): EventRow {
  return {
    id: 1,
    videoId: 1,
    anchorMs: 20_000,
    startMs: 20_000,
    endMs: 40_000,
    notes: null,
    tagId: 1,
    tagName: "Attacking",
    tagColor: "#4C8DFF",
    categoryName: "ATTACK",
    teamId: null,
    teamName: null,
    playerId: null,
    playerName: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  stubLaneLayout();
  usePlayerStore.setState({ durationMs: 600_000, ended: false });
  useTagStore.setState({
    tags: [
      {
        id: 1,
        categoryId: 1,
        parentId: null,
        name: "Attacking",
        color: "#4C8DFF",
        shortcutKey: "1",
        sortOrder: 0,
        createdAt: 0,
      },
      {
        id: 2,
        categoryId: 1,
        parentId: null,
        name: "Pass",
        color: "#F0913A",
        shortcutKey: "2",
        sortOrder: 1,
        createdAt: 0,
      },
    ],
  });
  useEventStore.setState({ events: [], filters: NO_FILTERS, undoStack: [], error: null });
  usePhaseStore.setState({
    phaseTagIds: [1],
    open: [],
    links: [],
    closures: {},
    error: null,
  });
});

describe("a phase on the timeline", () => {
  it("shows the time recorded in the lane, beside the count", () => {
    useEventStore.setState({
      events: [
        event({ id: 1, startMs: 20_000, endMs: 50_000 }),
        event({ id: 2, startMs: 100_000, endMs: 132_000, anchorMs: 100_000 }),
      ],
    });
    // Both are runs — an event with no session is a one-press capture, and its
    // padding is deliberately not counted here.
    usePhaseStore.setState({
      phaseTagIds: [1],
      open: [],
      links: [],
      closures: { 1: "user", 2: "exit" },
      error: null,
    });

    render(<Timeline />);

    // 30 s + 32 s = 62 s, printed as a duration rather than as a timecode.
    const lane = screen.getByRole("region", { name: "Attacking track" });
    expect(within(lane.parentElement as HTMLElement).getByText("01:02")).toBeInTheDocument();
  });

  it("says in words that a lane is recording", () => {
    useEventStore.setState({ events: [event({ id: 1, endMs: 20_000 })] });
    usePhaseStore.setState({
      phaseTagIds: [1],
      open: [{ eventId: 1, tagId: 1, streamKey: "team:none", teamId: null, startedAtMs: 20_000 }],
      links: [],
      closures: { 1: null },
      error: null,
    });

    render(<Timeline />);

    // Not a colour: the state is legible without one (NFR-34).
    expect(screen.getByText("recording")).toBeInTheDocument();
    const bar = screen.getByRole("button", { name: /Attacking phase from/i });
    expect(bar.getAttribute("title")).toMatch(/recording — click to stop/);
  });

  it("offers a Stop button while a phase is running", () => {
    // A running phase's bar can be three pixels wide at a fitted zoom, so
    // stopping it must not depend on hitting the bar.
    useEventStore.setState({ events: [event({ id: 1, endMs: 20_000 })] });
    usePhaseStore.setState({
      phaseTagIds: [1],
      open: [{ eventId: 1, tagId: 1, streamKey: "team:none", teamId: null, startedAtMs: 20_000 }],
      links: [],
      closures: { 1: null },
      error: null,
    });

    render(<Timeline />);

    expect(screen.getByRole("button", { name: /Stop Attacking/i })).toBeInTheDocument();
  });

  it("does not count a one-press capture as time in the phase", () => {
    // A phase tag holds two kinds of event: runs that were started and stopped,
    // and moments captured with one press before the tag was a phase. Only the
    // first is a duration; adding the second's padding would be the fiction the
    // phase model exists to remove (FR-50.5).
    useEventStore.setState({
      events: [
        event({ id: 1, startMs: 20_000, endMs: 31_813 }),
        event({ id: 2, startMs: 60_000, endMs: 80_000, anchorMs: 68_000 }),
      ],
    });
    usePhaseStore.setState({
      phaseTagIds: [1],
      open: [],
      links: [],
      // One session, for the run only.
      closures: { 1: "user" },
      error: null,
    });

    render(<Timeline />);

    const lane = screen.getByRole("region", { name: "Attacking track" });
    // 11.8 s of real phase, not 31.8 s including the moment's padding.
    expect(within(lane.parentElement as HTMLElement).getByText("00:11")).toBeInTheDocument();
    expect(screen.queryByText("00:31")).toBeNull();
    // And the one-press event says what it is rather than claiming to record.
    expect(
      screen.getByRole("button", { name: /Attacking \(one press\).*not a phase run/i }),
    ).toBeInTheDocument();
  });

  it("tells an action which phase it was recorded inside", () => {
    useEventStore.setState({
      events: [
        event({ id: 1, tagId: 1, tagName: "Attacking", startMs: 20_000, endMs: 60_000 }),
        event({
          id: 2,
          tagId: 2,
          tagName: "Pass",
          startMs: 30_000,
          endMs: 30_000,
          anchorMs: 30_000,
        }),
      ],
    });
    usePhaseStore.setState({
      phaseTagIds: [1],
      open: [],
      links: [{ childId: 2, parentId: 1 }],
      closures: { 1: "user" },
      error: null,
    });

    render(<Timeline />);

    // The link is `event_parents`; the bar says whose phase it is.
    expect(
      screen.getByRole("button", { name: /Pass from .*inside Attacking/i }),
    ).toBeInTheDocument();
    // And the phase itself says how it ended.
    expect(
      screen.getByRole("button", { name: /Attacking phase .*stopped by you/i }),
    ).toBeInTheDocument();
  });
});
