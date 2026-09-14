import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "@/app/ErrorBoundary";
import { Timeline } from "@/features/timeline/Timeline";
import { NO_FILTERS, useEventStore } from "@/stores/eventStore";
import { usePlayerStore } from "@/stores/playerStore";
import { useTagStore } from "@/stores/tagStore";

/**
 * Dragging on the marker lane must not consult the event after dispatch.
 *
 * The lane read `event.currentTarget.getBoundingClientRect()` from inside a
 * `setSelection` updater. React runs an updater during the *next* render, by
 * which time it has cleared `currentTarget`, so the read threw `null is not an
 * object` and — with no error boundary at the time — took the whole window with
 * it. This test drives the real handlers and asserts nothing throws.
 */

vi.mock("@/lib/ipc/database", () => ({
  execute: vi.fn().mockResolvedValue(undefined),
  select: vi.fn().mockResolvedValue([]),
}));

/** One tagged event, and the track its tag produces. */
function seedEvent(): void {
  useEventStore.setState({
    events: [spaceEvent()],
    filters: NO_FILTERS,
    lastCapturedId: null,
    undoStack: [],
    error: null,
  });
}

const seekMs = vi.fn();
vi.mock("@/lib/playback", () => ({
  playback: {
    seekMs: (ms: number) => seekMs(ms),
    onFrame: () => () => {},
    onState: () => () => {},
    durationMs: 0,
    timeMs: 0,
    pause: vi.fn(),
    play: vi.fn(),
  },
}));

/** jsdom has no layout and no pointer capture, so the lane is given both. */
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

/** The lane for a tag: tracks are drawn per tag now, each one a labelled group. */
function trackLane(name: string): Element {
  return screen.getByRole("region", { name: `${name} track` });
}

/**
 * A pointer event carrying the buttons a real gesture would have.
 *
 * `MouseEvent` defaults `buttons` to 0 — what a *hover* reports — so a drag
 * dispatched with the default looks, to the code under test, like a pointer that
 * is not holding anything. That default is why a stale drag which kept editing a
 * clip after its button was gone stayed invisible here, and why the timeline now
 * checks `buttons` before it treats a move as a drag.
 */
function pointer(
  type: string,
  clientX: number,
  buttons = type === "pointerup" ? 0 : 1,
): MouseEvent {
  return new MouseEvent(type, { bubbles: true, clientX, clientY: 10, buttons });
}

beforeEach(() => {
  vi.clearAllMocks();
  stubLaneLayout();
  usePlayerStore.setState({ durationMs: 861_737 });
  useEventStore.setState({
    events: [],
    filters: NO_FILTERS,
    lastCapturedId: null,
    undoStack: [],
    error: null,
  });
  // Tracks are drawn per tag, in the taxonomy's order, so the tags must exist.
  useTagStore.setState({
    tags: [
      {
        id: 1,
        categoryId: 1,
        parentId: null,
        name: "Build Up",
        color: "#4C8DFF",
        shortcutKey: "1",
        sortOrder: 0,
        createdAt: 0,
      },
    ],
  });
});

describe("dragging a range on the timeline", () => {
  it("does not throw once React runs the update, and does not blank the window", async () => {
    const logged: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args) => {
      logged.push(args.map(String).join(" "));
    });

    seedEvent();
    const { container } = render(
      <ErrorBoundary>
        <Timeline />
      </ErrorBoundary>,
    );

    const lane = trackLane("Build Up");
    expect(container).toBeTruthy();

    // Dispatched outside `act`, so the pointermove update is flushed the way a
    // real drag flushes it: after the event has finished dispatching.
    lane.dispatchEvent(pointer("pointerdown", 100));
    lane.dispatchEvent(pointer("pointermove", 220));
    await new Promise((resolve) => setTimeout(resolve, 0));
    lane.dispatchEvent(pointer("pointerup", 220));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(screen.queryByText(/hit a problem/i)).toBeNull();
    expect(
      logged.some((message) =>
        /currentTarget|getBoundingClientRect|null is not an object/.test(message),
      ),
    ).toBe(false);

    spy.mockRestore();
  });

  it("treats a press that never moved as a seek", async () => {
    seedEvent();
    const { container } = render(
      <ErrorBoundary>
        <Timeline />
      </ErrorBoundary>,
    );

    const lane = trackLane("Build Up");
    expect(container).toBeTruthy();

    for (const x of [300, 420]) {
      lane.dispatchEvent(pointer("pointerdown", x));
      lane.dispatchEvent(pointer("pointerup", x));
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    // Two presses, later to the right: a press seeks to the time under it. The
    // exact millisecond depends on the fitted scale, which `timelineScale` owns.
    expect(seekMs).toHaveBeenCalledTimes(2);
    const [first, second] = seekMs.mock.calls.map((call) => call[0] as number);
    expect(first).toBeGreaterThan(0);
    expect(second).toBeGreaterThan(first);
    expect(second).toBeLessThan(861_737);
  });
});

