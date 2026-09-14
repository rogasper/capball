import { PerspectiveCamera, Raycaster, Vector2, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import {
  CAMERA_POSES,
  type CameraPose,
  cameraBasis,
  groundPointFromNdc,
  measurePose,
  metresPerPixel,
  type Ndc,
  ndcOfGroundPoint,
  pitchSampleGrid,
  poseById,
} from "@/lib/pitch/pitch3d";

/**
 * The angled view's picking, measured rather than asserted (T10, FR-80.1, FR-80.2).
 *
 * Three claims, and each is checked against something that is not this module:
 *
 * 1. The camera maths agrees with **three.js**, which will draw the scene. That is
 *    the check that matters: if my longhand basis disagreed with the renderer, a
 *    click would land beside the shape it appears to be on — the failure mode that
 *    makes an angled drawing surface worthless.
 * 2. Each pose frames the whole pitch, so nothing is off-screen at a fixed pose.
 * 3. A click keeps its precision across the pitch, worst case, in metres per pixel.
 *    That number is what T10 exists to produce: 3 pixels of clicking is 3 metres-per-
 *    pixel of error on the ground.
 */

const SIZE = { lengthM: 105, widthM: 68 };
const ASPECT = 16 / 9;
const PIXELS_WIDE = 960;

function threeCamera(pose: (typeof CAMERA_POSES)[number]) {
  const camera = new PerspectiveCamera(pose.fovDeg, ASPECT, pose.near, pose.far);
  camera.position.set(...pose.eye);
  camera.lookAt(new Vector3(...pose.target));
  camera.updateMatrixWorld(true);
  return camera;
}

/** The ground point three's own raycaster finds for a screen point. */
function threeGroundPoint(pose: (typeof CAMERA_POSES)[number], ndc: Ndc): [number, number] | null {
  const camera = threeCamera(pose);
  const raycaster = new Raycaster();
  raycaster.setFromCamera(new Vector2(ndc.x, ndc.y), camera);

  const origin = raycaster.ray.origin;
  const dir = raycaster.ray.direction;
  if (dir.y >= -1e-9) return null;
  const t = -origin.y / dir.y;
  return [origin.x + t * dir.x, origin.z + t * dir.z];
}

describe("the camera agrees with three.js", () => {
  for (const pose of CAMERA_POSES) {
    it(`picks the same ground point as three at the "${pose.id}" pose`, () => {
      const samples: Ndc[] = [
        { x: 0, y: 0 },
        { x: -0.5, y: -0.3 },
        { x: 0.6, y: 0.2 },
        { x: 0.2, y: -0.6 },
      ];

      for (const ndc of samples) {
        const mine = groundPointFromNdc(pose, ndc, ASPECT);
        const theirs = threeGroundPoint(pose, ndc);
        expect(mine).not.toBeNull();
        expect(theirs).not.toBeNull();
        if (!mine || !theirs) continue;
        expect(mine[0]).toBeCloseTo(theirs[0], 6);
        expect(mine[1]).toBeCloseTo(theirs[1], 6);
      }
    });

    it(`projects the same screen point as three at the "${pose.id}" pose`, () => {
      const camera = threeCamera(pose);
      for (const point of pitchSampleGrid(SIZE, 4)) {
        const mine = ndcOfGroundPoint(pose, point, ASPECT);
        if (!mine) continue;

        const projected = new Vector3(point[0], 0, point[1]).project(camera);
        expect(projected.x).toBeCloseTo(mine.x, 5);
        expect(projected.y).toBeCloseTo(mine.y, 5);
      }
    });
  }
});

describe("the poses are fitted to the pitch", () => {
  for (const pose of CAMERA_POSES) {
    it(`shows every corner, with room to spare, at the "${pose.id}" pose`, () => {
      const corners: [number, number][] = [
        [-SIZE.lengthM / 2, -SIZE.widthM / 2],
        [SIZE.lengthM / 2, -SIZE.widthM / 2],
        [SIZE.lengthM / 2, SIZE.widthM / 2],
        [-SIZE.lengthM / 2, SIZE.widthM / 2],
      ];

      for (const corner of corners) {
        const ndc = ndcOfGroundPoint(pose, corner, ASPECT);
        expect(ndc).not.toBeNull();
        if (!ndc) continue;
        // Inside the frame, with a little air so a marker at a corner is visible.
        expect(Math.abs(ndc.x)).toBeLessThan(0.98);
        expect(Math.abs(ndc.y)).toBeLessThan(0.98);
      }
    });
  }
});

describe("T10: what a click is worth at an angle", () => {
  it("keeps precision across the pitch at every pose, and reports the figures", () => {
    for (const pose of CAMERA_POSES) {
      const measured = measurePose(pose, SIZE, ASPECT, PIXELS_WIDE);
      console.log(
        `T10: "${pose.id}" → worst ${measured.worstMPerPx.toFixed(3)} m per pixel at ` +
          `(${measured.worstAt[0].toFixed(0)}, ${measured.worstAt[1].toFixed(0)}) m; ` +
          `far half ${measured.worstFarMPerPx.toFixed(3)} m per pixel`,
      );

      // The band is derived, not tuned: a sloppy 3-pixel click must stay inside a
      // metre on the ground, which is roughly what R1's careful picking achieves on
      // the frame (T8). 3 × 0.35 = 1.05 m, so 0.35 is the ceiling; a pose shallow
      // enough to break that would be a pose this view must not offer.
      expect(measured.worstMPerPx).toBeLessThan(0.35);
      expect(measured.worstFarMPerPx).toBeLessThan(0.35);
      expect(measured.worstMPerPx * 3).toBeLessThan(1.1);
    }
  });

  it("is worse at a shallow angle, which is why the poses are steep", () => {
    const steep = metresPerPixel(poseById("tactical"), [0, 30], ASPECT, PIXELS_WIDE);
    const shallow = metresPerPixel(poseById("broadcast"), [0, 30], ASPECT, PIXELS_WIDE);
    expect(steep).not.toBeNull();
    expect(shallow).not.toBeNull();
    if (steep === null || shallow === null) return;
    expect(steep).toBeLessThan(shallow);
  });
});

describe("rays that meet nothing", () => {
  it("says nothing for a ray that does not descend, instead of clamping it", () => {
    // A camera looking at the horizon: the centre of the frame is level, so every
    // ray is horizontal and there is no ground intersection to invent.
    const level: CameraPose = {
      ...poseById("broadcast"),
      eye: [0, 10, -78],
      target: [0, 10, 6],
    };
    expect(groundPointFromNdc(level, { x: 0, y: 0 }, ASPECT)).toBeNull();
    expect(groundPointFromNdc(level, { x: 0.5, y: 0.2 }, ASPECT)).toBeNull();

    // A pose that frames the pitch does look down, so the near touchline has an
    // answer and the ray is not simply always refused.
    expect(groundPointFromNdc(poseById("broadcast"), { x: 0, y: -0.5 }, ASPECT)).not.toBeNull();
  });

  it("has an orthonormal basis at every pose", () => {
    for (const pose of CAMERA_POSES) {
      const { forward, right, up } = cameraBasis(pose);
      const length = (v: number[]) => Math.hypot(v[0], v[1], v[2]);
      expect(length(forward)).toBeCloseTo(1, 9);
      expect(length(right)).toBeCloseTo(1, 9);
      expect(length(up)).toBeCloseTo(1, 9);
      expect(forward[0] * right[0] + forward[1] * right[1] + forward[2] * right[2]).toBeCloseTo(
        0,
        9,
      );
      expect(up[0] * right[0] + up[1] * right[1] + up[2] * right[2]).toBeCloseTo(0, 9);
    }
  });
});
