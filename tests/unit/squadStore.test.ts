import { beforeEach, describe, expect, it, vi } from "vitest";
import * as teamsQuery from "@/lib/db/queries/teams";
import { useSquadStore } from "@/stores/squadStore";

/**
 * The team colour (FR-8.1).
 *
 * The column existed from R0 and every marker reads it, but nothing could write
 * it — so every marker fell back to a neutral and two teams were told apart only
 * by their name. These hold the write and, more importantly, the rollback: a
 * colour that failed to save must not keep showing on the pitch.
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

const TEAM = {
  id: 1,
  name: "MU",
  shortName: null,
  color: null,
  createdAt: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
  setTeamColor.mockResolvedValue(undefined);
  useSquadStore.setState({ teams: { 1: { ...TEAM } }, players: { 1: [] }, error: null });
});

describe("setTeamColor", () => {
  it("shows the colour immediately and writes it", async () => {
    await useSquadStore.getState().setTeamColor(1, "#DA291C");

    expect(useSquadStore.getState().teams[1]?.color).toBe("#DA291C");
    expect(setTeamColor).toHaveBeenCalledWith(1, "#DA291C");
  });

  it("clears the colour with null, which is the neutral state", async () => {
    useSquadStore.setState({ teams: { 1: { ...TEAM, color: "#DA291C" } } });
    await useSquadStore.getState().setTeamColor(1, null);

    expect(useSquadStore.getState().teams[1]?.color).toBeNull();
    expect(setTeamColor).toHaveBeenCalledWith(1, null);
  });

  it("puts the old colour back, and says why, when the write fails", async () => {
    useSquadStore.setState({ teams: { 1: { ...TEAM, color: "#1D4ED8" } } });
    setTeamColor.mockRejectedValue(new Error("database is locked"));

    await useSquadStore.getState().setTeamColor(1, "#DA291C");

    // A colour that did not save must not keep colouring the markers.
    expect(useSquadStore.getState().teams[1]?.color).toBe("#1D4ED8");
    expect(useSquadStore.getState().error).toMatch(/database is locked/);
  });

  it("does nothing for a team it does not know", async () => {
    await useSquadStore.getState().setTeamColor(99, "#DA291C");
    expect(setTeamColor).toHaveBeenCalledWith(99, "#DA291C");
    expect(useSquadStore.getState().teams[99]).toBeUndefined();
  });
});
