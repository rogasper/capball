import { describe, expect, it } from "vitest";
import { boxGeometry, pathGeometry, twoPointGeometry } from "@/lib/annotate/geometry";
import {
  sortByLayer,
  toPrimitive,
  toPrimitives,
  visibleAnnotations,
} from "@/lib/annotate/primitives";
import { type Annotation, DEFAULT_STYLE, type ShapeKind } from "@/lib/annotate/types";
import type { WindowContext } from "@/lib/annotate/window";

const ctx: WindowContext = {
  anchorMs: 60_000,
  eventStartMs: 52_000,
  eventEndMs: 72_000,
  durationMs: 5_400_000,
};

function annotation(kind: ShapeKind, patch: Partial<Annotation> = {}): Annotation {
  return {
    id: 1,
    uid: "u1",
    eventId: 1,
    kind,
    windowMode: "moment",
    windowMs: 2_500,
    geometry: boxGeometry([0.1, 0.1], [0.3, 0.3]),
    style: { ...DEFAULT_STYLE },
    label: null,
    z: 0,
    ...patch,
  };
}

describe("toPrimitive", () => {
  it("passes a rectangle through as a box", () => {
    const primitive = toPrimitive(annotation("rect"));
    expect(primitive.kind).toBe("rect");
    if (primitive.kind !== "rect") return;
    expect(primitive.x).toBeCloseTo(0.1);
    expect(primitive.w).toBeCloseTo(0.2);
  });

  it("describes an ellipse by the same box", () => {
    const primitive = toPrimitive(annotation("ellipse"));
    expect(primitive.kind).toBe("ellipse");
  });

  it("takes text content from the label", () => {
    const primitive = toPrimitive(annotation("text", { label: "High press" }));
    expect(primitive.kind).toBe("text");
    if (primitive.kind !== "text") return;
    expect(primitive.text).toBe("High press");
    expect(primitive.fontSize).toBe(DEFAULT_STYLE.fontSize);
  });

  it("closes a polygon and fills nothing unless a fill was set", () => {
    const primitive = toPrimitive(
      annotation("polygon", {
        geometry: pathGeometry([
          [0.2, 0.2],
          [0.6, 0.2],
          [0.6, 0.6],
        ]),
      }),
    );
    expect(primitive.kind).toBe("path");
    if (primitive.kind !== "path") return;
    expect(primitive.closed).toBe(true);
    expect(primitive.smooth).toBe(false);
    expect(primitive.head).toBe(false);
    expect(primitive.fill).toBeNull();
  });

  it("smooths a freehand stroke and marks an arrow's head", () => {
    const freehand = toPrimitive(
      annotation("freehand", {
        geometry: pathGeometry([
          [0.2, 0.2],
          [0.4, 0.4],
          [0.6, 0.2],
        ]),
      }),
    );
    const arrow = toPrimitive(
      annotation("arrow", { geometry: twoPointGeometry([0.2, 0.2], [0.8, 0.8]) }),
    );

    expect(freehand.kind === "path" && freehand.smooth).toBe(true);
    expect(arrow.kind === "path" && arrow.head).toBe(true);
  });

  it("centres the rotation origin on the box", () => {
    const primitive = toPrimitive(annotation("rect"));
    expect(primitive.center[0]).toBeCloseTo(0.2);
    expect(primitive.center[1]).toBeCloseTo(0.2);
  });

  it("keeps the annotation id so a hit can be traced back", () => {
    expect(toPrimitive(annotation("rect", { id: 42 })).annotationId).toBe(42);
  });
});

describe("layer order", () => {
  const low = annotation("rect", { id: 1, z: 0 });
  const high = annotation("rect", { id: 2, z: 5 });
  const tie = annotation("rect", { id: 3, z: 0 });

  it("paints back to front by z, with the id breaking ties", () => {
    expect(sortByLayer([high, tie, low]).map((a) => a.id)).toEqual([1, 3, 2]);
  });

  it("does not reorder the array it was given", () => {
    const input = [high, low];
    sortByLayer(input);
    expect(input.map((a) => a.id)).toEqual([2, 1]);
  });

  it("shows only what its window covers", () => {
    // `long` spans the event's clip range; `elsewhere` is a half-second moment.
    const long = annotation("rect", { id: 4, windowMode: "event" });
    const elsewhere = annotation("rect", { id: 5, windowMode: "moment", windowMs: 1_000 });

    expect(visibleAnnotations([long, elsewhere], 10_000, ctx)).toEqual([]);
    expect(visibleAnnotations([long, elsewhere], 55_000, ctx).map((a) => a.id)).toEqual([4]);
    expect(visibleAnnotations([long, elsewhere], 60_000, ctx).map((a) => a.id)).toEqual([4, 5]);
  });

  it("builds primitives in paint order", () => {
    const primitives = toPrimitives([high, low], 60_000, ctx);
    expect(primitives.map((primitive) => primitive.annotationId)).toEqual([1, 2]);
  });
});
