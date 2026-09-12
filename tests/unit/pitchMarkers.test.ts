import { describe, expect, it } from "vitest";
import { pickMarkers } from "@/features/pitch/markers";
import { normalizePoint, type Rect } from "@/lib/annotate/geometry";

/**
 * A letterboxed picture inside a wider stage — the layout that exposed the bug.
 * The picture is 431 px wide inside a 640 px stage, so it starts 104 px in.
 */
const rect: Rect = { x: 104, y: 0, w: 431, h: 242 };
const stageWidth = 640;

describe("pickMarkers", () => {
  it("puts a marker back exactly where the click landed", () => {
    const click = [stageWidth / 2 + 40, 90];
    const [imageU, imageV] = normalizePoint(
      { x: 0, y: 0, w: rect.w, h: rect.h },
      click[0] - rect.x,
      click[1] - rect.y,
    );

    const [marker] = pickMarkers([{ feature: "centre-spot", imageU, imageV }], rect);

    // The markers live in a box that is already positioned at rect.x / rect.y,
    // so adding the offset again here lands them a letterbox away from the click.
    expect(rect.x + marker.point[0]).toBeCloseTo(click[0]);
    expect(rect.y + marker.point[1]).toBeCloseTo(click[1]);
  });

  it("does not carry the picture's own offset", () => {
    const [topLeft] = pickMarkers([{ feature: "a", imageU: 0, imageV: 0 }], rect);
    const [bottomRight] = pickMarkers([{ feature: "b", imageU: 1, imageV: 1 }], rect);

    expect(topLeft.point).toEqual([0, 0]);
    expect(bottomRight.point[0]).toBeCloseTo(rect.w);
    expect(bottomRight.point[1]).toBeCloseTo(rect.h);
  });

  it("keeps the feature key so a marker can be traced to its pick", () => {
    const markers = pickMarkers(
      [
        { feature: "centre-spot", imageU: 0.5, imageV: 0.5 },
        { feature: "corner-left-top", imageU: 0.1, imageV: 0.1 },
      ],
      rect,
    );
    expect(markers.map((marker) => marker.feature)).toEqual(["centre-spot", "corner-left-top"]);
  });
});
