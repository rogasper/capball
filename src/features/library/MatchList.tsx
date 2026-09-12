import { Plus, Video } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useLibraryStore } from "@/stores/libraryStore";
import { NewMatchDialog } from "./NewMatchDialog";

function formatKickoff(kickoffAt: number | null): string | null {
  if (!kickoffAt) return null;
  return new Date(kickoffAt).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function MatchList() {
  const matches = useLibraryStore((state) => state.matches);
  const currentMatchId = useLibraryStore((state) => state.currentMatchId);
  const openMatch = useLibraryStore((state) => state.openMatch);

  const [creating, setCreating] = useState(false);

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-title">Matches</h2>
        <Button size="sm" variant="outline" onClick={() => setCreating(true)}>
          <Plus className="size-4" aria-hidden="true" />
          New
        </Button>
      </div>

      {matches.length === 0 ? (
        <p className="text-body text-muted-foreground">
          No matches yet. Create one, then add the video you want to analyse.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {matches.map((match) => {
            const isCurrent = match.id === currentMatchId;
            const kickoff = formatKickoff(match.kickoffAt);

            return (
              <li key={match.id}>
                <button
                  type="button"
                  onClick={() => void openMatch(match.id)}
                  aria-current={isCurrent ? "true" : undefined}
                  className={cn(
                    "w-full rounded-md border border-transparent px-3 py-2 text-left transition-colors",
                    "hover:bg-accent focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
                    isCurrent && "border-border bg-card",
                  )}
                >
                  <span className="block truncate text-body-lg">
                    {match.homeTeam} <span className="text-muted-foreground">vs</span>{" "}
                    {match.awayTeam}
                  </span>
                  <span className="flex items-center gap-2 text-label text-muted-foreground">
                    {match.competition && <span className="truncate">{match.competition}</span>}
                    {kickoff && <span>{kickoff}</span>}
                    <span className="ml-auto flex items-center gap-1">
                      <Video className="size-3" aria-hidden="true" />
                      <span className="tabular-nums">{match.videoCount}</span>
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <NewMatchDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
}
