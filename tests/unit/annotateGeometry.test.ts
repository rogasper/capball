import { describe, expect, it } from "vitest";
import {
  absolutePoints,
  boxGeometry,
  contentRect,
  denormalizePoint,
  handlesFor,
  hitTest,
  MIN_SIZE,
  moveBy,
  normalizePoint,
  pathGeometry,
  resizeBy,
  rotateTo,
  simplifyPath,
  twoPointGeometry,
} from "@/lib/annotate/geometry";
import {
  type Annotation,
  DEFAULT_STYLE,
  type Geometry,
  type ShapeKind,
} from "@/lib/annotate/types";

/**
 * A square content rect, so normalised units and pixels differ by exactly 1000
 * and the rotation cases are not confused by aspect ratio.
 */
const square = { x: 0, y: 0, w: 1000, h: 1000 };

function annotation(
  kind: ShapeKind,
  geometry: Geometry,
  patch: Partial<Annotation> = {},
): Annotation {
  return {
    id: 1,
    uid: "u1",
    eventId: 1,
    kind,
    windowMode: "moment",
    windowMs: 2500,
    geometry,
    style: { ...DEFAULT_STYLE },
    label: null,
    z: 0,
    ...patch,
  };
}

describe("contentRect", () => {
  it("letterboxes a 16:9 picture inside a square element", () => {
    const rect = contentRect(1000, 1000, 1920, 1080);
    expect(rect.w).toBeCloseTo(1000);
    expect(rect.h).toBeCloseTo(562.5);
    expect(rect.x).toBeCloseTo(0);
    expect(rect.y).toBeCloseTo(218.75);
  });

  it("pillarboxes a 4:3 picture in a wide element", () => {
    const rect = contentRect(2000, 600, 640, 480);
    expect(rect.h).toBeCloseTo(600);
    expect(rect.w).toBeCloseTo(800);
    expect(rect.x).toBeCloseTo(600);
    expect(rect.y).toBeCloseTo(0);
  });

  it("collapses rather than dividing by zero before metadata arrives", () => {
    expect(contentRect(1000, 1000, 0, 0)).toEqual({ x: 0, y: 0, w: 0, h: 0 });
  });

  it("round-trips a normalised point through pixels", () => {
    const rect = contentRect(1000, 1000, 1920, 1080);
    const point = normalizePoint(rect, 640, 400);
    const [px, py] = denormalizePoint(rect, point);
    expect(px).toBeCloseTo(640);
    expect(py).toBeCloseTo(400);
  });
});

describe("shape geometry", () => {
  it("keeps a horizontal line well defined with a zero-height box", () => {
    const geometry = twoPointGeometry([0.2, 0.5], [0.8, 0.5]);
    expect(geometry.h).toBeCloseTo(0);
    const points = absolutePoints(geometry);
    expect(points[0][0]).toBeCloseTo(0.2);
    expect(points[1][0]).toBeCloseTo(0.8);
    expect(points[0][1]).toBeCloseTo(0.5);
    expect(points[1][1]).toBeCloseTo(0.5);
  });

  it("keeps a vertical arrow well defined with a zero-width box", () => {
    const geometry = twoPointGeometry([0.5, 0.1], [0.5, 0.9]);
    expect(geometry.w).toBeCloseTo(0);
    const points = absolutePoints(geometry);
    expect(points[0][1]).toBeCloseTo(0.1);
    expect(points[1][1]).toBeCloseTo(0.9);
  });

  it("remembers which end a drag started from, even right-to-left", () => {
    const geometry = twoPointGeometry([0.8, 0.2], [0.2, 0.8]);
    const points = absolutePoints(geometry);
    expect(points[0][0]).toBeCloseTo(0.8);
    expect(points[0][1]).toBeCloseTo(0.2);
    expect(points[1][0]).toBeCloseTo(0.2);
    expect(points[1][1]).toBeCloseTo(0.8);
  });

  it("stores a stroke's points in its own box and expands them back", () => {
    const stroke: [number, number][] = [
      [0.1, 0.2],
      [0.3, 0.4],
      [0.5, 0.2],
    ];
    const geometry = pathGeometry(stroke);
    // Points are relative, so the smallest is at the box's own origin.
    expect(geometry.points?.[0]).toEqual([0, 0]);
    expect(geometry.points?.[1][0]).toBeCloseTo(0.5);
    const expanded = absolutePoints(geometry);
    expanded.forEach((point, index) => {
      expect(point[0]).toBeCloseTo(stroke[index][0]);
      expect(point[1]).toBeCloseTo(stroke[index][1]);
    });
  });

  it("scales a stroke with its box rather than moving each point", () => {
    const geometry = pathGeometry([
      [0.2, 0.2],
      [0.4, 0.4],
    ]);
    const before = absolutePoints(geometry);
    const resized = resizeBy(annotation("freehand", geometry), "se", [800, 800], square);
    const after = absolutePoints(resized);
    // The grabbed corner moved, the fixed corner did not.
    expect(before[0][0]).toBeCloseTo(after[0][0]);
    expect(after[1][0]).toBeCloseTo(0.8);
  });

  it("keeps the box from inverting when a drag runs past the opposite corner", () => {
    const geometry = boxGeometry([0.2, 0.2], [0.6, 0.6]);
    const resized = resizeBy(annotation("rect", geometry), "se", [100, 100], square);
    expect(resized.w).toBe(MIN_SIZE);
    expect(resized.h).toBe(MIN_SIZE);
  });

  it("moves a line endpoint without moving the other one", () => {
    const geometry = twoPointGeometry([0.2, 0.2], [0.6, 0.6]);
    const resized = resizeBy(annotation("line", geometry), "p1", [900, 300], square);
    const points = absolutePoints(resized);
    expect(points[0][0]).toBeCloseTo(0.2);
    expect(points[0][1]).toBeCloseTo(0.2);
    expect(points[1][0]).toBeCloseTo(0.9);
    expect(points[1][1]).toBeCloseTo(0.3);
  });
});

