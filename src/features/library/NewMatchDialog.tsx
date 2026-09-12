import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLibraryStore } from "@/stores/libraryStore";

export function NewMatchDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const createMatch = useLibraryStore((state) => state.createMatch);

  const [homeTeam, setHomeTeam] = useState("");
  const [awayTeam, setAwayTeam] = useState("");
  const [competition, setCompetition] = useState("");
  const [kickoff, setKickoff] = useState("");

  const sameTeam =
    homeTeam.trim().length > 0 && homeTeam.trim().toLowerCase() === awayTeam.trim().toLowerCase();
  const canSubmit = homeTeam.trim().length > 0 && awayTeam.trim().length > 0 && !sameTeam;

  const reset = () => {
    setHomeTeam("");
    setAwayTeam("");
    setCompetition("");
    setKickoff("");
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;

    const parsed = kickoff ? new Date(kickoff).getTime() : Number.NaN;
    await createMatch({
      homeTeam: homeTeam.trim(),
      awayTeam: awayTeam.trim(),
      competition: competition.trim() || undefined,
      kickoffAt: Number.isFinite(parsed) ? parsed : null,
    });

    reset();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>New match</DialogTitle>
            <DialogDescription>
              Teams are reused across matches, so naming them consistently pays off later.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="home-team">Home team</Label>
              <Input
                id="home-team"
                value={homeTeam}
                onChange={(event) => setHomeTeam(event.currentTarget.value)}
                placeholder="Manchester United"
                autoFocus
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="away-team">Away team</Label>
              <Input
                id="away-team"
                value={awayTeam}
                onChange={(event) => setAwayTeam(event.currentTarget.value)}
                placeholder="Sabah"
              />
              {sameTeam && (
                <p className="text-label text-danger">A match needs two different teams.</p>
              )}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="competition">Competition</Label>
              <Input
                id="competition"
                value={competition}
                onChange={(event) => setCompetition(event.currentTarget.value)}
                placeholder="Champions League"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="kickoff">Kick-off</Label>
              <Input
                id="kickoff"
                type="datetime-local"
                value={kickoff}
                onChange={(event) => setKickoff(event.currentTarget.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              Create match
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
