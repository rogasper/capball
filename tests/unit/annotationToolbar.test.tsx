import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AnnotationToolbar } from "@/features/annotate/AnnotationToolbar";
import { boxGeometry } from "@/lib/annotate/geometry";
import { type Annotation, DEFAULT_STYLE, type ShapeKind } from "@/lib/annotate/types";
import { useAnnotationStore } from "@/stores/annotationStore";
import { useEventStore } from "@/stores/eventStore";
import { usePlayerStore } from "@/stores/playerStore";

/**
 * The drawing inspector's R2 controls (FR-20.11, FR-20.12).
 *
 * The pure modules are covered by their own tests; what these hold is that the
 * controls exist, that they write the style the renderer reads, and — the part
 * most easily left implicit — that a shape whose corners cannot be reshaped is
 * told so in words rather than by a missing control.
 */

vi.mock("@/lib/ipc/database", () => ({
  execute: vi.fn().mockResolvedValue(undefined),
  select: vi.fn().mockResolvedValue([]),
}));

function drawing(kind: ShapeKind, patch: Partial<Annotation> = {}): Annotation {
  return {
    id: 1,
    uid: "u1",
    eventId: 7,
    kind,
    windowMode: "moment",
    windowMs: 2_500,
    geometry: boxGeometry([0.2, 0.2], [0.6, 0.4]),
    style: { ...DEFAULT_STYLE },
    label: null,
    z: 0,
    ...patch,
  };
}

function open(annotation: Annotation | null, style = DEFAULT_STYLE): void {
  usePlayerStore.setState({ paused: true });
  useAnnotationStore.setState({
    eventId: 7,
    annotations: annotation ? [annotation] : [],
    selectedId: annotation?.id ?? null,
    style: { ...style },
    // `select()` syncs these in the app; a test that set the selection directly
    // has to do the same, or it would be testing a state the app cannot reach.
    ownWindow: annotation?.ownWindow ?? null,
    ...(annotation ? { windowMode: annotation.windowMode, windowMs: annotation.windowMs } : {}),
    error: null,
  });
}

let playheadMs = 0;

function setPlayhead(timeMs: number): void {
  playheadMs = timeMs;
}

/** The open event, which the panel needs to scale a range against. */
function withEvent(): void {
  useEventStore.setState({
    events: [
      {
        id: 7,
        videoId: 1,
        anchorMs: 100_000,
        startMs: 92_000,
        endMs: 112_000,
        notes: null,
        tagId: 1,
        tagName: "Attacking",
        tagColor: null,
        categoryName: "ATTACK",
        teamId: null,
        teamName: null,
        playerId: null,
        playerName: null,
      },
    ],
  });
}

/** The playhead, which the range actions read. `timeMs` is a getter in the
 * real controller, so the mock exposes one too and a test sets it through
 * `setPlayhead` rather than by assignment. */
