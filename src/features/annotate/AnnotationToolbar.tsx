import {
  ArrowRight,
  Circle,
  Minus,
  MousePointer2,
  Pencil,
  Pentagon,
  Redo2,
  Square,
  Trash2,
  Type,
  Undo2,
} from "lucide-react";
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
import { STROKE_PRESETS, type StrokePreset, stylePatchOf } from "@/lib/annotate/presets";
import {
  type FillPattern,
  type ShapeKind,
  STROKE_PATTERNS,
  type StrokePattern,
} from "@/lib/annotate/types";
import { canEditVertices } from "@/lib/annotate/vertices";
import { defaultOwnWindow } from "@/lib/annotate/window";
import { playback } from "@/lib/playback";
import { STROKE_PATTERN_LABELS, strokePreviewPath } from "@/lib/render/stroke";
import { formatTimecode } from "@/lib/time/timecode";
import { cn } from "@/lib/utils";
import { useAnnotationStore } from "@/stores/annotationStore";
import { useEventStore } from "@/stores/eventStore";
import { usePlayerStore } from "@/stores/playerStore";

/**
 * The drawing tools and the selected shape's inspector (FR-20.2, FR-20.4, FR-20.5).
 *
 * Tools are disabled while the video plays, because a drawing belongs to a
 * frozen frame (OQ-3) — the UI says so rather than silently ignoring a drag.
 */

const TOOLS: { kind: ShapeKind; label: string; Icon: typeof Square }[] = [
  { kind: "arrow", label: "Arrow", Icon: ArrowRight },
  { kind: "line", label: "Line", Icon: Minus },
  { kind: "rect", label: "Rectangle", Icon: Square },
  { kind: "ellipse", label: "Ellipse or highlight", Icon: Circle },
  { kind: "polygon", label: "Zone", Icon: Pentagon },
  { kind: "freehand", label: "Freehand", Icon: Pencil },
  { kind: "text", label: "Text", Icon: Type },
];

const STROKE_SWATCHES = ["#4C8DFF", "#FF4C4C", "#FFB020", "#34D399", "#FFFFFF"];

/**
 * A line sample, at the pattern and width the renderer will use (FR-20.14).
 *
 * The toolbar shows the line rather than naming it, because "dashed" is a word
 * and a dash is the thing the user is choosing between.
 */
function StrokeSample({
  pattern,
  colour,
  width = 18,
  strokeWidth = 2,
}: {
  pattern: StrokePattern;
  colour: string;
  width?: number;
  strokeWidth?: number;
}) {
  const sample = strokePreviewPath(pattern, strokeWidth);
  return (
    <svg
      width={width}
      height={12}
      viewBox="0 0 24 12"
      aria-hidden="true"
      className="shrink-0"
      focusable="false"
    >
      <path
        d={sample.d}
        fill="none"
        stroke={colour}
        strokeWidth={sample.strokeWidth}
        strokeLinecap="round"
        strokeDasharray={sample.dash ?? undefined}
      />
    </svg>
  );
}

/**
 * Fills carry an alpha so a zone marks an area without hiding the players in
 * it, and the swatch row is the *pattern's* colour, independent of the outline
 * (FR-20.12).
 */
const FILL_SWATCHES = ["#4C8DFF", "#FFB020", "#34D399", "#FF4C4C"];

const PATTERN_LABELS: Record<FillPattern, string> = {
  solid: "Solid",
  hatch: "Hatch",
  crossHatch: "Cross-hatch",
};

/** Spacing is a fraction of the picture's width, so it scales with the export. */
const PATTERN_SCALES: { label: string; value: number }[] = [
  { label: "Fine", value: 0.01 },
  { label: "Medium", value: 0.02 },
  { label: "Coarse", value: 0.04 },
];

const PATTERN_ANGLES: { label: string; value: number }[] = [
  { label: "Diagonal up", value: -Math.PI / 4 },
  { label: "Diagonal down", value: Math.PI / 4 },
  { label: "Horizontal", value: 0 },
  { label: "Vertical", value: Math.PI / 2 },
];

