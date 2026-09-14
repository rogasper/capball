import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PitchCanvas } from "@/features/pitch/PitchCanvas";
import { DEFAULT_STYLE } from "@/lib/annotate/types";
import { useAnnotationStore } from "@/stores/annotationStore";
import { useCalibrationStore } from "@/stores/calibrationStore";
import { useEventStore } from "@/stores/eventStore";
import { useLibraryStore } from "@/stores/libraryStore";

/**
 * Drawing on the pitch (FR-80.2, FR-80.3).
 *
 * Two things only the rendered surface can hold: that drawing is *offered* only
 * when the perspective is known, and that the tools which do not belong there
 * say so instead of quietly doing nothing.
 */

vi.mock("@/lib/ipc/database", () => ({
  execute: vi.fn().mockResolvedValue(undefined),
  select: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/db/queries/annotations", () => ({
  listAnnotations: vi.fn().mockResolvedValue([]),
  createAnnotation: vi.fn(async (input: unknown) => ({ id: 1, ...(input as object) })),
  updateAnnotationGeometry: vi.fn().mockResolvedValue(undefined),
  updateAnnotationShape: vi.fn().mockResolvedValue(undefined),
  updateAnnotationStyle: vi.fn().mockResolvedValue(undefined),
  updateAnnotationWindow: vi.fn().mockResolvedValue(undefined),
  updateAnnotationLabel: vi.fn().mockResolvedValue(undefined),
  deleteAnnotation: vi.fn().mockResolvedValue(undefined),
  countAnnotations: vi.fn().mockResolvedValue(0),
  reorderAnnotations: vi.fn().mockResolvedValue(undefined),
}));

const SIZE = { lengthM: 105, widthM: 68 };

const event = {
  id: 7,
  videoId: 1,
  anchorMs: 57_701,
  startMs: 49_701,
  endMs: 69_701,
  notes: null,
  tagId: 1,
  tagName: "High Press",
  tagColor: "#4C8DFF",
  categoryName: "DEFENSE",
  teamId: null,
  teamName: null,
  playerId: null,
  playerName: null,
};

const reference = [
  { feature: "left-pa-front-top", imageU: 0.2, imageV: 0.3, xM: -36, yM: -20.16 },
  { feature: "left-pa-front-bottom", imageU: 0.2, imageV: 0.7, xM: -36, yM: 20.16 },
  { feature: "left-pa-goal-line-top", imageU: 0.05, imageV: 0.35, xM: -52.5, yM: -20.16 },
  { feature: "left-pa-goal-line-bottom", imageU: 0.05, imageV: 0.65, xM: -52.5, yM: 20.16 },
];

/** One marked player, so the SVG has something to render and its role exists. */
const sets = [
  {
    label: "This moment",
    variant: "solid" as const,
    positions: [
      {
        id: 1,
        uid: "p1",
        eventId: 7,
        playerId: 3,
        playerName: "Saka",
        shirtNumber: 7,
        teamId: 1,
        teamName: "Arsenal",
        teamColor: "#EF0107",
        calibrationId: 1,
        imageU: 0.5,
        imageV: 0.5,
        xM: 10,
        yM: -4,
      },
    ],
  },
];

function calibrate(): void {
  useCalibrationStore.setState({
    videoId: 1,
    calibrations: [
      {
        id: 1,
        videoId: 1,
        fromMs: 0,
        pitchLengthM: 105,
        pitchWidthM: 68,
        rmsErrorPx: 1.4,
        points: reference,
      },
    ],
    picks: [],
    fromMs: 0,
    pitchLengthM: 105,
    pitchWidthM: 68,
    pendingFeature: null,
    editingId: null,
    error: null,
  });
}

/**
 * jsdom gives every element a zero-sized box, and a pitch view with no size has
 * no metres in it. The stub below is the size the SVG has when the panel is open
 * at a normal window width.
 */
const realRect = Element.prototype.getBoundingClientRect;
const realCapture = {
  set: Element.prototype.setPointerCapture,
  has: Element.prototype.hasPointerCapture,
  release: Element.prototype.releasePointerCapture,
};

