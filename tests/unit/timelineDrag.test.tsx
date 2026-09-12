import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "@/app/ErrorBoundary";
import { Timeline } from "@/features/timeline/Timeline";
import { useEventStore } from "@/stores/eventStore";
import { usePlayerStore } from "@/stores/playerStore";

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

/** The marker lane is the ruler's sibling; the ruler is the named one. */
function markerLane(container: HTMLElement): Element {
  const ruler = container.querySelector('[role="slider"][aria-label="Timeline"]');
  const lane = ruler?.nextElementSibling;
  if (!lane) throw new Error("the marker lane is not where it used to be");
  return lane;
}

function pointer(type: string, clientX: number): MouseEvent {
  return new MouseEvent(type, { bubbles: true, clientX, clientY: 10 });
}

beforeEach(() => {
  vi.clearAllMocks();
  stubLaneLayout();
  usePlayerStore.setState({ durationMs: 861_737 });
  useEventStore.setState({ events: [], lastCapturedId: null, undoStack: [], error: null });
});

describe("dragging a range on the timeline", () => {
  it("does not throw once React runs the update, and does not blank the window", async () => {
    const logged: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args) => {
      logged.push(args.map(String).join(" "));
    });

    const { container } = render(
      <ErrorBoundary>
        <Timeline />
      </ErrorBoundary>,
    );

    const lane = markerLane(container);

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
    const { container } = render(
      <ErrorBoundary>
        <Timeline />
      </ErrorBoundary>,
    );

    const lane = markerLane(container);
    lane.dispatchEvent(pointer("pointerdown", 300));
    lane.dispatchEvent(pointer("pointerup", 300));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(seekMs).toHaveBeenCalledTimes(1);
    // Halfway across a 14-minute match at the fitted zoom.
    expect(seekMs.mock.calls[0][0]).toBeGreaterThan(400_000);
  });
});
