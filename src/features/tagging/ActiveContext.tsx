import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLibraryStore } from "@/stores/libraryStore";
import { useSquadStore } from "@/stores/squadStore";
import { useTagStore } from "@/stores/tagStore";

/**
 * The context new events inherit (FR-7).
 *
 * Kept visible at all times (FR-7.1), because an event silently attributed to
 * the wrong team is worse than no attribution at all.
 */
export function ActiveContext() {
  const currentMatch = useLibraryStore((state) => state.currentMatch);
  const activeTeamId = useTagStore((state) => state.activeTeamId);
  const activePlayerId = useTagStore((state) => state.activePlayerId);
  const setActiveTeam = useTagStore((state) => state.setActiveTeam);
  const setActivePlayer = useTagStore((state) => state.setActivePlayer);
  const teams = useSquadStore((state) => state.teams);
  const players = useSquadStore((state) => state.players);

  if (!currentMatch) return null;

  const home = teams[currentMatch.homeTeamId];
  const away = teams[currentMatch.awayTeamId];
  const roster = activeTeamId === null ? [] : (players[activeTeamId] ?? []);

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border bg-card px-4 py-2">
      <span className="text-label text-muted-foreground">Tagging as</span>

      <Select
        value={activeTeamId === null ? "none" : String(activeTeamId)}
        onValueChange={(value) => setActiveTeam(value === "none" ? null : Number(value))}
      >
        <SelectTrigger size="sm" className="h-7 w-44 text-label" aria-label="Active team">
          <SelectValue placeholder="No team" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">No team</SelectItem>
          {[home, away].filter(Boolean).map((team) => (
            <SelectItem key={team.id} value={String(team.id)}>
              {team.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={activePlayerId === null ? "none" : String(activePlayerId)}
        onValueChange={(value) => setActivePlayer(value === "none" ? null : Number(value))}
        disabled={activeTeamId === null || roster.length === 0}
      >
        <SelectTrigger size="sm" className="h-7 w-44 text-label" aria-label="Active player">
          <SelectValue placeholder={roster.length === 0 ? "No players" : "No player"} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">No player</SelectItem>
          {roster.map((player) => (
            <SelectItem key={player.id} value={String(player.id)}>
              {player.shirtNumber ? `${player.shirtNumber} · ${player.name}` : player.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <span className="ml-auto text-caption text-muted-foreground">
        New events inherit this. Clear it for a neutral event.
      </span>
    </div>
  );
}
