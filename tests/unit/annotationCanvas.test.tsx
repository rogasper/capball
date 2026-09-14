import { fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AnnotationCanvas } from "@/features/annotate/AnnotationCanvas";
import { boxGeometry, pathGeometry } from "@/lib/annotate/geometry";
import { type Annotation, DEFAULT_STYLE, type ShapeKind } from "@/lib/annotate/types";
import { useAnnotationStore } from "@/stores/annotationStore";
import { useEventStore } from "@/stores/eventStore";
import { useLibraryStore } from "@/stores/libraryStore";
import { usePlayerStore } from "@/stores/playerStore";

/**
 * The handle layer (FR-20.11).
 *
 * R1's canvas had no component test, which is how the drawing surface's own
 * rules went unexercised; M12 adds grips that only exist as DOM, so this holds
 * the two things the pure tests cannot: that the grips render at all, and that
 * each one says what it does — including the ones that remove a corner, since
 * that gesture is invisible until you know it is there.
 */

vi.mock("@/lib/ipc/database", () => ({
  execute: vi.fn().mockResolvedValue(undefined),
  select: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/playback", () => ({
  playback: {
    timeMs: 0,
    durationMs: 100_000,
    onFrame: () => () => {},
    onState: () => () => {},
  },
}));

function drawing(kind: ShapeKind, geometry = boxGeometry([0.2, 0.2], [0.6, 0.4])): Annotation {
  return {
    id: 1,
    uid: "u1",
    eventId: 7,
    kind,
    windowMode: "moment",
    windowMs: 2_500,
    geometry,
    style: { ...DEFAULT_STYLE },
    label: null,
    z: 0,
  };
}

function select(annotation: Annotation | null): void {
  useAnnotationStore.setState({
    eventId: 7,
    annotations: annotation ? [annotation] : [],
    selectedId: annotation?.id ?? null,
    tool: null,
    // jsdom returns null from getContext, which the canvas already tolerates.
    error: null,
  });
}

function draw(): void {
  const stageRef = createRef<HTMLElement>();
  // The video ref is deliberately unattached: jsdom has no video, so the content
  // rect stays empty and the grips land at the origin. That is enough to hold
  // what this test is about — which grips exist and what they say.
  const videoRef = createRef<HTMLVideoElement>();
  render(
    <>
      <section ref={stageRef} />
      <AnnotationCanvas stageRef={stageRef} videoRef={videoRef} />
    </>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  usePlayerStore.setState({ paused: true });
  useLibraryStore.setState({ playbackUrl: "asset://video.mp4", probe: null });
  useEventStore.setState({
    events: [
      {
        id: 7,
        videoId: 1,
        anchorMs: 1_000,
        startMs: 0,
        endMs: 5_000,
        notes: null,
        tagId: 1,
        tagName: "Shot",
        tagColor: "#4C8DFF",
        categoryName: "ATTACK",
        teamId: null,
        teamName: null,
        playerId: null,
        playerName: null,
      },
    ],
  });
  select(null);
});

describe("the grips a selected shape shows", () => {
  it("offers a rectangle its four resize corners plus one add-grip per edge", () => {
    select(drawing("rect"));
    draw();

    expect(screen.getAllByRole("button", { name: /^Resize from/ })).toHaveLength(4);
    expect(screen.getAllByRole("button", { name: "Add a corner on this edge" })).toHaveLength(4);
    expect(screen.getByRole("button", { name: "Rotate" })).toBeTruthy();
  });

  it("offers a polygon a grip per corner and no box resize", () => {
    select(
      drawing(
        "polygon",
        pathGeometry([
          [0.2, 0.2],
          [0.6, 0.2],
          [0.6, 0.6],
        ]),
      ),
    );
    draw();

    expect(screen.getAllByRole("button", { name: /^Corner \d+ of 3/ })).toHaveLength(3);
    expect(screen.queryByRole("button", { name: /^Resize from/ })).toBeNull();
    // A polygon has edges too, so a corner can be added to it.
    expect(screen.getAllByRole("button", { name: "Add a corner on this edge" })).toHaveLength(3);
  });

  it("tells the user that a corner can be removed, not only moved", () => {
    select(drawing("rect"));
    draw();

    // The removal gesture is invisible until it is named, so the label names it.
    expect(screen.getAllByRole("button", { name: /Delete removes this corner/ })).toHaveLength(4);
  });

  it("keeps a line's two endpoints and offers it no new corner", () => {
    select(
      drawing(
        "line",
        pathGeometry([
          [0.2, 0.2],
          [0.8, 0.6],
        ]),
      ),
    );
    draw();

    expect(screen.getByRole("button", { name: "Move start point" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Move end point" })).toBeTruthy();
    // Inserting one would have to close the line into a triangle nobody drew.
    expect(screen.queryByRole("button", { name: "Add a corner on this edge" })).toBeNull();
  });

  it("shows no grips at all while a tool is in hand", () => {
    select(drawing("rect"));
    useAnnotationStore.setState({ tool: "ellipse", toolSurface: "frame" });
    draw();

    expect(screen.queryByRole("button", { name: /^Resize from/ })).toBeNull();
  });

  it("leaves the video alone while the pitch view owns the tool", () => {
    select(null);
    // A tool armed on the other surface must not swallow clicks here: that is
    // what made the app look locked while a zone was being drawn on the pitch.
    useAnnotationStore.setState({ tool: "rect", toolSurface: "pitch" });
    draw();

    fireEvent.pointerDown(screen.getByLabelText("Annotation layer"), {
      clientX: 40,
      clientY: 40,
    });

    expect(useAnnotationStore.getState().draft).toBeNull();
    expect(useAnnotationStore.getState().draftPoints).toBeNull();
  });
});