beforeEach(() => {
  Element.prototype.getBoundingClientRect = () =>
    ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 1130,
      bottom: 760,
      width: 1130,
      height: 760,
      toJSON: () => ({}),
    }) as DOMRect;

  // jsdom implements no pointer capture at all, and every drag gesture in the
  // editor takes the pointer so a release outside the panel still ends the drag.
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => {};

  vi.clearAllMocks();
  useEventStore.setState({ events: [event], lastCapturedId: null, undoStack: [], error: null });
  useLibraryStore.setState({
    probe: {
      path: "/tmp/match.mp4",
      sizeBytes: 1,
      container: "mov",
      durationMs: 90_000,
      width: 1920,
      height: 1080,
      fpsNum: 25,
      fpsDen: 1,
      videoCodec: "h264",
      audioCodec: "aac",
      faststart: true,
    },
  });
  useCalibrationStore.setState({ videoId: 1, calibrations: [], picks: [], error: null });
  useAnnotationStore.setState({
    eventId: 7,
    annotations: [],
    selectedId: null,
    tool: null,
    toolSurface: "frame",
    draft: null,
    draftPoints: null,
    draftSpace: "frame",
    error: null,
    notice: null,
  });
});

describe("drawing on the pitch", () => {
  it("asks for a calibration instead of offering tools that need the perspective", () => {
    render(<PitchCanvas size={SIZE} sets={[]} emptyMessage="nothing yet" />);

    expect(screen.getByText(/calibrate this video above/i)).toBeTruthy();
    expect(screen.queryByLabelText("Rectangle, in metres")).toBeNull();
  });

  it("offers the tools in metres once the video is calibrated", () => {
    calibrate();
    render(<PitchCanvas size={SIZE} sets={[]} emptyMessage="nothing yet" />);

    expect(screen.getByLabelText("Rectangle, in metres")).toBeTruthy();
    expect(screen.getByLabelText("Zone by clicks, in metres")).toBeTruthy();
    // The space is stated, and so is what it means for the video.
    expect(screen.getByText(/shapes are stored in metres/i)).toBeTruthy();
    expect(screen.getByText(/moves if you correct the calibration/i)).toBeTruthy();
  });

  it("arms its tool on the pitch surface, and declares the space at the gesture", () => {
    calibrate();
    render(<PitchCanvas size={SIZE} sets={sets} emptyMessage="nothing yet" />);

    // Picking a tool here must not arm the video's canvas: that is what made the
    // app feel locked, because the video swallowed every click while a tool was
    // in hand on the other surface.
    fireEvent.click(screen.getByLabelText("Rectangle, in metres"));
    expect(useAnnotationStore.getState().toolSurface).toBe("pitch");

    fireEvent.pointerDown(screen.getByRole("img"), { clientX: 100, clientY: 100 });
    expect(useAnnotationStore.getState().draftSpace).toBe("pitch");
  });

  it("refuses freehand and text on the pitch, and says where they belong", () => {
    calibrate();
    // A guard rather than a path the tool row offers: it exists so that a future
    // tool, or a tool armed elsewhere, cannot silently draw a stroke in metres.
    useAnnotationStore.setState({ tool: "freehand", toolSurface: "pitch" });
    render(<PitchCanvas size={SIZE} sets={sets} emptyMessage="nothing yet" />);

    fireEvent.pointerDown(screen.getByRole("img"), { clientX: 100, clientY: 100 });

    expect(useAnnotationStore.getState().error).toMatch(/drawn on the video frame/i);
    // Nothing was started, so nothing can be committed by accident.
    expect(useAnnotationStore.getState().draft).toBeNull();
    expect(useAnnotationStore.getState().draftPoints).toBeNull();
  });

  it("draws a zone click by click and says how to close it", () => {
    calibrate();
    render(<PitchCanvas size={SIZE} sets={sets} emptyMessage="nothing yet" />);
    fireEvent.click(screen.getByLabelText("Zone by clicks, in metres"));

    fireEvent.pointerDown(screen.getByRole("img"), { clientX: 200, clientY: 200 });

    expect(useAnnotationStore.getState().draftPoints).toHaveLength(1);
    expect(screen.getByText(/press Enter or double-click to close the zone/i)).toBeTruthy();
  });
});

