import { describe, expect, it } from "vitest";
import {
  applyHomography,
  invertHomography,
  MIN_POINTS,
  nearDuplicatePicks,
  projectToImage,
  RMS_ACCEPTABLE_PX,
  RMS_GOOD_PX,
  residualsPx,
  resolveCalibration,
  solveHomography,
  worstResidual,
} from "@/lib/pitch/homography";
import { findFeature, pitchFeatures } from "@/lib/pitch/pitchModel";
import type { Correspondence } from "@/lib/pitch/types";

/**
 * A synthetic broadcast camera: a plain scale and translate, which is a valid
 * homography and therefore invertible exactly.
 *
 * With the pitch at the centre of a 1920×1080 frame and 8 px per metre, the
 * whole pitch fits (x ±52.5 → 540..1380, y ±34 → 268..812), so a correct solve
 * must reproduce held-out points to within floating-point noise.
 */
const PX_PER_M = 8;

function camera(xM: number, yM: number) {
  return { px: PX_PER_M * xM + 960, py: PX_PER_M * yM + 540 };
}

function fromFeatures(keys: string[]): Correspondence[] {
  return keys.map((key) => {
    const found = findFeature({ lengthM: 105, widthM: 68 }, key);
    if (!found) throw new Error(`no feature ${key}`);
    const { px, py } = camera(found.x, found.y);
    return { px, py, xM: found.x, yM: found.y };
  });
}

const SPREAD_KEYS = [
  "centre-spot",
  "left-penalty-spot",
  "right-penalty-spot",
  "left-pa-front-top",
  "right-pa-front-bottom",
  "corner-left-top",
];

