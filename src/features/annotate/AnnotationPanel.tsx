import { AnnotationLayers } from "./AnnotationLayers";
import { AnnotationToolbar } from "./AnnotationToolbar";

/** The Draw tab: tools, the selected shape's inspector, and the layer stack. */
export function AnnotationPanel() {
  return (
    <div className="space-y-4">
      <h2 className="text-title">Draw</h2>
      <AnnotationToolbar />

      <div className="space-y-2 border-t border-border pt-3">
        <h3 className="text-label text-muted-foreground">Layers</h3>
        <AnnotationLayers />
      </div>
    </div>
  );
}
