import { describe, expect, it } from "vitest";
import { applyHomography, solveHomography } from "@/lib/pitch/homography";
import { findFeature } from "@/lib/pitch/pitchModel";
import { isSupported, supportedRegion } from "@/lib/pitch/positions";
import { outlinePrimitives, projectOutline, projectPositions } from "@/lib/pitch/project";
import type { Correspondence } from "@/lib/pitch/types";

/**
 * The verification overlay's geometry (FR-30.2).
 *
 * `projectOutline` uses the inverse of the calibration to draw where the pitch is
 * on the frame. It has to survive a projection that throws parts of the pitch far
 * outside the picture, because that is exactly what a mis-picked reference point
 * produces — and the user needs to see the mess rather than a crash or a line
 * drawn across the screen.
 */

const FRAME = { width: 1920, height: 1080 };
const SIZE = { lengthM: 105, widthM: 68 };
const PX_PER_M = 6;

function camera(xM: number, yM: number) {
  return { px: PX_PER_M * xM + 960, py: PX_PER_M * yM + 540 };
}

function calibrated() {
  const keys = [
    "centre-spot",
    "left-penalty-spot",
    "right-pa-front-top",
    "corner-left-top",
    "corner-right-bottom",
    "left-pa-front-bottom",
  ];
  const points: Correspondence[] = keys.map((key) => {
    const found = findFeature(SIZE, key);
    if (!found) throw new Error(`no feature ${key}`);
    const { px, py } = camera(found.x, found.y);
    return { px, py, xM: found.x, yM: found.y };
  });
  const result = solveHomography(points);
  if (!result.ok) throw new Error(result.reason);
  return result.h;
}

describe("projectOutline", () => {
  it("draws every line of the pitch model", () => {
    const { lines } = projectOutline(calibrated(), SIZE, FRAME);
    // The boundary, halfway, two areas, two six-yard boxes, the circle, two
    // arcs and four corners.
    expect(lines.length).toBeGreaterThanOrEqual(13);
    expect(lines.every((line) => line.length >= 2)).toBe(true);
  });

  it("lands the boundary where the camera says it is", () => {
    const { lines } = projectOutline(calibrated(), SIZE, FRAME);
    const boundary = lines[0];

    // The first point of the boundary is the left-top corner.
    const corner = camera(-52.5, -34);
    expect(boundary[0][0]).toBeCloseTo(corner.px / FRAME.width, 6);
    expect(boundary[0][1]).toBeCloseTo(corner.py / FRAME.height, 6);
    // And it closes.
    expect(boundary[4]).toEqual(boundary[0]);
  });

  it("keeps every projected point inside a sane range for a good calibration", () => {
    const { lines, clipped } = projectOutline(calibrated(), SIZE, FRAME);
    for (const line of lines) {
      for (const [u, v] of line) {
        expect(Number.isFinite(u)).toBe(true);
        expect(Number.isFinite(v)).toBe(true);
        expect(Math.abs(u)).toBeLessThan(12);
        expect(Math.abs(v)).toBeLessThan(12);
      }
    }
    expect(clipped).toBe(false);
  });

  it("draws only the part of the pitch the picks support, and says it clipped", () => {
    // What a tight-shot calibration looks like: the picks constrain one half.
    // The extrapolated half is fiction — 11 m median error when measured — and
    // drawing it is what made the shape look broken (technical-design-R1 §6.3).
    const region = supportedRegion(
      [
        [-52.5, -34],
        [-20, -34],
        [-20, 34],
        [-52.5, 34],
      ],
      SIZE,
    );

    const h = calibrated();
    const clippedOutline = projectOutline(h, SIZE, FRAME, region);
    expect(clippedOutline.regionClipped).toBe(true);

    // Every drawn point really is inside the region the picks constrain.
    for (const line of clippedOutline.lines) {
      for (const [u, v] of line) {
        const metres = applyHomography(h, u * FRAME.width, v * FRAME.height);
        expect(isSupported(region, [metres.x, metres.y])).toBe(true);
      }
    }

    // And less of the model is drawn than without the region.
    const count = (lines: [number, number][][]) =>
      lines.reduce((sum, line) => sum + line.length, 0);
    expect(count(clippedOutline.lines)).toBeLessThan(count(projectOutline(h, SIZE, FRAME).lines));
  });

  it("breaks a line rather than drawing it across the frame, when the frame is far smaller than the projection", () => {
    // A tiny frame makes most of the projection land outside the runaway bound,
    // which is the path a mis-picked point takes in practice.
    const { lines, clipped } = projectOutline(calibrated(), SIZE, { width: 10, height: 10 });
    expect(clipped).toBe(true);
    for (const line of lines) {
      expect(line.length).toBeGreaterThanOrEqual(2);
      for (const [u, v] of line) {
        expect(Math.abs(u)).toBeLessThanOrEqual(12.001);
        expect(Math.abs(v)).toBeLessThanOrEqual(12.001);
      }
    }
  });

  it("never emits an unbounded point, whatever the calibration", () => {
    const matrices = [
      calibrated(),
      // A strong perspective term: the inverse has a pole somewhere near the pitch.
      [0.1, 0, -50, 0, -0.1, 30, 0, 0.002, 1],
      [0.02, 0.001, -20, 0.001, -0.02, 10, 0.0001, 0.001, 1],
    ];

    for (const h of matrices) {
      const { lines } = projectOutline(h, SIZE, FRAME);
      for (const line of lines) {
        for (const [u, v] of line) {
          expect(Number.isFinite(u)).toBe(true);
          expect(Number.isFinite(v)).toBe(true);
          expect(Math.abs(u)).toBeLessThanOrEqual(12.001);
          expect(Math.abs(v)).toBeLessThanOrEqual(12.001);
        }
      }
    }
  });
});

describe("outlinePrimitives", () => {
  it("produces drawable paths behind everything else", () => {
    const primitives = outlinePrimitives(calibrated(), SIZE, FRAME, {
      stroke: "#22D3EE",
      width: 0.002,
      opacity: 0.9,
    });

    expect(primitives.length).toBeGreaterThan(0);
    for (const primitive of primitives) {
      expect(primitive.kind).toBe("path");
      if (primitive.kind !== "path") continue;
      expect(primitive.closed).toBe(false);
      expect(primitive.head).toBe(false);
      expect(primitive.fill).toBeNull();
      expect(primitive.stroke).toBe("#22D3EE");
    }
    // Behind the drawings, so checking a calibration never hides a shape.
    expect(primitives.every((primitive) => primitive.z < 0)).toBe(true);
  });
});

describe("projectPositions", () => {
  it("maps pitch positions onto the frame", () => {
    const projected = projectPositions(calibrated(), [{ xM: 0, yM: 0 }], FRAME);
    expect(projected[0]?.[0]).toBeCloseTo(960 / FRAME.width, 6);
    expect(projected[0]?.[1]).toBeCloseTo(540 / FRAME.height, 6);
  });

  it("returns nothing for a position it cannot place", () => {
    // A pitch position far outside the ground projects off the scale.
    const projected = projectPositions(calibrated(), [{ xM: 12_000, yM: 0 }], FRAME);
    expect(projected[0]).toBeNull();
  });
});
