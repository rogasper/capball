import type { PositionRow } from "@/lib/db/queries/positions";
import { type PitchSize, pitchOutline } from "@/lib/pitch/pitchModel";
import { cn } from "@/lib/utils";

/**
 * The top-down pitch (FR-30.5).
 *
 * Drawn from the same pitch model the calibration overlay uses, so the shape a
 * position is judged against is the shape the calibration was verified against.
 * Colour is never the only signal: every marker carries a shirt number and the
 * team's name, and in a comparison the two moments differ by marker shape as well
 * (NFR-24).
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
  emptyMessage,
}: {
  size: PitchSize;
  sets: PitchViewSet[];
  emptyMessage: string;
}) {
  const total = sets.reduce((sum, set) => sum + set.positions.length, 0);
  const halfLength = size.lengthM / 2;
  const halfWidth = size.widthM / 2;

  if (total === 0) {
    return <p className="text-body text-muted-foreground">{emptyMessage}</p>;
  }

  const markerRadius = 1.7;
  const fontSize = 1.9;

  return (
    <div className="space-y-2">
      <svg
        viewBox={`${-halfLength - MARGIN_M} ${-halfWidth - MARGIN_M} ${size.lengthM + MARGIN_M * 2} ${size.widthM + MARGIN_M * 2}`}
        role="img"
        aria-label={`Pitch view with ${total} marked ${total === 1 ? "position" : "positions"}`}
        className="w-full rounded-md border border-border bg-card"
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

        {sets.map((set) =>
          set.positions.map((position) => (
            <g key={`${set.label}-${position.id}`}>
              <circle
                cx={position.xM}
                cy={position.yM}
                r={markerRadius}
                fill={set.variant === "solid" ? (position.teamColor ?? "currentColor") : "none"}
                stroke={position.teamColor ?? "currentColor"}
                strokeWidth={0.35}
                strokeDasharray={set.variant === "hollow" ? "1.2 0.8" : undefined}
              />
              <text
                x={position.xM}
                y={position.yM + fontSize * 0.35}
                textAnchor="middle"
                fontSize={fontSize}
                className={cn(
                  "select-none",
                  set.variant === "solid" ? "fill-background" : "fill-foreground",
                )}
              >
                {position.shirtNumber ?? "?"}
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
