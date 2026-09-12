import type { Tag } from "@/lib/db/queries/taxonomy";
import type { EventDraft } from "@/stores/eventStore";
import { useLibraryStore } from "@/stores/libraryStore";
import { useSquadStore } from "@/stores/squadStore";
import { useTagStore } from "@/stores/tagStore";

export type DraftTimes = {
  /** The moment the event is about. */
  anchorMs: number;
  startMs: number;
  endMs: number;
};

/**
 * Assembles everything an event needs from the current app state.
 *
 * Shared by the keyboard capture path and the timeline's range selection, so
 * both produce identical events — including the active team and player context
 * (FR-7) — and both fail with the same plain message when there is nothing to
 * tag against.
 */
export function buildEventDraft(tag: Tag, times: DraftTimes): EventDraft {
  const library = useLibraryStore.getState();
  const taxonomy = useTagStore.getState();
  const squad = useSquadStore.getState();

  const { currentMatchId, activeVideoId } = library;
  if (!currentMatchId) throw new Error("Create or open a match before tagging.");
  if (!activeVideoId) throw new Error("Add a video to this match before tagging.");

  const teamId = taxonomy.activeTeamId;
  const playerId = taxonomy.activePlayerId;
  const team = teamId === null ? undefined : squad.teams[teamId];
  const player =
    playerId === null
      ? undefined
      : (squad.players[teamId ?? -1] ?? []).find((candidate) => candidate.id === playerId);

  return {
    matchId: currentMatchId,
    videoId: activeVideoId,
    tagId: tag.id,
    tagName: tag.name,
    tagColor: tag.color,
    categoryName:
      taxonomy.categories.find((category) => category.id === tag.categoryId)?.name ?? "",
    teamId,
    teamName: team?.name ?? null,
    playerId,
    playerName: player?.name ?? null,
    anchorMs: Math.round(times.anchorMs),
    startMs: Math.round(times.startMs),
    endMs: Math.round(times.endMs),
  };
}