describe("opening an event from the timeline", () => {
  it("loads the event, not just the playhead, so Draw and Pitch have one", async () => {
    // Reported from the running app: clicking a marker moved the playhead but the
    // Draw tab still said "select an event", because only the event *list* loaded
    // it. The two now share one definition of opening an event.
    const { useAnnotationStore } = await import("@/stores/annotationStore");
    useAnnotationStore.setState({ eventId: null, annotations: [] });
    usePlayerStore.setState({ durationMs: 60_000 });
    useEventStore.setState({
      events: [spaceEvent()],
      lastCapturedId: null,
      undoStack: [],
      error: null,
    });

    render(<Timeline />);
    const bar = screen.getByRole("button", { name: /Build Up from/i });
    // A real click is a press and a release, which is where the open happens.
    // Pressed inside the bar, away from its 4-pixel trim edges.
    bar.dispatchEvent(pointer("pointerdown", 300));
    bar.dispatchEvent(pointer("pointerup", 300));

    // Opening seeks to the *moment*, not to the start of the clip.
    expect(seekMs).toHaveBeenCalledWith(30_000);
    await waitFor(() => expect(useAnnotationStore.getState().eventId).toBe(7));
  });
});

describe("a span can be moved and trimmed", () => {
  /** 60 s across 600 px: 0.01 px per ms, so 100 px is ten seconds. */
  function timelineWithOneEvent() {
    usePlayerStore.setState({ durationMs: 60_000 });
    seedEvent();
    return render(<Timeline />);
  }

  it("moves the whole span — clip and moment — when its body is dragged", async () => {
    timelineWithOneEvent();
    const bar = screen.getByRole("button", { name: /Build Up from/i });

    bar.dispatchEvent(pointer("pointerdown", 300));
    bar.dispatchEvent(pointer("pointermove", 400));
    bar.dispatchEvent(pointer("pointerup", 400));

    // The three fields move together, by the same amount, in the same
    // direction: the clip travels and its moment travels inside it. The exact
    // milliseconds depend on the fitted scale, which `timelineScale` covers.
    await waitFor(() => expect(useEventStore.getState().events[0]?.startMs).not.toBe(20_000));
    const moved = useEventStore.getState().events[0];
    const shift = (moved?.startMs ?? 0) - 20_000;
    expect(shift).toBeGreaterThan(0);
    expect((moved?.endMs ?? 0) - 40_000).toBe(shift);
    expect((moved?.anchorMs ?? 0) - 30_000).toBe(shift);
  });

  it("trims one end without touching the other, or the moment outside it", async () => {
    timelineWithOneEvent();
    const grip = screen.getByRole("button", { name: /Trim the end of Build Up/i });

    // Dragging the end back trims it, and nothing else.
    grip.dispatchEvent(pointer("pointerdown", 400));
    grip.dispatchEvent(pointer("pointermove", 300));
    grip.dispatchEvent(pointer("pointerup", 300));

    await waitFor(() => expect(useEventStore.getState().events[0]?.endMs).toBeLessThan(40_000));
    const trimmed = useEventStore.getState().events[0];
    expect(trimmed?.startMs).toBe(20_000);
    // The clip was trimmed past the moment, so the moment comes in with it: a
    // moment outside its own clip is a state nothing else should have to handle.
    expect(trimmed?.anchorMs).toBe(trimmed?.endMs);
  });

  it("never lets a trim cross the other end", async () => {
    timelineWithOneEvent();
    const grip = screen.getByRole("button", { name: /Trim the end of Build Up/i });

    grip.dispatchEvent(pointer("pointerdown", 400));
    grip.dispatchEvent(pointer("pointermove", 0));
    grip.dispatchEvent(pointer("pointerup", 0));

    await waitFor(() => expect(useEventStore.getState().events[0]?.endMs).toBeGreaterThan(20_000));
    expect(useEventStore.getState().events[0]?.endMs).toBeLessThanOrEqual(20_200);
  });
});

