import { describe, expect, it } from "vitest";
import { absolutePoints, boxGeometry, pathGeometry } from "@/lib/annotate/geometry";
import { type Annotation, DEFAULT_STYLE, type ShapeKind } from "@/lib/annotate/types";
import {
  canAddVertices,
  canEditVertices,
  dragsSingleVertex,
  edgeMidpoint,
  insertVertex,
  moveVertex,
  removeVertex,
  vertexCount,
  vertexList,
} from "@/lib/annotate/vertices";

/**
 * Reshaping (FR-20.11). The cases that matter are the ones the owner asked for:
 * a rectangle loses a corner and becomes the triangle in front of them, and an
 * edit never disturbs anything but the geometry and the kind.
 */

function shape(kind: ShapeKind, geometry: Annotation["geometry"]): Annotation {
  return {
    id: 1,
    uid: "u1",
    eventId: 7,
    kind,
    windowMode: "moment",
    windowMs: 2_500,
    geometry,
    style: { ...DEFAULT_STYLE },
    label: "Zone 14",
    z: 3,
  };
}

const RECT = shape("rect", boxGeometry([0.2, 0.2], [0.6, 0.4]));
const TRIANGLE = shape(
  "polygon",
  pathGeometry([
    [0.2, 0.2],
    [0.6, 0.2],
    [0.6, 0.6],
  ]),
);
const LINE = shape(
  "line",
  pathGeometry([
    [0.2, 0.2],
    [0.8, 0.6],
  ]),
);
const ELLIPSE = shape("ellipse", boxGeometry([0.2, 0.2], [0.6, 0.6]));

describe("the vertex list", () => {
  it("reports a rectangle's four corners in order", () => {
    expect(vertexList(RECT)).toEqual([
      [0.2, 0.2],
      [0.6, 0.2],
      [0.6, 0.4],
      [0.2, 0.4],
    ]);
    expect(vertexCount(RECT)).toBe(4);
  });

  it("reports a polygon's own points", () => {
    expect(vertexList(TRIANGLE)).toEqual([
      [0.2, 0.2],
      [0.6, 0.2],
      [0.6, 0.6],
    ]);
  });

  it("reports nothing for a shape whose vertices are not a design", () => {
    expect(vertexList(ELLIPSE)).toEqual([]);
    expect(vertexList(shape("text", { x: 0.2, y: 0.2, w: 0, h: 0, rotation: 0 }))).toEqual([]);
    expect(
      vertexList(
        shape(
          "freehand",
          pathGeometry([
            [0.2, 0.2],
            [0.4, 0.4],
          ]),
        ),
      ),
    ).toEqual([]);
  });

  it("knows which kinds can be edited and which can take a corner", () => {
    expect(canEditVertices("rect")).toBe(true);
    expect(canEditVertices("ellipse")).toBe(false);
    // A line's points are dragged, but inserting one would have to close it into
    // a triangle nobody drew.
    expect(canAddVertices("line")).toBe(false);
    expect(canAddVertices("rect")).toBe(true);
    // A rectangle's corner drag stays the box resize R1 already had.
    expect(dragsSingleVertex("rect")).toBe(false);
    expect(dragsSingleVertex("polygon")).toBe(true);
  });
});

describe("moving one vertex", () => {
  it("moves that vertex and leaves every other one where it was", () => {
    const edit = moveVertex(TRIANGLE, 1, [0.8, 0.1]);
    expect(edit).not.toBeNull();
    if (!edit) return;

    const points = absolutePoints(edit.geometry);
    expect(points[1][0]).toBeCloseTo(0.8);
    expect(points[1][1]).toBeCloseTo(0.1);
    expect(points[0][0]).toBeCloseTo(0.2);
    expect(points[0][1]).toBeCloseTo(0.2);
    expect(points[2][0]).toBeCloseTo(0.6);
    expect(points[2][1]).toBeCloseTo(0.6);
  });

  it("keeps the kind, because the corner count did not change", () => {
    expect(moveVertex(TRIANGLE, 0, [0.25, 0.25])?.kind).toBe("polygon");
  });

  it("refuses a rectangle, whose corner drag is a resize", () => {
    expect(moveVertex(RECT, 0, [0.3, 0.3])).toBeNull();
  });

  it("refuses an index that is not a vertex", () => {
    expect(moveVertex(TRIANGLE, 9, [0.3, 0.3])).toBeNull();
    expect(moveVertex(TRIANGLE, -1, [0.3, 0.3])).toBeNull();
  });
});

