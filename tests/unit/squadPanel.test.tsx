import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SquadPanel } from "@/features/library/SquadPanel";
import * as teamsQuery from "@/lib/db/queries/teams";
import { useLibraryStore } from "@/stores/libraryStore";
import { useSquadStore } from "@/stores/squadStore";

/**
 * Choosing a team's colour (FR-8.1).
 *
 * The panel is the only place a colour can be set, and until R2 it could not be
 * set at all — every marker on the pitch fell back to the same neutral, so two
 * teams were distinguishable only by their names.
 */

vi.mock("@/lib/db/queries/teams", () => ({
  listTeams: vi.fn().mockResolvedValue([]),
  ensureTeam: vi.fn(),
  renameTeam: vi.fn().mockResolvedValue(undefined),
  setTeamColor: vi.fn().mockResolvedValue(undefined),
  findTeamByName: vi.fn(),
}));

vi.mock("@/lib/db/queries/players", () => ({
  listPlayers: vi.fn().mockResolvedValue([]),
  createPlayer: vi.fn(),
  deletePlayer: vi.fn(),
}));

const setTeamColor = vi.mocked(teamsQuery.setTeamColor);

const TEAM = { id: 1, name: "MU", shortName: null, color: null, createdAt: 0 };

beforeEach(() => {
  vi.clearAllMocks();
  setTeamColor.mockResolvedValue(undefined);
  useLibraryStore.setState({
    currentMatch: {
      id: 1,
      homeTeamId: 1,
      awayTeamId: 2,
      competition: null,
      season: null,
      kickoffAt: null,
      venue: null,
      notes: null,
      createdAt: 0,
      updatedAt: 0,
    },
  });
  useSquadStore.setState({ teams: { 1: { ...TEAM } }, players: { 1: [] }, error: null });
});

describe("the team colour picker", () => {
  it("writes the colour that was clicked", () => {
    render(<SquadPanel />);

    fireEvent.click(screen.getByLabelText("MU plays in #DA291C"));

    expect(setTeamColor).toHaveBeenCalledWith(1, "#DA291C");
    expect(useSquadStore.getState().teams[1]?.color).toBe("#DA291C");
  });

  it("shows which colour is current, so the choice is not a guess", () => {
    render(<SquadPanel />);

    expect(screen.getByLabelText("MU plays in #DA291C")).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByLabelText("MU plays in #DA291C"));
    expect(screen.getByLabelText("MU plays in #DA291C")).toHaveAttribute("aria-pressed", "true");
  });

  it("lets the colour be cleared back to the neutral state", () => {
    useSquadStore.setState({ teams: { 1: { ...TEAM, color: "#DA291C" } } });
    render(<SquadPanel />);

    fireEvent.click(screen.getByLabelText("No colour for MU"));

    expect(setTeamColor).toHaveBeenCalledWith(1, null);
    expect(useSquadStore.getState().teams[1]?.color).toBeNull();
  });

  it("says the colour is per team, not per player", () => {
    render(<SquadPanel />);
    // A legend rather than a bare row of dots: the group is announced.
    expect(screen.getByText("Colour for MU")).toBeTruthy();
  });
});
