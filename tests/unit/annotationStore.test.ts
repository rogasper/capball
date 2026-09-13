import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  absolutePoints,
  pathGeometry,
  type Rect,
  shapeVertices,
  twoPointGeometry,
} from "@/lib/annotate/geometry";
import type { Annotation, Geometry, ShapeKind } from "@/lib/annotate/types";
import { DEFAULT_STYLE } from "@/lib/annotate/types";
import * as annotationsQuery from "@/lib/db/queries/annotations";
import { useAnnotationStore } from "@/stores/annotationStore";

/**
 * The query layer is the only thing this store touches, so mocking it keeps the
 * editor's rules — gesture-scoped writes, the command stack, style memory —
 * testable without a database. The SQL itself is covered by the integration
 * test.
 */
vi.mock("@/lib/db/queries/annotations", () => ({
  listAnnotations: vi.fn(),
  createAnnotation: vi.fn(),
  updateAnnotationGeometry: vi.fn(),
  updateAnnotationShape: vi.fn(),
  updateAnnotationStyle: vi.fn(),
  updateAnnotationWindow: vi.fn(),
  updateAnnotationLabel: vi.fn(),
  deleteAnnotation: vi.fn(),
  countAnnotations: vi.fn(),
  reorderAnnotations: vi.fn(),
}));

const listAnnotations = vi.mocked(annotationsQuery.listAnnotations);
const createAnnotation = vi.mocked(annotationsQuery.createAnnotation);
const updateAnnotationGeometry = vi.mocked(annotationsQuery.updateAnnotationGeometry);
const updateAnnotationShape = vi.mocked(annotationsQuery.updateAnnotationShape);
const updateAnnotationStyle = vi.mocked(annotationsQuery.updateAnnotationStyle);
const updateAnnotationWindow = vi.mocked(annotationsQuery.updateAnnotationWindow);
const updateAnnotationLabel = vi.mocked(annotationsQuery.updateAnnotationLabel);
const deleteAnnotation = vi.mocked(annotationsQuery.deleteAnnotation);
const reorderAnnotations = vi.mocked(annotationsQuery.reorderAnnotations);

let nextId = 1;

function row(id: number, uid: string, patch: Partial<Annotation> = {}): Annotation {
  return {
    id,
    uid,
    eventId: 7,
    kind: "rect",
    windowMode: "moment",
    windowMs: 2_500,
    geometry: { x: 0.2, y: 0.2, w: 0.2, h: 0.2, rotation: 0 },
    style: { ...DEFAULT_STYLE },
    label: null,
    z: id - 1,
    ...patch,
  };
}

const box: Geometry = { x: 0.1, y: 0.1, w: 0.2, h: 0.2, rotation: 0 };

beforeEach(() => {
  vi.clearAllMocks();
  nextId = 1;

  useAnnotationStore.setState({
    eventId: null,
    annotations: [],
    selectedId: null,
    tool: null,
    draft: null,
    draftPoints: null,
    draftLabel: null,
    dragOrigin: null,
    style: { ...DEFAULT_STYLE },
    windowMode: "moment",
    windowMs: 2_500,
    undoStack: [],
    redoStack: [],
    error: null,
  });

  createAnnotation.mockImplementation(async (input) => ({ id: nextId++, ...input }) as Annotation);
  updateAnnotationGeometry.mockResolvedValue(undefined);
  updateAnnotationShape.mockResolvedValue(undefined);
  updateAnnotationStyle.mockResolvedValue(undefined);
  updateAnnotationWindow.mockResolvedValue(undefined);
  updateAnnotationLabel.mockResolvedValue(undefined);
  deleteAnnotation.mockResolvedValue(undefined);
  reorderAnnotations.mockResolvedValue(undefined);
});

