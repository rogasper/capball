import type { Point } from "@/lib/annotate/geometry";
import type { PitchSize } from "./pitchModel";

/**
 * The angled pitch view's geometry (FR-80.1, FR-80.2).
 *
 * The point of this module is that **picking is exact**, not approximate. A ray
 * through a screen pixel meets the ground plane in one place, and that place is
 * a pitch coordinate — no iteration, no tolerance, no nearest-marker guessing.
 * What a shallow camera angle costs is *precision*: one screen pixel covers more
 * ground the further away and the shallower the view, which is a number this
 * module can measure rather than a defect it has to hide (spike T10).
 *
 * Scene coordinates: `x` along the pitch, `z` across it, `y` up. A pitch metre
 * `(xM, yM)` is the scene point `(xM, 0, yM)`.
 *
 * Nothing here imports three.js: the maths is longhand so it can be tested, and
 * the test checks it against three's own camera and raycaster, which is the same
 * trick the pinhole camera plays in `shapePrimitives`.
 */

export type Vec3 = [number, number, number];
export type ScenePoint = { x: number; y: number; z: number };

export type CameraPose = {
  id: string;
  label: string;
  /** Camera position in scene coordinates. */
  eye: Vec3;
  /** What it looks at, on the ground. */
  target: Vec3;
  fovDeg: number;
  near: number;
  far: number;
};

/**
 * The two cameras R2 offers.
 *
 * Deliberately not a free orbit: looking at a pitch from inside the ground has no
 * analytical value, and a pose that can be anywhere cannot be checked. The field
 * of view is **derived** from the pitch rather than hand-tuned — hand-tuned
 * numbers were wrong by a factor of two on the first attempt, and a pose that
 * clips the pitch is a pose whose picking tests prove nothing.
 */
const POSE_ANGLES: { id: string; label: string; eye: Vec3; target: Vec3 }[] = [
  {
    id: "broadcast",
    label: "Broadcast — high behind the goal",
    // 24 m up and 78 m back: the familiar television angle.
    eye: [0, 24, -78],
    target: [0, 0, 6],
  },
  {
    id: "tactical",
    label: "Tactical — higher and steeper",
    eye: [0, 46, -52],
    target: [0, 0, 2],
  },
];

/**
 * The smallest field of view that still contains the whole pitch.
 *
 * Bisection rather than a formula: the constraint is "every corner projects
 * inside the frame", which is easy to test and awkward to invert. The result is
 * the tightest framing that fits, with a margin so a marker at a corner is not
 * clipped by the edge.
 */
export function fitPose(
  base: { id: string; label: string; eye: Vec3; target: Vec3 },
  size: PitchSize,
  aspect: number,
  margin = 0.06,
): CameraPose {
  const corners: Point[] = [
    [-size.lengthM / 2, -size.widthM / 2],
    [size.lengthM / 2, -size.widthM / 2],
    [size.lengthM / 2, size.widthM / 2],
    [-size.lengthM / 2, size.widthM / 2],
  ];
  const fits = (fovDeg: number): boolean =>
    corners.every((corner) => {
      const ndc = ndcOfGroundPoint({ ...base, fovDeg, near: 1, far: 400 }, corner, aspect);
      if (!ndc) return false;
      return Math.abs(ndc.x) <= 1 - margin && Math.abs(ndc.y) <= 1 - margin;
    });

  // A narrow view is "zoomed in" and will not fit; a wide one always does. The
  // search keeps `narrow` on the failing side and `wide` on the fitting side, and
  // returns a field of view that provably fits — the first attempt had this
  // backwards, and the corner test caught it.
  let narrow = 5;
  let wide = 120;
  for (let i = 0; i < 50; i++) {
    const middle = (narrow + wide) / 2;
    if (fits(middle)) wide = middle;
    else narrow = middle;
  }

  // Rounded up, because rounding down would leave it a hair too tight.
  return { ...base, fovDeg: Math.ceil(wide * 10) / 10, near: 1, far: 400 };
}

/** The poses, framed for the given pitch. */
export function cameraPosesFor(size: PitchSize, aspect: number): CameraPose[] {
  return POSE_ANGLES.map((angle) => fitPose(angle, size, aspect));
}

/** The default pitch's poses, for a caller that has no size to hand. */
export const CAMERA_POSES: CameraPose[] = cameraPosesFor({ lengthM: 105, widthM: 68 }, 16 / 9);

export function poseById(id: string): CameraPose {
  return CAMERA_POSES.find((pose) => pose.id === id) ?? CAMERA_POSES[0];
}

// Function declarations rather than arrow constants: the poses are fitted at
// module load, and a `const` helper defined below would still be in its temporal
// dead zone.
function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function normalise(v: Vec3): Vec3 {
  const length = Math.hypot(v[0], v[1], v[2]);
  return length < 1e-9 ? [0, 0, 0] : [v[0] / length, v[1] / length, v[2] / length];
}

