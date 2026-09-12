import { useCallback, useEffect, useRef, useState } from "react";
import { ipc } from "@/lib/ipc";

/**
 * Thumbnails, with a cache and a queue (FR-12).
 *
 * A heavily tagged match has hundreds of events, and each thumbnail is one
 * FFmpeg run. Asking for all of them at once would spawn hundreds of processes,
 * so requests are deduplicated, capped in concurrency, and queued by priority:
 * what the user is looking at jumps ahead of the background fill.
 *
 * Rendered files live in the app cache and are keyed by source and timestamp, so
 * a moment is never rendered twice.
 */

const MAX_CONCURRENT = 2;

type Task = {
  key: string;
  input: string;
  atMs: number;
  priority: number;
  resolve: (url: string) => void;
  reject: (error: unknown) => void;
};

const cache = new Map<string, Promise<string>>();
const queue: Task[] = [];
let inFlight = 0;

const keyOf = (input: string, atMs: number) => `${input}@${atMs}`;

/** Priority 0 is what the user is looking at; higher numbers wait. */
export const ON_DEMAND = 0;
export const BACKGROUND = 1;

function pump(): void {
  if (inFlight >= MAX_CONCURRENT) return;

  queue.sort((a, b) => a.priority - b.priority);
  const task = queue.shift();
  if (!task) return;

  inFlight += 1;

  void ipc
    .extractThumbnail(task.input, task.atMs)
    .then((path) => task.resolve(ipc.assetUrl(path)))
    .catch((error) => {
      // A failure is not remembered, so a later attempt can retry it.
      cache.delete(task.key);
      task.reject(error);
    })
    .finally(() => {
      inFlight -= 1;
      pump();
    });
}

export function requestThumbnail(
  input: string,
  atMs: number,
  priority = ON_DEMAND,
): Promise<string> {
  const key = keyOf(input, atMs);
  const cached = cache.get(key);
  if (cached) return cached;

  const pending = new Promise<string>((resolve, reject) => {
    queue.push({ key, input, atMs, priority, resolve, reject });
  });

  cache.set(key, pending);
  pump();
  return pending;
}

export function isThumbnailRequested(input: string, atMs: number): boolean {
  return cache.has(keyOf(input, atMs));
}

export function forgetThumbnails(): void {
  cache.clear();
}

export type ThumbnailState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; url: string }
  | { status: "failed"; error: string };

/**
 * Starts rendering only once the element is near the viewport, so a long event
 * list does not render every thumbnail the moment it opens.
 */
export function useThumbnail(
  input: string | null,
  atMs: number,
  priority = ON_DEMAND,
): { state: ThumbnailState; ref: (node: HTMLElement | null) => void } {
  const [state, setState] = useState<ThumbnailState>({ status: "idle" });
  const [visible, setVisible] = useState(false);
  const observer = useRef<IntersectionObserver | null>(null);

  const ref = useCallback((node: HTMLElement | null) => {
    observer.current?.disconnect();
    observer.current = null;

    // Without an observer (tests, older engines) there is nothing to wait for.
    if (!node || typeof IntersectionObserver === "undefined") {
      setVisible(Boolean(node));
      return;
    }

    const created = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          created.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    created.observe(node);
    observer.current = created;
  }, []);

  useEffect(() => () => observer.current?.disconnect(), []);

  useEffect(() => {
    if (!visible || !input) return;

    let cancelled = false;
    setState({ status: "loading" });

    requestThumbnail(input, atMs, priority)
      .then((url) => {
        if (!cancelled) setState({ status: "ready", url });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            status: "failed",
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [visible, input, atMs, priority]);

  return { state, ref };
}