describe("loading", () => {
  it("opens an event's drawings in paint order", async () => {
    listAnnotations.mockResolvedValue([row(2, "b", { z: 5 }), row(1, "a", { z: 1 })]);
    await useAnnotationStore.getState().load(7);

    const state = useAnnotationStore.getState();
    expect(state.eventId).toBe(7);
    expect(state.annotations.map((annotation) => annotation.uid)).toEqual(["a", "b"]);
  });

  it("surfaces a read failure instead of showing an empty event", async () => {
    listAnnotations.mockRejectedValue(new Error("Annotation 3 has an unreadable geometry."));
    await useAnnotationStore.getState().load(7);
    expect(useAnnotationStore.getState().error).toMatch(/unreadable geometry/);
  });
});

describe("drawing", () => {
  it("does nothing without an event or a tool", async () => {
    useAnnotationStore.setState({ eventId: 7, draft: box });
    await useAnnotationStore.getState().commitDraft();
    expect(createAnnotation).not.toHaveBeenCalled();
  });

  it("stores the draft with the current style and window, and selects it", async () => {
    useAnnotationStore.setState({ eventId: 7, tool: "rect", draft: box, windowMs: 4_000 });

    await useAnnotationStore.getState().commitDraft();

    const input = createAnnotation.mock.calls[0][0];
    expect(input).toMatchObject({
      eventId: 7,
      kind: "rect",
      windowMode: "moment",
      windowMs: 4_000,
    });
    expect(input.geometry).toEqual(box);
    expect(input.uid).toBeTruthy();

    const state = useAnnotationStore.getState();
    expect(state.annotations).toHaveLength(1);
    expect(state.selectedId).toBe(state.annotations[0].id);
    expect(state.draft).toBeNull();
  });

  it("puts a new shape on top of the stack", async () => {
    listAnnotations.mockResolvedValue([row(1, "a", { z: 3 })]);
    await useAnnotationStore.getState().load(7);
    useAnnotationStore.setState({ tool: "arrow", draft: box });

    await useAnnotationStore.getState().commitDraft();

    expect(createAnnotation.mock.calls[0][0].z).toBe(4);
  });

  it("simplifies a freehand stroke before storing it", async () => {
    useAnnotationStore.setState({
      eventId: 7,
      tool: "freehand",
      draftPoints: [
        [0.1, 0.1],
        [0.2, 0.1],
        [0.3, 0.1],
        [0.4, 0.1],
        [0.4, 0.4],
      ],
    });

    await useAnnotationStore.getState().commitDraft();

    // The collinear run collapses; the corner survives.
    const geometry = createAnnotation.mock.calls[0][0].geometry;
    expect(geometry.points).toHaveLength(3);
  });

  it("does not store a freehand stroke that never moved", async () => {
    useAnnotationStore.setState({ eventId: 7, tool: "freehand", draftPoints: [[0.1, 0.1]] });
    await useAnnotationStore.getState().commitDraft();
    expect(createAnnotation).not.toHaveBeenCalled();
  });
});

describe("style memory", () => {
  it("applies a style to the selection and keeps it for the next shape", async () => {
    listAnnotations.mockResolvedValue([row(1, "a")]);
    await useAnnotationStore.getState().load(7);
    useAnnotationStore.getState().select(1);

    useAnnotationStore.getState().setStyle({ stroke: "#FF0000" });

    expect(useAnnotationStore.getState().style.stroke).toBe("#FF0000");
    expect(useAnnotationStore.getState().annotations[0].style.stroke).toBe("#FF0000");
    expect(updateAnnotationStyle).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ stroke: "#FF0000" }),
    );
  });

  it("remembers a style with nothing selected", () => {
    useAnnotationStore.getState().setStyle({ stroke: "#00FF00" });
    expect(useAnnotationStore.getState().style.stroke).toBe("#00FF00");
    expect(updateAnnotationStyle).not.toHaveBeenCalled();
  });
});

