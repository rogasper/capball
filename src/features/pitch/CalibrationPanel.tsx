import { Maximize2 } from "lucide-react";
import { useMemo } from "react";
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
import { RMS_ACCEPTABLE_PX, RMS_GOOD_PX } from "@/lib/pitch/homography";
import { findFeature, pitchFeatures } from "@/lib/pitch/pitchModel";
import {
  describeCoverage,
  isNarrowCoverage,
  regionOf,
  storedCalibrationWarning,
} from "@/lib/pitch/positions";
import { playback } from "@/lib/playback";
import { formatTimecode } from "@/lib/time/timecode";
import { cn } from "@/lib/utils";
import { solvePicks, useCalibrationStore } from "@/stores/calibrationStore";
import { useLibraryStore } from "@/stores/libraryStore";
import { useMagnifierStore } from "@/stores/magnifierStore";

/**
 * Calibrating a video, in plain language (FR-30.1, FR-30.2, NFR-26).
 *
 * The panel never claims more than it has. A calibration with few or badly
 * spread points is described as such, and nothing downstream is allowed to show
 * a pitch position until a calibration exists at all.
 */

function verdictText(rmsErrorPx: number): string {
  if (rmsErrorPx <= RMS_GOOD_PX) return "lines up closely";
  if (rmsErrorPx <= RMS_ACCEPTABLE_PX) return "close enough to use";
  return "not close enough";
}