vi.mock("@/lib/playback", () => ({
  playback: {
    get timeMs() {
      return playheadMs;
    },
    seekMs: vi.fn(),
    onFrame: () => () => {},
    onState: () => () => {},
    pause: vi.fn(),
    play: vi.fn(),
    durationMs: 0,
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  open(null);
});

describe("fill patterns", () => {
  it("offers no pattern controls for an unfilled shape", () => {
    open(null, { ...DEFAULT_STYLE, fill: null });
    render(<AnnotationToolbar />);
    expect(screen.queryByLabelText("Fill pattern type")).toBeNull();
  });

  it("writes the pattern it is given into the style the renderer reads", () => {
    open(null, { ...DEFAULT_STYLE, fill: "#4C8DFF33" });
    render(<AnnotationToolbar />);

    // The control is present as soon as there is a fill to pattern.
    const trigger = screen.getByLabelText("Fill pattern type");
    expect(trigger).toBeTruthy();

    // The store is the single source of truth for the style, so a change here is
    // what the canvas and the burn-in will both read.
    act(() => useAnnotationStore.getState().setStyle({ fillPattern: "crossHatch" }));
    expect(useAnnotationStore.getState().style.fillPattern).toBe("crossHatch");
  });

  it("shows the spacing and angle only once the fill is patterned", () => {
    open(null, { ...DEFAULT_STYLE, fill: "#4C8DFF33", fillPattern: "solid" });
    const { rerender } = render(<AnnotationToolbar />);
    expect(screen.queryByLabelText("Hatch spacing")).toBeNull();

    act(() => open(null, { ...DEFAULT_STYLE, fill: "#4C8DFF33", fillPattern: "hatch" }));
    rerender(<AnnotationToolbar />);
    expect(screen.getByLabelText("Hatch spacing")).toBeTruthy();
    expect(screen.getByLabelText("Hatch angle")).toBeTruthy();
  });

  it("turns the fill off without losing the pattern the user chose", () => {
    open(null, { ...DEFAULT_STYLE, fill: "#4C8DFF33", fillPattern: "crossHatch" });
    render(<AnnotationToolbar />);

    fireEvent.click(screen.getByRole("button", { name: "Fill" }));
    const style = useAnnotationStore.getState().style;
    expect(style.fill).toBeNull();
    // The pattern is remembered, so switching the fill back on does not reset it.
    expect(style.fillPattern).toBe("crossHatch");
  });
});

describe("what the inspector says about reshaping", () => {
  it("explains the reshape gestures on a shape that has corners to edit", () => {
    open(drawing("rect"));
    render(<AnnotationToolbar />);
    expect(screen.getByText(/Drag a corner to reshape it/)).toBeTruthy();
  });

  it("says plainly when a shape's corners are not editable", () => {
    open(drawing("ellipse"));
    render(<AnnotationToolbar />);
    expect(screen.getByText(/its handles are its box, not corners you can remove/)).toBeTruthy();
  });
});

describe("the line vocabulary (FR-20.14)", () => {
  it("offers every line style as a button, and marks the active one", () => {
    // The inspector reads its style from the store, so the shape's own style has
    // to be the store's style for "which one is active" to mean anything.
    const dotted = drawing("line", { style: { ...DEFAULT_STYLE, strokePattern: "dotted" } });
    open(dotted, dotted.style);

    render(<AnnotationToolbar />);

    // The buttons show the line rather than naming it, so the accessible name is
    // what a tester — and a screen reader — has to go on.
    for (const [pattern, label] of [
      ["solid", "Solid"],
      ["dashed", "Dashed"],
      ["dotted", "Dotted"],
      ["dashDot", "Dash-dot"],
    ] as const) {
      const button = screen.getByRole("button", { name: `${label} line` });
      expect(button.getAttribute("aria-pressed")).toBe(pattern === "dotted" ? "true" : "false");
    }
  });

  it("writes the line style into the style the renderer reads", () => {
    open(drawing("line"));

    render(<AnnotationToolbar />);
    fireEvent.click(screen.getByRole("button", { name: "Dashed line" }));

    expect(useAnnotationStore.getState().style.strokePattern).toBe("dashed");
  });

  it("offers the named strokes, each with what it means", () => {
    render(<AnnotationToolbar />);

    for (const label of ["Pass", "Run", "Dribble", "Press", "Cover"]) {
      expect(screen.getByRole("button", { name: new RegExp(label, "i") })).toBeInTheDocument();
    }
    // With nothing selected a preset arms the tool, and says so.
    expect(screen.getByTitle(/Draw a run/i)).toBeInTheDocument();
  });

  it("restyles a selected shape rather than arming a tool", () => {
    open(drawing("arrow"));

    render(<AnnotationToolbar />);
    fireEvent.click(screen.getByRole("button", { name: /Run/i }));

    const state = useAnnotationStore.getState();
    // The shape took the notation…
    expect(state.annotations[0]?.style.strokePattern).toBe("dashed");
    expect(state.annotations[0]?.style.stroke).toBe("#F0913A");
    // …and no tool was armed, so a click on the canvas cannot draw by surprise.
    expect(state.tool).toBeNull();
    // Every preset says it will restyle, because a shape is selected.
    expect(screen.getAllByTitle(/Restyle the selected shape/i)).toHaveLength(5);
  });

  it("arms the tool when there is nothing selected", () => {
    open(null);

    render(<AnnotationToolbar />);
    fireEvent.click(screen.getByRole("button", { name: /Cover/i }));

    const state = useAnnotationStore.getState();
    expect(state.tool).toBe("line");
    expect(state.style.strokePattern).toBe("dashed");
  });
});

describe("a drawing's own range (FR-20.16)", () => {
  const drawn = () => drawing("rect", { ownWindow: { startMs: 30_000, endMs: 40_000 } });

  it("shows a range that is set, and the two ways to change its ends", () => {
    const shape = drawn();
    open(shape, shape.style);
    // Drawing requires an event, so the panel always has one to show the range
    // against — which is what the bar's scale is.
    withEvent();

    render(<AnnotationToolbar />);

    // The control shows the state in effect, not the mode it overrode.
    expect(screen.getByRole("combobox", { name: "Time window" })).toHaveTextContent(
      "A range I set",
    );
    expect(screen.getByRole("img", { name: /On screen from/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start here" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "End here" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "The whole event" })).toBeInTheDocument();
  });

  it("moves an end to the playhead, which is how this app sets every other time", () => {
    const shape = drawn();
    open(shape, shape.style);
    withEvent();
    // The playhead is inside the range, which is the ordinary case: the edge
    // being set moves to it.
    setPlayhead(35_000);

    render(<AnnotationToolbar />);
    fireEvent.click(screen.getByRole("button", { name: "Start here" }));

    expect(useAnnotationStore.getState().annotations[0]?.ownWindow).toEqual({
      startMs: 35_000,
      endMs: 40_000,
    });
  });

  it("widens to the event's own clip", () => {
    const shape = drawn();
    open(shape, shape.style);
    withEvent();

    render(<AnnotationToolbar />);
    fireEvent.click(screen.getByRole("button", { name: "The whole event" }));

    expect(useAnnotationStore.getState().annotations[0]?.ownWindow).toEqual({
      startMs: 92_000,
      endMs: 112_000,
    });
  });

  it("does not show the length field when a range is in effect", () => {
    const shape = drawn();
    open(shape, shape.style);
    withEvent();

    render(<AnnotationToolbar />);

    expect(screen.queryByRole("spinbutton", { name: /window length/i })).toBeNull();
  });
});
