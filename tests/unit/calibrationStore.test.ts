import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StoredCalibration } from "@/lib/db/queries/calibrations";
import * as calibrationsQuery from "@/lib/db/queries/calibrations";
import {
  activeCalibrationAt,
  nextRecommended,
  solvePicks,
  useCalibrationStore,
} from "@/stores/calibrationStore";

/**
 * The calibration flow. The SQL is covered by the integration test; what matters
 * here is the flow's own rules: one pick per feature, auto-advance through a
 * spread set, a refusal to save an unsolvable set, and a clear message when the
 * four-point trap is hit.
 */

vi.mock("@/lib/db/queries/calibrations", () => ({
  listCalibrations: vi.fn(),
  saveCalibration: vi.fn(),
  deleteCalibration: vi.fn(),
}));

const listCalibrations = vi.mocked(calibrationsQuery.listCalibrations);
const saveCalibration = vi.mocked(calibrationsQuery.saveCalibration);
const deleteCalibration = vi.mocked(calibrationsQuery.deleteCalibration);

/** The same synthetic camera the homography tests use. */
const FRAME = { width: 1920, height: 1080 };
const PX_PER_M = 8;

function pixelsFor(xM: number, yM: number) {
  return { px: PX_PER_M * xM + 960, py: PX_PER_M * yM + 540 };
}

/**
 * Click a set of features by name, as the flow would: the store looks up each
 * feature's real position, so the test only supplies where the click landed.
 */
async function pickFeatures(keys: string[]) {
  const { findFeature } = await import("@/lib/pitch/pitchModel");
  for (const key of keys) {
    const found = findFeature({ lengthM: 105, widthM: 68 }, key);
    if (!found) throw new Error(`no feature ${key}`);
    useCalibrationStore.setState({ pendingFeature: key });
    const { px, py } = pixelsFor(found.x, found.y);
    await useCalibrationStore.getState().addPick(px / FRAME.width, py / FRAME.height);
  }
}

function stored(patch: Partial<StoredCalibration> = {}): StoredCalibration {
  return {
    id: 1,
    videoId: 7,
    fromMs: 0,
    pitchLengthM: 105,
    pitchWidthM: 68,
    rmsErrorPx: 1.2,
    points: [
      { feature: "centre-spot", imageU: 0.5, imageV: 0.5, xM: 0, yM: 0 },
      { feature: "left-penalty-spot", imageU: 0.2, imageV: 0.5, xM: -41.5, yM: 0 },
    ],
    ...patch,
  };
}

beforeEach(() => {
  vi.clearAllMocks();

  useCalibrationStore.setState({
    videoId: null,
    calibrations: [],
    picks: [],
    fromMs: 0,
    pitchLengthM: 105,
    pitchWidthM: 68,
    pendingFeature: null,
    skipped: [],
    editingId: null,
    error: null,
  });
});

describe("nextRecommended", () => {
  it("walks the recommended order and skips what is already picked", () => {
    const first = nextRecommended([]);
    expect(first).toBeTruthy();
    expect(nextRecommended([first as string])).not.toBe(first);
    expect(nextRecommended(["centre-spot", "left-penalty-spot"])).toBe("right-penalty-spot");
  });

  it("runs out rather than looping once every recommendation is used", () => {
    const all = [
      "centre-spot",
      "left-penalty-spot",
      "right-penalty-spot",
      "left-pa-front-top",
      "right-pa-front-bottom",
      "left-pa-front-bottom",
      "right-pa-front-top",
      "halfway-top",
      "halfway-bottom",
    ];
    expect(nextRecommended(all)).toBeNull();
  });

  it("does not offer a landmark the user passed over", () => {
    expect(nextRecommended([], ["centre-spot"])).toBe("left-penalty-spot");
    expect(nextRecommended([], ["centre-spot", "left-penalty-spot"])).toBe("right-penalty-spot");
  });
});