describe("simplifyPath", () => {
  it("drops points that lie on the line", () => {
    const straight: [number, number][] = [
      [0, 0],
      [0.1, 0],
      [0.2, 0],
      [0.3, 0],
      [0.4, 0],
    ];
    expect(simplifyPath(straight, 0.001)).toHaveLength(2);
  });

  it("keeps a corner", () => {
    const corner: [number, number][] = [
      [0, 0],
      [0.1, 0],
      [0.2, 0],
      [0.2, 0.2],
    ];
    const simplified = simplifyPath(corner, 0.001);
    expect(simplified).toHaveLength(3);
    expect(simplified[1]).toEqual([0.2, 0]);
  });

  it("leaves a two-point path alone", () => {
    const line: [number, number][] = [
      [0, 0],
      [1, 1],
    ];
    expect(simplifyPath(line, 0.05)).toEqual(line);
  });
});

describe("hit tests", () => {
  it("hits a filled rectangle inside it and near its edge", () => {
    const shape = annotation("rect", boxGeometry([0.4, 0.4], [0.6, 0.6]), {
      style: { ...DEFAULT_STYLE, fill: "#123456" },
    });
    expect(hitTest(shape, [500, 500], square, 4)).toBe(true);
    expect(hitTest(shape, [590, 500], square, 4)).toBe(true);
    expect(hitTest(shape, [700, 500], square, 4)).toBe(false);
  });

  it("misses the corners of an ellipse's box", () => {
    const shape = annotation("ellipse", boxGeometry([0.4, 0.4], [0.6, 0.6]));
    expect(hitTest(shape, [500, 500], square, 2)).toBe(true);
    // The corner of the bounding box is outside the curve.
    expect(hitTest(shape, [595, 595], square, 2)).toBe(false);
  });

  it("follows a line within its stroke, not its bounding box", () => {
    const shape = annotation("line", twoPointGeometry([0.1, 0.1], [0.9, 0.1]));
    expect(hitTest(shape, [500, 100], square, 4)).toBe(true);
    expect(hitTest(shape, [500, 400], square, 4)).toBe(false);
  });

  it("needs a fill before a polygon's interior counts as a hit", () => {
    const geometry = pathGeometry([
      [0.3, 0.3],
      [0.7, 0.3],
      [0.7, 0.7],
      [0.3, 0.7],
    ]);
    const outline = annotation("polygon", geometry);
    const filled = annotation("polygon", geometry, {
      style: { ...DEFAULT_STYLE, fill: "#123456" },
    });

    expect(hitTest(outline, [500, 500], square, 4)).toBe(false);
    expect(hitTest(outline, [500, 300], square, 4)).toBe(true);
    expect(hitTest(filled, [500, 500], square, 4)).toBe(true);
  });

  it("hits a freehand stroke along its path", () => {
    const shape = annotation(
      "freehand",
      pathGeometry([
        [0.2, 0.5],
        [0.5, 0.5],
        [0.8, 0.5],
      ]),
    );
    expect(hitTest(shape, [500, 500], square, 6)).toBe(true);
    expect(hitTest(shape, [500, 200], square, 6)).toBe(false);
  });

  it("uses the label's approximate box for text", () => {
    const shape = annotation(
      "text",
      { x: 0.2, y: 0.2, w: 0, h: 0, rotation: 0 },
      {
        label: "Pressing",
      },
    );
    expect(hitTest(shape, [250, 230], square, 4)).toBe(true);
    expect(hitTest(shape, [900, 900], square, 4)).toBe(false);
  });

  it("tests a rotated shape against its own axes", () => {
    // A wide, thin bar, turned upright. A point 40 px below the centre is
    // outside the bar as drawn but inside it once it is rotated a quarter turn.
    const geometry = boxGeometry([0.45, 0.45], [0.55, 0.47]);
    const upright = annotation("rect", { ...geometry, rotation: Math.PI / 2 });

    expect(hitTest(annotation("rect", geometry), [500, 500], square, 2)).toBe(false);
    expect(hitTest(upright, [500, 500], square, 2)).toBe(true);
  });
});

