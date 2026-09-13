import { describe, expect, it } from "vitest";
import type { StoredCalibration } from "@/lib/db/queries/calibrations";
import { applyHomography, solveHomography } from "@/lib/pitch/homography";
import { findFeature } from "@/lib/pitch/pitchModel";
import { placeOnPitch } from "@/lib/pitch/place";
import {
  convexHull,
  derivePosition,
  describeCoverage,
  hullArea,
  isNarrowCoverage,
  isPositionVisibleAt,
  isSupported,
  SUPPORT_MARGIN_M,
  storedCalibrationWarning,
  supportedRegion,
} from "@/lib/pitch/positions";
import type { Correspondence } from "@/lib/pitch/types";

/**
 * Positions, and the honesty rules around them (FR-30.3, NFR-26).
 *
 * The supported region is what separates "this position is good to a metre" from
 * "this position is a guess", so both halves get real tests: the geometry of the
 * hull, and the verdicts the marking flow will show the user.
 */

const SIZE = { lengthM: 105, widthM: 68 };
const FRAME = { width: 1920, height: 1080 };
const PX_PER_M = 6;

function camera(xM: number, yM: number) {
  return { px: PX_PER_M * xM + 960, py: PX_PER_M * yM + 540 };
}

/** A calibration good enough to derive positions from. */
function calibrated() {
  const keys = [
    "centre-spot",
    "left-penalty-spot",
    "right-penalty-spot",
    "corner-left-top",
    "corner-right-bottom",
  ];
  const points: Correspondence[] = keys.map((key) => {
    const feature = findFeature(SIZE, key);
    if (!feature) throw new Error(`no feature ${key}`);
    const { px, py } = camera(feature.x, feature.y);
    return { px, py, xM: feature.x, yM: feature.y };
  });
  const solved = solveHomography(points);
  if (!solved.ok) throw new Error(solved.reason);
  return solved.h;
}

/** A centre spot in the middle of the frame, for a click at that pixel. */
function clickAt(xM: number, yM: number) {
  const { px, py } = camera(xM, yM);
  return { imageU: px / FRAME.width, imageV: py / FRAME.height };
}

describe("convexHull", () => {
  it("returns a square's corners and drops the point inside it", () => {
    const hull = convexHull([
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
      [5, 5],
    ]);
    expect(hull).toHaveLength(4);
    expect(hull).not.toContainEqual([5, 5]);
  });

  it("is counter-clockwise, so the inside test can rely on it", () => {
    const hull = convexHull([
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ]);
    // Positive shoelace sum means counter-clockwise.
    let sum = 0;
    for (let i = 0; i < hull.length; i++) {
      const [x1, y1] = hull[i];
      const [x2, y2] = hull[(i + 1) % hull.length];
      sum += x1 * y2 - x2 * y1;
    }
    expect(sum).toBeGreaterThan(0);
  });

  it("handles a line of points without inventing an area", () => {
    const hull = convexHull([
      [0, 0],
      [5, 0],
      [10, 0],
    ]);
    expect(hullArea(hull)).toBe(0);
  });

  it("survives duplicates and too few points", () => {
    expect(convexHull([[1, 1]])).toEqual([[1, 1]]);
    expect(
      convexHull([
        [1, 1],
        [1, 1],
      ]),
    ).toHaveLength(2);
    expect(convexHull([])).toEqual([]);
  });

  it("measures a known square", () => {
    expect(
      hullArea([
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ]),
    ).toBeCloseTo(100);
  });
});

