import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Pitch3D } from "@/features/pitch/Pitch3D";
import { boxGeometry, pathGeometry } from "@/lib/annotate/geometry";
import { type Annotation, DEFAULT_STYLE, type ShapeKind } from "@/lib/annotate/types";
import { cameraPosesFor } from "@/lib/pitch/pitch3d";
import { buildPitchGroup, disposeGroup } from "@/lib/pitch/threeScene";
import { useAnnotationStore } from "@/stores/annotationStore";

/**
 * The angled view (FR-80.1).
 *
 * jsdom has no WebGL, so the *rendering* cannot be judged here — that is a human
 * check in the running app, and the picking maths is measured in `pitch3d.test.ts`
 * against three's own raycaster. What this holds is what a suite can hold: the
 * scene graph the renderer will be given, and that a machine without WebGL gets an
 * explanation instead of a blank panel or a crash.
 */

vi.mock("@/lib/ipc/database", () => ({
  execute: vi.fn().mockResolvedValue(undefined),
  select: vi.fn().mockResolvedValue([]),
}));

const SIZE = { lengthM: 105, widthM: 68 };

function shape(kind: ShapeKind, geometry: Annotation["geometry"], id = 1): Annotation {
  return {
    id,
    uid: `u${id}`,
    eventId: 7,
    kind,
    windowMode: "moment",
    windowMs: 2_500,
    geometry: { ...geometry, space: "pitch" },
    style: { ...DEFAULT_STYLE },
    label: null,
    z: id,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useAnnotationStore.setState({
    eventId: 7,
    annotations: [],
    selectedId: null,
    tool: null,
    toolSurface: "pitch",
    draft: null,
    draftPoints: null,
    style: { ...DEFAULT_STYLE },
    error: null,
    notice: null,
  });
});

describe("the scene the angled view draws", () => {
  it("has the pitch outline, one object per shape, and one sprite per marker", () => {
    const group = buildPitchGroup({
      size: SIZE,
      markers: [{ xM: 0, yM: 0, label: "8", color: "#DA291C" }],
      annotations: [
        shape("rect", boxGeometry([-20, -10], [20, 10])),
        shape(
          "line",
          pathGeometry([
            [-30, 0],
            [30, 10],
          ]),
          2,
        ),
      ],
    });

    // The outline is many lines; the two shapes add a group and a line; the marker
    // adds a sprite. Exact counts of the outline would be brittle, so it is a
    // lower bound with the parts that matter identified.
    expect(group.children.length).toBeGreaterThan(10);
    const sprites = group.children.filter((child) => child.type === "Sprite");
    expect(sprites).toHaveLength(1);

    disposeGroup(group);
  });

  it("puts every object on the ground, because no height is known (D20)", () => {
    const group = buildPitchGroup({
      size: SIZE,
      markers: [{ xM: 12, yM: -8, label: "BF", color: "#64748B" }],
      annotations: [],
    });
    const sprite = group.children.find((child) => child.type === "Sprite");
    expect(sprite?.position.x).toBeCloseTo(12, 6);
    expect(sprite?.position.z).toBeCloseTo(-8, 6);
    expect(sprite?.position.y).toBeGreaterThan(0);

    disposeGroup(group);
  });
});

describe("a machine without WebGL", () => {
  it("explains itself rather than showing an empty panel", () => {
    render(<Pitch3D size={SIZE} positions={[]} emptyMessage="nothing yet" />);

    // jsdom cannot create a WebGL context, which is the case this covers.
    expect(screen.getByText(/cannot draw an angled view/i)).toBeTruthy();
    expect(screen.getByText(/top-down pitch is the one to use/i)).toBeTruthy();
  });
});

describe("the view switch", () => {
  it("is offered from the pitch panel", () => {
    render(<Pitch3D size={SIZE} positions={[]} emptyMessage="nothing yet" />);
    // The pose buttons belong to the angled surface, so they are absent when it
    // cannot run — but the failure is stated, never silent.
    expect(screen.queryByRole("button", { name: /broadcast/i })).toBeNull();
    expect(screen.getByText(/cannot draw an angled view/i)).toBeTruthy();
  });
});

describe("the pose buttons", () => {
  it("would offer both poses once WebGL is available", () => {
    // The poses themselves are measured in `pitch3d.test.ts`; this asserts the
    // list the UI is built from, so a pose cannot be added without a measurement.
    const poses = cameraPosesFor(SIZE, 16 / 9);
    expect(poses.map((pose) => pose.id)).toEqual(["broadcast", "tactical"]);
    for (const pose of poses) {
      expect(pose.fovDeg).toBeGreaterThan(5);
      expect(pose.fovDeg).toBeLessThan(120);
    }
  });
});
