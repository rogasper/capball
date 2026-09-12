import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { isFilterActive, useEventStore } from "@/stores/eventStore";
import { useLibraryStore } from "@/stores/libraryStore";
import { useSquadStore } from "@/stores/squadStore";
import { useTagStore } from "@/stores/tagStore";

/** Narrows both the timeline and the event list (FR-13). */
export function FilterBar() {
  const filters = useEventStore((state) => state.filters);
  const setFilters = useEventStore((state) => state.setFilters);
  const toggleTagFilter = useEventStore((state) => state.toggleTagFilter);
  const clearFilters = useEventStore((state) => state.clearFilters);

  const tags = useTagStore((state) => state.tags);
  const teams = useSquadStore((state) => state.teams);
  const players = useSquadStore((state) => state.players);
  const currentMatch = useLibraryStore((state) => state.currentMatch);

  if (!currentMatch) return null;

  const matchTeams = [teams[currentMatch.homeTeamId], teams[currentMatch.awayTeamId]].filter(
    Boolean,
  );

  // Without a team filter, every squad in the match is offered.
  const roster =
    filters.teamId === null
      ? [currentMatch.homeTeamId, currentMatch.awayTeamId].flatMap((id) => players[id] ?? [])
      : (players[filters.teamId] ?? []);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-label text-muted-foreground">Show</span>

      <span className="flex flex-wrap gap-1">
        {tags.map((tag) => {
          const on = filters.tagIds.includes(tag.id);
          return (
            <button
              key={tag.id}
              type="button"
              aria-pressed={on}
              onClick={() => toggleTagFilter(tag.id)}
              className={cn(
                "flex items-center gap-1 rounded-full border px-2 py-0.5 text-caption transition-colors",
                "focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
                on
                  ? "border-primary bg-primary/15 text-foreground"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              <span
                className="size-1.5 rounded-full"
                style={{ background: tag.color ?? "var(--muted-foreground)" }}
                aria-hidden="true"
              />
              {tag.name}
            </button>
          );
        })}
      </span>

      <Select
        value={filters.teamId === null ? "any" : String(filters.teamId)}
        onValueChange={(value) =>
          setFilters({ teamId: value === "any" ? null : Number(value), playerId: null })
        }
      >
        <SelectTrigger size="sm" className="h-6 w-32 text-label" aria-label="Filter by team">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="any">Any team</SelectItem>
          {matchTeams.map((team) => (
            <SelectItem key={team.id} value={String(team.id)}>
              {team.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={filters.playerId === null ? "any" : String(filters.playerId)}
        onValueChange={(value) => setFilters({ playerId: value === "any" ? null : Number(value) })}
        disabled={roster.length === 0}
      >
        <SelectTrigger size="sm" className="h-6 w-32 text-label" aria-label="Filter by player">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="any">Any player</SelectItem>
          {roster.map((player) => (
            <SelectItem key={player.id} value={String(player.id)}>
              {player.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {isFilterActive(filters) && (
        <Button variant="ghost" size="xs" onClick={clearFilters}>
          <X className="size-3" aria-hidden="true" />
          Clear
        </Button>
      )}
    </div>
  );
}
