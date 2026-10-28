import { useEffect, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { BookOpen } from "lucide-react";

/**
 * A public guide page, readable without an account and linkable section by
 * section: the job ad import guide and the Jira guide are both one of these.
 */
export function PublicGuide({
  documentTitle,
  name,
  heading,
  intro,
  sections,
  children,
}: {
  /** The browser tab's title. */
  documentTitle: string;
  /** After "Agilefant² —" in the header. */
  name: string;
  heading: string;
  intro: ReactNode;
  sections: ReadonlyArray<{ id: string; title: string }>;
  children: ReactNode;
}) {
  useEffect(() => {
    document.title = documentTitle;
  }, [documentTitle]);

  // A link to a section — /user-guide/jira#stopping — opens at it. The browser
  // looks for the section as the address loads, before this page has arrived
  // to have one, and stays at the top.
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (id) document.getElementById(id)?.scrollIntoView();
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b px-4 py-4 sm:px-6">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-primary" aria-hidden="true" />
            <span className="text-base font-semibold">
              Agilefant<sup className="text-primary">2</sup> — {name}
            </span>
          </div>
          <nav className="flex items-center gap-4 text-sm">
            <Link to="/user-guide" className="text-muted-foreground transition-colors hover:text-foreground">
              Full user guide
            </Link>
            <Link to="/auth" className="text-muted-foreground transition-colors hover:text-foreground">
              Sign in →
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{heading}</h1>
        <p className="mt-4 text-lg leading-relaxed text-muted-foreground">{intro}</p>

        <nav aria-label="On this page" className="mt-8 rounded-lg border p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">On this page</p>
          <ol className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
            {sections.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className="text-primary underline-offset-2 hover:underline">
                  {s.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        {children}

        <footer className="mt-16 border-t pt-6 text-sm text-muted-foreground">
          <Link to="/user-guide" className="text-primary underline-offset-2 hover:underline">
            Read the full Agilefant² user guide →
          </Link>
        </footer>
      </main>
    </div>
  );
}

export function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="mt-12 scroll-mt-6" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="text-2xl font-semibold tracking-tight">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** A step within a long section; with an id, one that can be linked to. */
export function SubHeading({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <h3 id={id} className="mt-8 scroll-mt-6 text-lg font-semibold tracking-tight">
      {children}
    </h3>
  );
}

export function P({ children }: { children: ReactNode }) {
  return <p className="mt-3 leading-relaxed">{children}</p>;
}

export function Ul({ children }: { children: ReactNode }) {
  return <ul className="mt-3 list-disc space-y-2 pl-6 leading-relaxed marker:text-muted-foreground">{children}</ul>;
}

export function Ol({ children }: { children: ReactNode }) {
  return <ol className="mt-3 list-decimal space-y-3 pl-6 leading-relaxed marker:text-muted-foreground">{children}</ol>;
}

/** A label the app shows, set apart from the prose around it. */
export function Em({ children }: { children: ReactNode }) {
  return <span className="font-medium">{children}</span>;
}

export function Code({ children }: { children: ReactNode }) {
  return <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em]">{children}</code>;
}

export function Dl({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="mt-3 space-y-3">
      {items.map(([term, description]) => (
        <div key={term} className="rounded-lg border px-4 py-3">
          <dt className="font-medium">{term}</dt>
          <dd className="mt-1 text-sm leading-relaxed text-muted-foreground">{description}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Callout({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "warning" }) {
  return (
    <div
      role="note"
      className={`mt-4 rounded-lg border px-4 py-3 text-sm leading-relaxed ${
        tone === "warning" ? "border-amber-500/40 bg-amber-500/10" : "border-primary/30 bg-primary/5"
      }`}
    >
      {children}
    </div>
  );
}