describe("supportedRegion", () => {
  it("reports how much of the pitch the picks cover", () => {
    // The four corners of a penalty area: 40.32 by 16.5, on a 105 by 68 pitch.
    const region = supportedRegion(
      [
        [-36, -20.16],
        [-52.5, -20.16],
        [-52.5, 20.16],
        [-36, 20.16],
      ],
      SIZE,
    );
    expect(region.areaM2).toBeCloseTo(40.32 * 16.5, 1);
    expect(region.shareOfPitch).toBeCloseTo((40.32 * 16.5) / (105 * 68), 3);
  });

  it("calls the whole pitch covered when the picks span it", () => {
    const region = supportedRegion(
      [
        [-52.5, -34],
        [52.5, -34],
        [52.5, 34],
        [-52.5, 34],
      ],
      SIZE,
    );
    expect(region.shareOfPitch).toBeCloseTo(1, 6);
    expect(isSupported(region, [0, 0])).toBe(true);
    expect(isSupported(region, [40, 20])).toBe(true);
  });
});

describe("isSupported", () => {
  const region = supportedRegion(
    [
      [-36, -20.16],
      [-52.5, -20.16],
      [-52.5, 20.16],
      [-36, 20.16],
    ],
    SIZE,
  );

  it("accepts a position inside the picked area", () => {
    expect(isSupported(region, [-45, 0])).toBe(true);
    expect(isSupported(region, [-40, 15])).toBe(true);
  });

  it("allows a little way past the edge, and no further", () => {
    // Just beyond the penalty area's front edge, within the margin.
    expect(isSupported(region, [-36 + SUPPORT_MARGIN_M - 0.5, 0])).toBe(true);
    expect(isSupported(region, [-36 + SUPPORT_MARGIN_M + 0.5, 0])).toBe(false);
    // Well past it: the centre circle is pure extrapolation.
    expect(isSupported(region, [0, 0])).toBe(false);
    expect(isSupported(region, [40, 20])).toBe(false);
  });

  it("treats a region with no area as covering nothing", () => {
    expect(
      isSupported(
        supportedRegion(
          [
            [-40, 0],
            [-30, 0],
          ],
          SIZE,
        ),
        [-35, 0],
      ),
    ).toBe(false);
  });
});

describe("derivePosition", () => {
  const h = calibrated();
  const region = supportedRegion(
    [
      [-52.5, -34],
      [52.5, -34],
      [52.5, 34],
      [-52.5, 34],
    ],
    SIZE,
  );

  it("maps a click to the pitch position under it", () => {
    const verdict = derivePosition(h, clickAt(12.5, -7.25), FRAME, SIZE, region);
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    expect(verdict.xM).toBeCloseTo(12.5, 6);
    expect(verdict.yM).toBeCloseTo(-7.25, 6);
    expect(verdict.supported).toBe(true);
    expect(verdict.warning).toBeNull();
  });

  it("refuses a click that lands off the pitch rather than storing nonsense", () => {
    // Far outside the touchline: the homography will happily extrapolate.
    const verdict = derivePosition(h, clickAt(0, -60), FRAME, SIZE, region);
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.reason).toMatch(/off the pitch/i);
  });

  it("accepts an extrapolated position but says it is a guess", () => {
    const tight = supportedRegion(
      [
        [-36, -20.16],
        [-52.5, -20.16],
        [-52.5, 20.16],
        [-36, 20.16],
      ],
      SIZE,
    );
    const verdict = derivePosition(h, clickAt(10, 0), FRAME, SIZE, tight);
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    expect(verdict.supported).toBe(false);
    // Roughly 24 m beyond the covered area, so it is well outside the margin.
    expect(verdict.warning).toMatch(/guess/i);
  });

  it("does not trust anything without a region to judge against", () => {
    const verdict = derivePosition(h, clickAt(0, 0), FRAME, SIZE, null);
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    expect(verdict.supported).toBe(false);
    expect(verdict.warning).toBeTruthy();
  });

  it("refuses before the frame size is known instead of dividing by zero", () => {
    const verdict = derivePosition(h, clickAt(0, 0), { width: 0, height: 0 }, SIZE, region);
    expect(verdict.ok).toBe(false);
  });

  it("keeps working from a homography it did not derive itself", () => {
    // A pure translation, as a sanity check that nothing assumes our own solve.
    const identity = [1 / PX_PER_M, 0, -960 / PX_PER_M, 0, 1 / PX_PER_M, -540 / PX_PER_M, 0, 0, 1];
    const mapped = applyHomography(identity, 960, 540);
    expect(mapped.x).toBeCloseTo(0, 6);
  });
});

