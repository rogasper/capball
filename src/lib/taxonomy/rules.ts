/**
 * Taxonomy rules (FR-4).
 *
 * Pure functions, so the shortcut and deletion rules can be tested without a
 * database. The database enforces what it can — a unique index on the shortcut
 * column — but a clear message needs to come from here.
 */

export type ShortcutOwner = {
  id: number;
  name: string;
  shortcutKey: string | null;
};

/** Keys the transport already owns; binding them would make one key mean two things. */
const RESERVED = new Set([
  " ",
  "Space",
  "Spacebar",
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Escape",
  "Esc",
  "Tab",
  "Enter",
  "Backspace",
]);

/**
 * Normalises a key for storage: single characters are upper-cased, function
 * keys are accepted, everything else is rejected.
 */
export function normalizeShortcut(input: string): string | null {
  const raw = input.trim();
  if (!raw || RESERVED.has(raw)) return null;
  if (raw.length === 1) {
    const upper = raw.toUpperCase();
    return upper === " " ? null : upper;
  }
  return /^F([1-9]|1[0-2])$/i.test(raw) ? raw.toUpperCase() : null;
}

export function describeShortcutProblem(input: string): string | null {
  if (!input.trim()) return null;
  if (normalizeShortcut(input)) return null;
  if (RESERVED.has(input.trim())) {
    return `"${input.trim()}" is used by playback. Pick another key.`;
  }
  return "Use a single character or a function key such as F5.";
}

/** The tag already holding this key, if any (FR-4.2). */
export function findShortcutConflict(
  existing: ShortcutOwner[],
  candidateKey: string,
  ignoreTagId?: number,
): ShortcutOwner | null {
  const normalized = normalizeShortcut(candidateKey);
  if (!normalized) return null;
  return (
    existing.find(
      (tag) =>
        tag.id !== ignoreTagId &&
        tag.shortcutKey !== null &&
        normalizeShortcut(tag.shortcutKey) === normalized,
    ) ?? null
  );
}

/**
 * What deleting a tag means for its events (PRD OQ-6: they are deleted, but
 * only after the user is told how many, with reassignment offered instead).
 */
export function tagDeletionImpact(
  tagName: string,
  eventCount: number,
): { requiresConfirmation: boolean; summary: string } {
  if (eventCount === 0) {
    return {
      requiresConfirmation: false,
      summary: `No events use "${tagName}".`,
    };
  }
  const plural = eventCount === 1 ? "event" : "events";
  return {
    requiresConfirmation: true,
    summary: `Deleting "${tagName}" will also delete ${eventCount} ${plural}. This cannot be undone.`,
  };
}

export function reassignmentSummary(eventCount: number, targetTagName: string): string {
  const plural = eventCount === 1 ? "event" : "events";
  return `Move ${eventCount} ${plural} to "${targetTagName}" instead.`;
}

/**
 * Every id below `rootId` in the tree, the root included.
 *
 * Used to keep the reassignment picker from offering a tag that is about to be
 * deleted, and to keep the impact count honest for nested tags.
 */
export function collectSubtreeIds(
  tags: { id: number; parentId: number | null }[],
  rootId: number,
): Set<number> {
  const collected = new Set<number>([rootId]);
  let grew = true;

  while (grew) {
    grew = false;
    for (const tag of tags) {
      if (tag.parentId !== null && collected.has(tag.parentId) && !collected.has(tag.id)) {
        collected.add(tag.id);
        grew = true;
      }
    }
  }

  return collected;
}
