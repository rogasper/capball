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
import { cn } from "@/lib/utils";
import { usePhaseStore } from "@/stores/phaseStore";
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
      {/* A tag with no key is the common case, so its button is quiet until it is
          wanted: a bordered "bind" on every row is what made the panel read as a
          grid of boxes. A bound key keeps its border, because it is a fact. */}
      <Button
        variant={listening ? "default" : tag.shortcutKey ? "outline" : "ghost"}
        size="xs"
        className={cn(
          "min-w-14 font-mono",
          !listening && !tag.shortcutKey && "text-muted-foreground hover:border-border",
        )}
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
  const isPhase = usePhaseStore((state) => state.phaseTagIds.includes(tag.id));
  const setPhaseTag = usePhaseStore((state) => state.setPhaseTag);

  // A tag cannot be nested under itself or under one of its own descendants.
  const excluded = collectSubtreeIds(categoryTags, tag.id);
  const parentingOptions = categoryTags.filter((candidate) => !excluded.has(candidate.id));
  const parentLabel =
    tag.parentId === null
      ? "Top level"
      : `under ${categoryTags.find((candidate) => candidate.id === tag.parentId)?.name ?? "another tag"}`;

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
        {/* How the tag is captured (FR-55.1), said as behaviour rather than as a
            noun: a button labelled "phase" reads as a command to start one, which
            is how a passage was lost by pressing it mid-recording. It sits on the
            name's line so the line below has the whole width for a parent name. */}
        <Select
          value={isPhase ? "phase" : "moment"}
          onValueChange={(value) => void setPhaseTag(tag.id, value === "phase")}
        >
          <SelectTrigger
            size="sm"
            className={cn(
              "h-6 w-36 shrink-0 text-label",
              !isPhase && "border-transparent text-muted-foreground hover:border-input",
            )}
            title={
              isPhase
                ? "Captured by pressing its key to start, and again to stop"
                : "Captured with a single press, like every tag before phases"
            }
            aria-label={`How ${tag.name} is captured`}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="moment">One press</SelectItem>
            <SelectItem value="phase">Until stopped</SelectItem>
          </SelectContent>
        </Select>
        <TagDeleteDialog tag={tag} allTags={allTags} />
      </div>

      {/* Where the tag sits and which key captures it. Both are sized so the
          panel never has to scroll sideways: the parent shrinks and ellipsises
          (its tooltip has the full name), the key is as wide as its own text. */}
      <div className="mt-0.5 flex items-center gap-1.5 pl-3">
        <Select
          value={tag.parentId === null ? "root" : String(tag.parentId)}
          onValueChange={(value) => void setParent(tag.id, value === "root" ? null : Number(value))}
        >
          <SelectTrigger
            size="sm"
            className={cn(
              "h-6 min-w-0 flex-1 text-label",
              tag.parentId === null &&
                "border-transparent text-muted-foreground hover:border-input",
            )}
            title={parentLabel}
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
