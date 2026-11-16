import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { itemLines, MAX_PASTED_ITEMS } from "./itemLines";
import { OrgNameLine } from "./OrgNameLine";
import { StartChoice } from "./StartChoice";
import type { StartKind } from "./startPresets";

/**
 * Shown in place of the empty list while the organisation has no items at
 * all, which is how every new account starts (see starterContent.ts). Of the
 * people who signed up from August to mid-November 2026, 15 of 34 never
 * changed anything: they met a panel that said "Select a list to view work
 * items" and left.
 *
 * Most people arrive with their work already written down somewhere, so a
 * pasted list becomes one item per line.
 */
export function FirstItemPrompt({
  listName,
  treeName,
  onAdd,
  org,
  start,
}: {
  /** The list the items go into. */
  listName: string;
  treeName?: string;
  onAdd: (titles: string[]) => void;
  /** The organisation's name, with a way to change it for those allowed to. */
  org?: { name: string; onRename: (name: string) => Promise<void> };
  /** Who it is for, while the starter lists are untouched and the person may change them. */
  start?: { kind: StartKind; onChoose: (kind: StartKind) => Promise<void> };
}) {
  const [text, setText] = useState("");
  const lines = itemLines(text);
  const titles = lines.slice(0, MAX_PASTED_ITEMS);

  const submit = () => {
    if (titles.length === 0) return;
    onAdd(titles);
    setText("");
  };

  return (
    <div className="flex-1 flex items-start justify-center px-4 py-6 md:py-16 overflow-y-auto">
      <section aria-labelledby="first-item-heading" className="w-full max-w-md space-y-4">
        <div className="space-y-1.5">
          <h2 id="first-item-heading" className="text-lg font-semibold">
            Add your first item
          </h2>
          <p className="text-sm text-muted-foreground">
            Anything you want to keep track of: a task, an idea. Type it and press Enter.
          </p>
        </div>
        <form
          className="flex items-start gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Textarea
            id="first-item-title"
            aria-label="First item"
            aria-describedby="first-item-paste"
            placeholder="e.g. Plan the team kick-off"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              // Enter adds, as in a one-line box; Shift+Enter starts another line.
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            rows={Math.min(Math.max(text.split("\n").length, 1), 8)}
            className="min-h-0 resize-none"
            autoFocus
            autoComplete="off"
          />
          <Button type="submit" disabled={titles.length === 0} className="shrink-0">
            <Plus className="w-4 h-4 mr-1" />
            {titles.length > 1 ? `Add ${titles.length} items` : "Add"}
          </Button>
        </form>
        {lines.length > MAX_PASTED_ITEMS && (
          <p role="status" className="text-xs text-muted-foreground">
            That is {lines.length} lines; the first {MAX_PASTED_ITEMS} are added.
          </p>
        )}
        <p id="first-item-paste" className="text-sm text-muted-foreground">
          Already have a list somewhere? Paste it here: each line becomes an item.
        </p>
        <p className="text-xs text-muted-foreground">
          {titles.length > 1 ? "They go" : "It goes"} into{" "}
          <span className="font-medium text-foreground">{treeName ? `${treeName} › ${listName}` : listName}</span>.
          You can rename the lists, nest them, add more trees, and switch on extras such as story points in your
          organisation's settings.
        </p>
        {start && <StartChoice kind={start.kind} onChoose={start.onChoose} />}
        {org && <OrgNameLine name={org.name} onRename={org.onRename} />}
      </section>
    </div>
  );
}
