import { ChevronLeft, ChevronRight } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { TabsList } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

/**
 * A tab row that scrolls instead of squeezing.
 *
 * Each tab is sized to its own label, so a long word is never clipped and a
 * short one never wastes the room. When the row does not fit, it scrolls and a
 * chevron appears on the side that has something hidden — the row says "there is
 * more" rather than quietly cutting a tab off.
 *
 * Both chevrons are always rendered and merely hidden while unused: adding and
 * removing them would change the scroller's width, which changes whether it
 * overflows, which brings the chevron back. Keeping the box fixed avoids that
 * flicker.
 */
export function ScrollingTabsList({ children }: { children: ReactNode }) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: false, end: false });

  const measure = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;

    const maxScroll = scroller.scrollWidth - scroller.clientWidth;
    const next = {
      start: scroller.scrollLeft > 1,
      end: maxScroll > 1 && scroller.scrollLeft < maxScroll - 1,
    };

    setEdges((previous) =>
      previous.start === next.start && previous.end === next.end ? previous : next,
    );
  }, []);

  useEffect(() => {
    measure();

    const scroller = scrollerRef.current;
    if (!scroller) return;

    scroller.addEventListener("scroll", measure, { passive: true });
    // jsdom has no ResizeObserver and no layout; this only matters in a window.
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(scroller);

    return () => {
      scroller.removeEventListener("scroll", measure);
      observer?.disconnect();
    };
  }, [measure]);

  const nudge = (delta: number) => {
    scrollerRef.current?.scrollBy({ left: delta, behavior: "smooth" });
  };

  return (
    <div className="flex items-center gap-1">
      <Chevron
        direction="left"
        shown={edges.start}
        onPress={() => nudge(-140)}
        label="Scroll tabs left"
      />

      <div
        ref={scrollerRef}
        className="min-w-0 flex-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <TabsList className="w-max flex-nowrap">{children}</TabsList>
      </div>

      <Chevron
        direction="right"
        shown={edges.end}
        onPress={() => nudge(140)}
        label="Scroll tabs right"
      />
    </div>
  );
}

function Chevron({
  direction,
  shown,
  onPress,
  label,
}: {
  direction: "left" | "right";
  shown: boolean;
  onPress: () => void;
  label: string;
}) {
  const Icon = direction === "left" ? ChevronLeft : ChevronRight;

  return (
    <Button
      variant="ghost"
      size="icon-xs"
      aria-label={label}
      // Hidden rather than removed, so the scroller's width never changes.
      className={cn("shrink-0", !shown && "invisible")}
      tabIndex={shown ? undefined : -1}
      onClick={onPress}
    >
      <Icon aria-hidden="true" />
    </Button>
  );
}
