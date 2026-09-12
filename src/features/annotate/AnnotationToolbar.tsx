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
import type { ShapeKind } from "@/lib/annotate/types";
import { cn } from "@/lib/utils";
import { useAnnotationStore } from "@/stores/annotationStore";
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
  const setWindow = useAnnotationStore((state) => state.setWindow);
  const remove = useAnnotationStore((state) => state.remove);
  const setLabel = useAnnotationStore((state) => state.setLabel);
  const undo = useAnnotationStore((state) => state.undo);
  const redo = useAnnotationStore((state) => state.redo);
  const draftPoints = useAnnotationStore((state) => state.draftPoints);
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

      <div className="space-y-1.5">
        <Label className="text-label text-muted-foreground">On screen for</Label>
        <div className="flex items-center gap-2">
          <Select
            value={windowMode}
            onValueChange={(value) => setWindow(value as typeof windowMode, windowMs)}
          >
            <SelectTrigger size="sm" className="h-7 flex-1 text-label" aria-label="Time window">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="moment">Its own moment</SelectItem>
              <SelectItem value="event">The event's clips</SelectItem>
              <SelectItem value="clip">The whole clip</SelectItem>
            </SelectContent>
          </Select>

          {windowMode === "moment" && (
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
