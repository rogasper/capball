import { create } from "zustand";
import {
  boxCenterPx,
  type HandleName,
  moveBy as moveGeometryBy,
  normalizePoint,
  type Point,
  pathGeometry,
  type Rect,
  resizeBy as resizeGeometryBy,
  rotateTo as rotateGeometryTo,
  rotatePoint,
  simplifyPath,
} from "@/lib/annotate/geometry";
import { sortByLayer } from "@/lib/annotate/primitives";
import {
  type Annotation,
  type AnnotationStyle,
  DEFAULT_STYLE,
  type Geometry,
  type ShapeKind,
  type WindowMode,
} from "@/lib/annotate/types";
import { edgeMidpoint, insertVertex, moveVertex, removeVertex } from "@/lib/annotate/vertices";
import * as annotationsQuery from "@/lib/db/queries/annotations";

/**
 * The annotation editor's state (plans/technical-design-R1.md §8).
 *
 * Two rules shape this store:
 *
 * 1. **Writes are gesture-scoped** (D24). Dragging updates the local row on
 *    every pointer move and persists once, on release, so a polygon drag is one
 *    write rather than hundreds.
 * 2. **Undo is an explicit command stack**, not a store snapshot, and undoing a
 *    deletion restores the drawing with its original `uid` — which is what keeps
 *    a restored shape the same shape as far as a later export or import is
 *    concerned.
 */

const MAX_UNDO = 50;

/** The style a new shape starts from when nothing is loaded yet. */
export const INITIAL_WINDOW_MS = 2_500;

type Patch = {
  geometry?: Geometry;
  /** Only a reshape changes this: a rectangle minus a corner is a polygon. */
  kind?: ShapeKind;
  style?: AnnotationStyle;
  windowMode?: WindowMode;
  windowMs?: number;
  label?: string | null;
};

type Command =
  | { kind: "create"; annotation: Annotation }
  | { kind: "delete"; annotation: Annotation }
  | { kind: "patch"; id: number; before: Patch; after: Patch };

type AnnotationState = {
  /** The event whose drawings are open. Drawing requires one (FR-20.8). */
  eventId: number | null;
  annotations: Annotation[];
  selectedId: number | null;

  /** `null` means no drawing tool is active and tag shortcuts still fire. */
  tool: ShapeKind | null;
  /** The shape being dragged out, before it is stored. */
  draft: Geometry | null;
  /** Freehand points collected so far, in normalised frame coordinates. */
  draftPoints: Point[] | null;
  draftLabel: string | null;
  /** The geometry the drag in progress started from. */
  dragOrigin: Geometry | null;

  style: AnnotationStyle;
  windowMode: WindowMode;
  windowMs: number;

  undoStack: Command[];
  redoStack: Command[];
  error: string | null;

  load: (eventId: number) => Promise<void>;
  /** How many drawings an event holds, for the deletion confirmation (FR-20.6). */
  countDrawings: (eventId: number) => Promise<number>;
  clear: () => void;

  setTool: (tool: ShapeKind | null) => void;
  setStyle: (patch: Partial<AnnotationStyle>) => void;
  setWindow: (mode: WindowMode, ms?: number) => void;

  beginDraft: (geometry: Geometry) => void;
  updateDraft: (geometry: Geometry) => void;
  updateDraftPoints: (points: Point[]) => void;
  setDraftLabel: (label: string) => void;
  cancelDraft: () => void;
  commitDraft: () => Promise<void>;

  select: (id: number | null) => void;
  /** Captures the geometry a drag starts from, so release can tell if it moved. */
  beginDrag: () => void;
  /** Live geometry during a drag; persisted by `commitGeometry`. */
  applyGeometry: (geometry: Geometry) => void;
  moveSelected: (delta: Point) => void;
  resizeSelected: (handle: HandleName, toPx: Point, rect: Rect) => void;
  rotateSelected: (toPx: Point, rect: Rect) => void;
  /** Reshaping (FR-20.11): one vertex, or the shape's corner count. */
  moveVertexTo: (index: number, toPx: Point, rect: Rect) => void;
  insertVertexAfter: (index: number) => Promise<void>;
  removeVertexAt: (index: number) => Promise<void>;
  commitGeometry: () => Promise<void>;

  setLabel: (id: number, label: string) => Promise<void>;
  remove: (id: number) => Promise<void>;
  reorder: (orderedIds: number[]) => Promise<void>;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  reportError: (message: string) => void;
  clearError: () => void;
};

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