describe("dragging", () => {
  beforeEach(async () => {
    listAnnotations.mockResolvedValue([row(1, "a")]);
    await useAnnotationStore.getState().load(7);
    useAnnotationStore.getState().select(1);
  });

  it("moves locally and writes once, on release", async () => {
    const { moveSelected, commitGeometry } = useAnnotationStore.getState();

    useAnnotationStore.getState().beginDrag();
    moveSelected([0.05, 0]);
    moveSelected([0.05, 0]);
    expect(updateAnnotationGeometry).not.toHaveBeenCalled();

    await commitGeometry();

    expect(updateAnnotationGeometry).toHaveBeenCalledTimes(1);
    expect(updateAnnotationGeometry.mock.calls[0][0]).toBe(1);
    expect(updateAnnotationGeometry.mock.calls[0][1].x).toBeCloseTo(0.3);
  });

  it("writes nothing when the drag ended where it started", async () => {
    await useAnnotationStore.getState().commitGeometry();
    expect(updateAnnotationGeometry).not.toHaveBeenCalled();
  });

  it("puts the shape back when the write fails", async () => {
    updateAnnotationGeometry.mockRejectedValue(new Error("disk full"));

    useAnnotationStore.getState().beginDrag();
    useAnnotationStore.getState().moveSelected([0.1, 0]);
    await useAnnotationStore.getState().commitGeometry();

    const state = useAnnotationStore.getState();
    expect(state.error).toMatch(/disk full/);
    expect(state.annotations[0].geometry.x).toBeCloseTo(0.2);
  });
});

describe("deleting and undo", () => {
  beforeEach(async () => {
    listAnnotations.mockResolvedValue([row(1, "a")]);
    await useAnnotationStore.getState().load(7);
  });

  it("removes a shape and restores it under the same uid", async () => {
    await useAnnotationStore.getState().remove(1);
    expect(useAnnotationStore.getState().annotations).toHaveLength(0);
    expect(deleteAnnotation).toHaveBeenCalledWith(1);

    await useAnnotationStore.getState().undo();

    const state = useAnnotationStore.getState();
    expect(state.annotations).toHaveLength(1);
    expect(state.annotations[0].uid).toBe("a");
  });

  it("undoes a deletion against the row it actually has now", async () => {
    await useAnnotationStore.getState().remove(1);
    await useAnnotationStore.getState().undo();
    // The restore gave the shape a new row id.
    expect(useAnnotationStore.getState().annotations[0].id).toBe(1);

    await useAnnotationStore.getState().redo();

    // Redo must not try to delete the id from before the undo.
    expect(deleteAnnotation).toHaveBeenLastCalledWith(1);
    expect(useAnnotationStore.getState().annotations).toHaveLength(0);
  });

  it("undoes the creation of a shape", async () => {
    useAnnotationStore.setState({ tool: "rect", draft: box });
    await useAnnotationStore.getState().commitDraft();
    const created = useAnnotationStore.getState().annotations[0];

    await useAnnotationStore.getState().undo();

    expect(deleteAnnotation).toHaveBeenCalledWith(created.id);
    expect(useAnnotationStore.getState().annotations).toHaveLength(0);
  });

  it("has nothing to undo on a fresh event", async () => {
    await useAnnotationStore.getState().undo();
    expect(useAnnotationStore.getState().annotations).toHaveLength(1);
  });
});

describe("layers", () => {
  it("rewrites the order and refuses a list that does not match", async () => {
    listAnnotations.mockResolvedValue([row(1, "a"), row(2, "b")]);
    await useAnnotationStore.getState().load(7);

    await useAnnotationStore.getState().reorder([2, 1]);
    expect(reorderAnnotations).toHaveBeenCalledWith(7, [2, 1]);
    expect(useAnnotationStore.getState().annotations.map((a) => a.uid)).toEqual(["b", "a"]);

    reorderAnnotations.mockClear();
    await useAnnotationStore.getState().reorder([2]);
    expect(reorderAnnotations).not.toHaveBeenCalled();
  });
});

describe("the capture contract", () => {
  it("reports no tool when drawing is off, so tag keys keep working", () => {
    useAnnotationStore.getState().setTool("rect");
    expect(useAnnotationStore.getState().tool).toBe("rect");

    useAnnotationStore.getState().setTool(null);
    expect(useAnnotationStore.getState().tool).toBeNull();
  });

  it("abandons a half-drawn shape when the tool changes", () => {
    useAnnotationStore.setState({ draft: box, draftPoints: [[0.1, 0.1]] });
    useAnnotationStore.getState().setTool("ellipse");
    expect(useAnnotationStore.getState().draft).toBeNull();
    expect(useAnnotationStore.getState().draftPoints).toBeNull();
  });
});

