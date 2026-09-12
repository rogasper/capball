import { create } from "zustand";
import type { Tag, TagCategory } from "@/lib/db/queries/taxonomy";
import * as taxonomyQuery from "@/lib/db/queries/taxonomy";
import {
  describeShortcutProblem,
  findShortcutConflict,
  normalizeShortcut,
  type ShortcutOwner,
} from "@/lib/taxonomy/rules";

type TagState = {
  categories: TagCategory[];
  tags: Tag[];
  error: string | null;

  /** Context stamped onto new events (FR-7); stored here, not per event. */
  activeTeamId: number | null;
  activePlayerId: number | null;

  load: () => Promise<void>;
  addCategory: (name: string) => Promise<void>;
  renameCategory: (id: number, name: string) => Promise<void>;
  removeCategory: (id: number) => Promise<void>;
  addTag: (input: {
    categoryId: number;
    parentId?: number | null;
    name: string;
    shortcutKey?: string | null;
  }) => Promise<void>;
  renameTag: (id: number, name: string) => Promise<void>;
  setParent: (id: number, parentId: number | null) => Promise<void>;
  bindShortcut: (id: number, key: string | null) => Promise<boolean>;
  impactOf: (tagId: number) => Promise<number>;
  removeTag: (id: number) => Promise<void>;
  reassignAndRemoveTag: (id: number, targetId: number) => Promise<void>;
  conflictFor: (key: string, ignoreTagId?: number) => ShortcutOwner | null;
  setActiveTeam: (id: number | null) => void;
  setActivePlayer: (id: number | null) => void;
  clearError: () => void;
};

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const useTagStore = create<TagState>((set, get) => ({
  categories: [],
  tags: [],
  error: null,
  activeTeamId: null,
  activePlayerId: null,

  async load() {
    try {
      const [categories, tags] = await Promise.all([
        taxonomyQuery.listCategories(),
        taxonomyQuery.listTags(),
      ]);
      set({ categories, tags });
    } catch (error) {
      set({ error: messageOf(error) });
    }
  },

  async addCategory(name) {
    try {
      await taxonomyQuery.createCategory(name);
      await get().load();
    } catch (error) {
      set({ error: messageOf(error) });
    }
  },

  async renameCategory(id, name) {
    try {
      await taxonomyQuery.renameCategory(id, name);
      await get().load();
    } catch (error) {
      set({ error: messageOf(error) });
    }
  },

  async removeCategory(id) {
    try {
      await taxonomyQuery.deleteCategory(id);
      await get().load();
    } catch (error) {
      set({ error: messageOf(error) });
    }
  },

  async addTag(input) {
    try {
      const existing = tagConflictOwner(get().tags, input.shortcutKey ?? null);
      if (existing) {
        set({ error: `"${existing.name}" already uses that key.` });
        return;
      }
      await taxonomyQuery.createTag(input);
      await get().load();
    } catch (error) {
      set({ error: messageOf(error) });
    }
  },

  async renameTag(id, name) {
    try {
      await taxonomyQuery.updateTag(id, { name });
      await get().load();
    } catch (error) {
      set({ error: messageOf(error) });
    }
  },

  /** Nests a tag under another, or returns it to the top level (FR-4.1). */
  async setParent(id, parentId) {
    try {
      await taxonomyQuery.updateTag(id, { parentId });
      await get().load();
    } catch (error) {
      set({ error: messageOf(error) });
    }
  },

  /** Binds a key, refusing conflicts and unreadable keys (FR-4.2). */
  async bindShortcut(id, key) {
    if (key !== null) {
      const problem = describeShortcutProblem(key);
      if (problem) {
        set({ error: problem });
        return false;
      }
      const conflict = get().conflictFor(key, id);
      if (conflict) {
        set({ error: `"${conflict.name}" already uses that key.` });
        return false;
      }
    }

    try {
      await taxonomyQuery.updateTag(id, { shortcutKey: key });
      await get().load();
      return true;
    } catch (error) {
      set({ error: messageOf(error) });
      return false;
    }
  },

  impactOf(tagId) {
    return taxonomyQuery.countEventsForTagSubtree(tagId);
  },

  async removeTag(id) {
    try {
      await taxonomyQuery.deleteTag(id);
      await get().load();
    } catch (error) {
      set({ error: messageOf(error) });
    }
  },

  async reassignAndRemoveTag(id, targetId) {
    try {
      await taxonomyQuery.reassignTagEvents(id, targetId);
      await taxonomyQuery.deleteTag(id);
      await get().load();
    } catch (error) {
      set({ error: messageOf(error) });
    }
  },

  conflictFor(key, ignoreTagId) {
    return findShortcutConflict(
      get().tags.map((tag) => ({
        id: tag.id,
        name: tag.name,
        shortcutKey: tag.shortcutKey,
      })),
      key,
      ignoreTagId,
    );
  },

  setActiveTeam(activeTeamId) {
    set({ activeTeamId, activePlayerId: null });
  },

  setActivePlayer(activePlayerId) {
    set({ activePlayerId });
  },

  clearError() {
    set({ error: null });
  },
}));

function tagConflictOwner(tags: Tag[], key: string | null) {
  if (!key) return null;
  const normalized = normalizeShortcut(key);
  if (!normalized) return null;
  return (
    tags.find(
      (tag) => tag.shortcutKey !== null && normalizeShortcut(tag.shortcutKey) === normalized,
    ) ?? null
  );
}
