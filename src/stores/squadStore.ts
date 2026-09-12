import { create } from "zustand";
import type { Player } from "@/lib/db/queries/players";
import * as playersQuery from "@/lib/db/queries/players";
import type { Team } from "@/lib/db/queries/teams";
import * as teamsQuery from "@/lib/db/queries/teams";

type SquadState = {
  teams: Record<number, Team>;
  players: Record<number, Player[]>;
  error: string | null;

  load: (teamIds: number[]) => Promise<void>;
  addPlayer: (input: {
    teamId: number;
    name: string;
    shirtNumber?: number | null;
  }) => Promise<void>;
  removePlayer: (teamId: number, playerId: number) => Promise<void>;
  renameTeam: (teamId: number, name: string) => Promise<void>;
  clearError: () => void;
};

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const useSquadStore = create<SquadState>((set, get) => ({
  teams: {},
  players: {},
  error: null,

  async load(teamIds) {
    try {
      const unique = [...new Set(teamIds)];
      const teams = await teamsQuery.listTeams();
      const rosters = await Promise.all(unique.map((id) => playersQuery.listPlayers(id)));

      set({
        teams: Object.fromEntries(
          teams.filter((team) => unique.includes(team.id)).map((team) => [team.id, team]),
        ),
        players: Object.fromEntries(unique.map((id, index) => [id, rosters[index] ?? []])),
      });
    } catch (error) {
      set({ error: messageOf(error) });
    }
  },

  async addPlayer(input) {
    try {
      await playersQuery.createPlayer(input);
      await get().load(Object.keys(get().players).map(Number));
    } catch (error) {
      // A duplicate name in the same squad trips the unique index, so say that
      // rather than showing a raw SQLite message.
      const message = messageOf(error);
      set({
        error: /UNIQUE/i.test(message) ? `${input.name} is already in this squad.` : message,
      });
    }
  },

  async removePlayer(teamId, playerId) {
    try {
      await playersQuery.deletePlayer(playerId);
      await get().load(Object.keys(get().players).map(Number));
      void teamId;
    } catch (error) {
      set({ error: messageOf(error) });
    }
  },

  async renameTeam(teamId, name) {
    try {
      await teamsQuery.renameTeam(teamId, name);
      await get().load(Object.keys(get().players).map(Number));
    } catch (error) {
      set({ error: messageOf(error) });
    }
  },

  clearError() {
    set({ error: null });
  },
}));
