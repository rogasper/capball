import { Maximize2, Play, Plus, Target, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { PositionRow } from "@/lib/db/queries/positions";
import { describeCoverage, regionOf, storedCalibrationWarning } from "@/lib/pitch/positions";
import { formatTimecode } from "@/lib/time/timecode";
import { useAnnotationStore } from "@/stores/annotationStore";
import { activeCalibrationAt, useCalibrationStore } from "@/stores/calibrationStore";
import { useEventStore } from "@/stores/eventStore";
import { useLibraryStore } from "@/stores/libraryStore";
import { useMagnifierStore } from "@/stores/magnifierStore";
import { usePositionStore } from "@/stores/positionStore";
import { useSquadStore } from "@/stores/squadStore";
import { useTagStore } from "@/stores/tagStore";
import { PitchView } from "./PitchView";

/**
 * Marking a player's position, and seeing the shape it makes (FR-30.3, FR-30.5).
 *
 * Identity is required, because a position without a player means nothing — but
 * the active context is offered as the default so the common case is one click.
 * A player who is not in the roster yet can be added here rather than sending the
 * user to another screen mid-flow.
 */

export function MarkingPanel() {
  const eventId = useAnnotationStore((state) => state.eventId);
  const events = useEventStore((state) => state.events);
  const match = useLibraryStore((state) => state.currentMatch);
  const probe = useLibraryStore((state) => state.probe);
  const calibrations = useCalibrationStore((state) => state.calibrations);
  const pitchLengthM = useCalibrationStore((state) => state.pitchLengthM);
  const pitchWidthM = useCalibrationStore((state) => state.pitchWidthM);

  const teams = useSquadStore((state) => state.teams);
  const players = useSquadStore((state) => state.players);
  const addPlayer = useSquadStore((state) => state.addPlayer);

  const marking = usePositionStore((state) => state.marking);
  const target = usePositionStore((state) => state.target);
  const positions = usePositionStore((state) => state.positions);
  const notice = usePositionStore((state) => state.notice);
  const error = usePositionStore((state) => state.error);
  const setMarking = usePositionStore((state) => state.setMarking);
  const openMagnifier = useMagnifierStore((state) => state.open);
  const setTarget = usePositionStore((state) => state.setTarget);
  const remove = usePositionStore((state) => state.remove);
  const loadFor = usePositionStore((state) => state.loadFor);

  const activeTeamId = useTagStore((state) => state.activeTeamId);
  const activePlayerId = useTagStore((state) => state.activePlayerId);

  const [newName, setNewName] = useState("");
  const [newShirt, setNewShirt] = useState("");
  const [compareId, setCompareId] = useState<number | null>(null);
  const [compared, setCompared] = useState<PositionRow[]>([]);

  const event = events.find((candidate) => candidate.id === eventId) ?? null;
  const calibration = event ? activeCalibrationAt(calibrations, event.anchorMs) : null;
  const size = useMemo(
    () => ({ lengthM: pitchLengthM, widthM: pitchWidthM }),
    [pitchLengthM, pitchWidthM],
  );

  const coverage = useMemo(
    () =>
      calibration && calibration.points.length >= 3 ? regionOf(calibration.points, size) : null,
    [calibration, size],
  );

  // A calibration with two clicks in the same place cannot be trusted, and the
  // marking flow is where that matters most — say so before a position is placed.
  // The click positions are stored normalised, so the check needs the frame size.
  const frame = useMemo(
    () => ({ width: probe?.width ?? 0, height: probe?.height ?? 0 }),
    [probe?.width, probe?.height],
  );
  const flaw = useMemo(
    () =>
      calibration && frame.width > 0 ? storedCalibrationWarning(calibration.points, frame) : null,
    [calibration, frame],
  );

  // The tagging context is the default here too (FR-30.3): the player being
  // marked is usually the one the event was tagged for, and asking again would be
  // busywork. Only the two teams in this match are looked at.
  useEffect(() => {
    if (target !== null || activePlayerId === null) return;

    const matchTeams = [match?.homeTeamId, match?.awayTeamId].filter(
      (id): id is number => typeof id === "number",
    );
    const searchOrder =
      activeTeamId !== null && matchTeams.includes(activeTeamId)
        ? [activeTeamId, ...matchTeams.filter((id) => id !== activeTeamId)]
        : matchTeams;

    for (const teamId of searchOrder) {
      const found = (players[teamId] ?? []).find((candidate) => candidate.id === activePlayerId);
      if (!found) continue;

      const team = teams[teamId];
      setTarget({
        playerId: found.id,
        playerName: found.name,
        shirtNumber: found.shirtNumber,
        teamId,
        teamName: team?.name ?? "",
        teamColor: team?.color ?? null,
      });
      return;
    }
  }, [target, activePlayerId, activeTeamId, players, teams, match, setTarget]);

  useEffect(() => {
    if (compareId === null) {
      setCompared([]);
      return;
    }
    let cancelled = false;
    void loadFor(compareId).then((rows) => {
      if (!cancelled) setCompared(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [compareId, loadFor]);

  if (eventId === null) {
    return (
      <p className="text-body text-muted-foreground">
        Select an event first — a position belongs to a moment, and the moment is the tag.
      </p>
    );
  }

  const roster = [match?.homeTeamId, match?.awayTeamId]
    .filter((id): id is number => typeof id === "number")
    .map((teamId) => ({ team: teams[teamId], teamId, list: players[teamId] ?? [] }))
    .filter((entry) => entry.team);

  const addToRoster = async () => {
    const teamId = target?.teamId ?? roster[0]?.teamId;
    if (!teamId || newName.trim().length === 0) return;

    const name = newName.trim();
    const shirt = newShirt.trim() === "" ? null : Number(newShirt);
    await addPlayer({ teamId, name, shirtNumber: Number.isFinite(shirt) ? shirt : null });

    // The store reloads the roster rather than returning the new row, so the
    // player is found by the name just added.
    const added = (useSquadStore.getState().players[teamId] ?? []).find(
      (candidate) => candidate.name === name,
    );
    if (added) {
      const team = useSquadStore.getState().teams[teamId];
      setTarget({
        playerId: added.id,
        playerName: added.name,
        shirtNumber: added.shirtNumber,
        teamId,
        teamName: team?.name ?? "",
        teamColor: team?.color ?? null,
      });
    }
    setNewName("");
    setNewShirt("");
  };

  return (
    <section className="space-y-3 border-t border-border pt-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-label text-muted-foreground">Player positions</h3>
        <span className="text-caption tabular-nums text-muted-foreground">
          {positions.length} marked
        </span>
      </div>

      {!calibration ? (
        <p className="rounded-md border border-border bg-muted px-2 py-1.5 text-label">
          This video is not calibrated, so a click cannot be turned into a pitch position. Calibrate
          above first.
        </p>
      ) : (
        <p className="text-caption text-muted-foreground">
          {coverage
            ? describeCoverage(coverage)
            : "Fewer than three reference points, so nothing is covered yet."}
        </p>
      )}

      {calibration && flaw && <p className="text-caption text-warning">{flaw}</p>}

      <div className="space-y-2">
        <Label className="text-label text-muted-foreground">Marking as</Label>
        <Select
          value={target ? String(target.playerId) : "none"}
          onValueChange={(value) => {
            if (value === "none") {
              setTarget(null);
              return;
            }
            const playerId = Number(value);
            for (const entry of roster) {
              const found = entry.list.find((candidate) => candidate.id === playerId);
              if (found) {
                setTarget({
                  playerId: found.id,
                  playerName: found.name,
                  shirtNumber: found.shirtNumber,
                  teamId: entry.teamId,
                  teamName: entry.team?.name ?? "",
                  teamColor: entry.team?.color ?? null,
                });
                return;
              }
            }
          }}
        >
          <SelectTrigger size="sm" className="h-7 w-full text-label" aria-label="Player to mark">
            <SelectValue placeholder="Choose a player" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No player</SelectItem>
            {roster.map((entry) => (
              <div key={entry.teamId}>
                <p className="px-2 py-1 text-caption text-muted-foreground">{entry.team?.name}</p>
                {entry.list.map((player) => (
                  <SelectItem key={player.id} value={String(player.id)}>
                    {player.shirtNumber ? `${player.shirtNumber} · ${player.name}` : player.name}
                  </SelectItem>
                ))}
              </div>
            ))}
          </SelectContent>
        </Select>

        <div className="flex items-center gap-1">
          <Input
            value={newName}
            onChange={(changeEvent) => setNewName(changeEvent.currentTarget.value)}
            placeholder="Add a player"
            aria-label="New player name"
            className="h-7 text-label"
          />
          <Input
            value={newShirt}
            onChange={(changeEvent) => setNewShirt(changeEvent.currentTarget.value)}
            placeholder="No."
            aria-label="New player shirt number"
            className="h-7 w-14 text-label"
          />
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Add the player to the roster"
            onClick={() => void addToRoster()}
          >
            <Plus aria-hidden="true" />
          </Button>
        </div>

        <Button
          variant={marking ? "default" : "outline"}
          size="sm"
          className="w-full"
          disabled={!calibration || !target}
          onClick={() => setMarking(!marking)}
        >
          <Target aria-hidden="true" />
          {marking ? "Stop marking" : "Mark positions on the frame"}
        </Button>

        {/* The video is shown at roughly 430 px for a 1920-px picture, so a
            screen pixel is worth more than four video pixels here too. */}
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          disabled={!calibration || !target}
          onClick={() => {
            setMarking(true);
            openMagnifier("position");
          }}
        >
          <Maximize2 aria-hidden="true" />
          Mark on a magnified frame
        </Button>

        <p className="text-caption text-muted-foreground">
          Markers show while the playhead is inside this event, and hide when you scrub away from it
          — a position only tells the truth at its own moment. Marking keeps them visible.
        </p>

        {marking && !notice && (
          <p className="rounded-md border border-primary/40 bg-primary/10 px-2 py-1.5 text-label">
            Click each player on the frame. The click is stored as a pitch position, so it stays
            right when the window changes.
          </p>
        )}
        {notice && (
          <p className="rounded-md border border-warning/40 bg-warning/10 px-2 py-1.5 text-label text-warning">
            {notice}
          </p>
        )}
        {error && (
          <p
            role="alert"
            className="rounded-md border border-danger/40 bg-danger/10 px-2 py-1.5 text-label"
          >
            {error}
          </p>
        )}
      </div>

      {positions.length > 0 && (
        <ul className="space-y-1">
          {positions.map((position) => (
            <li key={position.id} className="flex items-center gap-2 text-label">
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{ background: position.teamColor ?? "var(--muted-foreground)" }}
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1 truncate">
                {position.shirtNumber ? `${position.shirtNumber} · ` : ""}
                {position.playerName}
                <span className="text-muted-foreground"> · {position.teamName}</span>
              </span>
              <span className="font-mono text-caption tabular-nums text-muted-foreground">
                {position.xM.toFixed(0)}, {position.yM.toFixed(0)} m
              </span>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`Remove ${position.playerName}`}
                onClick={() => void remove(position.id)}
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="space-y-2 border-t border-border pt-3">
        <div className="flex items-center justify-between gap-2">
          <Label className="text-label text-muted-foreground">Pitch view</Label>
          <Select
            value={compareId === null ? "none" : String(compareId)}
            onValueChange={(value) => setCompareId(value === "none" ? null : Number(value))}
          >
            <SelectTrigger size="sm" className="h-7 w-44 text-label" aria-label="Compare with">
              <SelectValue placeholder="Compare with…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">This moment only</SelectItem>
              {events
                .filter((candidate) => candidate.id !== eventId)
                .map((candidate) => (
                  <SelectItem key={candidate.id} value={String(candidate.id)}>
                    {formatTimecode(candidate.anchorMs)} · {candidate.tagName}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>

        <PitchView
          size={size}
          emptyMessage="No positions on this moment yet. Mark where each player was and they appear here."
          sets={[
            {
              label: compareId === null ? "This moment" : "This moment",
              positions,
              variant: "solid",
            },
            ...(compareId === null
              ? []
              : [{ label: "The other moment", positions: compared, variant: "hollow" as const }]),
          ]}
        />

        {compareId !== null && (
          <p className="flex items-center gap-1 text-caption text-muted-foreground">
            <Play className="size-3" aria-hidden="true" />
            The first moment is a filled disc, the second a dashed ring, so the two can be told
            apart without relying on colour.
          </p>
        )}
      </div>
    </section>
  );
}