function nextZ(annotations: Annotation[]): number {
  return annotations.reduce((highest, annotation) => Math.max(highest, annotation.z), -1) + 1;
}

function replace(annotations: Annotation[], id: number, patch: Partial<Annotation>): Annotation[] {
  return annotations.map((annotation) =>
    annotation.id === id ? { ...annotation, ...patch } : annotation,
  );
}

export const useAnnotationStore = create<AnnotationState>((set, get) => {
  function pushCommand(command: Command): void {
    set((state) => ({
      undoStack: [...state.undoStack, command].slice(-MAX_UNDO),
      redoStack: [],
    }));
  }

  function applyPatch(id: number, patch: Patch): void {
    set((state) => ({
      annotations: replace(state.annotations, id, patch),
    }));
  }

  return {
    eventId: null,
    annotations: [],
    selectedId: null,
    tool: null,
    draft: null,
    draftPoints: null,
    draftLabel: null,
    dragOrigin: null,
    style: { ...DEFAULT_STYLE },
    windowMode: "moment",
    windowMs: INITIAL_WINDOW_MS,
    undoStack: [],
    redoStack: [],
    error: null,

    async load(eventId) {
      try {
        const rows = await annotationsQuery.listAnnotations(eventId);
        set({
          eventId,
          annotations: sortByLayer(rows),
          selectedId: null,
          draft: null,
          draftPoints: null,
          draftLabel: null,
          dragOrigin: null,
          undoStack: [],
          redoStack: [],
          error: null,
        });
      } catch (error) {
        set({ eventId, annotations: [], error: messageOf(error) });
      }
    },

    async countDrawings(eventId) {
      if (get().eventId === eventId) return get().annotations.length;
      try {
        return await annotationsQuery.countAnnotations(eventId);
      } catch (error) {
        set({ error: messageOf(error) });
        return 0;
      }
    },

    clear() {
      set({
        eventId: null,
        annotations: [],
        selectedId: null,
        tool: null,
        draft: null,
        draftPoints: null,
        draftLabel: null,
        dragOrigin: null,
        undoStack: [],
        redoStack: [],
        error: null,
      });
    },

    setTool(tool) {
      set({ tool, draft: null, draftPoints: null, draftLabel: null });
    },

    /** Applies to the selected shape *and* becomes the style of the next one (FR-20.5). */
    setStyle(patch) {
      const style = { ...get().style, ...patch };
      const id = get().selectedId;
      set({ style });

      if (id === null) return;
      const before = get().annotations.find((annotation) => annotation.id === id);
      if (!before) return;

      applyPatch(id, { style });
      pushCommand({ kind: "patch", id, before: { style: before.style }, after: { style } });
      void annotationsQuery.updateAnnotationStyle(id, style).catch((error) => {
        set({ error: messageOf(error) });
      });
    },

    setWindow(mode, ms) {
      const windowMs = Math.max(0, Math.round(ms ?? get().windowMs));
      const id = get().selectedId;
      set({ windowMode: mode, windowMs });

      if (id === null) return;
      const before = get().annotations.find((annotation) => annotation.id === id);
      if (!before) return;

      applyPatch(id, { windowMode: mode, windowMs });
      pushCommand({
        kind: "patch",
        id,
        before: { windowMode: before.windowMode, windowMs: before.windowMs },
        after: { windowMode: mode, windowMs },
      });
      void annotationsQuery.updateAnnotationWindow(id, mode, windowMs).catch((error) => {
        set({ error: messageOf(error) });
      });
    },

    beginDraft(geometry) {
      set({ draft: geometry });
    },

    updateDraft(geometry) {
      set({ draft: geometry });
    },

    updateDraftPoints(points) {
      set({ draftPoints: points });
    },

    setDraftLabel(label) {
      set({ draftLabel: label });
    },

    cancelDraft() {
      set({ draft: null, draftPoints: null, draftLabel: null });
    },

    async commitDraft() {
      const { eventId, tool, draft, draftPoints, draftLabel, style, windowMode, windowMs } = get();
      if (eventId === null || tool === null) return;

      const geometry =
        tool === "freehand"
          ? draftPoints && draftPoints.length >= 2
            ? pathGeometry(simplifyPath(draftPoints, 0.002))
            : null
          : draft;

      if (!geometry) return;

      const draftAnnotation: Annotation = {
        id: -1,
        uid: crypto.randomUUID(),
        eventId,
        kind: tool,
        windowMode,
        windowMs,
        geometry,
        style: { ...style },
        label: tool === "text" ? (draftLabel ?? "") : (draftLabel ?? null),
        z: nextZ(get().annotations),
      };

      set({ draft: null, draftPoints: null, draftLabel: null });

      try {
        const stored = await annotationsQuery.createAnnotation({
          uid: draftAnnotation.uid,
          eventId,
          kind: draftAnnotation.kind,
          windowMode,
          windowMs,
          geometry,
          style: draftAnnotation.style,
          label: draftAnnotation.label,
          z: draftAnnotation.z,
        });

        set((state) => ({
          annotations: sortByLayer([...state.annotations, stored]),
          selectedId: stored.id,
          error: null,
        }));
        pushCommand({ kind: "create", annotation: stored });
      } catch (error) {
        set({ error: messageOf(error) });
      }
    },

    select(id) {
      set({ selectedId: id });
    },

    beginDrag() {
      const { selectedId, annotations } = get();
      const current = annotations.find((annotation) => annotation.id === selectedId);
      set({ dragOrigin: current ? current.geometry : null });
    },

    applyGeometry(geometry) {
      const id = get().selectedId;
      if (id === null) return;
      applyPatch(id, { geometry });
    },

    moveSelected(delta) {
      const { selectedId, annotations } = get();
      const current = annotations.find((annotation) => annotation.id === selectedId);
      if (!current) return;
      applyPatch(current.id, { geometry: moveGeometryBy(current.geometry, delta[0], delta[1]) });
    },

    resizeSelected(handle, toPx, rect) {
      const { selectedId, annotations } = get();
      const current = annotations.find((annotation) => annotation.id === selectedId);
      if (!current) return;
      applyPatch(current.id, { geometry: resizeGeometryBy(current, handle, toPx, rect) });
    },

    rotateSelected(toPx, rect) {
      const { selectedId, annotations } = get();
      const current = annotations.find((annotation) => annotation.id === selectedId);
      if (!current) return;
      applyPatch(current.id, { geometry: rotateGeometryTo(current.geometry, toPx, rect) });
    },

    /**
     * Drags one vertex of a polygon, line or arrow.
     *
     * The pointer arrives in the rotated space the user sees, so it is turned
     * back about the box centre before it is stored — without that, dragging a
     * corner of a rotated zone would move the vertex somewhere else.
     */
    moveVertexTo(index, toPx, rect) {
      const { selectedId, annotations } = get();
      const current = annotations.find((annotation) => annotation.id === selectedId);
      if (!current) return;

      const centre = boxCenterPx(current.geometry, rect);
      const local = rotatePoint(toPx, centre, -current.geometry.rotation);
      const to = normalizePoint(rect, local[0], local[1]);
      const edit = moveVertex(current, index, to);
      if (edit) applyPatch(current.id, { geometry: edit.geometry });
    },

    /**
     * Adds a corner on the edge that starts at `index`.
     *
     * The whole shape is replaced in one command and one write, because the
     * corner count changes what the shape *is*: a rectangle becomes a polygon
     * (FR-20.11), and an undo has to restore the kind as well as the geometry.
     */
    async insertVertexAfter(index) {
      const { selectedId, annotations } = get();
      const current = annotations.find((annotation) => annotation.id === selectedId);
      if (!current) return;

      const at = edgeMidpoint(current, index);
      const edit = at ? insertVertex(current, index, at) : null;
      if (!edit) {
        set({ error: "This shape cannot take another corner." });
        return;
      }

      applyPatch(current.id, edit);
      pushCommand({
        kind: "patch",
        id: current.id,
        before: { kind: current.kind, geometry: current.geometry },
        after: { kind: edit.kind, geometry: edit.geometry },
      });

      try {
        await annotationsQuery.updateAnnotationShape(current.id, edit.kind, edit.geometry);
      } catch (error) {
        applyPatch(current.id, { kind: current.kind, geometry: current.geometry });
        set({ error: messageOf(error) });
      }
    },

    /** Removes a corner, closing the outline over the rest. */
    async removeVertexAt(index) {
      const { selectedId, annotations } = get();
      const current = annotations.find((annotation) => annotation.id === selectedId);
      if (!current) return;

      const edit = removeVertex(current, index);
      if (!edit) {
        set({ error: "This shape has no corner to spare — a line needs both its ends." });
        return;
      }

      applyPatch(current.id, edit);
      pushCommand({
        kind: "patch",
        id: current.id,
        before: { kind: current.kind, geometry: current.geometry },
        after: { kind: edit.kind, geometry: edit.geometry },
      });

      try {
        await annotationsQuery.updateAnnotationShape(current.id, edit.kind, edit.geometry);
      } catch (error) {
        applyPatch(current.id, { kind: current.kind, geometry: current.geometry });
        set({ error: messageOf(error) });
      }
    },

    /** Persists the geometry a drag produced, as one command and one write. */
    async commitGeometry() {
      const { selectedId, annotations, dragOrigin } = get();
      const current = annotations.find((annotation) => annotation.id === selectedId);
      set({ dragOrigin: null });
      if (!current) return;

      const previous = dragOrigin ?? current.geometry;
      if (sameGeometry(previous, current.geometry)) return;

      const id = current.id;
      const geometry = current.geometry;
      pushCommand({ kind: "patch", id, before: { geometry: previous }, after: { geometry } });

      try {
        await annotationsQuery.updateAnnotationGeometry(id, geometry);
      } catch (error) {
        applyPatch(id, { geometry: previous });
        set({ error: messageOf(error) });
      }
    },

    async setLabel(id, label) {
      const before = get().annotations.find((annotation) => annotation.id === id);
      if (!before) return;
      const trimmed = label.trim();
      const next = trimmed.length > 0 ? trimmed : null;
      if (before.label === next) return;

      applyPatch(id, { label: next });
      pushCommand({ kind: "patch", id, before: { label: before.label }, after: { label: next } });

      try {
        await annotationsQuery.updateAnnotationLabel(id, next);
      } catch (error) {
        applyPatch(id, { label: before.label });
        set({ error: messageOf(error) });
      }
    },

    async remove(id) {
      const { annotations } = get();
      const removed = annotations.find((annotation) => annotation.id === id);
      if (!removed) return;

      set((state) => ({
        annotations: state.annotations.filter((annotation) => annotation.id !== id),
        selectedId: state.selectedId === id ? null : state.selectedId,
      }));

      try {
        await annotationsQuery.deleteAnnotation(id);
        pushCommand({ kind: "delete", annotation: removed });
      } catch (error) {
        set((state) => ({
          annotations: sortByLayer([...state.annotations, removed]),
          error: messageOf(error),
        }));
      }
    },

    async reorder(orderedIds) {
      const { annotations, eventId } = get();
      if (eventId === null) return;

      const byId = new Map(annotations.map((annotation) => [annotation.id, annotation]));
      const reordered = orderedIds
        .map((id, index) => {
          const annotation = byId.get(id);
          return annotation ? { ...annotation, z: index } : null;
        })
        .filter((annotation): annotation is Annotation => annotation !== null);

      if (reordered.length !== annotations.length) return;

      set({ annotations: sortByLayer(reordered) });
      try {
        await annotationsQuery.reorderAnnotations(eventId, orderedIds);
      } catch (error) {
        set({ annotations: sortByLayer(annotations), error: messageOf(error) });
      }
    },

    async undo() {
      const command = get().undoStack.at(-1);
      if (!command) return;

      set((state) => ({
        undoStack: state.undoStack.slice(0, -1),
        redoStack: [...state.redoStack, command],
      }));

      try {
        if (command.kind === "create") {
          const id = liveId(get().annotations, command.annotation.uid);
          if (id === null) return;
          await annotationsQuery.deleteAnnotation(id);
          set((state) => ({
            annotations: state.annotations.filter((annotation) => annotation.id !== id),
            selectedId: state.selectedId === id ? null : state.selectedId,
          }));
          return;
        }

        if (command.kind === "delete") {
          const restored = await reinsert(command.annotation);
          set((state) => ({ annotations: sortByLayer([...state.annotations, restored]) }));
          return;
        }

        applyPatch(command.id, command.before);
        await writePatch(command.id, command.before);
      } catch (error) {
        set({ error: messageOf(error) });
      }
    },

    async redo() {
      const command = get().redoStack.at(-1);
      if (!command) return;

      set((state) => ({
        redoStack: state.redoStack.slice(0, -1),
        undoStack: [...state.undoStack, command],
      }));

      try {
        if (command.kind === "create") {
          const restored = await reinsert(command.annotation);
          set((state) => ({ annotations: sortByLayer([...state.annotations, restored]) }));
          return;
        }

        if (command.kind === "delete") {
          // Resolved through the uid: an earlier undo may have re-inserted this
          // shape under a new row id, and the stale id would delete nothing.
          const id = liveId(get().annotations, command.annotation.uid);
          if (id === null) return;
          await annotationsQuery.deleteAnnotation(id);
          set((state) => ({
            annotations: state.annotations.filter((annotation) => annotation.id !== id),
            selectedId: state.selectedId === id ? null : state.selectedId,
          }));
          return;
        }

        applyPatch(command.id, command.after);
        await writePatch(command.id, command.after);
      } catch (error) {
        set({ error: messageOf(error) });
      }
    },

    reportError(message) {
      set({ error: message });
    },

    clearError() {
      set({ error: null });
    },
  };
});

