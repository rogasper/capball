import { Plus, Trash2, X } from "lucide-react";
import { Fragment, useEffect, useState } from "react";
import { EditableName } from "@/components/editable-name";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Tag, TagCategory } from "@/lib/db/queries/taxonomy";
import { collectSubtreeIds, tagDeletionImpact } from "@/lib/taxonomy/rules";
import { useTagStore } from "@/stores/tagStore";

/** Click, then press the key you want. Conflicts are refused by the store. */
function ShortcutBinding({ tag }: { tag: Tag }) {
  const bindShortcut = useTagStore((state) => state.bindShortcut);
  const [listening, setListening] = useState(false);

  useEffect(() => {
    if (!listening) return;

    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      setListening(false);
      if (event.key === "Escape") return;
      void bindShortcut(tag.id, event.key);
    };

    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [listening, bindShortcut, tag.id]);

  return (
    <span className="flex items-center gap-1">
      <Button
        variant={listening ? "default" : "outline"}
        size="xs"
        className="min-w-14 font-mono"
        onClick={() => setListening(true)}
      >
        {listening ? "press…" : (tag.shortcutKey ?? "bind")}
      </Button>
      {tag.shortcutKey && (
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`Unbind ${tag.shortcutKey}`}
          onClick={() => void bindShortcut(tag.id, null)}
        >
          <X className="size-3" aria-hidden="true" />
        </Button>
      )}
    </span>
  );
}

