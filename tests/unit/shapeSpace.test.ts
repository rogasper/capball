import { describe, expect, it } from "vitest";
import { boxGeometry, pathGeometry } from "@/lib/annotate/geometry";
import type { Geometry } from "@/lib/annotate/types";
import {
  type Annotation,
  type AnnotationStyle,
  DEFAULT_STYLE,
  type ShapeKind,
} from "@/lib/annotate/types";
import { solveHomography } from "@/lib/pitch/homography";
import { derivePosition, regionOf } from "@/lib/pitch/positions";
import {
  ELLIPSE_SAMPLES,
  geometrySpaceProblem,
  pitchShapeAt,
  projectShape,
  projectShapes,
  shapeOutline,
} from "@/lib/pitch/shapePrimitives";
import type { Correspondence } from "@/lib/pitch/types";

/**
 * The second geometry space (FR-80.2, FR-80.3, NFR-38).
 *
 * The projection is checked against an **independent pinhole camera** rather than
 * against the homography it is built from. That matters: four reference points
 * are fitted exactly, so comparing the app's maths with the app's own maths would
 * prove nothing — R1 learned that the hard way. The pinhole is a different
 * description of the same scene, so agreement at points that were *not* used to
 * fit the homography is a real statement about the code path, and it fails
 * loudly if the direction of the transform is ever inverted.
 */

const SIZE = { lengthM: 105, widthM: 68 };
const FRAME = { width: 1920, height: 1080 };

/** A camera behind one goal, 18 m up and 60 m back, tilted down at the centre. */
const CAMERA = { x: 0, y: -60, z: 18, focal: 1400, tilt: 0.28 };

/**
 * The ground truth: a pinhole camera looking along +y with a downward tilt.
 *
 * Basis: right = (1,0,0), forward = (0, cos t, −sin t), up = (0, sin t, cos t).
 * Written from the basis rather than from a homography so that agreement with
 * the app's projection is evidence about the code, not about the same algebra
 * twice.
 */
function pinhole(xM: number, yM: number): { px: number; py: number } {
  const dx = xM - CAMERA.x;
  const dy = yM - CAMERA.y;
  const dz = 0 - CAMERA.z;
  const cos = Math.cos(CAMERA.tilt);
  const sin = Math.sin(CAMERA.tilt);

  const cx = dx;
  const cy = dy * sin + dz * cos;
  const cz = dy * cos - dz * sin;
  if (cz <= 0) throw new Error("the test camera asked for a point behind the lens");

  return {
    px: FRAME.width / 2 + (CAMERA.focal * cx) / cz,
    py: FRAME.height / 2 - (CAMERA.focal * cy) / cz,
  };
}

const LANDMARKS: [number, number][] = [
  [-52.5, 34],
  [52.5, 34],
  [-52.5, -34],
  [52.5, -34],
  [-36, 20.16],
  [36, -20.16],
  [0, 0],
  [0, 34],
];

/** The calibration the app would hold: six-plus picks, image → pitch. */
function storedHomography(): number[] {
  const picks: Correspondence[] = LANDMARKS.map(([xM, yM]) => {
    const { px, py } = pinhole(xM, yM);
    return { px, py, xM, yM };
  });
  const solved = solveHomography(picks);
  if (!solved.ok) throw new Error(solved.reason);
  return solved.h;
}

function shape(
  kind: ShapeKind,
  geometry: Geometry,
  style: Partial<AnnotationStyle> = {},
): Annotation {
  return {
    id: 1,
    uid: "u1",
    eventId: 7,
    kind,
    windowMode: "moment",
    windowMs: 2_500,
    geometry: { ...geometry, space: "pitch" },
    style: { ...DEFAULT_STYLE, stroke: "#FF4C4C", width: 0.01, ...style },
    label: null,
    z: 0,
  };
}

const REGION = regionOf(
  LANDMARKS.map(([xM, yM]) => ({ imageU: 0, imageV: 0, xM, yM })),
  SIZE,
);