describe("describeCoverage", () => {
  const regionAt = (share: number) => ({ hull: [], areaM2: 0, shareOfPitch: share });

  it("says the whole pitch is covered when it is", () => {
    expect(describeCoverage(regionAt(1))).toMatch(/whole pitch/i);
    expect(describeCoverage(regionAt(0.96))).toMatch(/whole pitch/i);
  });

  it("gives a percentage in the middle", () => {
    expect(describeCoverage(regionAt(0.72))).toMatch(/about 72%/);
  });

  it("warns plainly when the picks cover little", () => {
    expect(describeCoverage(regionAt(0.09))).toMatch(/only about 9%/);
    expect(describeCoverage(regionAt(0.09))).toMatch(/unreliable/i);
  });

  it("calls a tight pick set narrow, and a spread one not", () => {
    // This is the test that replaced the frame-space warning: seven picks inside
    // one penalty area cover 44% of the frame but about 15% of the pitch, and the
    // error beyond them was measured at 11 m (technical-design-R1 §6.3).
    const tight = supportedRegion(
      [
        [-52.5, -20.16],
        [-36, -20.16],
        [-36, 20.16],
        [-52.5, 20.16],
      ],
      SIZE,
    );
    expect(isNarrowCoverage(tight)).toBe(true);

    const spread = supportedRegion(
      [
        [-52.5, -34],
        [52.5, -34],
        [52.5, 34],
        [-52.5, 34],
      ],
      SIZE,
    );
    expect(isNarrowCoverage(spread)).toBe(false);
  });
});

describe("placeOnPitch", () => {
  /** A stored calibration whose clicks reproduce the synthetic camera. */
  function stored(keys: string[]): StoredCalibration {
    return {
      id: 1,
      videoId: 7,
      fromMs: 0,
      pitchLengthM: SIZE.lengthM,
      pitchWidthM: SIZE.widthM,
      rmsErrorPx: 0,
      points: keys.map((key) => {
        const feature = findFeature(SIZE, key);
        if (!feature) throw new Error(`no feature ${key}`);
        const { px, py } = camera(feature.x, feature.y);
        return {
          feature: key,
          imageU: px / FRAME.width,
          imageV: py / FRAME.height,
          xM: feature.x,
          yM: feature.y,
        };
      }),
    };
  }

  const SPREAD = [
    "centre-spot",
    "left-penalty-spot",
    "right-penalty-spot",
    "corner-left-top",
    "corner-right-bottom",
  ];

  it("refuses a video with no calibration rather than guessing", () => {
    const verdict = placeOnPitch({
      calibration: null,
      click: clickAt(0, 0),
      frame: FRAME,
      size: SIZE,
    });
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.reason).toMatch(/not calibrated/i);
  });

  it("refuses before the frame size is known", () => {
    const verdict = placeOnPitch({
      calibration: stored(SPREAD),
      click: clickAt(0, 0),
      frame: { width: 0, height: 0 },
      size: SIZE,
    });
    expect(verdict.ok).toBe(false);
  });

  it("turns a click into pitch metres when the picks support it", () => {
    const verdict = placeOnPitch({
      calibration: stored(SPREAD),
      click: clickAt(12.5, -7.25),
      frame: FRAME,
      size: SIZE,
    });
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    expect(verdict.xM).toBeCloseTo(12.5, 6);
    expect(verdict.yM).toBeCloseTo(-7.25, 6);
    expect(verdict.warning).toBeNull();
  });

  it("accepts but flags a click outside the region the picks constrain", () => {
    // The tight-shot case: the calibration only reaches one band of the pitch,
    // and a position elsewhere is a guess (technical-design-R1 §6.3).
    const tight = stored([
      "left-penalty-spot",
      "left-pa-front-top",
      "left-pa-front-bottom",
      "left-pa-goal-line-top",
      "left-pa-goal-line-bottom",
      "corner-left-top",
      "corner-left-bottom",
    ]);

    const verdict = placeOnPitch({
      calibration: tight,
      click: clickAt(0, 0),
      frame: FRAME,
      size: SIZE,
    });
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    expect(verdict.warning).toMatch(/guess/i);
  });
});

