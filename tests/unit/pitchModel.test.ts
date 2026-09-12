import { describe, expect, it } from "vitest";
import {
  DEFAULT_PITCH_LENGTH_M,
  DEFAULT_PITCH_WIDTH_M,
  findFeature,
  onPitch,
  PITCH,
  pitchFeatures,
  pitchOutline,
  RECOMMENDED_FEATURE_KEYS,
} from "@/lib/pitch/pitchModel";

const standard = { lengthM: DEFAULT_PITCH_LENGTH_M, widthM: DEFAULT_PITCH_WIDTH_M };

function feature(key: string, size = standard) {
  const found = findFeature(size, key);
  if (!found) throw new Error(`no feature ${key}`);
  return found;
}

describe("pitch features", () => {
  it("places the penalty spots 11 m from the goal line", () => {
    // Half of 105 is 52.5, so the spot sits at 41.5.
    expect(feature("left-penalty-spot").x).toBeCloseTo(-41.5);
    expect(feature("right-penalty-spot").x).toBeCloseTo(41.5);
    expect(feature("left-penalty-spot").y).toBeCloseTo(0);
  });

  it("places the penalty area corners by the Laws", () => {
    const front = feature("right-pa-front-top");
    expect(front.x).toBeCloseTo(52.5 - PITCH.penaltyAreaDepth);
    expect(front.y).toBeCloseTo(-PITCH.penaltyAreaWidth / 2);
  });

  it("places the six-yard box inside the penalty area", () => {
    const sixYard = feature("left-ga-front-top");
    expect(sixYard.x).toBeCloseTo(-(52.5 - PITCH.goalAreaDepth));
    expect(sixYard.y).toBeCloseTo(-PITCH.goalAreaWidth / 2);
    expect(Math.abs(sixYard.x)).toBeGreaterThan(Math.abs(feature("left-pa-front-top").x));
  });

  it("puts the goal posts 7.32 m apart on the goal line", () => {
    expect(feature("right-post-top").x).toBeCloseTo(52.5);
    expect(feature("right-post-top").y).toBeCloseTo(-PITCH.goalWidth / 2);
    expect(feature("right-post-bottom").y - feature("right-post-top").y).toBeCloseTo(
      PITCH.goalWidth,
    );
  });

  it("meets the halfway line at the touchlines", () => {
    expect(feature("halfway-top").y).toBeCloseTo(-34);
    expect(feature("halfway-bottom").y).toBeCloseTo(34);
  });

  it("crosses the penalty arc ahead of the spot", () => {
    // The arc's own radius further from the goal than the spot.
    expect(feature("left-pa-arc").x).toBeCloseTo(-(41.5 - PITCH.centreCircleRadius));
  });

  it("has unique keys and offers every recommended one", () => {
    const keys = pitchFeatures(standard).map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of RECOMMENDED_FEATURE_KEYS) {
      expect(keys).toContain(key);
    }
  });

  it("moves with a non-standard pitch", () => {
    const small = { lengthM: 100, widthM: 64 };
    expect(findFeature(small, "corner-left-top")).toMatchObject({ x: -50, y: -32 });
    expect(findFeature(small, "right-penalty-spot")?.x).toBeCloseTo(39);
  });
});

describe("pitch outline", () => {
  it("closes the boundary rectangle", () => {
    const boundary = pitchOutline(standard)[0];
    expect(boundary.points).toHaveLength(5);
    expect(boundary.points[0]).toEqual(boundary.points[4]);
    expect(boundary.points[0]).toEqual([-52.5, -34]);
  });

  it("samples the centre circle densely enough to bend under a projection", () => {
    const circle = pitchOutline(standard).find(
      (line) => line.points.length > 40 && line.points[0][0] === PITCH.centreCircleRadius,
    );
    expect(circle).toBeDefined();
    expect(circle?.points.length).toBeGreaterThan(40);
  });

  it("draws both goals behind the goal line", () => {
    const goals = pitchOutline(standard).filter((line) =>
      line.points.some((point) => Math.abs(point[0]) > 52.5),
    );
    expect(goals).toHaveLength(2);
  });

  it("draws every penalty area once", () => {
    const areas = pitchOutline(standard).filter(
      (line) =>
        line.points.length === 4 &&
        line.points.every((point) => Math.abs(point[1]) === PITCH.penaltyAreaWidth / 2),
    );
    expect(areas).toHaveLength(2);
  });
});

describe("onPitch", () => {
  it("accepts the centre and rejects a point well outside", () => {
    expect(onPitch({ x: 0, y: 0 }, standard)).toBe(true);
    expect(onPitch({ x: 60, y: 0 }, standard)).toBe(false);
    expect(onPitch({ x: 0, y: 40 }, standard)).toBe(false);
  });

  it("allows the small tolerance a clicked line needs", () => {
    expect(onPitch({ x: 53, y: 0 }, standard)).toBe(true);
    expect(onPitch({ x: 54.5, y: 0 }, standard)).toBe(false);
  });
});