describe("solveHomography", () => {
  it("recovers a camera from six points and reports a clean fit", () => {
    const result = solveHomography(fromFeatures(SPREAD_KEYS));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.quality.verdict).toBe("good");
    expect(result.quality.rmsErrorPx).toBeLessThan(1e-6);
    expect(result.quality.residualsPx).toHaveLength(SPREAD_KEYS.length);
  });

  it("maps held-out points correctly, so it learned the camera rather than the points", () => {
    const result = solveHomography(fromFeatures(SPREAD_KEYS));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Features that were not part of the solve.
    for (const key of ["halfway-bottom", "left-ga-front-bottom", "circle-top"]) {
      const held = findFeature({ lengthM: 105, widthM: 68 }, key);
      if (!held) throw new Error(`no feature ${key}`);
      const { px, py } = camera(held.x, held.y);
      const mapped = applyHomography(result.h, px, py);
      expect(mapped.x).toBeCloseTo(held.x, 6);
      expect(mapped.y).toBeCloseTo(held.y, 6);
    }
  });

  it("works at the mathematical minimum of four points", () => {
    const result = solveHomography(
      fromFeatures([
        "centre-spot",
        "left-penalty-spot",
        "right-pa-front-top",
        "corner-left-bottom",
      ]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.quality.rmsErrorPx).toBeLessThan(1e-6);
  });

  it("names the four-point trap: the tempting quartet has three points in a line", () => {
    // The centre spot and both penalty spots all sit on the halfway axis, and
    // that trio plus one corner is the most natural four points to pick — and
    // mathematically not enough.
    const result = solveHomography(
      fromFeatures(["centre-spot", "left-penalty-spot", "right-penalty-spot", "corner-left-top"]),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/straight line/i);
  });

  it("accepts the same three in a line once the set is larger than four", () => {
    // Six points already include that collinear trio; over-determination makes
    // it harmless, which is why the check above only fires at exactly four.
    const result = solveHomography(fromFeatures(SPREAD_KEYS));
    expect(result.ok).toBe(true);
  });

  it("refuses fewer than four points, saying how many it needs", () => {
    const result = solveHomography(fromFeatures(SPREAD_KEYS.slice(0, 3)));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain(String(MIN_POINTS));
  });

  it("refuses points that lie in a line, and says why", () => {
    const line: Correspondence[] = [
      { px: 100, py: 300, xM: -40, yM: -30 },
      { px: 300, py: 300, xM: 0, yM: 0 },
      { px: 500, py: 300, xM: 20, yM: -10 },
      { px: 900, py: 300, xM: 40, yM: 30 },
    ];
    const result = solveHomography(line);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/line/i);
  });

  it("reports a poor fit that points at the one wrong pick", () => {
    const points = fromFeatures([
      "centre-spot",
      "left-penalty-spot",
      "right-penalty-spot",
      "left-pa-front-top",
      "right-pa-front-bottom",
      "corner-left-top",
      "corner-right-bottom",
    ]);
    const badIndex = 3;
    points[badIndex] = {
      ...points[badIndex],
      px: points[badIndex].px + 220,
      py: points[badIndex].py - 180,
    };

    const result = solveHomography(points);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.quality.rmsErrorPx).toBeGreaterThan(RMS_ACCEPTABLE_PX);
    expect(result.quality.verdict).toBe("poor");
    expect(result.quality.warning).toMatch(/wrong place/i);

    const worst = result.quality.residualsPx.indexOf(Math.max(...result.quality.residualsPx));
    expect(worst).toBe(badIndex);
  });

  it("degrades the verdict as noise grows, in the band the owner accepted", () => {
    const base = fromFeatures(SPREAD_KEYS);
    const jitter = (points: Correspondence[], amount: number) =>
      points.map((point, index) => ({
        ...point,
        // Deterministic, alternating, so the test does not depend on luck.
        px: point.px + (index % 2 === 0 ? amount : -amount),
        py: point.py + (index % 3 === 0 ? amount : -amount),
      }));

    const slight = solveHomography(jitter(base, 1));
    const heavy = solveHomography(jitter(base, 12));

    expect(slight.ok && heavy.ok).toBe(true);
    if (!slight.ok || !heavy.ok) return;

    expect(slight.quality.rmsErrorPx).toBeGreaterThan(0);
    expect(slight.quality.rmsErrorPx).toBeLessThanOrEqual(RMS_GOOD_PX);
    expect(slight.quality.verdict).toBe("good");
    expect(heavy.quality.rmsErrorPx).toBeGreaterThan(RMS_ACCEPTABLE_PX);
    expect(heavy.quality.verdict).toBe("poor");
  });

  it("names the worst-residual point, which is what a poor fit is refused on", () => {
    // Coverage is deliberately not judged here: frame-space coverage stayed
    // silent in the tight-shot case it existed for, so pitch coverage lives in
    // `lib/pitch/positions.ts` and is tested there.
    expect(worstResidual([1.2, 0.4, 9.8, 2.1])).toEqual({ index: 2, px: 9.8 });
    expect(worstResidual([])).toBeNull();
  });

  it("refuses two clicks in the same place, which a four-point fit would hide", () => {
    // Taken from the owner's real library: "centre circle, left" and "left
    // penalty spot" — 32 m apart on the pitch — were clicked 1.2 px apart, and
    // the four-point fit reported 1.4e-10 px. Four points always fit exactly, so
    // the residual cannot catch this; the duplicate check must.
    const points = fromFeatures([
      "centre-spot",
      "left-penalty-spot",
      "left-ga-front-top",
      "left-pa-front-top",
    ]);
    const collision = points[1];
    points[0] = { ...points[0], px: collision.px + 0.19, py: collision.py + 1.2 };

    const result = solveHomography(points);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/same click|same place/i);
    expect(result.suspectIndices).toEqual([0, 1]);
  });

  it("does not mistake a genuinely tight pick set for one click", () => {
    // Two landmarks can be close in the image under foreshortening; the check is
    // about a pair that is close *relative to the spread of the picks*.
    expect(nearDuplicatePicks(fromFeatures(SPREAD_KEYS))).toBeNull();
  });

  it("says a four-point fit's error is not evidence, and stops saying it at five", () => {
    const four = solveHomography(
      fromFeatures([
        "centre-spot",
        "left-penalty-spot",
        "right-pa-front-top",
        "corner-left-bottom",
      ]),
    );
    expect(four.ok).toBe(true);
    if (!four.ok) return;
    expect(four.quality.rmsErrorPx).toBeLessThan(1e-6);
    expect(four.quality.warning).toMatch(/not evidence/i);

    const five = solveHomography(fromFeatures(SPREAD_KEYS));
    expect(five.ok).toBe(true);
    if (!five.ok) return;
    expect(five.quality.warning).toBeNull();
  });

  it("does not claim a good fit when there is no warning to give", () => {
    const result = solveHomography(fromFeatures(SPREAD_KEYS));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.quality.warning).toBeNull();
  });
});