describe("reshaping (FR-20.11)", () => {
  const FRAME: Rect = { x: 0, y: 0, w: 1_000, h: 1_000 };

  function select(kind: ShapeKind, geometry: Geometry): void {
    useAnnotationStore.setState({
      eventId: 7,
      annotations: [row(1, "a", { kind, geometry })],
      selectedId: 1,
      undoStack: [],
      redoStack: [],
      error: null,
    });
  }

  it("turns a rectangle into a triangle when a corner is removed, and undo restores both", async () => {
    select("rect", { x: 0.2, y: 0.2, w: 0.4, h: 0.2, rotation: 0 });

    await useAnnotationStore.getState().removeVertexAt(1);

    const shaped = useAnnotationStore.getState().annotations[0];
    expect(shaped.kind).toBe("polygon");
    expect(absolutePoints(shaped.geometry)).toHaveLength(3);
    // Kind and geometry are written together, once.
    expect(updateAnnotationShape).toHaveBeenCalledTimes(1);
    expect(updateAnnotationShape.mock.calls[0][1]).toBe("polygon");

    await useAnnotationStore.getState().undo();

    const restored = useAnnotationStore.getState().annotations[0];
    expect(restored.kind).toBe("rect");
    // A rectangle has no stored points: its vertices are its box corners.
    expect(shapeVertices(restored.geometry, restored.kind)).toHaveLength(4);
    // The undo wrote the rectangle back as a rectangle, not as a 4-point polygon.
    expect(updateAnnotationShape.mock.calls.at(-1)?.[1]).toBe("rect");
  });

  it("adds a corner to a rectangle, which is stored as a polygon from then on", async () => {
    select("rect", { x: 0.2, y: 0.2, w: 0.4, h: 0.2, rotation: 0 });

    await useAnnotationStore.getState().insertVertexAfter(0);

    const shaped = useAnnotationStore.getState().annotations[0];
    expect(shaped.kind).toBe("polygon");
    expect(absolutePoints(shaped.geometry)).toHaveLength(5);
    expect(updateAnnotationShape.mock.calls[0][1]).toBe("polygon");
  });

  it("refuses to take an end off a line, and says why", async () => {
    select("line", twoPointGeometry([0.2, 0.2], [0.6, 0.6]));

    await useAnnotationStore.getState().removeVertexAt(0);

    expect(updateAnnotationShape).not.toHaveBeenCalled();
    expect(useAnnotationStore.getState().annotations[0].kind).toBe("line");
    expect(useAnnotationStore.getState().error).toMatch(/no corner to spare/);
  });

  it("moves one vertex of a polygon and writes geometry alone", async () => {
    select(
      "polygon",
      pathGeometry([
        [0.2, 0.2],
        [0.6, 0.2],
        [0.6, 0.6],
      ]),
    );

    useAnnotationStore.getState().beginDrag();
    useAnnotationStore.getState().moveVertexTo(1, [800, 150], FRAME);

    const moved = useAnnotationStore.getState().annotations[0];
    expect(moved.kind).toBe("polygon");
    expect(absolutePoints(moved.geometry)[1][0]).toBeCloseTo(0.8);
    expect(absolutePoints(moved.geometry)[0][0]).toBeCloseTo(0.2);

    await useAnnotationStore.getState().commitGeometry();
    // The corner count did not change, so the kind is not rewritten.
    expect(updateAnnotationGeometry).toHaveBeenCalledTimes(1);
    expect(updateAnnotationShape).not.toHaveBeenCalled();
  });

  it("ignores a vertex drag on a rectangle, whose corners resize", () => {
    select("rect", { x: 0.2, y: 0.2, w: 0.4, h: 0.2, rotation: 0 });
    const before = useAnnotationStore.getState().annotations[0].geometry;

    useAnnotationStore.getState().beginDrag();
    useAnnotationStore.getState().moveVertexTo(0, [500, 500], FRAME);

    expect(useAnnotationStore.getState().annotations[0].geometry).toEqual(before);
  });
});
