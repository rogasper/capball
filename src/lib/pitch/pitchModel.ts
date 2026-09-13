/**
 * The pitch in metres (plans/technical-design-R1.md §6.1).
 *
 * Origin at the centre of the pitch, `+x` along the long axis and `+y` across
 * it, so a 105×68 pitch spans `x ∈ [-52.5, 52.5]` and `y ∈ [-34, 34]`. `+x`
 * increases to the right of the canonical pitch diagram and `+y` increases
 * downward, which is what makes the top-down view read naturally.
 *
 * Length and width are per-calibration values because they change what a stored
 * metre means. Everything else is derived from the Laws of the Game.
 */

/** Law-fixed dimensions, in metres. */
export const PITCH = {
  goalWidth: 7.32,
  penaltyAreaWidth: 40.32,
  penaltyAreaDepth: 16.5,
  goalAreaWidth: 18.32,
  goalAreaDepth: 5.5,
  centreCircleRadius: 9.15,
  penaltySpotFromGoalLine: 11,
  cornerArcRadius: 1,
  lineWidth: 0.12,
} as const;

export const DEFAULT_PITCH_LENGTH_M = 105;
export const DEFAULT_PITCH_WIDTH_M = 68;

export type PitchSize = { lengthM: number; widthM: number };

export type PitchFeature = {
  /** Stable key, stored with the point. */
  key: string;
  label: string;
  group: string;
  x: number;
  y: number;
};

export type PitchLine = { points: [number, number][] };

function half(size: PitchSize) {
  return { x: size.lengthM / 2, y: size.widthM / 2 };
}

/**
 * The named points a user can calibrate against.
 *
 * A feature's coordinates are fixed by the Laws, so picking the wrong label is
 * what makes a calibration wrong — which is exactly what the outline overlay is
 * there to reveal (FR-30.2). The order is the order they are offered in: the
 * spots and area corners first, because they are the easiest to click precisely
 * on a broadcast frame.
 */
export function pitchFeatures(size: PitchSize): PitchFeature[] {
  const { x, y } = half(size);
  const spot = PITCH.penaltySpotFromGoalLine;
  const paHalf = PITCH.penaltyAreaWidth / 2;
  const paFront = x - PITCH.penaltyAreaDepth;
  const gaHalf = PITCH.goalAreaWidth / 2;
  const gaFront = x - PITCH.goalAreaDepth;
  const post = PITCH.goalWidth / 2;
  const circle = PITCH.centreCircleRadius;

  return [
    { key: "centre-spot", label: "Centre spot", group: "Centre", x: 0, y: 0 },
    {
      key: "left-penalty-spot",
      label: "Left penalty spot",
      group: "Left penalty area",
      x: -(x - spot),
      y: 0,
    },
    {
      key: "right-penalty-spot",
      label: "Right penalty spot",
      group: "Right penalty area",
      x: x - spot,
      y: 0,
    },
    {
      key: "left-pa-front-top",
      label: "Left area, top corner",
      group: "Left penalty area",
      x: -paFront,
      y: -paHalf,
    },
    {
      key: "left-pa-front-bottom",
      label: "Left area, bottom corner",
      group: "Left penalty area",
      x: -paFront,
      y: paHalf,
    },
    {
      key: "right-pa-front-top",
      label: "Right area, top corner",
      group: "Right penalty area",
      x: paFront,
      y: -paHalf,
    },
    {
      key: "right-pa-front-bottom",
      label: "Right area, bottom corner",
      group: "Right penalty area",
      x: paFront,
      y: paHalf,
    },
    {
      key: "left-ga-front-top",
      label: "Left six-yard, top corner",
      group: "Left penalty area",
      x: -gaFront,
      y: -gaHalf,
    },
    {
      key: "left-ga-front-bottom",
      label: "Left six-yard, bottom corner",
      group: "Left penalty area",
      x: -gaFront,
      y: gaHalf,
    },
    {
      key: "right-ga-front-top",
      label: "Right six-yard, top corner",
      group: "Right penalty area",
      x: gaFront,
      y: -gaHalf,
    },
    {
      key: "right-ga-front-bottom",
      label: "Right six-yard, bottom corner",
      group: "Right penalty area",
      x: gaFront,
      y: gaHalf,
    },
    {
      key: "left-pa-goal-line-top",
      label: "Left area on the goal line, top",
      group: "Left penalty area",
      x: -x,
      y: -paHalf,
    },
    {
      key: "left-pa-goal-line-bottom",
      label: "Left area on the goal line, bottom",
      group: "Left penalty area",
      x: -x,
      y: paHalf,
    },
    {
      key: "right-pa-goal-line-top",
      label: "Right area on the goal line, top",
      group: "Right penalty area",
      x,
      y: -paHalf,
    },
    {
      key: "right-pa-goal-line-bottom",
      label: "Right area on the goal line, bottom",
      group: "Right penalty area",
      x,
      y: paHalf,
    },
    {
      key: "left-post-top",
      label: "Left goal, top post",
      group: "Left penalty area",
      x: -x,
      y: -post,
    },
    {
      key: "left-post-bottom",
      label: "Left goal, bottom post",
      group: "Left penalty area",
      x: -x,
      y: post,
    },
    {
      key: "right-post-top",
      label: "Right goal, top post",
      group: "Right penalty area",
      x,
      y: -post,
    },
    {
      key: "right-post-bottom",
      label: "Right goal, bottom post",
      group: "Right penalty area",
      x,
      y: post,
    },
    { key: "halfway-top", label: "Halfway line, top touchline", group: "Centre", x: 0, y: -y },
    { key: "halfway-bottom", label: "Halfway line, bottom touchline", group: "Centre", x: 0, y },
    { key: "circle-left", label: "Centre circle, left", group: "Centre", x: -circle, y: 0 },
    { key: "circle-right", label: "Centre circle, right", group: "Centre", x: circle, y: 0 },
    { key: "circle-top", label: "Centre circle, top", group: "Centre", x: 0, y: -circle },
    { key: "circle-bottom", label: "Centre circle, bottom", group: "Centre", x: 0, y: circle },
    {
      key: "left-pa-arc",
      label: "Left penalty arc, ahead of the spot",
      group: "Left penalty area",
      x: -(x - spot - circle),
      y: 0,
    },
    {
      key: "right-pa-arc",
      label: "Right penalty arc, ahead of the spot",
      group: "Right penalty area",
      x: x - spot - circle,
      y: 0,
    },
    { key: "corner-left-top", label: "Corner, left top", group: "Corners", x: -x, y: -y },
    { key: "corner-right-top", label: "Corner, right top", group: "Corners", x, y: -y },
    { key: "corner-left-bottom", label: "Corner, left bottom", group: "Corners", x: -x, y },
    { key: "corner-right-bottom", label: "Corner, right bottom", group: "Corners", x, y },
  ];
}

