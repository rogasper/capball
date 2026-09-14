import {
  BufferGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Line,
  LineBasicMaterial,
  LineLoop,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  Shape,
  ShapeGeometry,
  Sprite,
  SpriteMaterial,
} from "three";
import type { Annotation } from "@/lib/annotate/types";
import { type PitchSize, pitchOutline } from "./pitchModel";
import { shapeOutline } from "./shapePrimitives";

/**
 * The angled view's scene (FR-80.1).
 *
 * One function builds the scene, and two surfaces use it: the screen (a
 * `WebGLRenderer` on a canvas in the panel) and, later, an offscreen render for an
 * exported inset. That is the same reasoning D18 uses for the frame — a second
 * builder would eventually disagree with the first about where something is.
 *
 * Scene coordinates: `x` along the pitch, `z` across it, `y` up. A pitch metre
 * `(xM, yM)` is `(xM, 0, yM)`, which is exactly the space `pitch3d.ts` picks in,
 * so a click and a drawn shape cannot disagree about the ground.
 *
 * No height is invented anywhere: every object sits on the plane at `y = 0`, a
 * hair above it so lines and fills never z-fight. There are no player bodies and
 * no ball, because a single camera cannot supply a height (D20).
 */

/** Just above the plane, so a line drawn on it is never hidden by it. */
const LIFT = 0.03;
/** How high a marker floats, in metres, so it reads as a label rather than a spot. */
const MARKER_LIFT = 1.4;
const MARKER_SCALE_M = 5;
const MARKER_PIXELS = 128;

const LINE_COLOUR = 0x94a3b8;

export type SceneMarker = {
  xM: number;
  yM: number;
  /** The shirt number, or the player's initials — whatever the marker should say. */
  label: string;
  color: string;
};

/** A canvas texture for one marker, or `null` where there is no 2D context (jsdom). */
function markerTexture(label: string, color: string): CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = MARKER_PIXELS;
  canvas.height = MARKER_PIXELS;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const centre = MARKER_PIXELS / 2;
  ctx.beginPath();
  ctx.arc(centre, centre, centre - 6, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = "#ffffff";
  ctx.stroke();

  // The number is drawn white over the team colour, and the halo the top-down view
  // uses is unnecessary here: a sprite has no surface behind it to fight.
  ctx.font = `600 ${Math.round(MARKER_PIXELS * 0.42)}px Inter, system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#ffffff";
  ctx.fillText(label, centre, centre + 2);

  const texture = new CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

/**
 * A line's geometry from pitch points.
 *
 * WebGL draws every line one pixel wide whatever `linewidth` says, so the
 * thickness of a shape's outline is not a knob here — the top-down view is where
 * line weight is meaningful, and this view is about the laid-out shape.
 */
function lineGeometry(points: [number, number][], lift = LIFT): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new Float32BufferAttribute(
      points.flatMap(([xM, yM]) => [xM, lift, yM]),
      3,
    ),
  );
  return geometry;
}

function shapeMesh(annotation: Annotation): Object3D | null {
  const outline = shapeOutline(annotation.geometry, annotation.kind);
  if (!outline || outline.points.length < 2) return null;

  const group = new Group();
  const stroke = new Color(annotation.style.stroke);

  if (outline.closed && outline.points.length >= 3) {
    // A filled region, when the shape has a fill. The pattern itself is not drawn
    // in the angled view — a hatch on a perspective plane is a texture problem —
    // and the top-down view is where a pattern is read (stated in the design).
    if (annotation.style.fill) {
      const shape = new Shape();
      outline.points.forEach(([xM, yM], index) => {
        if (index === 0) shape.moveTo(xM, yM);
        else shape.lineTo(xM, yM);
      });
      shape.closePath();

      const geometry = new ShapeGeometry(shape);
      // `ShapeGeometry` builds in the XY plane, so the whole mesh is laid down.
      geometry.rotateX(Math.PI / 2);
      geometry.translate(0, LIFT, 0);
      const material = new MeshBasicMaterial({
        color: new Color(annotation.style.fill),
        transparent: true,
        opacity: Math.min(0.45, annotation.style.opacity),
        side: DoubleSide,
        depthWrite: false,
      });
      group.add(new Mesh(geometry, material));
    }

    const loop = new LineLoop(
      lineGeometry(outline.points),
      new LineBasicMaterial({ color: stroke }),
    );
    group.add(loop);
  } else {
    const line = new Line(lineGeometry(outline.points), new LineBasicMaterial({ color: stroke }));
    group.add(line);
  }

  // An arrow without a head is just a line, so the head is drawn where the shape
  // says it points — on the ground, with no height implied.
  if (outline.head && outline.points.length >= 2) {
    const last = outline.points[outline.points.length - 1];
    const previous = outline.points[outline.points.length - 2];
    const head = new Mesh(new ConeGeometry(1.1, 2.4, 12), new MeshBasicMaterial({ color: stroke }));
    head.position.set(last[0], LIFT + 0.2, last[1]);
    head.rotateX(Math.PI / 2);
    head.lookAt(previous[0], LIFT + 0.2, previous[1]);
    head.rotateX(-Math.PI / 2);
    group.add(head);
  }

  return group;
}

export function buildPitchGroup(input: {
  size: PitchSize;
  markers: SceneMarker[];
  annotations: Annotation[];
}): Group {
  const group = new Group();

  const outlineMaterial = new LineBasicMaterial({ color: LINE_COLOUR });
  for (const line of pitchOutline(input.size)) {
    group.add(new Line(lineGeometry(line.points), outlineMaterial));
  }

  for (const annotation of input.annotations) {
    const mesh = shapeMesh(annotation);
    if (mesh) group.add(mesh);
  }

  for (const marker of input.markers) {
    const texture = markerTexture(marker.label, marker.color);
    const sprite = new Sprite(
      new SpriteMaterial({ map: texture ?? null, transparent: true, depthTest: false }),
    );
    sprite.position.set(marker.xM, MARKER_LIFT, marker.yM);
    sprite.scale.set(MARKER_SCALE_M, MARKER_SCALE_M, 1);
    group.add(sprite);
  }

  return group;
}

/**
 * Frees the GPU memory a scene held.
 *
 * A renderer that rebuilds its scene on every annotation change would leak a
 * geometry and a texture per redraw without this, which on a laptop showing a
 * match for an hour is the difference between fine and a warm machine.
 */
export function disposeGroup(group: Object3D): void {
  group.traverse((child) => {
    const mesh = child as Partial<Mesh> & { material?: unknown };
    mesh.geometry?.dispose?.();
    const material = mesh.material;
    if (Array.isArray(material)) {
      for (const entry of material) disposeMaterial(entry);
    } else if (material) {
      disposeMaterial(material);
    }
  });
}

function disposeMaterial(material: unknown): void {
  const candidate = material as { map?: { dispose?: () => void }; dispose?: () => void };
  candidate.map?.dispose?.();
  candidate.dispose?.();
}