describe("storedCalibrationWarning", () => {
  /** The owner's real stored calibration, read from their library. */
  const real = [
    { imageU: 0.4057, imageV: 0.498, xM: -9.15, yM: 0 },
    { imageU: 0.4058, imageV: 0.4991, xM: -41.5, yM: 0 },
    { imageU: 0.7838, imageV: 0.3824, xM: -47, yM: -9.16 },
    { imageU: 0.6319, imageV: 0.2525, xM: -36, yM: -20.16 },
  ];

  it("flags the real calibration, whose first two clicks are 1.2 px apart", () => {
    // Two landmarks 32 m apart on the pitch cannot share a place on the frame,
    // and the four-point fit reported 1.4e-10 px — so the residual never would.
    expect(storedCalibrationWarning(real, FRAME)).toMatch(/same place/i);
  });

  it("says a four-point calibration's error is not evidence", () => {
    const four = [
      { imageU: 0.5, imageV: 0.5, xM: 0, yM: 0 },
      { imageU: 0.2, imageV: 0.5, xM: -41.5, yM: 0 },
      { imageU: 0.8, imageV: 0.4, xM: 36, yM: -20.16 },
      { imageU: 0.3, imageV: 0.8, xM: -52.5, yM: 34 },
    ];
    expect(storedCalibrationWarning(four, FRAME)).toMatch(/not evidence/i);
  });

  it("says nothing about a well-spread calibration", () => {
    const spread = [
      "centre-spot",
      "left-penalty-spot",
      "right-penalty-spot",
      "corner-left-top",
      "corner-right-bottom",
    ].map((key) => {
      const feature = findFeature(SIZE, key);
      if (!feature) throw new Error(`no feature ${key}`);
      const { px, py } = camera(feature.x, feature.y);
      return {
        imageU: px / FRAME.width,
        imageV: py / FRAME.height,
        xM: feature.x,
        yM: feature.y,
      };
    });

    expect(storedCalibrationWarning(spread, FRAME)).toBeNull();
  });
});

describe("isPositionVisibleAt", () => {
  // The event's own range is the display window: 92 s to 112 s.
  const range = { startMs: 92_000, endMs: 112_000 };

  it("shows the markers inside the event's own range, boundaries included", () => {
    expect(isPositionVisibleAt(92_000, range, false)).toBe(true);
    expect(isPositionVisibleAt(100_000, range, false)).toBe(true);
    expect(isPositionVisibleAt(112_000, range, false)).toBe(true);
  });

  it("hides them once the playhead has left the event", () => {
    // The click is only true at the anchor; over other footage it would read as
    // "this is where they are now" rather than "this is where they were".
    expect(isPositionVisibleAt(91_999, range, false)).toBe(false);
    expect(isPositionVisibleAt(112_001, range, false)).toBe(false);
    expect(isPositionVisibleAt(0, range, false)).toBe(false);
  });

  it("shows nothing when no event is selected", () => {
    expect(isPositionVisibleAt(100_000, null, false)).toBe(false);
  });

  it("keeps them visible while marking, wherever the playhead is", () => {
    // Placing a position needs its existing markers as context.
    expect(isPositionVisibleAt(0, range, true)).toBe(true);
    expect(isPositionVisibleAt(500_000, range, true)).toBe(true);
    expect(isPositionVisibleAt(0, null, true)).toBe(true);
  });
});
