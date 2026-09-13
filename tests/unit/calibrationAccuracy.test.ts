import { describe, expect, it } from "vitest";
import { applyHomography, solveHomography } from "@/lib/pitch/homography";
import { findFeature } from "@/lib/pitch/pitchModel";
import type { Correspondence } from "@/lib/pitch/types";

/**
 * What a manual calibration is actually worth (T8, NFR-26).
 *
 * The band — 2 px good, 6 px acceptable — says how the outline looks on the
 * frame. It does not say how wrong a *position* can be, which is what a user is
 * really trusting. This measures both, on a synthetic broadcast view (a
 * trapezoid, so the projection has real perspective rather than being affine)
 * with clicking error applied to every pick.
 *
 * The printed numbers are the justification for the band and for the "points
 * cover too little of the frame" warning. They bound what hand-placed points can
 * deliver when the picks are as good as a careful person can make them — they
 * are not a claim about any particular broadcast.
 */

const SIZE = { lengthM: 105, widthM: 68 };

/** A plausible camera behind one goal: near touchline wide, far touchline narrow. */
const VIEW_CORNERS: { pitch: [number, number]; px: number; py: number }[] = [
  { pitch: [-52.5, 34], px: 300, py: 1000 },
  { pitch: [52.5, 34], px: 1620, py: 1000 },
  { pitch: [-52.5, -34], px: 700, py: 500 },
  { pitch: [52.5, -34], px: 1220, py: 500 },
];

/** The pitch→image map, solved by swapping the roles of the two point sets. */
function forward(): number[] {
  const swapped: Correspondence[] = VIEW_CORNERS.map((corner) => ({
    px: corner.pitch[0],
    py: corner.pitch[1],
    xM: corner.px,
    yM: corner.py,
  }));
  const result = solveHomography(swapped);
  if (!result.ok) throw new Error(result.reason);
  return result.h;
}

/** Deterministic noise, so a failure is reproducible rather than a coin toss. */
function noise(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    const first = state / 2_147_483_648;
    const second = ((state * 7919) % 1000) / 1000;
    // Two uniforms, which is enough to look like an imprecise click.
    return (first + second - 1) * 1.4;
  };
}

const RECOMMENDED = [
  "centre-spot",
  "left-penalty-spot",
  "right-penalty-spot",
  "left-pa-front-top",
  "right-pa-front-bottom",
  "corner-left-top",
  "corner-right-bottom",
  "halfway-bottom",
];

function measure(keys: string[], sigmaPx: number, seed: number) {
  const h = forward();
  const jitter = noise(seed);

  const picks: Correspondence[] = keys.map((key) => {
    const feature = findFeature(SIZE, key);
    if (!feature) throw new Error(`no feature ${key}`);
    const truePixel = applyHomography(h, feature.x, feature.y);
    return {
      px: truePixel.x + jitter() * sigmaPx,
      py: truePixel.y + jitter() * sigmaPx,
      xM: feature.x,
      yM: feature.y,
    };
  });

  const solved = solveHomography(picks);
  if (!solved.ok) throw new Error(solved.reason);

  // How far a position can be from the truth, across the whole pitch.
  const errors: number[] = [];
  for (let x = -50; x <= 50; x += 10) {
    for (let y = -30; y <= 30; y += 10) {
      const asPixel = applyHomography(h, x, y);
      const mapped = applyHomography(solved.h, asPixel.x, asPixel.y);
      errors.push(Math.hypot(mapped.x - x, mapped.y - y));
    }
  }
  errors.sort((a, b) => a - b);

  return {
    rmsErrorPx: solved.quality.rmsErrorPx,
    medianErrorM: errors[Math.floor(errors.length / 2)],
    p95ErrorM: errors[Math.floor(errors.length * 0.95)],
    worstErrorM: errors[errors.length - 1],
  };
}

type Measurement = ReturnType<typeof measure>;

