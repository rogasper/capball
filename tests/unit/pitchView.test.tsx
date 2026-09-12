import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PitchView } from "@/features/pitch/PitchView";
import type { PositionRow } from "@/lib/db/queries/positions";

/**
 * The pitch view (FR-30.5, NFR-24).
 *
 * Two things it must never do: imply a position exists when there is none, and
 * distinguish two moments by colour alone.
 */

const SIZE = { lengthM: 105, widthM: 68 };

function position(patch: Partial<PositionRow> = {}): PositionRow {
  return {
    id: 1,
    eventId: 7,
    playerId: 11,
    playerName: "Bruno Fernandes",
    shirtNumber: 8,
    teamId: 1,
    teamName: "Manchester United",
    teamColor: "#DA291C",
    calibrationId: 3,
    imageU: 0.4,
    imageV: 0.5,
    xM: -14.25,
    yM: 6.75,
    ...patch,
  };
}

describe("PitchView", () => {
  it("says so when the moment has no positions, rather than drawing an empty pitch", () => {
    render(
      <PitchView
        size={SIZE}
        sets={[{ label: "This moment", positions: [], variant: "solid" }]}
        emptyMessage="Nothing marked here yet."
      />,
    );

    expect(screen.getByText("Nothing marked here yet.")).toBeInTheDocument();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("labels each marker with a shirt number and the team's name", () => {
    const { container } = render(
      <PitchView
        size={SIZE}
        emptyMessage="none"
        sets={[{ label: "This moment", positions: [position()], variant: "solid" }]}
      />,
    );

    // Colour is never the only signal: the number and the name are both drawn.
    expect(screen.getByText("8")).toBeInTheDocument();
    expect(screen.getByText("Manchester United")).toBeInTheDocument();
    expect(container.querySelector("circle")?.getAttribute("fill")).toBe("#DA291C");
    expect(screen.getByRole("img")).toHaveAttribute(
      "aria-label",
      "Pitch view with 1 marked position",
    );
  });

  it("distinguishes two moments by marker shape and says which is which", () => {
    const { container } = render(
      <PitchView
        size={SIZE}
        emptyMessage="none"
        sets={[
          { label: "This moment", positions: [position()], variant: "solid" },
          {
            label: "The other moment",
            positions: [position({ id: 2, playerId: 12, xM: 5 })],
            variant: "hollow",
          },
        ]}
      />,
    );

    const circles = [...container.querySelectorAll("circle")];
    expect(circles).toHaveLength(2);
    expect(circles[0].getAttribute("stroke-dasharray")).toBeNull();
    // The second moment is a dashed ring, so shape separates them, not colour.
    expect(circles[1].getAttribute("stroke-dasharray")).toBe("1.2 0.8");
    expect(circles[1].getAttribute("fill")).toBe("none");

    expect(screen.getByText(/This moment: 1 player/)).toBeInTheDocument();
    expect(screen.getByText(/The other moment: 1 player/)).toBeInTheDocument();
    expect(screen.getAllByText(/dashed ring|filled disc/)).toHaveLength(2);
  });

  it("draws the pitch from the model, so a position is judged against the same shape", () => {
    const { container } = render(
      <PitchView
        size={SIZE}
        emptyMessage="none"
        sets={[{ label: "This moment", positions: [position()], variant: "solid" }]}
      />,
    );

    // The boundary, the halfway line, two areas, two six-yard boxes, two goals,
    // the centre circle, two arcs and four corner arcs.
    expect(container.querySelectorAll("path").length).toBeGreaterThanOrEqual(14);
  });
});