/** The camera's basis: forward, right and up, in scene coordinates. */
export function cameraBasis(pose: CameraPose): { forward: Vec3; right: Vec3; up: Vec3 } {
  const forward = normalise(sub(pose.target, pose.eye));
  // `y` is up, so the horizon never degenerates for the poses this app offers.
  const right = normalise(cross(forward, [0, 1, 0]));
  const up = cross(right, forward);
  return { forward, right, up };
}

export type Ndc = { x: number; y: number };

/**
 * The ray through a screen point, in scene coordinates.
 *
 * `ndc` is the usual normalised device coordinate: `-1..1` on both axes, `y` up.
 * Normalising the direction makes the ground intersection a plain division, and
 * makes the result independent of the pitch's size.
 */
export function rayThrough(
  pose: CameraPose,
  ndc: Ndc,
  aspect: number,
): { origin: Vec3; dir: Vec3 } {
  const { forward, right, up } = cameraBasis(pose);
  const halfHeight = Math.tan((pose.fovDeg * Math.PI) / 360);
  const halfWidth = halfHeight * aspect;

  const dir = normalise([
    forward[0] + ndc.x * halfWidth * right[0] + ndc.y * halfHeight * up[0],
    forward[1] + ndc.x * halfWidth * right[1] + ndc.y * halfHeight * up[1],
    forward[2] + ndc.x * halfWidth * right[2] + ndc.y * halfHeight * up[2],
  ]);

  return { origin: pose.eye, dir };
}

/**
 * Where a screen point lands on the pitch, or `null` when the ray goes up.
 *
 * A ray that does not descend can never meet the ground: that is the horizon,
 * and it is reported rather than clamped to something plausible.
 */
export function groundPointFromNdc(pose: CameraPose, ndc: Ndc, aspect: number): Point | null {
  const { origin, dir } = rayThrough(pose, ndc, aspect);
  if (dir[1] >= -1e-9) return null;

  const t = -origin[1] / dir[1];
  return [origin[0] + t * dir[0], origin[2] + t * dir[2]];
}

/** The screen point a pitch position appears at, or `null` when behind the camera. */
export function ndcOfGroundPoint(pose: CameraPose, point: Point, aspect: number): Ndc | null {
  const { forward, right, up } = cameraBasis(pose);
  const v = sub([point[0], 0, point[1]], pose.eye);
  const depth = dot(v, forward);
  if (depth <= pose.near) return null;

  const halfHeight = Math.tan((pose.fovDeg * Math.PI) / 360);
  const halfWidth = halfHeight * aspect;
  return {
    x: dot(v, right) / (depth * halfWidth),
    y: dot(v, up) / (depth * halfHeight),
  };
}

/**
 * How much ground one screen pixel covers at a pitch position, in metres.
 *
 * Measured by moving one pixel and projecting the result, rather than by a
 * derivative that could be wrong in the same way the projection is. This is the
 * number that decides whether a click at an angle is honest (spike T10): a
 * precision of `m` metres per pixel turns a 3-pixel click into a `3m` metre error.
 */
export function metresPerPixel(
  pose: CameraPose,
  point: Point,
  aspect: number,
  pixelsWide: number,
): number | null {
  const centre = ndcOfGroundPoint(pose, point, aspect);
  if (!centre) return null;

  const step = 2 / pixelsWide;
  const neighbour = groundPointFromNdc(pose, { x: centre.x + step, y: centre.y }, aspect);
  if (!neighbour) return null;

  return Math.hypot(neighbour[0] - point[0], neighbour[1] - point[1]);
}

/** A grid of points across the pitch, for a measurement that is not one lucky sample. */
export function pitchSampleGrid(size: PitchSize, steps = 8): Point[] {
  const points: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    for (let j = 0; j <= steps; j++) {
      points.push([
        -size.lengthM / 2 + (size.lengthM * i) / steps,
        -size.widthM / 2 + (size.widthM * j) / steps,
      ]);
    }
  }
  return points;
}

export type PosePrecision = {
  pose: CameraPose;
  /** The worst metres-per-pixel anywhere on the pitch, and where it is worst. */
  worstMPerPx: number;
  worstAt: Point;
  /** The same for the far half, which is where a shallow camera loses precision. */
  worstFarMPerPx: number;
};

/**
 * The T10 measurement: how precise a click is at a pose, worst case.
 *
 * "Far" means the half of the pitch further from the camera, because that is
 * where this number gets worse and where a claim about it has to hold.
 */
export function measurePose(
  pose: CameraPose,
  size: PitchSize,
  aspect: number,
  pixelsWide: number,
): PosePrecision {
  let worstMPerPx = 0;
  let worstAt: Point = [0, 0];
  let worstFarMPerPx = 0;

  for (const point of pitchSampleGrid(size)) {
    const value = metresPerPixel(pose, point, aspect, pixelsWide);
    if (value === null) continue;
    if (value > worstMPerPx) {
      worstMPerPx = value;
      worstAt = point;
    }
    // The far half is the one behind the pitch centre, away from the camera.
    const awayFromCamera = pose.eye[2] < 0 ? point[1] > 0 : point[1] < 0;
    if (awayFromCamera && value > worstFarMPerPx) worstFarMPerPx = value;
  }

  return { pose, worstMPerPx, worstAt, worstFarMPerPx };
}
