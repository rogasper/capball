import { describe, expect, it } from "vitest";
import { pathGeometry, simplifyPath } from "@/lib/annotate/geometry";
import { toPrimitive, toPrimitives } from "@/lib/annotate/primitives";
import { type Annotation, DEFAULT_STYLE, type ShapeKind } from "@/lib/annotate/types";
import type { WindowContext } from "@/lib/annotate/window";
import { renderPrimitives } from "@/lib/render/canvas";
import { patternSegments } from "@/lib/render/pattern";

/**
 * The canvas repaint budget (T6, NFR-21).
 *
 * Honest limit, stated up front: jsdom does not rasterise a canvas, so the actual
 * paint cannot be timed here. What *is* measured is the work the app does per
 * repaint — generating the primitive list from 100 shapes (including a long
 * freehand stroke) and issuing the canvas operations — because that is the part
 * that can regress silently when someone makes generation quadratic.
 *
 * The remainder of the budget argument is structural and enforced elsewhere: the
 * drawing layer repaints on change, not on a timer, and the playhead subscription
 * only triggers a repaint when a shape's window opens or closes.
 */

const CONTEXT: WindowContext = {
  anchorMs: 100_000,
  eventStartMs: 92_000,
  eventEndMs: 112_000,
  durationMs: 861_737,
};

const KINDS: ShapeKind[] = ["arrow", "line", "rect", "ellipse", "polygon", "freehand", "text"];

/** A long freehand stroke, as it arrives from the pointer before simplification. */
function longStroke(points = 2_000): [number, number][] {
  return Array.from({ length: points }, (_, index) => {
    const angle = (index / points) * Math.PI * 8;
    const radius = 0.1 + (index / points) * 0.35;
    return [0.5 + radius * Math.cos(angle), 0.5 + radius * Math.sin(angle)] as [number, number];
  });
}

function hundredShapes(): Annotation[] {
  const freehand = simplifyPath(longStroke(), 0.002);

  return Array.from({ length: 100 }, (_, index) => {
    const kind = KINDS[index % KINDS.length] as ShapeKind;
    return {
      id: index + 1,
      uid: `uid-${index}`,
      eventId: 1,
      kind,
      // Everything visible for the whole event, the worst case for the visible
      // set: no shape drops out, so a repaint always draws all hundred.
      windowMode: "event",
      windowMs: 2_500,
      geometry:
        kind === "freehand"
          ? pathGeometry(freehand)
          : { x: 0.1 + (index % 10) * 0.08, y: (index % 7) * 0.1, w: 0.06, h: 0.05, rotation: 0 },
      style: { ...DEFAULT_STYLE },
      label: kind === "text" ? `label ${index}` : null,
      z: index,
    } satisfies Annotation;
  });
}

/** A recording context: counts the operations a real canvas would receive. */
function recordingContext() {
  let operations = 0;
  const count = () => {
    operations += 1;
  };
  const context = new Proxy(
    {},
    {
      get(_target, property) {
        if (property === "operations") return operations;
        if (property === "then") return undefined;
        return typeof property === "string" && property.startsWith("__") ? undefined : count;
      },
      set() {
        return true;
      },
    },
  );
  return context as unknown as Parameters<typeof renderPrimitives>[1] & { operations: number };
}

describe("the repaint budget at 100 shapes", () => {
  const shapes = hundredShapes();

  it("generates the primitive list well inside a frame, and reports the figure", () => {
    const runs = 200;
    // Warm up, so the first-call cost is not the number recorded.
    toPrimitives(shapes, 100_000, CONTEXT);

    const started = performance.now();
    for (let i = 0; i < runs; i++) toPrimitives(shapes, 100_000, CONTEXT);
    const perRunMs = (performance.now() - started) / runs;

    // A 60 fps frame is 16.7 ms; generating the list is expected to be a small
    // fraction of one, and this bound fails loudly if generation goes quadratic.
    console.log(
      `T6: ${shapes.length} shapes (incl. a ${simplifyPath(longStroke(), 0.002).length}-point freehand) → primitive list in ${perRunMs.toFixed(3)} ms`,
    );
    expect(perRunMs).toBeLessThan(4);
  });

  it("issues a bounded number of canvas operations for the same set", () => {
    const context = recordingContext();
    renderPrimitives(toPrimitives(shapes, 100_000, CONTEXT), context, 1920, 1080);

    console.log(
      `T6: one full repaint of ${shapes.length} shapes → ${context.operations} canvas operations`,
    );
    // save/restore per shape is four calls by itself, so a hundred shapes plus
    // their geometry cannot be a handful — but it must not be unbounded either.
    expect(context.operations).toBeGreaterThan(100);
    expect(context.operations).toBeLessThan(50_000);
  });
});

describe("the cost of a hatched zone (T11, FR-20.12, NFR-40)", () => {
  /** The picture area of a full-frame zone at 1920×1080, which is the worst case. */
  const FULL_FRAME = { x: 38, y: 22, w: 1_843, h: 1_037 };

  function hatchedZone(pattern: "hatch" | "crossHatch", scale: number): Annotation {
    return {
      id: 1,
      uid: "u1",
      eventId: 1,
      kind: "rect",
      // Visible for the whole event, so the pattern is always on screen.
      windowMode: "event",
      windowMs: 2_500,
      geometry: { x: 0.02, y: 0.02, w: 0.96, h: 0.96, rotation: 0 },
      style: { ...DEFAULT_STYLE, fill: "#4C8DFF33", fillPattern: pattern, patternScale: scale },
      label: null,
      z: 0,
    };
  }

  it("generates a full-frame pattern well inside a frame, and reports the figure", () => {
    const runs = 200;
    // Warm up, so the first-call cost is not the number recorded.
    patternSegments(FULL_FRAME, 19.2, -Math.PI / 4, "hatch");

    const started = performance.now();
    let segments = 0;
    for (let i = 0; i < runs; i++) {
      segments = patternSegments(FULL_FRAME, 19.2, -Math.PI / 4, "hatch").length;
    }
    const perRunMs = (performance.now() - started) / runs;

    console.log(
      `T11: a full-frame hatch at the finest UI spacing → ${segments} lines in ${perRunMs.toFixed(3)} ms`,
    );
    expect(perRunMs).toBeLessThan(4);
    // The measurement found 111 lines; this bound is the guarantee, not the figure.
    expect(segments).toBeLessThan(200);
  });

  it("keeps the smallest spacing inside the line cap", () => {
    // 0.002 of 1920 px is under 4 px apart, which the UI does not offer but a
    // stored style may still hold: the cap has to hold anyway.
    const context = recordingContext();
    renderPrimitives([toPrimitive(hatchedZone("crossHatch", 0.002))], context, 1920, 1080);

    console.log(`T11: the worst-case cross-hatch → ${context.operations} canvas operations`);
    expect(context.operations).toBeLessThan(3_000);
  });
});