afterEach(() => {
  Element.prototype.getBoundingClientRect = realRect;
  Element.prototype.setPointerCapture = realCapture.set;
  Element.prototype.hasPointerCapture = realCapture.has;
  Element.prototype.releasePointerCapture = realCapture.release;
});

describe("after a shape is drawn", () => {
  it("hands the diagram back to selecting, so no tool stays armed", async () => {
    calibrate();
    render(<PitchCanvas size={SIZE} sets={sets} emptyMessage="nothing yet" />);
    fireEvent.click(screen.getByLabelText("Rectangle, in metres"));

    const surface = screen.getByRole("img");
    // A drag big enough to be a shape: at this scale a metre is about ten pixels.
    fireEvent.pointerDown(surface, { clientX: 300, clientY: 300 });
    fireEvent.pointerMove(surface, { clientX: 500, clientY: 420 });
    fireEvent.pointerUp(surface, { clientX: 500, clientY: 420 });

    // The commit is asynchronous; the tool is cleared once the draft is gone.
    await waitFor(() => expect(useAnnotationStore.getState().tool).toBeNull());
    expect(useAnnotationStore.getState().annotations).toHaveLength(1);
    expect(useAnnotationStore.getState().annotations[0]?.geometry.space).toBe("pitch");
  });
});

describe("the shape being drawn is visible while it is drawn", () => {
  it("shows a dashed preview during the drag, so the tool does not look dead", () => {
    calibrate();
    const { container } = render(
      <PitchCanvas size={SIZE} sets={sets} emptyMessage="nothing yet" />,
    );
    fireEvent.click(screen.getByLabelText("Rectangle, in metres"));

    const surface = screen.getByRole("img");
    expect(container.querySelector("path[stroke-dasharray]")).toBeNull();

    fireEvent.pointerDown(surface, { clientX: 300, clientY: 300 });
    fireEvent.pointerMove(surface, { clientX: 460, clientY: 400 });

    // Dashed because it is not stored yet; without this a drag looked like
    // nothing happening at all.
    expect(container.querySelector("path[stroke-dasharray]")).toBeTruthy();
  });

  it("shows each corner as it is placed, so a zone by clicks has feedback", () => {
    calibrate();
    const { container } = render(
      <PitchCanvas size={SIZE} sets={sets} emptyMessage="nothing yet" />,
    );
    fireEvent.click(screen.getByLabelText("Zone by clicks, in metres"));

    const surface = screen.getByRole("img");
    fireEvent.pointerDown(surface, { clientX: 300, clientY: 300 });
    fireEvent.pointerDown(surface, { clientX: 400, clientY: 340 });

    // Two corners placed: two circles in the draft group.
    expect(container.querySelectorAll("circle[stroke-width='0.3']")).toHaveLength(2);
  });
});

describe("drawings that belong to the other space", () => {
  it("says so, rather than looking like it lost them", () => {
    calibrate();
    // A shape drawn over the video: listed in the Draw tab, never on this
    // diagram, because its numbers are fractions of the picture.
    useAnnotationStore.setState({
      annotations: [
        {
          id: 1,
          uid: "frame-shape",
          eventId: 7,
          kind: "line",
          windowMode: "moment",
          windowMs: 2_500,
          geometry: { x: 0.1, y: 0.1, w: 0.2, h: 0.2, rotation: 0, space: "frame" },
          style: { ...DEFAULT_STYLE },
          label: null,
          z: 0,
        },
      ],
    });

    render(<PitchCanvas size={SIZE} sets={sets} emptyMessage="nothing yet" />);

    expect(screen.getByText(/anchored to the video frame/i)).toBeTruthy();
    expect(screen.getByText(/edit it in the Draw tab/i)).toBeTruthy();
  });

  it("says nothing when the moment has no drawings at all", () => {
    calibrate();
    render(<PitchCanvas size={SIZE} sets={sets} emptyMessage="nothing yet" />);
    expect(screen.queryByText(/anchored to the video frame/i)).toBeNull();
  });
});
