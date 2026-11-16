import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Shown in place of the empty list while the organisation has no items at
 * all, which is how every new account starts (see starterContent.ts). Of the
 * people who signed up from August to mid-November 2026, 15 of 34 never
 * changed anything: they met a panel that said "Select a list to view work
 * items" and left.
 */
export function FirstItemPrompt({
  listName,
  treeName,
  onAdd,
}: {
  /** The list the item goes into. */
  listName: string;
  treeName?: string;
  onAdd: (title: string) => void;
}) {
  const [title, setTitle] = useState("");

  const submit = () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    onAdd(trimmed);
    setTitle("");
  };

  return (
    <div className="flex-1 flex items-start justify-center px-4 py-10 md:py-16">
      <section aria-labelledby="first-item-heading" className="w-full max-w-md space-y-4">
        <div className="space-y-1.5">
          <h2 id="first-item-heading" className="text-lg font-semibold">
            Add your first item
          </h2>
          <p className="text-sm text-muted-foreground">
            Anything you want to keep track of: a task, an idea, a job ad. Type it and press Enter.
          </p>
        </div>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Input
            id="first-item-title"
            aria-label="First item"
            placeholder="e.g. Plan the team kick-off"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
            autoComplete="off"
          />
          <Button type="submit" disabled={!title.trim()} className="shrink-0">
            <Plus className="w-4 h-4 mr-1" />
            Add
          </Button>
        </form>
        <p className="text-xs text-muted-foreground">
          It goes into <span className="font-medium text-foreground">{treeName ? `${treeName} › ${listName}` : listName}</span>.
          You can rename the lists, nest them, add more trees, and switch on extras such as story points in your
          organisation's settings.
        </p>
      </section>
    </div>
  );
}
