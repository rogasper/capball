import { ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Annotation, ShapeKind } from "@/lib/annotate/types";
import { cn } from "@/lib/utils";
import { useAnnotationStore } from "@/stores/annotationStore";

/**
 * The annotation list *is* the layer stack (FR-20.6, technical-design-R1 §5.5):
 * array order is z-order, shown front to back.
 *
 * It also serves as the accessible surface — the canvas is pixels, so this is
 * where a shape can be picked with the keyboard and read by a screen reader.
 */

const KIND_LABELS: Record<ShapeKind, string> = {
  arrow: "Arrow",
  line: "Line",
  rect: "Rectangle",
  ellipse: "Ellipse",
  polygon: "Zone",
  freehand: "Freehand",
  text: "Text",
};

export function describeAnnotation(annotation: Annotation): string {
  const kind = KIND_LABELS[annotation.kind];
  return annotation.label ? `${kind} · ${annotation.label}` : kind;
}

export function AnnotationLayers() {
  const eventId = useAnnotationStore((state) => state.eventId);
  const annotations = useAnnotationStore((state) => state.annotations);
  const selectedId = useAnnotationStore((state) => state.selectedId);
  const select = useAnnotationStore((state) => state.select);
  const reorder = useAnnotationStore((state) => state.reorder);
  const remove = useAnnotationStore((state) => state.remove);

  if (eventId === null) {
    return <p className="text-body text-muted-foreground">No event selected.</p>;
  }

  if (annotations.length === 0) {
    return (
      <p className="text-body text-muted-foreground">
        Nothing drawn on this event yet. Pick a tool and draw on the paused frame.
      </p>
    );
  }

  const front = [...annotations].reverse();

  const shift = (id: number, delta: number) => {
    const order = annotations.map((annotation) => annotation.id);
    const at = order.indexOf(id);
    const to = at + delta;
    if (at === -1 || to < 0 || to >= order.length) return;
    const next = [...order];
    next.splice(at, 1);
    next.splice(to, 0, id);
    void reorder(next);
  };

  return (
    <ul className="space-y-1">
      {front.map((annotation) => (
        <li key={annotation.id} className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => select(annotation.id)}
            aria-current={annotation.id === selectedId}
            className={cn(
              "min-w-0 flex-1 truncate rounded-md px-2 py-1 text-left text-label",
              annotation.id === selectedId ? "bg-muted text-foreground" : "hover:bg-muted/60",
            )}
          >
            {describeAnnotation(annotation)}
          </button>

          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`Bring ${describeAnnotation(annotation)} forward`}
            onClick={() => shift(annotation.id, 1)}
          >
            <ChevronUp aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`Send ${describeAnnotation(annotation)} back`}
            onClick={() => shift(annotation.id, -1)}
          >
            <ChevronDown aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`Delete ${describeAnnotation(annotation)}`}
            onClick={() => void remove(annotation.id)}
          >
            <Trash2 aria-hidden="true" />
          </Button>
        </li>
      ))}
    </ul>
  );
}
