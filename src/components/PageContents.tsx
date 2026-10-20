import { useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { ListTree } from "lucide-react";

export interface PageContentsItem {
  /** The id of the element the entry jumps to; none for a section this reader is not shown. */
  id?: string;
  label: string;
  /** Said after the label, quietly: why an entry has no link, say. */
  note?: string;
}

export interface PageContentsGroup {
  title: string;
  items: PageContentsItem[];
}

/** Bring a section into view and give it focus, leaving its address in the URL to link to. */
function goTo(id: string, smooth: boolean) {
  const target = document.getElementById(id);
  if (!target) return;
  target.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" });
  // Focus goes with the view, so the keyboard carries on from the section.
  if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
  target.focus({ preventScroll: true });
  // Replaced, not pushed: Back leaves the page rather than stepping through
  // every section visited on it.
  history.replaceState(history.state, "", `#${id}`);
}

/**
 * A page's table of contents: a link to each of its sections, in groups.
 *
 * The links are plain anchors, so a section can be linked to from elsewhere
 * (/settings/bells-whistles#labels) and the list works without script; with
 * it, the page scrolls there smoothly. A page opened at such an address is
 * brought to its section once the section has been drawn — the cards fill in
 * after the page itself, too late for the browser's own jump.
 */
export function PageContents({ groups, title = "On this page" }: { groups: PageContentsGroup[]; title?: string }) {
  const ids = groups.flatMap((group) => group.items.flatMap((item) => (item.id ? [item.id] : [])));

  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (!id || !ids.includes(id)) return;
    const frame = requestAnimationFrame(() => goTo(id, false));
    return () => cancelAnimationFrame(frame);
    // Once, on arriving at the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (groups.every((group) => group.items.length === 0)) return null;
  return (
    <Card>
      <CardContent className="pt-6">
        <nav aria-label={title}>
          <p className="text-sm font-medium flex items-center gap-2 mb-3">
            <ListTree className="w-4 h-4" /> {title}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
            {groups.map((group) => (
              <section key={group.title} aria-label={group.title}>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1.5">{group.title}</p>
                <ol className="space-y-1 text-sm">
                  {group.items.map((item) => (
                    <li key={item.id ?? item.label}>
                      {item.id ? (
                        <a
                          href={`#${item.id}`}
                          onClick={(event) => {
                            if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
                            event.preventDefault();
                            goTo(item.id!, true);
                          }}
                          className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                        >
                          {item.label}
                        </a>
                      ) : (
                        <span className="text-muted-foreground/70">{item.label}</span>
                      )}
                      {item.note && <span className="text-xs text-muted-foreground/70"> — {item.note}</span>}
                    </li>
                  ))}
                </ol>
              </section>
            ))}
          </div>
        </nav>
      </CardContent>
    </Card>
  );
}
