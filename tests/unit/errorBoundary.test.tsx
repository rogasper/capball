import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "@/app/ErrorBoundary";

/**
 * The app had no boundary, so one bad render emptied the window: no message, no
 * way back, and — in the case that prompted this — no trace of what failed. The
 * boundary turns that into something the user can act on and report.
 */

function Boom(): never {
  throw new Error("the calibration exploded");
}

describe("ErrorBoundary", () => {
  it("renders its children when nothing throws", () => {
    render(
      <ErrorBoundary>
        <p>all well</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText("all well")).toBeInTheDocument();
  });

  it("shows what failed instead of an empty window", () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );

    expect(screen.getByText(/hit a problem/i)).toBeInTheDocument();
    expect(screen.getByText(/the calibration exploded/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reload/i })).toBeInTheDocument();
    // The library is not the thing that broke, and saying so stops a panic.
    expect(screen.getByText(/your library is untouched/i)).toBeInTheDocument();

    logged.mockRestore();
  });
});
