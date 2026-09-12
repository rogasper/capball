import { CornerDownLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Click the name to edit it; Enter commits, Escape abandons. */
export function EditableName({
  value,
  onCommit,
  className,
}: {
  value: string;
  onCommit: (next: string) => void;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  useEffect(() => setDraft(value), [value]);

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className={`truncate text-left hover:text-primary ${className ?? ""}`}
        title="Rename"
      >
        {value}
      </button>
    );
  }

  const commit = () => {
    setEditing(false);
    if (draft.trim() && draft.trim() !== value) onCommit(draft.trim());
  };

  return (
    <span className="flex items-center gap-1">
      <Input
        value={draft}
        autoFocus
        onChange={(event) => setDraft(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
          if (event.key === "Escape") {
            setDraft(value);
            setEditing(false);
          }
        }}
        className="h-6 text-label"
      />
      <Button variant="ghost" size="icon-xs" aria-label="Save name" onClick={commit}>
        <CornerDownLeft className="size-3" aria-hidden="true" />
      </Button>
    </span>
  );
}
