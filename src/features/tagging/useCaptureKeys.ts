import { useEffect } from "react";
import type { Tag } from "@/lib/db/queries/taxonomy";
import { isTypingTarget } from "@/lib/keyboard/typing";
import { playback } from "@/lib/playback";
import { findTagByShortcut } from "@/lib/taxonomy/rules";
import { useEventStore } from "@/stores/eventStore";
import { useLibraryStore } from "@/stores/libraryStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useSquadStore } from "@/stores/squadStore";
import { useTagStore } from "@/stores/tagStore";

/**
 * One keystroke, one event (FR-5).
 *
 * The tag map comes from the database, not from a hardcoded list, and the
 * player's live position comes from the playback controller rather than React
 * state — so a capture records the moment the key was pressed, not the moment
 * the UI last rendered.
 */

async function captureNow(tag: Tag): Promise<void> {
  const library = useLibraryStore.getState();
  const events = useEventStore.getState();
  const settings = useSettingsStore.getState();
  const taxonomy = useTagStore.getState();
  const squad = useSquadStore.getState();

  const matchId = library.currentMatchId;
  const videoId = library.activeVideoId;

  if (!matchId) {
    events.reportError("Create or open a match before tagging.");
    return;
  }
  if (!videoId) {
    events.reportError("Add a video to this match before tagging.");
    return;
  }

  const teamId = taxonomy.activeTeamId;
  const playerId = taxonomy.activePlayerId;
  const team = teamId === null ? undefined : squad.teams[teamId];
  const player =
    playerId === null
      ? undefined
      : (squad.players[teamId ?? -1] ?? []).find((candidate) => candidate.id === playerId);

  await events.capture({
    matchId,
    videoId,
    tagId: tag.id,
    tagName: tag.name,
    tagColor: tag.color,
    categoryName:
      taxonomy.categories.find((category) => category.id === tag.categoryId)?.name ?? "",
    teamId,
    teamName: team?.name ?? null,
    playerId,
    playerName: player?.name ?? null,
    anchorMs: playback.timeMs,
    preRollMs: settings.preRollMs,
    postRollMs: settings.postRollMs,
    durationMs: library.probe?.durationMs ?? playback.durationMs,
  });
}

export function useCaptureKeys(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;

      // Undo the last capture, even if that same letter is also bound to a tag.
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        void useEventStore.getState().undoLast();
        return;
      }

      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const tag = findTagByShortcut(useTagStore.getState().tags, event.key);
      if (!tag) return;

      event.preventDefault();
      void captureNow(tag);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
}