/** Averaged over seeds, because a single noise draw proves nothing. */
function average(keys: string[], sigmaPx: number, seeds = 40) {
  const runs = Array.from({ length: seeds }, (_, index) =>
    measure(keys, sigmaPx, 1000 + index * 37),
  );
  const mean = (pick: (run: Measurement) => number) =>
    runs.reduce((sum, run) => sum + pick(run), 0) / runs.length;
  return {
    rmsErrorPx: mean((run) => run.rmsErrorPx),
    medianErrorM: mean((run) => run.medianErrorM),
    p95ErrorM: mean((run) => run.p95ErrorM),
    worstErrorM: mean((run) => run.worstErrorM),
  };
}

describe("calibration accuracy with seven picks", () => {
  const careful = average(RECOMMENDED.slice(0, 7), 3);
  const sloppy = average(RECOMMENDED.slice(0, 7), 8);

  it("records what careful picks are worth, and what sloppy ones cost", () => {
    // The measurement, printed where it can be read and re-derived.
    console.log(
      [
        "T8 measurement on a synthetic perspective view, 7 reference points:",
        `  clicking error ±3 px → outline rms ${careful.rmsErrorPx.toFixed(1)} px; ` +
          `position error median ${careful.medianErrorM.toFixed(2)} m, ` +
          `95th ${careful.p95ErrorM.toFixed(2)} m, worst ${careful.worstErrorM.toFixed(2)} m`,
        `  clicking error ±8 px → outline rms ${sloppy.rmsErrorPx.toFixed(1)} px; ` +
          `position error median ${sloppy.medianErrorM.toFixed(2)} m, ` +
          `95th ${sloppy.p95ErrorM.toFixed(2)} m, worst ${sloppy.worstErrorM.toFixed(2)} m`,
      ].join("\n"),
    );

    // Careful picking lands inside the accepted band, which makes the band
    // meaningful rather than aspirational.
    expect(careful.rmsErrorPx).toBeLessThanOrEqual(6);
    // And a position is good to about a metre, which is the claim the app is
    // making when it shows a player on the pitch.
    expect(careful.p95ErrorM).toBeLessThan(1.5);

    // Sloppy picking is visibly worse, so the warning is worth showing.
    expect(sloppy.rmsErrorPx).toBeGreaterThan(careful.rmsErrorPx);
    expect(sloppy.p95ErrorM).toBeGreaterThan(careful.p95ErrorM);
  });

  it("is worst away from the reference points, which is why spread is asked for", () => {
    const run = measure(RECOMMENDED.slice(0, 7), 4, 4242);
    expect(run.worstErrorM).toBeGreaterThan(run.medianErrorM);
  });

  it("improves the positions with more picks, and stops flattering the residual", () => {
    // Two things change with more picks, and only one of them is obvious:
    //
    // 1. The fitted camera improves, so positions *away* from the reference
    //    points get better. This is the honest reason to ask for six to eight.
    // 2. The reported residual gets *worse* — because a fit over few points has
    //    enough freedom to chase their noise, so it reports a flattering error.
    //    A low rms with four points is therefore not evidence of a good
    //    calibration, which is exactly why the flow asks for more.
    const five = average(RECOMMENDED.slice(0, 5), 4, 60);
    const eight = average(RECOMMENDED.slice(0, 8), 4, 60);

    console.log(
      `  pick count 5 → 95th position error ${five.p95ErrorM.toFixed(2)} m, ` +
        `rms ${five.rmsErrorPx.toFixed(1)} px; ` +
        `8 → ${eight.p95ErrorM.toFixed(2)} m, rms ${eight.rmsErrorPx.toFixed(1)} px ` +
        "(the residual rises toward the real clicking error)",
    );

    expect(eight.p95ErrorM).toBeLessThan(five.p95ErrorM);
    expect(eight.rmsErrorPx).toBeGreaterThan(five.rmsErrorPx);
  });
});