function TagDeleteDialog({ tag, allTags }: { tag: Tag; allTags: Tag[] }) {
  const impactOf = useTagStore((state) => state.impactOf);
  const removeTag = useTagStore((state) => state.removeTag);
  const reassignAndRemoveTag = useTagStore((state) => state.reassignAndRemoveTag);

  const [open, setOpen] = useState(false);
  const [count, setCount] = useState<number | null>(null);
  const [targetId, setTargetId] = useState<string>("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setCount(null);
    setTargetId("");

    void impactOf(tag.id).then((value) => {
      if (!cancelled) setCount(value);
    });

    return () => {
      cancelled = true;
    };
  }, [open, tag.id, impactOf]);

  const excluded = collectSubtreeIds(allTags, tag.id);
  const destinations = allTags.filter((candidate) => !excluded.has(candidate.id));
  const impact = count === null ? null : tagDeletionImpact(tag.name, count);

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="icon-xs" aria-label={`Delete ${tag.name}`}>
          <Trash2 className="size-3" aria-hidden="true" />
        </Button>
      </AlertDialogTrigger>

      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete “{tag.name}”?</AlertDialogTitle>
          <AlertDialogDescription>
            {impact ? impact.summary : "Checking how many events use this tag, and its sub-tags…"}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {destinations.length > 0 && (count ?? 0) > 0 && (
          <div className="grid gap-2 py-2">
            <Select value={targetId} onValueChange={setTargetId}>
              <SelectTrigger size="sm">
                <SelectValue placeholder="Move its events to another tag instead" />
              </SelectTrigger>
              <SelectContent>
                {destinations.map((candidate) => (
                  <SelectItem key={candidate.id} value={String(candidate.id)}>
                    {candidate.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          {targetId && (
            <AlertDialogAction onClick={() => void reassignAndRemoveTag(tag.id, Number(targetId))}>
              Move events, then delete
            </AlertDialogAction>
          )}
          <AlertDialogAction variant="destructive" onClick={() => void removeTag(tag.id)}>
            Delete tag and its events
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * A tag row. The second line carries the two things that define how a tag
 * behaves — where it sits in the tree, and which key captures it.
 */
function TagRow({
  tag,
  allTags,
  categoryTags,
  depth,
}: {
  tag: Tag;
  allTags: Tag[];
  categoryTags: Tag[];
  depth: number;
}) {
  const renameTag = useTagStore((state) => state.renameTag);
  const setParent = useTagStore((state) => state.setParent);

  // A tag cannot be nested under itself or under one of its own descendants.
  const excluded = collectSubtreeIds(categoryTags, tag.id);
  const parentingOptions = categoryTags.filter((candidate) => !excluded.has(candidate.id));

  return (
    <li
      className="rounded-md px-2 py-1 hover:bg-accent/50"
      style={{ paddingLeft: `${8 + depth * 12}px` }}
    >
      <div className="flex items-center gap-2">
        <span
          className="size-2 shrink-0 rounded-full"
          style={{ background: tag.color ?? "var(--muted-foreground)" }}
          aria-hidden="true"
        />
        <span className="flex min-w-0 flex-1 text-body">
          <EditableName value={tag.name} onCommit={(next) => void renameTag(tag.id, next)} />
        </span>
        <TagDeleteDialog tag={tag} allTags={allTags} />
      </div>

      <div className="mt-0.5 flex items-center gap-2 pl-4">
        <Select
          value={tag.parentId === null ? "root" : String(tag.parentId)}
          onValueChange={(value) => void setParent(tag.id, value === "root" ? null : Number(value))}
        >
          <SelectTrigger
            size="sm"
            className="h-6 w-28 text-label"
            aria-label={`Where ${tag.name} sits`}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="root">Top level</SelectItem>
            {parentingOptions.map((candidate) => (
              <SelectItem key={candidate.id} value={String(candidate.id)}>
                under {candidate.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <ShortcutBinding tag={tag} />
      </div>
    </li>
  );
}

/** Renders a category's tags as a tree, so nesting is visible (FR-4.1). */
function TagTree({ categoryTags, allTags }: { categoryTags: Tag[]; allTags: Tag[] }) {
  const renderBranch = (tag: Tag, depth: number): React.ReactNode => (
    <Fragment key={tag.id}>
      <TagRow tag={tag} allTags={allTags} categoryTags={categoryTags} depth={depth} />
      {categoryTags
        .filter((candidate) => candidate.parentId === tag.id)
        .map((child) => renderBranch(child, depth + 1))}
    </Fragment>
  );

  return (
    <ul className="space-y-0.5">
      {categoryTags.filter((tag) => tag.parentId === null).map((root) => renderBranch(root, 0))}
    </ul>
  );
}

function CategoryBlock({ category, tags }: { category: TagCategory; tags: Tag[] }) {
  const addTag = useTagStore((state) => state.addTag);
  const renameCategory = useTagStore((state) => state.renameCategory);
  const removeCategory = useTagStore((state) => state.removeCategory);

  const [newTag, setNewTag] = useState("");

  const submitTag = async (event: React.FormEvent) => {
    event.preventDefault();
    const name = newTag.trim();
    if (!name) return;
    await addTag({ categoryId: category.id, name });
    setNewTag("");
  };

  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <span
          className="size-2.5 shrink-0 rounded-full"
          style={{ background: category.color ?? "var(--muted-foreground)" }}
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1 text-title">
          <EditableName
            value={category.name}
            onCommit={(next) => void renameCategory(category.id, next)}
          />
        </div>

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="ghost" size="icon-xs" aria-label={`Delete ${category.name}`}>
              <Trash2 className="size-3" aria-hidden="true" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete “{category.name}”?</AlertDialogTitle>
              <AlertDialogDescription>
                Its {tags.length} tag{tags.length === 1 ? "" : "s"} go with it, and so do the events
                tagged with them. Delete the tags individually if you want to keep some.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={() => void removeCategory(category.id)}
              >
                Delete category
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      <TagTree categoryTags={tags} allTags={tags} />

      <form onSubmit={submitTag} className="flex items-center gap-2">
        <Input
          value={newTag}
          onChange={(event) => setNewTag(event.currentTarget.value)}
          placeholder="Add a tag…"
          className="h-7 text-label"
        />
        <Button type="submit" variant="outline" size="icon-sm" aria-label="Add tag">
          <Plus className="size-3.5" aria-hidden="true" />
        </Button>
      </form>
    </section>
  );
}

export function TaxonomyPanel() {
  const categories = useTagStore((state) => state.categories);
  const tags = useTagStore((state) => state.tags);
  const error = useTagStore((state) => state.error);
  const addCategory = useTagStore((state) => state.addCategory);
  const clearError = useTagStore((state) => state.clearError);

  const [newCategory, setNewCategory] = useState("");

  const submitCategory = async (event: React.FormEvent) => {
    event.preventDefault();
    const name = newCategory.trim();
    if (!name) return;
    await addCategory(name);
    setNewCategory("");
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-title">Tags</h2>
        <p className="text-label text-muted-foreground">
          Your own vocabulary. Keys you bind here capture an event with one press.
        </p>
      </div>

      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/10 p-2"
        >
          <p className="flex-1 text-label break-words">{error}</p>
          <Button variant="ghost" size="icon-xs" aria-label="Dismiss" onClick={clearError}>
            <X className="size-3" aria-hidden="true" />
          </Button>
        </div>
      )}

      {categories.map((category) => (
        <CategoryBlock
          key={category.id}
          category={category}
          tags={tags.filter((tag) => tag.categoryId === category.id)}
        />
      ))}

      <form
        onSubmit={submitCategory}
        className="flex items-center gap-2 border-t border-border pt-3"
      >
        <Input
          value={newCategory}
          onChange={(event) => setNewCategory(event.currentTarget.value)}
          placeholder="New category…"
          className="h-7 text-label"
        />
        <Button type="submit" variant="outline" size="icon-sm" aria-label="Add category">
          <Plus className="size-3.5" aria-hidden="true" />
        </Button>
      </form>
    </div>
  );
}
