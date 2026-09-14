import { describe, expect, it } from "vitest";
import { boxGeometry, handlesFor, normalizePoint, pathGeometry } from "@/lib/annotate/geometry";
import type { Annotation } from "@/lib/annotate/types";
import { DEFAULT_STYLE } from "@/lib/annotate/types";
import {
  pathDataOf,
  patternLinesInPitch,
  pitchBoundsOf,
  pitchRectOf,
  screenToPitch,
  viewBoxOf,
} from "@/lib/pitch/pitchView";

/**
 * The pitch view's coordinate space (FR-80.2).
 *
 * The pointer conversion reproduces SVG's own `xMidYMid meet` fit, so it is
 * checked against the cases that fit gets wrong when hand-rolled: a box whose
 * aspect differs from the viewBox (letterboxing), and a degenerate box.
 */

const SIZE = { lengthM: 105, widthM: 68 };
const VIEW = viewBoxOf(SIZE);

describe("the viewBox", () => {
  it("is the pitch plus a margin, centred on the pitch centre", () => {
    expect(VIEW.minX).toBeCloseTo(-56.5);
    expect(VIEW.minY).toBeCloseTo(-38);
    expect(VIEW.width).toBeCloseTo(113);
    expect(VIEW.height).toBeCloseTo(76);
  });

  it("keeps the pitch centre at the middle of the box", () => {
    expect(VIEW.minX + VIEW.width / 2).toBeCloseTo(0);
    expect(VIEW.minY + VIEW.height / 2).toBeCloseTo(0);
  });
});

describe("a pointer on the pitch view", () => {
  it("reads the centre of a matching box as the centre spot", () => {
    const box = { left: 100, top: 50, width: 1130, height: 760 };
    expect(screenToPitch(100 + 565, 50 + 380, box, VIEW)).toEqual([0, 0]);
  });

  it("scales with the element, so the same point is the same metre at any size", () => {
    const box = { left: 0, top: 0, width: 1130, height: 760 };
    const half = { left: 0, top: 0, width: 565, height: 380 };
    // A tenth of the way across is the same metre in both.
    expect(screenToPitch(113, 76, box, VIEW)).toEqual(screenToPitch(56.5, 38, half, VIEW));
  });

  it("letterboxes when the element's aspect does not match, as SVG would", () => {
    // A wider element than the viewBox: the drawing is centred horizontally.
    const box = { left: 0, top: 0, width: 2000, height: 760 };
    const scale = 760 / VIEW.height;
    const offsetX = (2000 - VIEW.width * scale) / 2;
    const [x] = screenToPitch(offsetX, 380, box, VIEW) ?? [];
    expect(x).toBeCloseTo(VIEW.minX);
  });

  it("returns nothing rather than nonsense for an unmeasured box", () => {
    expect(screenToPitch(10, 10, { left: 0, top: 0, width: 0, height: 0 }, VIEW)).toBeNull();
  });
});

describe("a shape as SVG", () => {
  it("closes a rectangle and leaves a line open", () => {
    const rect = pathDataOf(boxGeometry([0, 0], [10, 6]), "rect");
    expect(rect?.endsWith("Z")).toBe(true);
    expect(rect?.startsWith("M0 0")).toBe(true);

    const line = pathDataOf(
      pathGeometry([
        [0, 0],
        [10, 6],
      ]),
      "line",
    );
    expect(line?.endsWith("Z")).toBe(false);
  });

  it("returns nothing for a shape that has no outline in metres", () => {
    expect(pathDataOf(boxGeometry([0, 0], [5, 2]), "text")).toBeNull();
  });

  it("measures a shape's bounds in metres", () => {
    const bounds = pitchBoundsOf(boxGeometry([-10, -4], [10, 4]), "rect");
    expect(bounds).toEqual({ x: -10, y: -4, w: 20, h: 8 });
  });
});

