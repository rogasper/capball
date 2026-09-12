import { ipc, type JobEvent } from "@/lib/ipc";

/**
 * Wraps the job event stream into a promise per job id.
 *
 * Events are buffered, because a short job can finish before the caller has a
 * chance to await it — the id is only known after `startMediaJob` returns.
 */

type Pending = {
  onProgress?: (event: JobEvent) => void;
  resolve: (event: JobEvent) => void;
};

const pending = new Map<string, Pending>();
const finished = new Map<string, JobEvent>();
let listener: Promise<unknown> | null = null;

function ensureListener(): Promise<unknown> {
  if (!listener) {
    listener = ipc.onJobEvent((event) => {
      const handlers = pending.get(event.jobId);
      if (!handlers) {
        // The id is only known after the job has started, so a terminal event
        // can arrive before anyone is awaiting it and must be kept. Progress
        // must not be: buffering a "running" event would hand the caller a
        // non-terminal result, which reads as "the job did not finish" and
        // aborts whatever was sequencing it.
        if (event.state !== "running") finished.set(event.jobId, event);
        return;
      }
      if (event.state === "running") {
        handlers.onProgress?.(event);
        return;
      }
      pending.delete(event.jobId);
      handlers.resolve(event);
    });
  }
  return listener;
}

/** Resolves with the terminal event: done, failed, or cancelled. */
export async function awaitJob(
  jobId: string,
  onProgress?: (event: JobEvent) => void,
): Promise<JobEvent> {
  await ensureListener();

  const alreadyFinished = finished.get(jobId);
  if (alreadyFinished) {
    finished.delete(jobId);
    return alreadyFinished;
  }

  return new Promise<JobEvent>((resolve) => {
    pending.set(jobId, { onProgress, resolve });
  });
}