describe("projection", () => {
  it("inverts itself", () => {
    const result = solveHomography(fromFeatures(SPREAD_KEYS));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const inverse = invertHomography(result.h);
    const identity = [
      result.h[0] * inverse[0] + result.h[1] * inverse[3] + result.h[2] * inverse[6],
      result.h[0] * inverse[1] + result.h[1] * inverse[4] + result.h[2] * inverse[7],
      result.h[3] * inverse[0] + result.h[4] * inverse[3] + result.h[5] * inverse[6],
      result.h[3] * inverse[1] + result.h[4] * inverse[4] + result.h[5] * inverse[7],
    ];
    expect(identity[0]).toBeCloseTo(1, 9);
    expect(identity[1]).toBeCloseTo(0, 9);
    expect(identity[2]).toBeCloseTo(0, 9);
    expect(identity[3]).toBeCloseTo(1, 9);
  });

  it("round-trips a pixel through the pitch and back", () => {
    const result = solveHomography(fromFeatures(SPREAD_KEYS));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const back = projectToImage(result.h, 12.5, -7.25);
    const mapped = applyHomography(result.h, back.px, back.py);
    expect(mapped.x).toBeCloseTo(12.5, 9);
    expect(mapped.y).toBeCloseTo(-7.25, 9);
  });

  it("measures each point's own error", () => {
    const points = fromFeatures(SPREAD_KEYS);
    const result = solveHomography(points);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const residuals = residualsPx(result.h, points);
    expect(residuals).toHaveLength(points.length);
    for (const value of residuals) expect(value).toBeLessThan(1e-6);
  });

  it("refuses to invert a degenerate matrix rather than returning nonsense", () => {
    expect(() => invertHomography([0, 0, 0, 0, 0, 0, 0, 0, 0])).toThrow(/degenerate/i);
  });
});

describe("resolveCalibration", () => {
  const list = [
    { id: 1, fromMs: 0 },
    { id: 2, fromMs: 2_700_000 },
  ];

  it("takes the latest calibration that has already started", () => {
    expect(resolveCalibration(list, 0)?.id).toBe(1);
    expect(resolveCalibration(list, 1_000_000)?.id).toBe(1);
    expect(resolveCalibration(list, 2_700_000)?.id).toBe(2);
    expect(resolveCalibration(list, 5_000_000)?.id).toBe(2);
  });

  it("finds nothing before the first calibration begins", () => {
    expect(resolveCalibration([{ id: 2, fromMs: 500 }], 400)).toBeNull();
    expect(resolveCalibration([], 1_000)).toBeNull();
  });

  it("does not depend on the order rows come back in", () => {
    const reversed = [list[1], list[0]];
    expect(resolveCalibration(reversed, 1_000_000)?.id).toBe(1);
    expect(resolveCalibration(reversed, 3_000_000)?.id).toBe(2);
  });
});

describe("the feature set is usable for calibration", () => {
  it("offers enough well-spread points to reach six to eight picks", () => {
    expect(pitchFeatures({ lengthM: 105, widthM: 68 }).length).toBeGreaterThanOrEqual(20);
  });
});