describe("a pattern in the pitch view", () => {
  it("draws nothing for a solid fill", () => {
    expect(
      patternLinesInPitch(
        boxGeometry([-10, -4], [10, 4]),
        "rect",
        { ...DEFAULT_STYLE, fill: "#fff" },
        SIZE,
      ),
    ).toEqual([]);
  });

  it("spaces the hatch as a fraction of the pitch length", () => {
    const lines = patternLinesInPitch(
      boxGeometry([-10, -4], [10, 4]),
      "rect",
      { ...DEFAULT_STYLE, fill: "#fff", fillPattern: "hatch", patternScale: 0.02, patternAngle: 0 },
      SIZE,
    );
    // Angle pinned to zero so the arithmetic is exact: 0.02 of 105 m is
    // 2.1 m apart across an 8 m box, so four lines.
    expect(lines.length).toBeGreaterThan(2);
    expect(lines.length).toBeLessThan(7);
  });

  it("gives cross-hatch both directions", () => {
    const geometry = boxGeometry([-10, -4], [10, 4]);
    const single = patternLinesInPitch(
      geometry,
      "rect",
      { ...DEFAULT_STYLE, fill: "#fff", fillPattern: "hatch", patternScale: 0.02, patternAngle: 0 },
      SIZE,
    );
    const crossed = patternLinesInPitch(
      geometry,
      "rect",
      {
        ...DEFAULT_STYLE,
        fill: "#fff",
        fillPattern: "crossHatch",
        patternScale: 0.02,
        patternAngle: 0,
      },
      SIZE,
    );
    expect(crossed.length).toBeGreaterThan(single.length);
  });

  it("has no pattern for an open stroke, which has no area", () => {
    expect(
      patternLinesInPitch(
        pathGeometry([
          [0, 0],
          [10, 6],
        ]),
        "line",
        { ...DEFAULT_STYLE, fill: "#fff", fillPattern: "hatch" },
        SIZE,
      ),
    ).toEqual([]);
  });
});

describe("the rect that makes metres look like pixels (FR-80.2)", () => {
  /** The diagram at a normal panel width: 1130 px for 113 m is 10 px a metre. */
  const box = { left: 0, top: 0, width: 1130, height: 760 };

  it("maps a metre to the pixel the SVG would use", () => {
    const rect = pitchRectOf(box, VIEW);
    // The centre spot is the middle of the drawing.
    expect(normalizePoint(rect, 565, 380)).toEqual([0, 0]);
    // A point ten metres along the length is a tenth of the way across.
    expect(normalizePoint(rect, 565 + 100, 380)).toEqual([10, 0]);
  });

  it("round-trips, so a drag lands where it was dropped", () => {
    const rect = pitchRectOf(box, VIEW);
    const [xM, yM] = normalizePoint(rect, 700, 250);
    // The forward direction the handle layer uses is the same mapping.
    expect(rect.x + xM * rect.w).toBeCloseTo(700, 9);
    expect(rect.y + yM * rect.h).toBeCloseTo(250, 9);
  });

  it("places the grips on the shape, so M12's toolkit works in metres", () => {
    const rect = pitchRectOf(box, VIEW);
    const shape = {
      id: 1,
      uid: "u1",
      eventId: 7,
      kind: "rect",
      windowMode: "moment",
      windowMs: 2_500,
      geometry: { ...boxGeometry([-20, -10], [20, 10]), space: "pitch" },
      style: { ...DEFAULT_STYLE },
      label: null,
      z: 0,
    } satisfies Annotation;

    const names = handlesFor(shape, rect).map((handle) => handle.name);
    expect(names).toEqual(["nw", "ne", "se", "sw", "m0", "m1", "m2", "m3", "rotate"]);

    // A 40 m wide box is 400 px wide at this scale.
    const nw = handlesFor(shape, rect).find((handle) => handle.name === "nw");
    const se = handlesFor(shape, rect).find((handle) => handle.name === "se");
    expect((se?.point[0] ?? 0) - (nw?.point[0] ?? 0)).toBeCloseTo(400, 6);
  });

  it("still gives a rect for an unmeasured box, rather than dividing by zero", () => {
    const rect = pitchRectOf({ left: 0, top: 0, width: 0, height: 0 }, VIEW);
    expect(rect.w).toBe(1);
    expect(Number.isFinite(rect.x)).toBe(true);
  });
});
