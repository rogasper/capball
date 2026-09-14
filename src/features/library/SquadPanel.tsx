import { Ban, Plus, Trash2, X } from "lucide-react";
import { useState } from "react";
import { EditableName } from "@/components/editable-name";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useLibraryStore } from "@/stores/libraryStore";
import { useSquadStore } from "@/stores/squadStore";

/**
 * The colours a team can be marked with (FR-8.1).
 *
 * Mid-tone on purpose: every marker and position reads its team's colour, and a
 * marker carries the shirt number over that colour, so the swatches have to work
 * against both a light and a dark surface. Colour is never the only signal — the
 * number and the team's name are always drawn too (NFR-24).
 */
const TEAM_COLOURS = ["#DA291C", "#1D4ED8", "#15803D", "#B45309", "#6D28D9", "#0F766E"];

function TeamSquad({ teamId }: { teamId: number }) {
  const team = useSquadStore((state) => state.teams[teamId]);
  const players = useSquadStore((state) => state.players[teamId]) ?? [];
  const addPlayer = useSquadStore((state) => state.addPlayer);
  const removePlayer = useSquadStore((state) => state.removePlayer);
  const renameTeam = useSquadStore((state) => state.renameTeam);
  const setTeamColor = useSquadStore((state) => state.setTeamColor);

  const [name, setName] = useState("");
  const [shirt, setShirt] = useState("");

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;

    const number = shirt.trim() ? Number(shirt.trim()) : null;
    await addPlayer({
      teamId,
      name: trimmed,
      shirtNumber: number !== null && Number.isFinite(number) ? number : null,
    });
    setName("");
    setShirt("");
  };

  if (!team) return null;

  return (
    <div className="space-y-1.5">
      <h4 className="text-label text-muted-foreground">
        <EditableName value={team.name} onCommit={(next) => void renameTeam(team.id, next)} />
      </h4>

      <fieldset className="flex flex-wrap items-center gap-1">
        <legend className="sr-only">Colour for {team.name}</legend>
        <span className="text-caption text-muted-foreground">Colour</span>
        {TEAM_COLOURS.map((colour) => (
          <button
            key={colour}
            type="button"
            aria-label={`${team.name} plays in ${colour}`}
            aria-pressed={team.color === colour}
            className={cn(
              "size-4 rounded-full border",
              team.color === colour ? "border-foreground" : "border-border",
            )}
            style={{ background: colour }}
            onClick={() => void setTeamColor(team.id, colour)}
          />
        ))}
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`No colour for ${team.name}`}
          aria-pressed={team.color === null}
          onClick={() => void setTeamColor(team.id, null)}
        >
          <Ban aria-hidden="true" />
        </Button>
      </fieldset>

      {players.length === 0 ? (
        <p className="text-label text-muted-foreground">No players yet.</p>
      ) : (
        <ul className="space-y-0.5">
          {players.map((player) => (
            <li
              key={player.id}
              className="flex items-center gap-2 rounded-md px-1.5 py-0.5 hover:bg-accent/50"
            >
              <span className="w-6 shrink-0 font-mono text-label tabular-nums text-muted-foreground">
                {player.shirtNumber ?? "–"}
              </span>
              <span className="min-w-0 flex-1 truncate text-body">{player.name}</span>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`Remove ${player.name}`}
                onClick={() => void removePlayer(teamId, player.id)}
              >
                <Trash2 className="size-3" aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={submit} className="flex items-center gap-1.5">
        <Input
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
          placeholder="Add a player…"
          className="h-7 text-label"
        />
        <Input
          value={shirt}
          onChange={(event) => setShirt(event.currentTarget.value)}
          placeholder="#"
          inputMode="numeric"
          className="h-7 w-12 text-center text-label"
        />
        <Button type="submit" variant="outline" size="icon-sm" aria-label="Add player">
          <Plus className="size-3.5" aria-hidden="true" />
        </Button>
      </form>
    </div>
  );
}

/**
 * The two squads, so events can carry a player later (FR-8.2). Teams are shared
 * across matches, which is why renaming one here renames it everywhere.
 */
export function SquadPanel() {
  const homeTeamId = useLibraryStore((state) => state.currentMatch?.homeTeamId);
  const awayTeamId = useLibraryStore((state) => state.currentMatch?.awayTeamId);
  const error = useSquadStore((state) => state.error);
  const clearError = useSquadStore((state) => state.clearError);

  // Squads are loaded by the shell, so they are available to the tagging
  // context even when this panel is not on screen.
  if (homeTeamId === undefined || awayTeamId === undefined) return null;

  return (
    <div className="space-y-3">
      <h3 className="text-label text-muted-foreground">Squads</h3>

      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/10 p-2"
        >
          <p className="flex-1 text-label break-words">{error}</p>
          <Button variant="ghost" size="icon-xs" aria-label="Dismiss" onClick={clearError}>
            <X className="size-3" aria-hidden="true" />
          </Button>
        </div>
      )}

      <TeamSquad teamId={homeTeamId} />
      <TeamSquad teamId={awayTeamId} />
    </div>
  );
}
