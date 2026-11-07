/**
 * The filter box over the list — keyword search and the label and team chips
 * in one place. "/" focuses it; while a command is typed after a "/" it
 * suggests the ones that fit, and Tab completes the first. The arrow keys
 * choose among the search results and Enter opens one; Escape clears it all.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { useAppStore } from "@/store/appStore";
import { useOrgStore } from "@/store/orgStore";
import { useLabelsStore, type Label } from "@/store/labelsStore";
import { useTeamStore } from "@/store/teamStore";
import { useIsMobile } from "@/hooks/use-mobile";
import { commandBeingTyped, suggestCommands } from "@/lib/itemSearch";
import type { ItemSearch, SearchResult } from "./useItemSearch";
import type { ListFilters } from "./useListFilters";

/** A chip that filters by a label or team, on and off. */
function FilterChip({ on, color, name, onClick }: { on: boolean; color: string; name: string; onClick: () => void }) {
  return (
    <button
      className={`flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs transition-colors ${
        on ? "bg-primary/15 text-primary ring-1 ring-primary/40" : "bg-muted text-muted-foreground hover:bg-muted/60"
      }`}
      onClick={onClick}
    >
      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
      {name}
    </button>
  );
}

function ClearChips({ title, onClick }: { title: string; onClick: () => void }) {
  return (
    <button
      className="flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground px-1 py-0.5 rounded transition-colors"
      onClick={onClick}
      title={title}
    >
      <X className="w-3 h-3" />
      Clear
    </button>
  );
}

export function FilterBar({
  search,
  filters,
  labelsVisible,
  onOpen,
}: {
  search: ItemSearch;
  filters: ListFilters;
  labelsVisible: boolean;
  /** Go to a search result. */
  onOpen: (result: SearchResult) => void;
}) {
  const query = useAppStore((s) => s.searchQuery);
  const setQuery = useAppStore((s) => s.setSearchQuery);
  const activeOrgId = useOrgStore((s) => s.activeOrgId);
  const labelsMap = useLabelsStore((s) => s.labels);
  const teams = useTeamStore((s) => s.teams);
  const isMobile = useIsMobile();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isHovered, setIsHovered] = useState(false);
  const [isFocused, setIsFocused] = useState(false);

  // The organisation's labels, as chips.
  const orgLabels = useMemo(
    () =>
      Object.values(labelsMap)
        .filter((l) => l.organizationId === activeOrgId)
        .sort((a, b) => a.name.localeCompare(b.name)) as Label[],
    [labelsMap, activeOrgId],
  );

  // "/" focuses the box.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
      if (!isInput && e.key === "/") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // The commands that fit what is being typed after a "/".
  const commandTyped = commandBeingTyped(query);
  const suggestions = commandTyped ? suggestCommands(commandTyped) : [];
  const applySuggestion = (insert: string) => {
    if (!commandTyped) return;
    setQuery(query.slice(0, query.length - commandTyped.length) + insert);
    inputRef.current?.focus();
  };

  const clearAll = () => {
    setQuery("");
    filters.clear();
  };
  // The chips show while the bar is in use, or something is chosen; always on a phone.
  const chipsInUse = isMobile || isFocused || isHovered;

  return (
    <div
      className="px-1 pt-1 pb-0.5 border-b shrink-0"
      onClick={(e) => e.stopPropagation()}
      onMouseEnter={() => !isMobile && setIsHovered(true)}
      onMouseLeave={() => !isMobile && setIsHovered(false)}
    >
      <div className="relative">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50 pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          className="w-full h-7 pl-7 pr-6 text-xs bg-muted/50 rounded-md border border-transparent focus:border-primary/40 focus:bg-background outline-none transition-colors placeholder:text-muted-foreground/50"
          placeholder="Filter items... (/)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              clearAll();
              (e.target as HTMLInputElement).blur();
            } else if (e.key === "Tab" && !e.shiftKey && suggestions.length > 0) {
              e.preventDefault();
              applySuggestion(suggestions[0].insert);
            } else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && search.active && search.shown.length > 0) {
              e.preventDefault();
              search.moveActive(e.key === "ArrowDown" ? 1 : -1);
            } else if (e.key === "Enter") {
              const chosen = search.active ? search.chosen() : undefined;
              if (chosen) onOpen(chosen);
              (e.target as HTMLInputElement).blur();
            }
            e.stopPropagation();
          }}
          role="combobox"
          aria-expanded={search.active}
          aria-autocomplete="list"
        />
        {isFocused && suggestions.length > 0 && (
          <div
            className="absolute left-0 right-0 top-full z-30 mt-1 rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
            role="listbox"
            aria-label="Search commands"
          >
            {suggestions.map((command, i) => (
              <button
                key={command.usage}
                type="button"
                role="option"
                aria-selected={i === 0}
                className={`flex w-full items-baseline gap-2 rounded-sm px-2 py-1 text-left text-xs hover:bg-accent${i === 0 ? " bg-accent/60" : ""}`}
                // Keep the cursor in the search box.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => applySuggestion(command.insert)}
              >
                <span className="font-mono">{command.usage}</span>
                <span className="text-muted-foreground">{command.description}</span>
              </button>
            ))}
            <p className="px-2 pt-1 text-[10px] text-muted-foreground">Tab completes the first. Commands combine with words.</p>
          </div>
        )}
        {(query || filters.active) && (
          <button
            className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            onClick={clearAll}
            title="Clear all filters"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      {!search.active && labelsVisible && orgLabels.length > 0 && (chipsInUse || filters.labelIds.size > 0) && (
        <div className="flex flex-wrap gap-1 mt-1">
          {orgLabels.map((label) => (
            <FilterChip
              key={label.id}
              on={filters.labelIds.has(label.id)}
              color={label.color}
              name={label.name}
              onClick={() => filters.toggleLabel(label.id)}
            />
          ))}
          {filters.labelIds.size > 0 && <ClearChips title="Clear label filter" onClick={filters.clearLabels} />}
        </div>
      )}
      {!search.active && teams.length > 0 && (chipsInUse || filters.teamIds.size > 0) && (
        <div className="flex flex-wrap gap-1 mt-1">
          {teams.map((team) => (
            <FilterChip
              key={team.id}
              on={filters.teamIds.has(team.id)}
              color="hsl(var(--primary))"
              name={team.name}
              onClick={() => filters.toggleTeam(team.id)}
            />
          ))}
          {filters.teamIds.size > 0 && <ClearChips title="Clear team filter" onClick={filters.clearTeams} />}
        </div>
      )}
    </div>
  );
}