describe("picking", () => {
  it("records a pick against the feature's real position and moves on", async () => {
    await useCalibrationStore.getState().load(7);
    useCalibrationStore.getState().startPicking("centre-spot");

    await useCalibrationStore.getState().addPick(0.5, 0.5);

    const state = useCalibrationStore.getState();
    expect(state.picks).toHaveLength(1);
    expect(state.picks[0]).toMatchObject({ feature: "centre-spot", xM: 0, yM: 0 });
    // Auto-advance, so the flow does not need a second click per point.
    expect(state.pendingFeature).toBe("left-penalty-spot");
  });

  it("replaces a feature picked twice instead of duplicating it", async () => {
    await useCalibrationStore.getState().load(7);
    useCalibrationStore.getState().startPicking("centre-spot");
    await useCalibrationStore.getState().addPick(0.5, 0.5);
    useCalibrationStore.getState().startPicking("centre-spot");
    await useCalibrationStore.getState().addPick(0.51, 0.49);

    const picks = useCalibrationStore.getState().picks;
    expect(picks).toHaveLength(1);
    expect(picks[0].imageU).toBeCloseTo(0.51);
  });

  it("frees a feature for picking again when its point is removed", async () => {
    await useCalibrationStore.getState().load(7);
    useCalibrationStore.getState().startPicking("centre-spot");
    await useCalibrationStore.getState().addPick(0.5, 0.5);

    useCalibrationStore.getState().removePick("centre-spot");

    expect(useCalibrationStore.getState().picks).toEqual([]);
    expect(useCalibrationStore.getState().pendingFeature).toBe("centre-spot");
  });

  it("moves a placed point without changing which feature it is", async () => {
    await useCalibrationStore.getState().load(7);
    await pickFeatures(["centre-spot"]);

    useCalibrationStore.getState().movePick("centre-spot", 0.42, 0.58);

    expect(useCalibrationStore.getState().picks[0]).toMatchObject({
      feature: "centre-spot",
      xM: 0,
      yM: 0,
      imageU: 0.42,
      imageV: 0.58,
    });
  });
});

describe("skipping a landmark that is not visible", () => {
  it("passes over the offered point and moves on, picking nothing", () => {
    useCalibrationStore.getState().startPicking(null);
    expect(useCalibrationStore.getState().pendingFeature).toBe("centre-spot");

    useCalibrationStore.getState().skipPending();
    expect(useCalibrationStore.getState().pendingFeature).toBe("left-penalty-spot");

    useCalibrationStore.getState().skipPending();
    expect(useCalibrationStore.getState().pendingFeature).toBe("right-penalty-spot");
    expect(useCalibrationStore.getState().picks).toEqual([]);
  });

  it("offers a skipped landmark again once a point is actually placed", async () => {
    await useCalibrationStore.getState().load(7);
    useCalibrationStore.getState().startPicking(null);
    useCalibrationStore.getState().skipPending();

    // Placing the offered point moves the set on, so the earlier skip is dropped.
    const { findFeature } = await import("@/lib/pitch/pitchModel");
    const feature = findFeature({ lengthM: 105, widthM: 68 }, "left-penalty-spot");
    if (!feature) throw new Error("no feature");
    const { px, py } = pixelsFor(feature.x, feature.y);
    await useCalibrationStore.getState().addPick(px / FRAME.width, py / FRAME.height);

    expect(useCalibrationStore.getState().pendingFeature).toBe("centre-spot");
  });
});

describe("solving", () => {
  it("has nothing to solve without points", () => {
    expect(solvePicks([], FRAME)).toBeNull();
  });

  it("refuses three points and accepts four well spread ones", async () => {
    await useCalibrationStore.getState().load(7);
    await pickFeatures(["centre-spot", "left-penalty-spot", "right-penalty-spot"]);
    expect(solvePicks(useCalibrationStore.getState().picks, FRAME)?.ok).toBe(false);

    await pickFeatures(["corner-left-top"]);

    const outcome = solvePicks(useCalibrationStore.getState().picks, FRAME);
    // Four points with three on the halfway axis is the trick that does not work.
    expect(outcome?.ok).toBe(false);
    if (!outcome || outcome.ok) return;
    expect(outcome.reason).toMatch(/straight line/i);
  });

  it("solves a spread set cleanly", async () => {
    await useCalibrationStore.getState().load(7);
    await pickFeatures([
      "centre-spot",
      "left-penalty-spot",
      "right-pa-front-top",
      "corner-left-top",
      "corner-right-bottom",
    ]);

    const outcome = solvePicks(useCalibrationStore.getState().picks, FRAME);
    expect(outcome?.ok).toBe(true);
    if (!outcome?.ok) return;
    expect(outcome.quality.rmsErrorPx).toBeLessThan(1e-6);
    expect(outcome.quality.verdict).toBe("good");
  });
});