describe("a clip that cannot hold trim handles", () => {
  /** A ten-minute match: a 20 s clip is about 16 px, far below a handle's width. */
  function shortTimeline() {
    usePlayerStore.setState({ durationMs: 600_000 });
    seedEvent();
    return render(<Timeline />);
  }

  it("moves rather than trims, wherever the press lands on the bar", async () => {
    // Reported from the running app: pressing an end to trim moved the whole
    // clip. A proximity test decided the mode as well as the handles, so a press
    // a few pixels inside an end became a move. The body now only ever moves.
    shortTimeline();
    const bar = screen.getByRole("button", { name: /Build Up from/i });
    expect(screen.queryByRole("button", { name: /Trim the start of Build Up/i })).toBeNull();

    // The press lands exactly on the bar's right edge, then drags 20 px right.
    await act(async () => {
      bar.dispatchEvent(pointer("pointerdown", 163));
      bar.dispatchEvent(pointer("pointermove", 183));
      bar.dispatchEvent(pointer("pointerup", 183));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const moved = useEventStore.getState().events[0];
    expect(moved?.startMs).not.toBe(20_000);
    expect((moved?.endMs ?? 0) - 40_000).toBe((moved?.startMs ?? 0) - 20_000);
  });

  it("offers its handles once a double-click has zoomed in", async () => {
    shortTimeline();
    const bar = screen.getByRole("button", { name: /Build Up from/i });

    await act(async () => {
      bar.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });

    expect(screen.queryByRole("button", { name: /Trim the start of Build Up/i })).not.toBeNull();
  });

  it("stays a plain mark — no marker inside it, no handles beside it", () => {
    // What a fitted timeline really looks like: a clip of a few pixels. Drawing
    // the moment marker inside it turned the bar into a white smear that read as
    // a "hold" icon rather than a clip.
    shortTimeline();
    const bar = screen.getByRole("button", { name: /Build Up from/i });
    expect(bar.querySelectorAll("span")).toHaveLength(0);
  });
});

describe("the time axis", () => {
  it("starts where the bars start, not under the track headers", () => {
    // The ruler used to be drawn across the full width while the bars began a
    // gutter to the right, so 00:00 sat under the track names and every label
    // named a moment 132 px to its right.
    usePlayerStore.setState({ durationMs: 60_000 });
    seedEvent();
    render(<Timeline />);

    const axis = screen.getByRole("slider", { name: "Timeline" });
    const gutter = axis.previousElementSibling as HTMLElement | null;
    const header = trackLane("Build Up").previousElementSibling as HTMLElement | null;

    expect(gutter).not.toBeNull();
    expect(gutter?.style.width).toBeTruthy();
    // One column, two rows: the axis and the lanes are offset by the same width.
    expect(gutter?.style.width).toBe(header?.style.width);
  });
});

describe("a gesture that loses its button", () => {
  it("stops editing the clip when a move arrives with no button held", async () => {
    // What the owner saw: the clip changing as the pointer moved, with nothing
    // pressed. A gesture whose capture went nowhere was never ended, and every
    // later move — no button, no press — carried on applying it.
    usePlayerStore.setState({ durationMs: 60_000 });
    seedEvent();
    render(<Timeline />);

    const bar = screen.getByRole("button", { name: /Build Up from/i });
    await act(async () => {
      bar.dispatchEvent(pointer("pointerdown", 300));
      // No `pointerup` at all: the release went to whatever else captured it.
      bar.dispatchEvent(pointer("pointermove", 500, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const untouched = useEventStore.getState().events[0];
    expect(untouched?.startMs).toBe(20_000);
    expect(untouched?.endMs).toBe(40_000);
    expect(untouched?.anchorMs).toBe(30_000);
  });
});

/** An event with a clip range, which is what a bar is drawn from. */
function spaceEvent() {
  return {
    id: 7,
    videoId: 1,
    anchorMs: 30_000,
    startMs: 20_000,
    endMs: 40_000,
    notes: null,
    tagId: 1,
    tagName: "Build Up",
    tagColor: "#4C8DFF",
    categoryName: "ATTACK",
    teamId: null,
    teamName: null,
    playerId: null,
    playerName: null,
  };
}
