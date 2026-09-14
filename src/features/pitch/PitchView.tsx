import type { Ref } from "react";
import type { Point } from "@/lib/annotate/geometry";
import type { Annotation } from "@/lib/annotate/types";
import type { PositionRow } from "@/lib/db/queries/positions";
import { type PitchSize, pitchOutline } from "@/lib/pitch/pitchModel";
import { pathDataOf, patternLinesInPitch } from "@/lib/pitch/pitchView";
import { cn } from "@/lib/utils";
import { markerLabel, NEUTRAL_TEAM_COLOUR } from "./markers";

/**
 * The top-down pitch (FR-30.5).
 *
 * Drawn from the same pitch model the calibration overlay uses, so the shape a
 * position is judged against is the shape the calibration was verified against.
 * Colour is never the only signal: every marker carries a shirt number and the
 * team's name, and in a comparison the two moments differ by marker shape as well
 * (NFR-24).
 *
 * Since R2 this view also draws the shapes anchored to the pitch (FR-80.2), in
 * metres — which is the view's own coordinate space, so no projection is
 * involved. The same outline function feeds the frame overlay through the
 * calibration, so the two surfaces cannot disagree about a shape (D34/D36).
 */

export type PitchViewSet = {
  label: string;
  positions: PositionRow[];
  /** The first set is solid, the second hollow, so shape distinguishes them. */
  variant: "solid" | "hollow";
};

