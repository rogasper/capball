import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AnnotationToolbar } from "@/features/annotate/AnnotationToolbar";
import { boxGeometry } from "@/lib/annotate/geometry";
import { type Annotation, DEFAULT_STYLE, type ShapeKind } from "@/lib/annotate/types";
import { useAnnotationStore } from "@/stores/annotationStore";
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
    error: null,
  });
}

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
