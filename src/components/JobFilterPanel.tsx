import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { JOB_CHIPS, SOURCES_SHOWN, type JobChip } from "@/lib/jobFilters";

/**
 * The filters of a public list of job ads: chips that leave kinds of job out
 * or narrow the list to one, and below them where the jobs were found.
 *
 * Shown only on a page whose link has job filters switched on — they read a
 * name as "Employer - Role" and a link as the ad's address, which is true of
 * a list of imported job ads and of nothing else.
 *
 * It holds no state of its own beyond what is folded away: the page owns the
 * choices, since the page is what filters.
 */
export function JobFilterPanel({
  chips,
  onToggleChip,
  sources,
  selectedSources,
  onToggleSource,
  shown,
  total,
  onReset,
  changed,
}: {
  chips: ReadonlySet<JobChip>;
  onToggleChip: (chip: JobChip) => void;
  /** The sources of the jobs the chips leave, most jobs first. */
  sources: readonly { source: string; count: number }[];
  selectedSources: ReadonlySet<string>;
  onToggleSource: (source: string) => void;
  /** Jobs left by the chips and the sources together, and how many there are in all. */
  shown: number;
  total: number;
  /** Every filter off again, as the page first opens. */
  onReset: () => void;
  /** Some filter is on. */
  changed: boolean;
}) {
  // Open beside the list, where there is room for it; folded on a phone,
  // where the panel sits above the list and every line of it is a line the
  // jobs are pushed down by.
  const [sourcesOpen, setSourcesOpen] = useState(
    () => typeof window === "undefined" || !window.matchMedia || window.matchMedia("(min-width: 768px)").matches,
  );
  const [allSources, setAllSources] = useState(false);
  // A ticked source stays listed however few jobs it has now: a tick that has
  // scrolled out of the short list could not be found to be taken off.
  const short = sources.filter((s, i) => i < SOURCES_SHOWN || selectedSources.has(s.source));
  const listed = allSources ? sources : short;
  const more = sources.length - short.length;

  return (
    // Beside the list on a wide screen, and staying there while the list
    // scrolls under it — a list of hundreds would otherwise leave its filters
    // at the top. Above the list on a narrow one, where it scrolls away with
    // the page as the rest of the page's head does.
    <aside
      aria-label="Filters"
      className="md:sticky md:top-4 md:max-h-[calc(100vh-2rem)] md:w-56 md:shrink-0 md:self-start md:overflow-y-auto"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">Filters</h2>
        {changed && (
          <button
            type="button"
            onClick={onReset}
            className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            Reset
          </button>
        )}
      </div>
      <p className="mt-0.5 text-xs tabular-nums text-muted-foreground" role="status">
        {shown} of {total} job{total === 1 ? "" : "s"}
      </p>

      <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="Kinds of job">
        {JOB_CHIPS.map((chip) => {
          const on = chips.has(chip.id);
          return (
            <button
              key={chip.id}
              type="button"
              aria-pressed={on}
              title={chip.hint}
              onClick={() => onToggleChip(chip.id)}
              className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                on
                  ? "border-primary/50 bg-primary/10 font-medium text-primary"
                  : "bg-background text-foreground hover:bg-accent"
              }`}
            >
              {chip.label}
            </button>
          );
        })}
      </div>

      {sources.length > 0 && (
        <div className="mt-5">
          <button
            type="button"
            aria-expanded={sourcesOpen}
            aria-controls="job-filter-sources"
            onClick={() => setSourcesOpen((open) => !open)}
            className="flex w-full items-center justify-between text-xs text-muted-foreground hover:text-foreground"
          >
            Source
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${sourcesOpen ? "" : "-rotate-90"}`} aria-hidden="true" />
          </button>
          {sourcesOpen && (
            <div id="job-filter-sources" className="mt-2 space-y-1.5">
              {listed.map(({ source, count }) => (
                <label key={source} className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={selectedSources.has(source)}
                    onChange={() => onToggleSource(source)}
                    className="h-4 w-4 shrink-0 rounded border"
                  />
                  <span className="min-w-0 flex-1 truncate" title={source}>
                    {source}
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{count}</span>
                </label>
              ))}
              {(more > 0 || allSources) && (
                <button
                  type="button"
                  onClick={() => setAllSources((all) => !all)}
                  className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                >
                  {allSources ? "Show fewer" : `Show ${more} more`}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