const MARGIN_M = 4;
export function PitchView({
  size,
  sets,
  shapes = [],
  draft = null,
  draftPoints = [],
  emptyMessage,
  svgRef,
  drawing = false,
}: {
  size: PitchSize;
  sets: PitchViewSet[];
  /** Pitch-anchored shapes of this moment, in metres. */
  shapes?: Annotation[];
  /**
   * The shape being drawn right now, and the corners placed so far.
   *
   * Without these the surface is silent while the pointer moves, and a drag
   * looks like it did nothing at all — which is exactly how a working tool gets
   * read as a broken one.
   */
  draft?: Annotation | null;
  draftPoints?: Point[];
  emptyMessage: string;
  svgRef?: Ref<SVGSVGElement>;
  /** True while a tool is in hand, which changes the cursor and the caption. */
  drawing?: boolean;
}) {
  const total = sets.reduce((sum, set) => sum + set.positions.length, 0);
  const halfLength = size.lengthM / 2;
  const halfWidth = size.widthM / 2;

  if (total === 0 && shapes.length === 0 && !draft && draftPoints.length === 0) {
    return <p className="text-body text-muted-foreground">{emptyMessage}</p>;
  }

  const markerRadius = 1.7;
  const fontSize = 1.9;

  return (
    <div className="space-y-2">
      <svg
        ref={svgRef}
        viewBox={`${-halfLength - MARGIN_M} ${-halfWidth - MARGIN_M} ${size.lengthM + MARGIN_M * 2} ${size.widthM + MARGIN_M * 2}`}
        role="img"
        aria-label={`Pitch view with ${total} marked ${total === 1 ? "position" : "positions"}${shapes.length > 0 ? ` and ${shapes.length} drawn ${shapes.length === 1 ? "shape" : "shapes"}` : ""}`}
        className={cn("w-full rounded-md border border-border bg-card", drawing && "touch-none")}
      >
        {/* The pitch itself: lines in metres, which is also the coordinate space. */}
        <g fill="none" stroke="currentColor" strokeWidth={0.35} className="text-border">
          {pitchOutline(size).map((line) => (
            <path
              // The outline is fixed, and each line starts somewhere unique.
              key={`${line.points[0][0]},${line.points[0][1]}`}
              d={line.points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x} ${y}`).join(" ")}
            />
          ))}
        </g>

        {/* Drawn shapes, under the markers so a marker is never hidden by a zone. */}
        {shapes.map((shape) => {
          const d = pathDataOf(shape.geometry, shape.kind);
          if (!d) return null;
          const lines = patternLinesInPitch(shape.geometry, shape.kind, shape.style, size);
          const clipId = `shape-${shape.uid}`;

          return (
            <g key={shape.uid}>
              {lines.length > 0 && (
                <defs>
                  <clipPath id={clipId}>
                    <path d={d} />
                  </clipPath>
                </defs>
              )}
              <path
                d={d}
                fill={shape.style.fill && lines.length === 0 ? shape.style.fill : "none"}
                stroke={shape.style.stroke}
                strokeWidth={Math.max(0.15, shape.style.width * size.lengthM)}
                strokeDasharray={shape.geometry.points ? undefined : "1.6 1"}
                opacity={shape.style.opacity}
              />
              {lines.length > 0 && (
                <g
                  clipPath={`url(#${clipId})`}
                  stroke={shape.style.fill ?? shape.style.stroke}
                  strokeWidth={0.25}
                >
                  {lines.map(([from, to]) => (
                    <line
                      key={`${from[0]},${from[1]},${to[0]},${to[1]}`}
                      x1={from[0]}
                      y1={from[1]}
                      x2={to[0]}
                      y2={to[1]}
                    />
                  ))}
                </g>
              )}
            </g>
          );
        })}

        {/* The shape in progress, dashed so it reads as not-yet-stored. */}
        {(draft || draftPoints.length > 0) && (
          <g className="text-foreground">
            {draft && pathDataOf(draft.geometry, draft.kind) && (
              <path
                d={pathDataOf(draft.geometry, draft.kind) ?? undefined}
                fill="none"
                stroke={draft.style.stroke}
                strokeWidth={Math.max(0.2, draft.style.width * size.lengthM)}
                strokeDasharray="2 1.4"
                opacity={0.8}
              />
            )}
            {draftPoints.map(([x, y], index) => (
              <circle
                // A corner is placed by clicking, so its position is its identity.
                key={`${x},${y}`}
                cx={x}
                cy={y}
                r={0.9}
                fill={index === 0 ? "currentColor" : "none"}
                stroke="currentColor"
                strokeWidth={0.3}
              />
            ))}
          </g>
        )}

        {sets.map((set) =>
          set.positions.map((position) => (
            <g key={`${set.label}-${position.id}`}>
              <circle
                cx={position.xM}
                cy={position.yM}
                r={markerRadius}
                fill={
                  set.variant === "solid" ? (position.teamColor ?? NEUTRAL_TEAM_COLOUR) : "none"
                }
                stroke={position.teamColor ?? NEUTRAL_TEAM_COLOUR}
                strokeWidth={0.35}
                strokeDasharray={set.variant === "hollow" ? "1.2 0.8" : undefined}
              />
              <text
                x={position.xM}
                y={position.yM + fontSize * 0.35}
                textAnchor="middle"
                fontSize={fontSize}
                // The halo is the surface colour, so the number reads on any team
                // colour and in either theme: the tokens do the contrast work
                // (NFR-10, NFR-24).
                paintOrder="stroke"
                stroke="var(--background)"
                strokeWidth={fontSize * 0.28}
                // The text is the surface's own foreground in both variants: the
                // halo handles the disc, and the disc-versus-ring difference is
                // carried by shape, not by the number's colour (NFR-24).
                className="select-none fill-foreground"
              >
                {markerLabel(position)}
              </text>
              <text
                x={position.xM}
                y={position.yM - markerRadius - 0.6}
                textAnchor="middle"
                fontSize={fontSize * 0.8}
                className="select-none fill-muted-foreground"
              >
                {position.teamName}
              </text>
            </g>
          )),
        )}
      </svg>

      {sets.length > 1 && (
        <ul className="space-y-0.5 text-caption text-muted-foreground">
          {sets.map((set) => (
            <li key={set.label}>
              {set.label}: {set.positions.length}{" "}
              {set.positions.length === 1 ? "player" : "players"}
              {set.variant === "hollow" ? " (dashed ring)" : " (filled disc)"}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
