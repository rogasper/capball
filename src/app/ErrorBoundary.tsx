import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * Stops one bad render from emptying the window.
 *
 * Without a boundary, React unmounts the whole tree when a render throws, so a
 * single defect anywhere — a bad coordinate, a degenerate calibration, a
 * malformed row — shows the user an empty dark window with no clue what
 * happened. That is exactly what a seek did once. Now the failure is visible and
 * recoverable: the message, and a way to carry on.
 */
type Props = { children: ReactNode };
type State = { error: Error | null; info: string | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Kept for the console, which is where a developer will look first.
    console.error("capball render error", error, info.componentStack);
    this.setState({ info: info.componentStack ?? null });
  }

  render(): ReactNode {
    const { error, info } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex h-screen flex-col gap-3 overflow-auto bg-background p-6 text-foreground">
        <h1 className="text-title">capball hit a problem and stopped drawing</h1>
        <p className="text-body text-muted-foreground">
          Your library is untouched — this is only the window. Reloading usually clears it.
        </p>

        <button
          type="button"
          className="w-fit rounded-md border border-border bg-muted px-3 py-1.5 text-label"
          onClick={() => window.location.reload()}
        >
          Reload the window
        </button>

        <pre className="max-w-3xl overflow-auto rounded-md border border-border bg-card p-3 text-caption whitespace-pre-wrap">
          {error.message}
          {info ? `\n\nWhere:\n${info}` : ""}
        </pre>
      </div>
    );
  }
}