describe("a shape's outline, in metres", () => {
  it("gives a rectangle its four corners", () => {
    const outline = shapeOutline(boxGeometry([0, 0], [10, 6]), "rect");
    expect(outline?.closed).toBe(true);
    expect(outline?.points).toHaveLength(4);
    expect(outline?.points[0]).toEqual([0, 0]);
  });

  it("samples a circle, because a circle is not a circle in perspective", () => {
    const outline = shapeOutline(boxGeometry([-5, -3], [5, 3]), "ellipse");
    expect(outline?.points).toHaveLength(ELLIPSE_SAMPLES);
    expect(outline?.closed).toBe(true);
  });

  it("refuses text, which cannot be placed honestly on a plane", () => {
    expect(shapeOutline(boxGeometry([0, 0], [4, 2]), "text")).toBeNull();
  });

  it("applies the shape's own rotation in metres", () => {
    const flat = boxGeometry([-10, -5], [10, 5]);
    const turned = { ...flat, rotation: Math.PI / 2 };
    const outline = shapeOutline(turned, "rect");
    // A quarter turn swaps the box's extent about its centre.
    const xs = outline?.points.map((point) => point[0]) ?? [];
    const ys = outline?.points.map((point) => point[1]) ?? [];
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(10, 6);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(20, 6);
  });
});

describe("projecting onto the frame (NFR-38)", () => {
  const h = storedHomography();

  it("lands where an independent pinhole camera says, and reports the figure", () => {
    const projected = projectShape(
      shape("rect", boxGeometry([-20, -10], [20, 10])),
      h,
      FRAME,
      REGION,
    );
    expect(projected.ok).toBe(true);
    if (!projected.ok) return;

    const worstPx = projected.primitive.points.reduce((worst, point, index) => {
      const corner = [
        [-20, -10],
        [20, -10],
        [20, 10],
        [-20, 10],
      ][index];
      const truth = pinhole(corner[0], corner[1]);
      const dx = point[0] * FRAME.width - truth.px;
      const dy = point[1] * FRAME.height - truth.py;
      return Math.max(worst, Math.hypot(dx, dy));
    }, 0);

    console.log(
      `NFR-38: a 40×20 m zone projects onto the frame within ${worstPx.toExponential(2)} px of an independent pinhole camera`,
    );
    expect(worstPx).toBeLessThan(0.5);
  });

  it("round-trips: the app's own inverse returns the metres it started from", () => {
    const h2 = storedHomography();
    const projected = projectShape(
      shape(
        "line",
        pathGeometry([
          [10, 5],
          [30, -8],
        ]),
      ),
      h2,
      FRAME,
      null,
    );
    expect(projected.ok).toBe(true);
    if (!projected.ok) return;

    for (const point of projected.primitive.points) {
      const back = derivePosition(h2, { imageU: point[0], imageV: point[1] }, FRAME, SIZE, null);
      expect(back.ok).toBe(true);
      if (!back.ok) return;
      expect(Number.isFinite(back.xM)).toBe(true);
    }

    // The first point projected from (10, 5) must come back as (10, 5).
    const first = projected.primitive.points[0];
    const back = derivePosition(h2, { imageU: first[0], imageV: first[1] }, FRAME, SIZE, null);
    if (back.ok) {
      expect(back.xM).toBeCloseTo(10, 6);
      expect(back.yM).toBeCloseTo(5, 6);
    }
  });

  it("keeps the shape's appearance, and bakes the rotation into the points", () => {
    const projected = projectShape(
      shape("rect", { ...boxGeometry([-10, -5], [10, 5]), rotation: 0.4 }),
      h,
      FRAME,
      REGION,
    );
    if (!projected.ok) return;
    expect(projected.primitive.rotation).toBe(0);
    expect(projected.primitive.stroke).toBe("#FF4C4C");
    expect(projected.primitive.closed).toBe(true);
    expect(projected.primitive.annotationId).toBe(1);
  });
});