async function writePatch(id: number, patch: Patch): Promise<void> {
  // A reshape writes kind and geometry in one statement: two would leave the row
  // briefly inconsistent if the second failed (see `updateAnnotationShape`).
  if (patch.kind !== undefined && patch.geometry) {
    await annotationsQuery.updateAnnotationShape(id, patch.kind, patch.geometry);
  } else if (patch.geometry) {
    await annotationsQuery.updateAnnotationGeometry(id, patch.geometry);
  }
  if (patch.style) await annotationsQuery.updateAnnotationStyle(id, patch.style);
  if (patch.windowMode !== undefined && patch.windowMs !== undefined) {
    await annotationsQuery.updateAnnotationWindow(id, patch.windowMode, patch.windowMs);
  }
  if (patch.label !== undefined) await annotationsQuery.updateAnnotationLabel(id, patch.label);
}

/** Re-creates a removed shape under its original uid, so it is the same shape. */
function reinsert(annotation: Annotation): Promise<Annotation> {
  return annotationsQuery.createAnnotation({
    uid: annotation.uid,
    eventId: annotation.eventId,
    kind: annotation.kind,
    windowMode: annotation.windowMode,
    windowMs: annotation.windowMs,
    geometry: annotation.geometry,
    style: annotation.style,
    label: annotation.label,
    z: annotation.z,
  });
}

/**
 * The row id a shape currently has, found by its stable uid.
 *
 * A restored shape gets a fresh row id, so any command that remembers an id
 * from before an undo would act on a row that no longer exists.
 */
function liveId(annotations: Annotation[], uid: string): number | null {
  return annotations.find((annotation) => annotation.uid === uid)?.id ?? null;
}

function sameGeometry(a: Geometry, b: Geometry): boolean {
  return (
    a.x === b.x &&
    a.y === b.y &&
    a.w === b.w &&
    a.h === b.h &&
    a.rotation === b.rotation &&
    JSON.stringify(a.points ?? []) === JSON.stringify(b.points ?? [])
  );
}
