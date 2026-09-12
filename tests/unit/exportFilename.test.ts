import { describe, expect, it } from "vitest";
import {
  AVAILABLE_PLACEHOLDERS,
  DEFAULT_TEMPLATE,
  describeConflicts,
  planNames,
  renderFilename,
  sanitizeSegment,
  timecodeForFilename,
} from "@/lib/export/filename";
import { paddedRange } from "@/stores/exportStore";

const context = {
  homeTeam: "Manchester United",
  awayTeam: "Sabah",
  competition: "Champions League",
};

const request = { id: 1, tag: "High Press", anchorMs: 85_701 };

describe("sanitizeSegment", () => {
  it("keeps names readable", () => {
    expect(sanitizeSegment("Manchester United")).toBe("Manchester-United");
  });

  it("removes anything that would break a path", () => {
    const traversal = sanitizeSegment("../../etc/passwd");
    expect(traversal).toBe("etc-passwd");
    expect(traversal).not.toContain("/");
    expect(traversal.startsWith(".")).toBe(false);

    expect(sanitizeSegment('a/b\\c:d*e?f"g<h>i|j')).toBe("a-b-cdefghij");
  });

  it("collapses whitespace and dashes", () => {
    expect(sanitizeSegment("  a    b  ")).toBe("a-b");
    expect(sanitizeSegment("a - - b")).toBe("a-b");
  });

  it("never returns an empty name", () => {
    expect(sanitizeSegment("   ")).toBe("untitled");
    expect(sanitizeSegment("///")).toBe("untitled");
  });

  it("bounds the length", () => {
    expect(sanitizeSegment("x".repeat(200), 10)).toHaveLength(10);
  });
});

describe("timecodeForFilename", () => {
  it("uses characters a filesystem accepts", () => {
    expect(timecodeForFilename(85_701)).toBe("01-25-701");
    expect(timecodeForFilename(0)).toBe("00-00-000");
  });

  it("never emits a negative time", () => {
    expect(timecodeForFilename(-5_000)).toBe("00-00-000");
  });
});

describe("renderFilename", () => {
  it("renders the default template", () => {
    expect(renderFilename(DEFAULT_TEMPLATE, context, request, 1)).toBe(
      "Manchester-United-vs-Sabah_High-Press_01-25-701.mp4",
    );
  });

  it("supports every advertised placeholder", () => {
    for (const placeholder of AVAILABLE_PLACEHOLDERS) {
      const name = renderFilename(`{${placeholder}}`, context, request, 3);
      expect(name).not.toContain("{");
      expect(name.endsWith(".mp4")).toBe(true);
    }
  });

  it("leaves unknown placeholders alone rather than dropping them silently", () => {
    expect(renderFilename("{nope}", context, request, 1)).toContain("{nope}");
  });

  it("keeps the extension whatever the template does", () => {
    expect(renderFilename("clip.mp4", context, request, 1)).toBe("clip.mp4.mp4");
  });
});

describe("planNames", () => {
  const requests = [
    { id: 1, tag: "Shot", anchorMs: 85_701 },
    { id: 2, tag: "Shot", anchorMs: 183_062 },
  ];

  it("names each event distinctly when the template includes the time", () => {
    const planned = planNames(requests, DEFAULT_TEMPLATE, context);
    expect(planned.map((item) => item.fileName)).toEqual([
      "Manchester-United-vs-Sabah_Shot_01-25-701.mp4",
      "Manchester-United-vs-Sabah_Shot_03-03-062.mp4",
    ]);
    expect(planned.every((item) => item.duplicateOf === null)).toBe(true);
  });

  it("flags a template that repeats itself instead of silently renaming", () => {
    const planned = planNames(requests, "{tag}", context);
    expect(planned[0]?.duplicateOf).toBeNull();
    expect(planned[1]?.duplicateOf).toBe(1);
  });

  it("lets an index placeholder break the tie", () => {
    const planned = planNames(requests, "{tag}_{index}", context);
    expect(planned.map((item) => item.fileName)).toEqual(["Shot_1.mp4", "Shot_2.mp4"]);
    expect(planned.every((item) => item.duplicateOf === null)).toBe(true);
  });
});

describe("describeConflicts", () => {
  it("reports what is already in the folder", () => {
    const planned = planNames([{ id: 1, tag: "Shot", anchorMs: 1_000 }], DEFAULT_TEMPLATE, context);
    const existing = new Set(planned.map((item) => item.fileName));

    expect(describeConflicts(planned, existing)).toEqual([
      `${planned[0]?.fileName} already exists in that folder.`,
    ]);
  });

  it("reports a duplicate inside the batch", () => {
    const planned = planNames(
      [
        { id: 1, tag: "Shot", anchorMs: 1_000 },
        { id: 2, tag: "Shot", anchorMs: 1_000 },
      ],
      "{tag}",
      context,
    );

    expect(describeConflicts(planned, new Set())).toHaveLength(1);
    expect(describeConflicts(planned, new Set())[0]).toMatch(/twice/);
  });

  it("is quiet when nothing collides", () => {
    const planned = planNames([{ id: 1, tag: "Shot", anchorMs: 1_000 }], DEFAULT_TEMPLATE, context);
    expect(describeConflicts(planned, new Set())).toEqual([]);
  });
});

describe("paddedRange", () => {
  it("leaves the event's own range alone without padding", () => {
    expect(paddedRange({ startMs: 92_000, endMs: 112_000 }, 0, 0, 600_000)).toEqual({
      startMs: 92_000,
      endMs: 112_000,
    });
  });

  it("adds padding on both sides", () => {
    expect(paddedRange({ startMs: 92_000, endMs: 112_000 }, 3_000, 5_000, 600_000)).toEqual({
      startMs: 89_000,
      endMs: 117_000,
    });
  });

  it("clamps to the start of the video", () => {
    expect(paddedRange({ startMs: 1_000, endMs: 5_000 }, 5_000, 0, 600_000).startMs).toBe(0);
  });

  it("clamps to the end of the video", () => {
    expect(paddedRange({ startMs: 590_000, endMs: 599_000 }, 0, 30_000, 600_000).endMs).toBe(
      600_000,
    );
  });

  it("stays sane when the duration is unknown", () => {
    const range = paddedRange({ startMs: 1_000, endMs: 2_000 }, 0, 1_000, 0);
    expect(range.endMs).toBe(3_000);
  });
});