export function AnnotationToolbar() {
  const paused = usePlayerStore((state) => state.paused);
  const eventId = useAnnotationStore((state) => state.eventId);
  const tool = useAnnotationStore((state) => state.tool);
  const setTool = useAnnotationStore((state) => state.setTool);
  const selectedId = useAnnotationStore((state) => state.selectedId);
  const annotations = useAnnotationStore((state) => state.annotations);
  const style = useAnnotationStore((state) => state.style);
  const setStyle = useAnnotationStore((state) => state.setStyle);
  const windowMode = useAnnotationStore((state) => state.windowMode);
  const windowMs = useAnnotationStore((state) => state.windowMs);
  const ownWindow = useAnnotationStore((state) => state.ownWindow);
  const setWindow = useAnnotationStore((state) => state.setWindow);
  const setOwnWindow = useAnnotationStore((state) => state.setOwnWindow);
  const durationMs = usePlayerStore((state) => state.durationMs);
  // The event's own span, which is the scale the range's bar is drawn against.
  const event = useEventStore((state) =>
    eventId === null ? null : (state.events.find((candidate) => candidate.id === eventId) ?? null),
  );
  const remove = useAnnotationStore((state) => state.remove);
  const setLabel = useAnnotationStore((state) => state.setLabel);
  const undo = useAnnotationStore((state) => state.undo);
  const redo = useAnnotationStore((state) => state.redo);
  const draftPoints = useAnnotationStore((state) => state.draftPoints);
  const notice = useAnnotationStore((state) => state.notice);
  const error = useAnnotationStore((state) => state.error);
  const canUndo = useAnnotationStore((state) => state.undoStack.length > 0);
  const canRedo = useAnnotationStore((state) => state.redoStack.length > 0);

  const selected = annotations.find((annotation) => annotation.id === selectedId) ?? null;

  if (eventId === null) {
    return (
      <p className="text-body text-muted-foreground">
        Select an event to draw on it. A drawing always belongs to a moment, so tag the moment first
        if it is not in the list yet.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {!paused && (
        <p className="rounded-md border border-border bg-muted px-2 py-1.5 text-label text-muted-foreground">
          Pause the video to draw. A drawing belongs to a single frozen frame.
        </p>
      )}

      {/* Feedback lives where the tools are. Without this a refusal — drawing
          freehand on the pitch, say — was recorded and never shown. */}
      {error && (
        <p className="rounded-md border border-danger/40 bg-danger/15 px-2 py-1.5 text-label">
          {error}
        </p>
      )}
      {!error && notice && (
        <p className="rounded-md border border-border bg-muted px-2 py-1.5 text-label text-muted-foreground">
          {notice}
        </p>
      )}

      <div className="space-y-1.5">
        <Label className="text-label text-muted-foreground">Tools</Label>
        <div className="flex flex-wrap gap-1">
          <Button
            variant={tool === null ? "default" : "outline"}
            size="icon-sm"
            aria-label="Select and edit"
            aria-pressed={tool === null}
            onClick={() => setTool(null)}
          >
            <MousePointer2 aria-hidden="true" />
          </Button>
          {TOOLS.map(({ kind, label, Icon }) => (
            <Button
              key={kind}
              variant={tool === kind ? "default" : "outline"}
              size="icon-sm"
              aria-label={label}
              aria-pressed={tool === kind}
              disabled={!paused}
              onClick={() => setTool(tool === kind ? null : kind)}
            >
              <Icon aria-hidden="true" />
            </Button>
          ))}
        </div>
      </div>

      {tool === "polygon" && (
        <p className="text-label text-muted-foreground">
          {draftPoints && draftPoints.length > 0
            ? `${draftPoints.length} point${draftPoints.length === 1 ? "" : "s"} — press Enter or double-click to close the zone.`
            : "Click each corner of the zone, then press Enter or double-click to close it."}
        </p>
      )}

      {/* The notation (FR-20.14). A preset sets the line style, colour, weight
          and head in one press: with a shape selected it restyles that shape,
          with nothing selected it arms the tool, and the tooltip says which. */}
      <div className="space-y-1.5">
        <Label className="text-label text-muted-foreground">Notation</Label>
        <div className="flex flex-wrap items-center gap-1">
          {STROKE_PRESETS.map((preset: StrokePreset) => {
            const active = style.stroke === preset.colour && style.strokePattern === preset.pattern;
            return (
              <Button
                key={preset.key}
                variant={active ? "default" : "outline"}
                size="xs"
                className="gap-1"
                aria-pressed={active}
                title={
                  selected === null
                    ? `Draw a ${preset.label.toLowerCase()} — ${preset.meaning}`
                    : `Restyle the selected shape — ${preset.meaning}`
                }
                onClick={() => {
                  // Restyle first: `setStyle` is what reaches a selection, and
                  // arming the tool is the part that only matters when drawing.
                  setStyle(stylePatchOf(preset));
                  if (selected === null) setTool(preset.tool);
                }}
              >
                <StrokeSample pattern={preset.pattern} colour={preset.colour} />
                {preset.label}
              </Button>
            );
          })}
        </div>
      </div>

      {/* The line style on its own, for a stroke that is not one of the five. */}
      <div className="space-y-1.5">
        <Label className="text-label text-muted-foreground">Line style</Label>
        <div className="flex flex-wrap items-center gap-1">
          {STROKE_PATTERNS.map((pattern: StrokePattern) => (
            <button
              key={pattern}
              type="button"
              aria-label={`${STROKE_PATTERN_LABELS[pattern]} line`}
              aria-pressed={style.strokePattern === pattern}
              title={STROKE_PATTERN_LABELS[pattern]}
              className={cn(
                "rounded-md border p-1",
                style.strokePattern === pattern ? "border-foreground" : "border-border",
              )}
              onClick={() => setStyle({ strokePattern: pattern })}
            >
              <StrokeSample pattern={pattern} colour={style.stroke} width={24} />
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="text-label text-muted-foreground">Colour</Label>
        <div className="flex flex-wrap items-center gap-1">
          {STROKE_SWATCHES.map((colour) => (
            <button
              key={colour}
              type="button"
              aria-label={`Colour ${colour}`}
              aria-pressed={style.stroke === colour}
              className={cn(
                "size-5 rounded-full border",
                style.stroke === colour ? "border-foreground" : "border-border",
              )}
              style={{ background: colour }}
              onClick={() => setStyle({ stroke: colour })}
            />
          ))}
          <Button
            variant={style.fill === null ? "outline" : "default"}
            size="xs"
            aria-pressed={style.fill !== null}
            onClick={() => setStyle({ fill: style.fill === null ? "#4C8DFF33" : null })}
          >
            Fill
          </Button>
        </div>
      </div>

      {style.fill !== null && (
        <div className="space-y-1.5">
          <Label className="text-label text-muted-foreground">Fill pattern</Label>
          <div className="flex flex-wrap items-center gap-1">
            {FILL_SWATCHES.map((colour) => (
              <button
                key={colour}
                type="button"
                aria-label={`Fill colour ${colour}`}
                aria-pressed={style.fill?.startsWith(colour) ?? false}
                className={cn(
                  "size-5 rounded-full border",
                  style.fill?.startsWith(colour) ? "border-foreground" : "border-border",
                )}
                style={{ background: `${colour}33` }}
                onClick={() => setStyle({ fill: `${colour}33` })}
              />
            ))}
          </div>

          <div className="flex items-center gap-1">
            <Select
              value={style.fillPattern}
              onValueChange={(value) => setStyle({ fillPattern: value as FillPattern })}
            >
              <SelectTrigger
                size="sm"
                className="h-7 flex-1 text-label"
                aria-label="Fill pattern type"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(PATTERN_LABELS) as FillPattern[]).map((pattern) => (
                  <SelectItem key={pattern} value={pattern}>
                    {PATTERN_LABELS[pattern]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {style.fillPattern !== "solid" && (
              <>
                <Select
                  value={String(style.patternScale)}
                  onValueChange={(value) => setStyle({ patternScale: Number(value) })}
                >
                  <SelectTrigger
                    size="sm"
                    className="h-7 w-24 text-label"
                    aria-label="Hatch spacing"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PATTERN_SCALES.map(({ label, value }) => (
                      <SelectItem key={label} value={String(value)}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select
                  value={String(style.patternAngle)}
                  onValueChange={(value) => setStyle({ patternAngle: Number(value) })}
                >
                  <SelectTrigger size="sm" className="h-7 w-28 text-label" aria-label="Hatch angle">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PATTERN_ANGLES.map(({ label, value }) => (
                      <SelectItem key={label} value={String(value)}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </>
            )}
          </div>

          <p className="text-caption text-muted-foreground">
            A hatch or cross-hatch keeps the area readable and tells two zones apart without colour.
          </p>
        </div>
      )}

      <div className="space-y-1.5">
        <Label className="text-label text-muted-foreground">On screen for</Label>
        <div className="flex items-center gap-2">
          <Select
            // A range wins over the mode, so the control shows the state that is
            // actually in effect rather than the one that was set and overridden.
            value={ownWindow === null ? windowMode : "range"}
            onValueChange={(value) => {
              if (value === "range") {
                void setOwnWindow(defaultOwnWindow(playback.timeMs, durationMs));
                return;
              }
              setWindow(value as typeof windowMode, windowMs);
            }}
          >
            <SelectTrigger size="sm" className="h-7 flex-1 text-label" aria-label="Time window">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="range">A range I set</SelectItem>
              <SelectItem value="moment">Its own moment</SelectItem>
              <SelectItem value="event">The event's clips</SelectItem>
              <SelectItem value="clip">The whole clip</SelectItem>
            </SelectContent>
          </Select>

          {ownWindow === null && windowMode === "moment" && (
            <Input
              type="number"
              min={200}
              step={100}
              value={windowMs}
              aria-label="Window length in milliseconds"
              className="h-7 w-24 text-label"
              onChange={(event) => setWindow("moment", Number(event.currentTarget.value))}
            />
          )}
        </div>

        {/* A drawing's own range (FR-20.16). The bar is the event's own span with
            the range inside it, so a range that falls outside the event is visible
            as such rather than quietly doing nothing. The three actions read the
            playhead, which is how this app sets every other time. */}
        {ownWindow !== null && (
          <div className="space-y-1.5">
            <div
              className="relative h-4 overflow-hidden rounded-sm border border-border bg-muted/40"
              role="img"
              aria-label={`On screen from ${formatTimecode(ownWindow.startMs)} to ${formatTimecode(ownWindow.endMs)}`}
            >
              {event && event.endMs > event.startMs && (
                <span
                  className="absolute inset-y-0 rounded-sm bg-primary/50"
                  style={{
                    left: `${((ownWindow.startMs - event.startMs) / (event.endMs - event.startMs)) * 100}%`,
                    width: `${((ownWindow.endMs - ownWindow.startMs) / (event.endMs - event.startMs)) * 100}%`,
                  }}
                />
              )}
              {event && (
                <span className="absolute inset-0 flex items-center justify-center font-mono text-caption tabular-nums text-foreground/80">
                  {formatTimecode(ownWindow.startMs)} → {formatTimecode(ownWindow.endMs)}
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-1">
              <Button
                variant="outline"
                size="xs"
                title="Set the start of the range to the playhead"
                onClick={() =>
                  void setOwnWindow({ startMs: playback.timeMs, endMs: ownWindow.endMs })
                }
              >
                Start here
              </Button>
              <Button
                variant="outline"
                size="xs"
                title="Set the end of the range to the playhead"
                onClick={() =>
                  void setOwnWindow({ startMs: ownWindow.startMs, endMs: playback.timeMs })
                }
              >
                End here
              </Button>
              {event && (
                <Button
                  variant="outline"
                  size="xs"
                  title="Widen the range to the event's own clip"
                  onClick={() => void setOwnWindow({ startMs: event.startMs, endMs: event.endMs })}
                >
                  The whole event
                </Button>
              )}
            </div>
          </div>
        )}
      </div>

      {selected && (
        <div className="space-y-1.5 border-t border-border pt-3">
          <Label className="text-label text-muted-foreground">
            {selected.kind === "text" ? "Text" : "Label (optional)"}
          </Label>
          <Input
            value={selected.label ?? ""}
            aria-label="Annotation label"
            placeholder={selected.kind === "text" ? "Say what this marks" : "Zone 14, second ball…"}
            className="h-7 text-label"
            onChange={(event) => void setLabel(selected.id, event.currentTarget.value)}
          />
          <p className="text-caption text-muted-foreground">
            A label is what makes a shape legible without relying on its colour.
          </p>
          <p className="text-caption text-muted-foreground">
            {canEditVertices(selected.kind)
              ? "Drag a corner to reshape it. The small hollow grip on an edge adds a corner, and Delete on a corner removes that one — a rectangle with a corner removed becomes a zone with three sides."
              : "Move, resize or rotate this shape: its handles are its box, not corners you can remove."}
          </p>
        </div>
      )}

      <div className="flex items-center gap-1 border-t border-border pt-3">
        <Button variant="outline" size="xs" onClick={() => void undo()} disabled={!canUndo}>
          <Undo2 aria-hidden="true" /> Undo
        </Button>
        <Button variant="outline" size="xs" onClick={() => void redo()} disabled={!canRedo}>
          <Redo2 aria-hidden="true" /> Redo
        </Button>
        {selected && (
          <Button
            variant="destructive"
            size="xs"
            className="ml-auto"
            onClick={() => void remove(selected.id)}
          >
            <Trash2 aria-hidden="true" /> Delete
          </Button>
        )}
      </div>
    </div>
  );
}