describe("what cannot be projected, and what is only a guess", () => {
  const h = storedHomography();

  it("says so when there is no calibration at all", () => {
    const summary = projectShapes(
      [shape("rect", boxGeometry([0, 0], [10, 10]))],
      null,
      FRAME,
      null,
    );
    expect(summary.uncalibrated).toBe(true);
    expect(summary.primitives).toHaveLength(0);
  });

  it("draws a shape that only partly leaves the covered area, and flags it", () => {
    // A tiny region around the centre: a wide zone reaches well outside it.
    const tight = regionOf(
      [
        { imageU: 0, imageV: 0, xM: -2, yM: -2 },
        { imageU: 0, imageV: 0, xM: 2, yM: -2 },
        { imageU: 0, imageV: 0, xM: 2, yM: 2 },
        { imageU: 0, imageV: 0, xM: -2, yM: 2 },
      ],
      SIZE,
    );
    const summary = projectShapes(
      [shape("rect", boxGeometry([-40, -20], [40, 20]))],
      h,
      FRAME,
      tight,
    );
    expect(summary.primitives).toHaveLength(1);
    expect(summary.guessedIds).toEqual([1]);
    expect(summary.omitted).toHaveLength(0);
  });

  it("omits a shape that lies entirely outside the covered area", () => {
    const elsewhere = regionOf(
      [
        { imageU: 0, imageV: 0, xM: 40, yM: 20 },
        { imageU: 0, imageV: 0, xM: 48, yM: 20 },
        { imageU: 0, imageV: 0, xM: 48, yM: 30 },
        { imageU: 0, imageV: 0, xM: 40, yM: 30 },
      ],
      SIZE,
    );
    const summary = projectShapes(
      [shape("rect", boxGeometry([-40, -20], [-30, -10]))],
      h,
      FRAME,
      elsewhere,
    );
    expect(summary.primitives).toHaveLength(0);
    expect(summary.omitted[0]?.reason).toBe("unsupported");
  });

  it("refuses text rather than drawing a label in the wrong place", () => {
    const result = projectShape(shape("text", boxGeometry([0, 0], [6, 2])), h, FRAME, null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("no-outline");
  });

  it("drops a projection that runs away off the frame", () => {
    // The bound is relative to the picture: the same zone on a small frame is
    // tens of frames away, which is the fit failing rather than a shape.
    const result = projectShape(
      shape("rect", boxGeometry([-3000, -3000], [3000, 3000])),
      h,
      { width: 192, height: 108 },
      null,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("runaway");
  });
});

describe("a geometry has to fit the space it claims", () => {
  it("rejects a metre-sized box tagged as a frame shape", () => {
    expect(geometrySpaceProblem(boxGeometry([-20, -10], [20, 10]), "frame", SIZE)).toMatch(
      /cannot be a fraction of a frame/,
    );
  });

  it("rejects a frame-sized box tagged as a pitch shape", () => {
    // 0.3 m from the centre is not a shape anyone drew on a pitch.
    expect(geometrySpaceProblem(boxGeometry([0.2, 0.2], [0.4, 0.3]), "pitch", SIZE)).toBeNull();
    // ... but a box tens of metres outside the touchline is a mis-tag.
    expect(geometrySpaceProblem(boxGeometry([80, 60], [90, 70]), "pitch", SIZE)).toMatch(
      /off the pitch/,
    );
  });

  it("accepts a shape that legitimately reaches past the picture or the line", () => {
    expect(geometrySpaceProblem(boxGeometry([-0.2, -0.1], [1.2, 1.1]), "frame", SIZE)).toBeNull();
    expect(geometrySpaceProblem(boxGeometry([-56, -38], [-52, -34]), "pitch", SIZE)).toBeNull();
  });

  it("cannot judge a pitch geometry without a pitch size, and says nothing rather than guessing", () => {
    expect(geometrySpaceProblem(boxGeometry([-20, -10], [20, 10]), "pitch", null)).toBeNull();
  });

  it("rejects a geometry with a non-finite number", () => {
    expect(
      geometrySpaceProblem({ ...boxGeometry([0, 0], [1, 1]), w: Number.NaN }, "frame", null),
    ).toMatch(/non-finite/);
  });
});

/** The mean of a projected shape's points, in frame pixels: inside a convex quad. */
function centroidInPixels(
  points: { 0: number; 1: number }[] | [number, number][],
): [number, number] {
  const xs = points.map((point) => point[0] * FRAME.width);
  const ys = points.map((point) => point[1] * FRAME.height);
  return [xs.reduce((a, b) => a + b, 0) / xs.length, ys.reduce((a, b) => a + b, 0) / ys.length];
}

describe("clicking a projected shape (FR-80.3)", () => {
  const h = storedHomography();
  const RECT = { x: 0, y: 0, w: 1920, h: 1080 };

  it("finds the shape under the pointer, in frame pixels", () => {
    // A filled zone is picked anywhere inside it, which is what a zone is for.
    const zone = shape("rect", boxGeometry([-20, -10], [20, 10]), { fill: "#4C8DFF33" });
    const summary = projectShapes([zone], h, FRAME, null);
    const points = summary.primitives[0]?.points ?? [];
    expect(points.length).toBeGreaterThan(2);
    if (points.length === 0) return;

    // The centroid of the projected quad, which is inside it by construction —
    // the corner it maps from is not, because perspective turns the box.
    const centre = centroidInPixels(points);
    expect(pitchShapeAt(summary, centre, RECT, 8)).toBe(1);
  });

  it("finds nothing far from any shape", () => {
    const summary = projectShapes(
      [shape("rect", boxGeometry([-20, -10], [20, 10]))],
      h,
      FRAME,
      null,
    );
    expect(pitchShapeAt(summary, [5, 5], RECT, 8)).toBeNull();
  });

  it("picks a zone with no fill anywhere inside it", () => {
    // A closed shape is a region: the projection turns every shape into a
    // polygon, and R1's polygon rule would test only the stroke without a fill,
    // leaving an unfilled zone grabbable by its outline alone.
    const zone = shape("rect", boxGeometry([-20, -10], [20, 10]));
    const summary = projectShapes([zone], h, FRAME, null);
    const points = summary.primitives[0]?.points ?? [];
    if (points.length === 0) return;
    expect(pitchShapeAt(summary, centroidInPixels(points), RECT, 8)).toBe(1);
  });

  it("still needs the stroke for an open shape, which encloses nothing", () => {
    const line = shape(
      "line",
      pathGeometry([
        [0, 0],
        [30, 10],
      ]),
    );
    const summary = projectShapes([line], h, FRAME, null);
    const points = summary.primitives[0]?.points ?? [];
    if (points.length === 0) return;
    // The midpoint of the projected segment is on the line, so it is picked.
    const mid = centroidInPixels(points);
    expect(pitchShapeAt(summary, mid, RECT, 8)).toBe(1);
    // Far off the segment, nothing.
    expect(pitchShapeAt(summary, [5, 5], RECT, 8)).toBeNull();
  });

  it("prefers the shape painted last", () => {
    const under = shape("rect", boxGeometry([-20, -10], [20, 10]), { fill: "#4C8DFF33" });
    const over = {
      ...shape("rect", boxGeometry([-20, -10], [20, 10]), { fill: "#4C8DFF33" }),
      id: 2,
      z: 5,
    };
    const summary = projectShapes([under, over], h, FRAME, null);
    const points = summary.primitives[0]?.points ?? [];
    if (points.length === 0) return;
    expect(pitchShapeAt(summary, centroidInPixels(points), RECT, 8)).toBe(2);
  });
});