/**
 * The order the flow walks through, chosen for spread rather than for
 * convenience: a calibration is only as good as how far apart its points are.
 */
export const RECOMMENDED_FEATURE_KEYS = [
  "centre-spot",
  "left-penalty-spot",
  "right-penalty-spot",
  "left-pa-front-top",
  "right-pa-front-bottom",
  "left-pa-front-bottom",
  "right-pa-front-top",
  "halfway-top",
  "halfway-bottom",
] as const;

export function findFeature(size: PitchSize, key: string): PitchFeature | undefined {
  return pitchFeatures(size).find((feature) => feature.key === key);
}

/** Sample a circle into a closed polyline, so a projection can bend it. */
function circlePoints(cx: number, cy: number, radius: number, steps = 48): [number, number][] {
  const points: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const angle = (i / steps) * Math.PI * 2;
    points.push([cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)]);
  }
  return points;
}

function arcPoints(
  cx: number,
  cy: number,
  radius: number,
  fromRad: number,
  toRad: number,
  steps = 24,
): [number, number][] {
  const points: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const angle = fromRad + ((toRad - fromRad) * i) / steps;
    points.push([cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)]);
  }
  return points;
}

/**
 * The pitch as lines, in metres.
 *
 * Circles and arcs are sampled into polylines on purpose: a circle projects to
 * a general conic under a homography, which our primitive set cannot express as
 * an ellipse. A sampled polyline projects exactly, point by point.
 *
 * Nothing here is drawn beyond the Laws. Goals used to be sketched two metres
 * behind the goal line as an orientation cue, but under a projection those
 * invented boxes read as pitch markings and made a tight calibration look more
 * broken than it was — the outline now stops at the goal line, where the real
 * markings stop.
 */
export function pitchOutline(size: PitchSize): PitchLine[] {
  const { x, y } = half(size);
  const spot = PITCH.penaltySpotFromGoalLine;
  const paHalf = PITCH.penaltyAreaWidth / 2;
  const paFront = x - PITCH.penaltyAreaDepth;
  const gaHalf = PITCH.goalAreaWidth / 2;
  const gaFront = x - PITCH.goalAreaDepth;
  const circle = PITCH.centreCircleRadius;

  const lines: PitchLine[] = [
    // Boundary and halfway.
    {
      points: [
        [-x, -y],
        [x, -y],
        [x, y],
        [-x, y],
        [-x, -y],
      ],
    },
    {
      points: [
        [0, -y],
        [0, y],
      ],
    },
    // Penalty areas.
    {
      points: [
        [-x, -paHalf],
        [-paFront, -paHalf],
        [-paFront, paHalf],
        [-x, paHalf],
      ],
    },
    {
      points: [
        [x, -paHalf],
        [paFront, -paHalf],
        [paFront, paHalf],
        [x, paHalf],
      ],
    },
    // Goal areas.
    {
      points: [
        [-x, -gaHalf],
        [-gaFront, -gaHalf],
        [-gaFront, gaHalf],
        [-x, gaHalf],
      ],
    },
    {
      points: [
        [x, -gaHalf],
        [gaFront, -gaHalf],
        [gaFront, gaHalf],
        [x, gaHalf],
      ],
    },
    // Centre circle and both penalty arcs.
    { points: circlePoints(0, 0, circle) },
    { points: arcPoints(-(x - spot), 0, circle, -0.93, 0.93) },
    { points: arcPoints(x - spot, 0, circle, Math.PI - 0.93, Math.PI + 0.93) },
    // Corner arcs, one per corner.
    { points: arcPoints(-x, -y, PITCH.cornerArcRadius, 0, Math.PI / 2) },
    { points: arcPoints(x, -y, PITCH.cornerArcRadius, Math.PI / 2, Math.PI) },
    { points: arcPoints(x, y, PITCH.cornerArcRadius, Math.PI, 1.5 * Math.PI) },
    { points: arcPoints(-x, y, PITCH.cornerArcRadius, 1.5 * Math.PI, 2 * Math.PI) },
  ];

  return lines;
}

/** Whether a pitch position is on the playing surface, with a small tolerance. */
export function onPitch(position: { x: number; y: number }, size: PitchSize, marginM = 1): boolean {
  const { x, y } = half(size);
  return Math.abs(position.x) <= x + marginM && Math.abs(position.y) <= y + marginM;
}