describe("removing a corner", () => {
  it("turns a rectangle into a triangle without the corner it lost", () => {
    const edit = removeVertex(RECT, 1);
    expect(edit?.kind).toBe("polygon");
    if (!edit) return;

    const points = absolutePoints(edit.geometry);
    expect(points).toHaveLength(3);
    // The three remaining corners, in their original order: the removed one is
    // gone and nothing was reordered around it.
    expect(points[0][0]).toBeCloseTo(0.2);
    expect(points[0][1]).toBeCloseTo(0.2);
    expect(points[1][0]).toBeCloseTo(0.6);
    expect(points[1][1]).toBeCloseTo(0.4);
    expect(points[2][0]).toBeCloseTo(0.2);
    expect(points[2][1]).toBeCloseTo(0.4);
  });

  it("closes a three-sided zone down to a line rather than a sliver", () => {
    const edit = removeVertex(TRIANGLE, 2);
    expect(edit?.kind).toBe("line");
    expect(absolutePoints(edit?.geometry ?? RECT.geometry)).toHaveLength(2);
  });

  it("refuses to take an end from a line", () => {
    expect(removeVertex(LINE, 0)).toBeNull();
  });

  it("refuses a shape with no vertices to remove", () => {
    expect(removeVertex(ELLIPSE, 0)).toBeNull();
  });
});

describe("adding a corner", () => {
  it("keeps every original corner and inserts the new one where the edge was", () => {
    const mid = edgeMidpoint(RECT, 1);
    expect(mid).not.toBeNull();
    if (!mid) return;

    const edit = insertVertex(RECT, 1, mid);
    expect(edit?.kind).toBe("polygon");
    if (!edit) return;

    const points = absolutePoints(edit.geometry);
    expect(points).toHaveLength(5);
    expect(points[2][0]).toBeCloseTo(mid[0]);
    expect(points[2][1]).toBeCloseTo(mid[1]);
    // The four corners are still there, still in order.
    expect(points[0][0]).toBeCloseTo(0.2);
    expect(points[1][0]).toBeCloseTo(0.6);
    expect(points[3][0]).toBeCloseTo(0.6);
    expect(points[4][0]).toBeCloseTo(0.2);
  });

  it("adds to a polygon without changing its kind", () => {
    const mid = edgeMidpoint(TRIANGLE, 0);
    const edit = mid ? insertVertex(TRIANGLE, 0, mid) : null;
    expect(edit?.kind).toBe("polygon");
    expect(absolutePoints(edit?.geometry ?? RECT.geometry)).toHaveLength(4);
  });

  it("refuses a line, which would have to become a triangle", () => {
    expect(insertVertex(LINE, 0, [0.5, 0.4])).toBeNull();
  });
});

describe("an edit touches nothing but the geometry and the kind", () => {
  it("carries exactly those two fields", () => {
    const edit = removeVertex(RECT, 0);
    expect(Object.keys(edit ?? {}).sort()).toEqual(["geometry", "kind"]);
  });

  it("leaves a degenerate result drawable rather than throwing", () => {
    // Two corners share an x, so the box has zero width: `toRelative` guards it
    // and `absolutePoints` inverts the same convention (R1 §5.3).
    const flat = shape(
      "polygon",
      pathGeometry([
        [0.2, 0.2],
        [0.2, 0.6],
        [0.2, 0.8],
      ]),
    );
    const edit = removeVertex(flat, 2);
    const points = absolutePoints(edit?.geometry ?? flat.geometry);
    expect(points).toHaveLength(2);
    expect(points.every((point) => Number.isFinite(point[0]) && Number.isFinite(point[1]))).toBe(
      true,
    );
  });

  it("measures an edge midpoint from the shape's own vertices", () => {
    expect(edgeMidpoint(RECT, 0)).toEqual([0.4, 0.2]);
    expect(edgeMidpoint(RECT, 2)).toEqual([0.4, 0.4]);
    expect(edgeMidpoint(RECT, 9)).toBeNull();
  });
});