describe("saving", () => {
  it("refuses without a video", async () => {
    expect(await useCalibrationStore.getState().save(FRAME)).toBe(false);
    expect(saveCalibration).not.toHaveBeenCalled();
  });

  it("refuses an unsolvable set and says so", async () => {
    await useCalibrationStore.getState().load(7);
    useCalibrationStore.setState({
      picks: [{ feature: "centre-spot", imageU: 0.5, imageV: 0.5, xM: 0, yM: 0 }],
    });

    expect(await useCalibrationStore.getState().save(FRAME)).toBe(false);
    expect(useCalibrationStore.getState().error).toMatch(/at least 4/i);
    expect(saveCalibration).not.toHaveBeenCalled();
  });

  it("refuses a poor fit by default and names the point most likely wrong", async () => {
    await useCalibrationStore.getState().load(7);
    await pickFeatures([
      "centre-spot",
      "left-penalty-spot",
      "right-penalty-spot",
      "left-pa-front-top",
      "right-pa-front-bottom",
      "corner-left-top",
      "corner-right-bottom",
    ]);

    // Knock one pick well off its landmark, the way a mis-click does.
    useCalibrationStore.setState({
      picks: useCalibrationStore
        .getState()
        .picks.map((pick) =>
          pick.feature === "left-pa-front-top"
            ? { ...pick, imageU: pick.imageU + 0.12, imageV: pick.imageV - 0.09 }
            : pick,
        ),
    });

    expect(await useCalibrationStore.getState().save(FRAME)).toBe(false);
    expect(useCalibrationStore.getState().error).toMatch(/outside the band/i);
    // The point named is the one that was knocked off, by its label.
    expect(useCalibrationStore.getState().error).toMatch(/Left area, top corner/);
    expect(saveCalibration).not.toHaveBeenCalled();

    // The deliberate override writes it, because a person looking at the frame
    // knows more than the residual does.
    listCalibrations.mockResolvedValue([stored()]);
    expect(await useCalibrationStore.getState().save(FRAME, true)).toBe(true);
    expect(saveCalibration).toHaveBeenCalled();
  });

  it("writes the picks with the solved error, then reloads", async () => {
    await useCalibrationStore.getState().load(7);
    await pickFeatures([
      "centre-spot",
      "left-penalty-spot",
      "right-pa-front-top",
      "corner-left-top",
      "corner-right-bottom",
    ]);
    listCalibrations.mockResolvedValue([stored({ rmsErrorPx: 0.0001 })]);

    expect(await useCalibrationStore.getState().save(FRAME)).toBe(true);

    const input = saveCalibration.mock.calls[0][0];
    expect(input.videoId).toBe(7);
    expect(input.rmsErrorPx).toBeLessThan(1e-6);
    expect(input.points).toHaveLength(5);
    expect(input.points[0]).toMatchObject({ feature: "centre-spot", xM: 0, yM: 0 });

    const state = useCalibrationStore.getState();
    expect(state.picks).toEqual([]);
    expect(state.calibrations).toHaveLength(1);
  });

  it("surfaces a write failure instead of clearing the draft", async () => {
    await useCalibrationStore.getState().load(7);
    await pickFeatures([
      "centre-spot",
      "left-penalty-spot",
      "right-pa-front-top",
      "corner-left-top",
      "corner-right-bottom",
    ]);
    saveCalibration.mockRejectedValue(new Error("disk full"));

    expect(await useCalibrationStore.getState().save(FRAME)).toBe(false);
    expect(useCalibrationStore.getState().error).toMatch(/disk full/);
    expect(useCalibrationStore.getState().picks).toHaveLength(5);
  });
});

describe("editing and loading", () => {
  it("opens a stored calibration for adjustment", async () => {
    listCalibrations.mockResolvedValue([stored({ id: 4, fromMs: 1_000, points: stored().points })]);
    await useCalibrationStore.getState().load(7);

    useCalibrationStore.getState().edit(4);

    const state = useCalibrationStore.getState();
    expect(state.editingId).toBe(4);
    expect(state.fromMs).toBe(1_000);
    expect(state.picks).toHaveLength(2);
  });

  it("seeds the pitch size from the settings it is opened with", async () => {
    listCalibrations.mockResolvedValue([]);
    await useCalibrationStore.getState().load(7, { lengthM: 100, widthM: 64 });

    expect(useCalibrationStore.getState().pitchLengthM).toBe(100);
    expect(useCalibrationStore.getState().pitchWidthM).toBe(64);
  });

  it("reports a read failure", async () => {
    listCalibrations.mockRejectedValue(new Error("database is locked"));
    await useCalibrationStore.getState().load(7);
    expect(useCalibrationStore.getState().error).toMatch(/locked/);
  });

  it("removes a calibration and reloads the list", async () => {
    listCalibrations.mockResolvedValue([stored()]);
    await useCalibrationStore.getState().load(7);
    listCalibrations.mockResolvedValue([]);

    await useCalibrationStore.getState().remove(1);

    expect(deleteCalibration).toHaveBeenCalledWith(1);
    expect(useCalibrationStore.getState().calibrations).toEqual([]);
  });
});

describe("activeCalibrationAt", () => {
  it("picks the calibration in force, and nothing before the first one", () => {
    const list = [stored({ id: 1, fromMs: 0 }), stored({ id: 2, fromMs: 2_700_000 })];

    expect(activeCalibrationAt(list, 500_000)?.id).toBe(1);
    expect(activeCalibrationAt(list, 2_700_000)?.id).toBe(2);
    expect(activeCalibrationAt([stored({ id: 2, fromMs: 2_700_000 })], 1_000)).toBeNull();
  });
});