describe("handles", () => {
  it("gives a rectangle four resize corners, an add grip per edge, and a rotate grip", () => {
    const names = handlesFor(annotation("rect", boxGeometry([0.2, 0.2], [0.6, 0.6])), square).map(
      (handle) => handle.name,
    );
    // R2 (FR-20.11): the corners stay a resize, and the midpoints are how a
    // rectangle gains a corner — or, with one removed, becomes a triangle.
    expect(names).toEqual(["nw", "ne", "se", "sw", "m0", "m1", "m2", "m3", "rotate"]);
  });

  it("gives a polygon one handle per vertex, an add grip per edge, and no box resize", () => {
    const names = handlesFor(
      annotation(
        "polygon",
        pathGeometry([
          [0.2, 0.2],
          [0.6, 0.2],
          [0.6, 0.6],
        ]),
      ),
      square,
    ).map((handle) => handle.name);

    // A polygon's corners are what it is, so there is no second set of grips
    // scaling its bounding box — but its edges can still gain a corner.
    expect(names).toEqual(["v0", "v1", "v2", "m0", "m1", "m2", "rotate"]);
  });

  it("gives an ellipse its box corners and no vertex handles", () => {
    const names = handlesFor(
      annotation("ellipse", boxGeometry([0.2, 0.2], [0.6, 0.6])),
      square,
    ).map((handle) => handle.name);
    expect(names).toEqual(["nw", "ne", "se", "sw", "rotate"]);
  });

  it("gives a line its two endpoints", () => {
    const names = handlesFor(
      annotation("line", twoPointGeometry([0.2, 0.2], [0.6, 0.6])),
      square,
    ).map((handle) => handle.name);
    expect(names).toEqual(["p0", "p1", "rotate"]);
  });

  it("gives text only a rotate grip, since its size is a style", () => {
    const names = handlesFor(
      annotation("text", { x: 0.2, y: 0.2, w: 0, h: 0, rotation: 0 }),
      square,
    ).map((handle) => handle.name);
    expect(names).toEqual(["rotate"]);
  });
});

describe("transforms", () => {
  it("moves without touching the size or the rotation", () => {
    const geometry: Geometry = { x: 0.2, y: 0.3, w: 0.1, h: 0.1, rotation: 0.5 };
    const moved = moveBy(geometry, 0.05, -0.1);
    expect(moved.x).toBeCloseTo(0.25);
    expect(moved.y).toBeCloseTo(0.2);
    expect(moved.w).toBeCloseTo(0.1);
    expect(moved.h).toBeCloseTo(0.1);
    expect(moved.rotation).toBeCloseTo(0.5);
  });

  it("reads a rotation of zero when the pointer is above the centre", () => {
    const geometry: Geometry = { x: 0.4, y: 0.4, w: 0.2, h: 0.2, rotation: 0 };
    const rotated = rotateTo(geometry, [500, 100], square);
    expect(rotated.rotation).toBeCloseTo(0);
  });

  it("reads a quarter turn when the pointer is to the right", () => {
    const geometry: Geometry = { x: 0.4, y: 0.4, w: 0.2, h: 0.2, rotation: 0 };
    const rotated = rotateTo(geometry, [900, 500], square);
    expect(rotated.rotation).toBeCloseTo(Math.PI / 2);
  });
});