export function CalibrationPanel() {
  const videoId = useCalibrationStore((state) => state.videoId);
  const calibrations = useCalibrationStore((state) => state.calibrations);
  const picks = useCalibrationStore((state) => state.picks);
  const pendingFeature = useCalibrationStore((state) => state.pendingFeature);
  const fromMs = useCalibrationStore((state) => state.fromMs);
  const pitchLengthM = useCalibrationStore((state) => state.pitchLengthM);
  const pitchWidthM = useCalibrationStore((state) => state.pitchWidthM);
  const editingId = useCalibrationStore((state) => state.editingId);
  const error = useCalibrationStore((state) => state.error);

  const startPicking = useCalibrationStore((state) => state.startPicking);
  const skipPending = useCalibrationStore((state) => state.skipPending);
  const magnifierMode = useMagnifierStore((state) => state.mode);
  const openMagnifier = useMagnifierStore((state) => state.open);
  const closeMagnifier = useMagnifierStore((state) => state.close);
  const removePick = useCalibrationStore((state) => state.removePick);
  const clearPicks = useCalibrationStore((state) => state.clearPicks);
  const setFromMs = useCalibrationStore((state) => state.setFromMs);
  const setPitchSize = useCalibrationStore((state) => state.setPitchSize);
  const edit = useCalibrationStore((state) => state.edit);
  const save = useCalibrationStore((state) => state.save);
  const remove = useCalibrationStore((state) => state.remove);

  const probe = useLibraryStore((state) => state.probe);
  const frame = useMemo(
    () => ({ width: probe?.width ?? 0, height: probe?.height ?? 0 }),
    [probe?.width, probe?.height],
  );

  const size = useMemo(
    () => ({ lengthM: pitchLengthM, widthM: pitchWidthM }),
    [pitchLengthM, pitchWidthM],
  );
  const features = useMemo(() => pitchFeatures(size), [size]);
  const solvable = frame.width > 0 && frame.height > 0 && picks.length > 0;
  const outcome = useMemo(
    () => (solvable ? solvePicks(picks, frame) : null),
    [picks, frame, solvable],
  );

  // Coverage is a question about the pitch, not the frame: how much of the
  // playing surface the picks actually constrain. It is what tells the user
  // whether the outline they are looking at is mostly measurement or mostly
  // extrapolation — see `isNarrowCoverage`.
  const coverage = useMemo(() => (picks.length >= 3 ? regionOf(picks, size) : null), [picks, size]);

  if (videoId === null) {
    return (
      <p className="text-body text-muted-foreground">
        Open a video to tell capball where the pitch is in it.
      </p>
    );
  }

  const groups = [...new Set(features.map((feature) => feature.group))];
  const pickedKeys = picks.map((pick) => pick.feature);
  const enough = picks.length >= 4;

  return (
    <div className="space-y-4">
      <section className="space-y-2">
        <h2 className="text-title">Pitch</h2>
        <p className="text-body text-muted-foreground">
          Mark a few points you can identify on the frame — spots and area corners are the easiest.
          capball draws the pitch they imply over the video, so a wrong pick is visible at once.
        </p>
      </section>

      {calibrations.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-label text-muted-foreground">Calibrations on this video</h3>
          <ul className="space-y-1">
            {calibrations.map((calibration) => {
              const flaw = storedCalibrationWarning(calibration.points, frame);
              return (
                <li
                  key={calibration.id}
                  className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-label">
                      {calibration.fromMs === 0
                        ? "From the start"
                        : `From ${formatTimecode(calibration.fromMs)}`}
                    </p>
                    <p className="text-caption text-muted-foreground">
                      {calibration.points.length} points · lines up{" "}
                      {verdictText(calibration.rmsErrorPx)} ({calibration.rmsErrorPx.toFixed(1)} px)
                    </p>
                    {flaw && <p className="text-caption text-warning">{flaw}</p>}
                  </div>
                  <Button variant="ghost" size="xs" onClick={() => edit(calibration.id)}>
                    Adjust
                  </Button>
                  <Button
                    variant="ghost"
                    size="xs"
                    aria-label={`Delete the calibration from ${formatTimecode(calibration.fromMs)}`}
                    onClick={() => void remove(calibration.id)}
                  >
                    Delete
                  </Button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {calibrations.length === 0 && picks.length === 0 && (
        <p className="rounded-md border border-border bg-muted px-2 py-1.5 text-label">
          This video is not calibrated yet, so capball cannot say where anything is on the pitch.
        </p>
      )}

      <section className="space-y-2 border-t border-border pt-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-label text-muted-foreground">
            {editingId === null ? "New calibration" : "Adjusting a calibration"}
          </h3>
          <span className="text-caption tabular-nums text-muted-foreground">
            {picks.length} point{picks.length === 1 ? "" : "s"}
            {enough ? "" : " · 4 is the minimum"}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <Select value={pendingFeature ?? ""} onValueChange={(value) => startPicking(value)}>
            {/* `min-w-0` is what lets this shrink: a flex item's automatic
                minimum is its content, and the long placeholder was pushing the
                whole sidebar wider than itself, which scrolled the panel. */}
            <SelectTrigger
              size="sm"
              className="h-7 min-w-0 flex-1 text-label"
              aria-label="Pitch feature"
            >
              <SelectValue placeholder="Choose a feature…" />
            </SelectTrigger>
            <SelectContent>
              {groups.map((group) => (
                <div key={group}>
                  <p className="px-2 py-1 text-caption text-muted-foreground">{group}</p>
                  {features
                    .filter((feature) => feature.group === group)
                    .map((feature) => (
                      <SelectItem key={feature.key} value={feature.key}>
                        {feature.label}
                        {pickedKeys.includes(feature.key) ? " · picked" : ""}
                      </SelectItem>
                    ))}
                </div>
              ))}
            </SelectContent>
          </Select>
          {pendingFeature === null ? (
            <Button variant="outline" size="sm" onClick={() => startPicking(null)}>
              Suggest one
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              title="Not visible in this frame"
              onClick={skipPending}
            >
              Skip this one
            </Button>
          )}
        </div>

        <Button
          variant={magnifierMode === "calibration" ? "default" : "outline"}
          size="sm"
          className="w-full"
          onClick={() =>
            magnifierMode === "calibration" ? closeMagnifier() : openMagnifier("calibration")
          }
        >
          <Maximize2 className="size-3.5" aria-hidden="true" />
          {magnifierMode === "calibration"
            ? "Close the magnified frame"
            : "Pick on a magnified frame"}
        </Button>

        {pendingFeature !== null && (
          <p className="rounded-md border border-primary/40 bg-primary/10 px-2 py-1.5 text-label">
            Click <strong>{findFeature(size, pendingFeature)?.label ?? pendingFeature}</strong> on
            the frame or in the magnified view. Any feature can be chosen from the list, and “Skip
            this one” passes over one that is not visible.
          </p>
        )}

        {picks.length > 0 && (
          <ul className="space-y-1">
            {picks.map((pick, index) => {
              const residual =
                outcome?.ok === true ? outcome.quality.residualsPx[index] : undefined;
              // The solver names the picks a failure points at, so the suspect
              // rows are marked rather than described.
              const suspect =
                outcome?.ok === false && (outcome.suspectIndices ?? []).includes(index);
              return (
                <li
                  key={pick.feature}
                  className={cn("flex items-center gap-2 text-label", suspect && "text-danger")}
                >
                  <span className="min-w-0 flex-1 truncate">
                    {findFeature(size, pick.feature)?.label ?? pick.feature}
                    {suspect && <span className="text-caption"> · check this one</span>}
                  </span>
                  {residual !== undefined && (
                    <span className="tabular-nums text-caption text-muted-foreground">
                      {residual.toFixed(1)} px off
                    </span>
                  )}
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Remove ${pick.feature}`}
                    onClick={() => removePick(pick.feature)}
                  >
                    ×
                  </Button>
                </li>
              );
            })}
          </ul>
        )}

        {outcome && !outcome.ok && (
          <p className="text-label text-danger">
            {outcome.reason}
            {(outcome.suspectIndices ?? []).length > 0 &&
              " The marked points above are the suspects."}
          </p>
        )}

        {outcome?.ok === true && (
          <div className="space-y-1">
            <p className="text-label">
              The outline lines up {verdictText(outcome.quality.rmsErrorPx)} —{" "}
              <span className="tabular-nums">{outcome.quality.rmsErrorPx.toFixed(1)} px</span>{" "}
              average error.
            </p>
            {outcome.quality.warning && (
              <p className="text-label text-warning">{outcome.quality.warning}</p>
            )}
          </div>
        )}

        {coverage && (
          <p
            className={cn(
              "text-label",
              isNarrowCoverage(coverage) ? "text-warning" : "text-muted-foreground",
            )}
          >
            {describeCoverage(coverage)}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button size="xs" disabled={!outcome?.ok} onClick={() => void save(frame)}>
            {editingId === null ? "Save calibration" : "Save changes"}
          </Button>
          {outcome?.ok === true && outcome.quality.verdict === "poor" && (
            <Button variant="outline" size="xs" onClick={() => void save(frame, true)}>
              Save anyway
            </Button>
          )}
          <Button
            variant="ghost"
            size="xs"
            onClick={() => clearPicks()}
            disabled={picks.length === 0}
          >
            Start over
          </Button>
        </div>
      </section>

      <section className="space-y-2 border-t border-border pt-3">
        <h3 className="text-label text-muted-foreground">Applies from</h3>
        <div className="flex items-center gap-2">
          <Input
            type="number"
            min={0}
            step={1000}
            value={fromMs}
            aria-label="Applies from, in milliseconds"
            className="h-7 w-28 text-label"
            onChange={(event) => setFromMs(Number(event.currentTarget.value))}
          />
          <Button variant="outline" size="xs" onClick={() => setFromMs(playback.timeMs)}>
            Use the playhead
          </Button>
        </div>
        <p className="text-caption text-muted-foreground">
          Leave it at zero for the whole video. Set a later time when the camera changes, and the
          earlier calibration keeps applying to the moments before it.
        </p>
      </section>

      <section className="space-y-2 border-t border-border pt-3">
        <h3 className="text-label text-muted-foreground">Pitch size</h3>
        <div className="flex items-center gap-2">
          <Label className="text-label text-muted-foreground">Length</Label>
          <Input
            type="number"
            min={1}
            value={pitchLengthM}
            aria-label="Pitch length in metres"
            className="h-7 w-20 text-label"
            onChange={(event) =>
              setPitchSize({
                lengthM: Number(event.currentTarget.value) || pitchLengthM,
                widthM: pitchWidthM,
              })
            }
          />
          <Label className="text-label text-muted-foreground">Width</Label>
          <Input
            type="number"
            min={1}
            value={pitchWidthM}
            aria-label="Pitch width in metres"
            className="h-7 w-20 text-label"
            onChange={(event) =>
              setPitchSize({
                lengthM: pitchLengthM,
                widthM: Number(event.currentTarget.value) || pitchWidthM,
              })
            }
          />
        </div>
        <p className="text-caption text-muted-foreground">
          Only the length and width vary between grounds; the areas, spots and circles follow the
          Laws.
        </p>
      </section>

      {error && (
        <p
          role="alert"
          className="rounded-md border border-danger/40 bg-danger/10 px-2 py-1.5 text-label"
        >
          {error}
        </p>
      )}
    </div>
  );
}
