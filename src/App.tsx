import { Film } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function App() {
  return (
    <main className="flex h-screen flex-col items-center justify-center gap-6 bg-background text-foreground">
      <div className="flex items-center gap-3">
        <Film className="size-6 text-primary" aria-hidden="true" />
        <h1 className="text-heading tracking-tight">capball</h1>
      </div>

      <p className="max-w-md text-center text-body text-muted-foreground">
        Foundation build (M0). Import, tagging, and clip export arrive in later milestones.
      </p>

      <Button variant="outline" disabled>
        Import a match video — coming in M1
      </Button>
    </main>
  );
}
