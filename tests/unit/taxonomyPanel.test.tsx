import { render, screen } from "@testing-library/react";
import { vi } from "vitest";
import { TaxonomyPanel } from "@/features/taxonomy/TaxonomyPanel";
import type { Tag, TagCategory } from "@/lib/db/queries/taxonomy";
import { useTagStore } from "@/stores/tagStore";

// Keeps the SQL plugin out of the test; the panel only reads store state.
vi.mock("@/lib/ipc/database", () => ({
  execute: vi.fn().mockResolvedValue(undefined),
  select: vi.fn().mockResolvedValue([]),
}));

const category: TagCategory = {
  id: 1,
  name: "DEFENSE",
  color: "#34D399",
  sortOrder: 0,
  createdAt: 0,
};

function tag(partial: Partial<Tag> & { id: number; name: string }): Tag {
  return {
    categoryId: 1,
    parentId: null,
    color: null,
    shortcutKey: null,
    sortOrder: 0,
    createdAt: 0,
    ...partial,
  };
}

const parent = tag({ id: 10, name: "High Press", shortcutKey: "1" });
const child = tag({ id: 11, name: "Counter Press", parentId: 10 });
const other = tag({ id: 12, name: "Mid Block" });

describe("TaxonomyPanel", () => {
  beforeEach(() => {
    useTagStore.setState({ categories: [category], tags: [parent, child, other], error: null });
  });

  it("lists the categories and their tags", () => {
    render(<TaxonomyPanel />);

    expect(screen.getByText("DEFENSE")).toBeInTheDocument();
    expect(screen.getByText("High Press")).toBeInTheDocument();
    expect(screen.getByText("Counter Press")).toBeInTheDocument();
    expect(screen.getByText("Mid Block")).toBeInTheDocument();
  });

  it("shows where a nested tag sits", () => {
    render(<TaxonomyPanel />);

    // The child's picker reflects its parent, and the parent offers nesting too.
    expect(screen.getByLabelText("Where Counter Press sits")).toHaveTextContent("under High Press");
    expect(screen.getByLabelText("Where High Press sits")).toHaveTextContent("Top level");
  });

  it("shows the bound key and how to change it", () => {
    render(<TaxonomyPanel />);

    expect(screen.getByRole("button", { name: "1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unbind 1" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "bind" })).toHaveLength(2);
  });

  it("offers a delete action per tag", () => {
    render(<TaxonomyPanel />);

    expect(screen.getByRole("button", { name: "Delete High Press" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete Counter Press" })).toBeInTheDocument();
  });
});
