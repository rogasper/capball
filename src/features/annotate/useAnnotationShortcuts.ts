import { useEffect } from "react";
import { isTypingTarget } from "@/lib/keyboard/typing";
import { useAnnotationStore } from "@/stores/annotationStore";

/**
 * The editor's own keys, and the reason tagging shortcuts stay quiet while a
 * tool is active (FR-20.7, NFR-25).
 *
 * This listener only acts when the editor has something to act on: a tool in
 * hand or a shape selected. Otherwise the keyboard belongs to playback and
 * capture, exactly as before.
 */
export function useAnnotationShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;

      const store = useAnnotationStore.getState();
      if (store.eventId === null) return;

      const drawing = store.tool !== null;
      const editing = store.selectedId !== null;
      if (!drawing && !editing) return;

      const undoChord = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z";

      if (undoChord) {
        event.preventDefault();
        if (event.shiftKey) void store.redo();
        else void store.undo();
        return;
      }

      if (event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.key === "Escape") {
        event.preventDefault();
        if (store.draft || store.draftPoints) store.cancelDraft();
        else store.select(null);
        return;
      }

      if (event.key === "Enter" && store.tool === "polygon") {
        event.preventDefault();
        void store.commitDraft();
        return;
      }

      if ((event.key === "Delete" || event.key === "Backspace") && store.selectedId !== null) {
        event.preventDefault();
        void store.remove(store.selectedId);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
