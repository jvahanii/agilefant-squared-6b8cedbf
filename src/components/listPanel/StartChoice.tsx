import { useState } from "react";
import { Link } from "react-router-dom";
import type { StartKind } from "./startPresets";

const OPTIONS: Array<{ kind: StartKind; label: string; hint: string }> = [
  { kind: "own", label: "Just me", hint: "Lists for now and later" },
  { kind: "team", label: "A team", hint: "A backlog and a sprint board, with story points" },
];

/** "Who is it for?" under the first-item box; see startPresets.ts. */
export function StartChoice({ kind, onChoose }: { kind: StartKind; onChoose: (kind: StartKind) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const choose = async (next: StartKind) => {
    if (next === kind || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onChoose(next);
    } catch {
      setError("That didn't save. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <fieldset className="space-y-2" aria-busy={busy}>
      <legend className="mb-2 text-sm font-medium">Who is it for?</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {OPTIONS.map((o) => (
          <label
            key={o.kind}
            className={`flex cursor-pointer items-start gap-2 rounded-md border p-2.5 text-sm ${
              kind === o.kind ? "border-primary bg-primary/5" : "hover:bg-muted/60"
            }`}
          >
            <input
              type="radio"
              name="start-choice"
              value={o.kind}
              checked={kind === o.kind}
              disabled={busy}
              onChange={() => void choose(o.kind)}
              className="mt-0.5 accent-[hsl(var(--primary))]"
            />
            <span>
              <span className="block font-medium">{o.label}</span>
              <span className="block text-xs text-muted-foreground">{o.hint}</span>
            </span>
          </label>
        ))}
      </div>
      {kind === "team" && (
        <p className="text-xs text-muted-foreground">
          To work together, your colleagues sign up first; then you add them by email under{" "}
          <Link to="/settings/team" className="text-primary underline underline-offset-2 hover:no-underline">
            Team settings
          </Link>
          .
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </fieldset>
  );
}
