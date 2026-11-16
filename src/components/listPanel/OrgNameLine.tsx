import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * "Your organisation is called …, Rename", under the first-item box. A new
 * organisation is named after its person, or their email address when the
 * sign-in gave no name, so the first thing it is called is rarely what they
 * would call it themselves. Renaming used to mean finding Team settings.
 */
export function OrgNameLine({ name, onRename }: { name: string; onRename: (name: string) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cancel = () => {
    setEditing(false);
    setDraft(name);
    setError(null);
  };

  if (!editing) {
    return (
      <p className="text-xs text-muted-foreground">
        Your organisation is called <span className="font-medium text-foreground">{name}</span>.{" "}
        <button
          type="button"
          className="text-primary underline underline-offset-2 hover:no-underline"
          onClick={() => {
            setDraft(name);
            setEditing(true);
          }}
        >
          Rename it
        </button>
      </p>
    );
  }

  const trimmed = draft.trim();
  return (
    <form
      className="space-y-1.5"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!trimmed || saving) return;
        if (trimmed === name) return cancel();
        setSaving(true);
        setError(null);
        try {
          await onRename(trimmed);
          setEditing(false);
        } catch (err) {
          setError(err instanceof Error && err.message ? err.message : "The name could not be saved.");
        } finally {
          setSaving(false);
        }
      }}
    >
      <label htmlFor="org-name-input" className="block text-xs text-muted-foreground">
        Organisation name
      </label>
      <div className="flex gap-2">
        <Input
          id="org-name-input"
          value={draft}
          maxLength={80}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              cancel();
            }
          }}
          className="h-8 text-sm"
          autoFocus
          autoComplete="off"
        />
        <Button type="submit" size="sm" disabled={!trimmed || saving} className="shrink-0">
          {saving ? "Saving…" : "Save"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={cancel} disabled={saving} className="shrink-0">
          Cancel
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}
