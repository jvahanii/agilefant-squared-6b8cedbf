import type { ReactNode } from "react";
import { useWebAnalytics } from "@/lib/webAnalytics";
import { Link } from "react-router-dom";
import { ChevronDown } from "lucide-react";

/**
 * What a signed-out visitor sees at agilefant.org.
 *
 * It used to be the sign-in form, which told a newcomer nothing about what they
 * would be signing in to. Every claim here is a feature that exists in the app
 * today — the copy is lifted from the user guide and the Bells & Whistles
 * settings, not written ahead of them — so keep the two in step when either
 * changes. The keys shown are real ones from `src/lib/shortcuts.ts`.
 *
 * The look is deliberately plain: one accent colour, Inter throughout,
 * rules instead of cards, and no icons standing in for content. The first
 * version had a gradient glow, a two-tone headline, a dozen identical icon
 * cards and a crimson banner, and read as generated.
 *
 * The product picture in the hero is plain markup rather than a screenshot: it
 * stays sharp at any width, costs no download, and cannot drift into showing
 * somebody's real backlog. It copies the app's own list (row numbers, status
 * dots, dates in mono) so that what a visitor sees is what they will get.
 */

const SCALES = [
  {
    who: "For one",
    body: "A to-do list that grows with you: recurring chores, a reading list rated by stars, monthly savings and income charted over time.",
  },
  {
    who: "For a team",
    body: "Sprints on a board, points that add up smartly, burnups, and everyone looking at the same live view.",
  },
  {
    who: "For an enterprise",
    body: "Share trees across organizations, give each team its own statuses and labels, see the whole, and sign in through an enterprise-grade identity provider.",
  },
] as const;

type Feature = { title: string; body: string; keys?: readonly string[] };

const FEATURE_GROUPS: ReadonlyArray<{ name: string; lead: string; features: readonly Feature[] }> = [
  {
    name: "Structure",
    lead: "Trees of lists, lists of items, items inside items.",
    features: [
      {
        title: "Lists inside lists",
        body: "Nest lists as deep as your work goes: product, release, sprint, or home, garden, shed. Items nest too.",
      },
      {
        title: "One item in many lists",
        body: "Mirror an item into a list in another tree and it is the same item in both, with its own place in each.",
      },
      {
        title: "Lists and boards",
        body: "Rank items in a list, or drag cards across status columns. The view chosen last time is remembered.",
      },
    ],
  },
  {
    name: "Speed",
    lead: "Made to be driven from the keyboard.",
    features: [
      {
        title: "Keyboard first",
        body: "Almost every action has a shortcut: add, indent, move, change status. Press ? to see them all.",
        keys: ["Enter", "Tab", "D", "?"],
      },
      {
        title: "Undo and redo",
        body: "Moved the wrong thing? Undo it. Deleted, reparented, renamed: all of it steps back.",
        keys: ["Ctrl", "Z"],
      },
      {
        title: "Live changes",
        body: "Changes appear for your whole team as they happen. No refresh, no stale boards.",
      },
    ],
  },
  {
    name: "Numbers",
    lead: "Switched on when the work needs counting.",
    features: [
      {
        title: "Points and burnups",
        body: "Story points roll up through the item tree, and burnup charts show scope changes and progress.",
      },
      {
        title: "Time logging",
        body: "Log time against work items, lists and trees, and move entries that landed in the wrong place. Probably more versatile than any other time logging app you'll find.",
      },
      {
        title: "Star ratings",
        body: "Rate items one to five stars and sort a list best first, for lists where taste matters more than order.",
      },
    ],
  },
  {
    name: "Your way",
    lead: "Bent to fit how you already work.",
    features: [
      {
        title: "Your statuses, your labels",
        body: "Keep the five built-in statuses or define your own workflow. Label items across every tree.",
      },
      {
        title: "Recurring items",
        body: "Items that come back by themselves every few days, at the hour you choose. Chores, reviews, check-ins.",
      },
      {
        title: "Publish a list",
        body: "Share a read-only web page of any list with people who have no account. Choose which fields show.",
      },
    ],
  },
];

const INTEGRATIONS = [
  {
    title: "Jira",
    body: "Synchronise Jira Cloud spaces with Agilefant lists both ways: names, descriptions, statuses, story points, web links and the epic-to-subtask hierarchy. Send any list to a new Jira space in one click; statuses missing on either side are created. Changes arrive within seconds; Jira may need a refresh to show them.",
  },
  {
    title: "GitHub",
    body: "Every merged pull request becomes a Done item at the top of the list you choose.",
  },
  {
    title: "WhatsApp",
    body: "Send a message to a connected chat and it lands as an In Progress item, ready to be ranked.",
  },
  {
    title: "Gmail",
    body: "Job-alert mail from the major Finnish and international boards becomes work items with employer, city, deadline and a link to the actual job ad.",
  },
] as const;

const PLANS = [
  {
    name: "Free",
    tagline: "No time limit",
    body: "Fully functional, from personal to enterprise use.",
    points: ["All features", "Unlimited everything", "No credit card"],
    cta: { label: "Start free", to: "/auth/sign-up" },
  },
  {
    name: "Enterprise",
    tagline: "Tailored",
    body: "For organizations that need it shaped around them.",
    points: ["Request features", "Dedicated support", "Tailored onboarding"],
    cta: { label: "Contact sales", href: "mailto:jvahanii@gmail.com" },
  },
] as const;

/**
 * The crest: a rearing elephant on a crimson shield under the Finnish flag.
 * The same artwork the app ships as its icon, and the mark Agilefant has worn
 * since long before this rewrite — not the flat pink elephant a generator left
 * in `agilefant-logo.png`.
 */
function Logo() {
  return (
    <span className="flex items-center gap-2 font-semibold tracking-tight">
      <img src="/agilefant-shield.png" alt="" width={28} height={28} className="h-7 w-7 object-contain" />
      <span>
        Agilefant<sup className="text-primary">2</sup>
      </span>
    </span>
  );
}

function Key({ children }: { children: ReactNode }) {
  return (
    <kbd className="mx-0.5 inline-flex h-6 min-w-6 items-center align-middle justify-center rounded border border-b-2 border-foreground/20 bg-card px-1.5 font-mono text-xs font-medium text-foreground">
      {children}
    </kbd>
  );
}

const STATUS = {
  done: "var(--status-done)",
  inProgress: "var(--status-in-progress)",
  pending: "var(--status-pending)",
  blocked: "var(--status-blocked)",
  notStarted: "var(--status-not-started)",
} as const;

const PREVIEW_LISTS = [
  { group: "Product", lists: [["Roadmap", 0], ["Release 4.2", 1], ["Sprint 18", 2], ["Ideas", 0]] },
  { group: "Home", lists: [["This week", 0], ["Garden", 0]] },
] as const;

const PREVIEW_ROWS: ReadonlyArray<{
  title: string;
  status: string;
  points: number;
  depth?: number;
  open?: boolean;
  selected?: boolean;
  due?: string;
  label?: string;
}> = [
  { title: "Checkout in one step", status: STATUS.done, points: 5 },
  { title: "Offline drafts", status: STATUS.inProgress, points: 8, open: true },
  { title: "Save to device", status: STATUS.done, points: 3, depth: 1 },
  { title: "Sync on reconnect", status: STATUS.inProgress, points: 5, depth: 1, selected: true },
  { title: "Dark mode", status: STATUS.notStarted, points: 3, due: "12/05" },
  { title: "Faster search", status: STATUS.blocked, points: 2, label: "api" },
  { title: "Export to CSV", status: STATUS.pending, points: 1 },
  { title: "Release notes", status: STATUS.notStarted, points: 1, due: "12/12" },
];

/** A still of the app as it is: the tree of lists on the left, one list on the right. */
function ProductPicture() {
  return (
    <div
      className="overflow-hidden rounded-lg border border-foreground/15 bg-background text-left text-[13px] shadow-[0_1px_0_hsl(var(--foreground)/0.04),0_24px_48px_-24px_hsl(var(--foreground)/0.25)]"
      aria-hidden="true"
    >
      <div className="flex h-10 items-center gap-3 border-b bg-card px-3">
        <img src="/agilefant-shield.png" alt="" width={18} height={18} className="h-[18px] w-[18px]" />
        <span className="font-semibold">
          Agilefant<sup className="text-primary">2</sup>
        </span>
        <span className="text-muted-foreground">Product team ▾</span>
        <span className="ml-auto hidden gap-2 sm:flex">
          <Key>?</Key>
        </span>
      </div>
      <div className="grid sm:grid-cols-[11rem_minmax(0,1fr)]">
        <div className="hidden border-r bg-card/60 py-2 sm:block">
          <p className="px-3 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground">LISTS</p>
          {PREVIEW_LISTS.map(({ group, lists }) => (
            <div key={group} className="mt-1">
              <p className="px-4 py-1 text-[11px] font-semibold tracking-wide text-muted-foreground">
                {group.toUpperCase()}
              </p>
              {lists.map(([name, depth]) => (
                <p
                  key={name}
                  className={`mx-1.5 truncate rounded px-2 py-[3px] ${name === "Release 4.2" ? "bg-accent font-medium text-accent-foreground" : ""}`}
                  style={{ paddingLeft: `${1.5 + depth * 0.9}rem` }}
                >
                  {name}
                </p>
              ))}
            </div>
          ))}
        </div>
        <div className="min-w-0">
          <div className="border-b px-3 py-1.5 text-muted-foreground">Filter items… (/)</div>
          <div className="flex items-end justify-between gap-3 px-3 pb-2 pt-2.5">
            <div>
              <p className="text-base font-semibold leading-tight">Release 4.2</p>
              <p className="text-xs text-muted-foreground">8 items</p>
            </div>
            <div className="flex rounded-md border bg-card p-0.5 text-xs">
              <span className="rounded bg-muted px-2 py-0.5 font-medium">List</span>
              <span className="px-2 py-0.5 text-muted-foreground">Board</span>
            </div>
          </div>
          <div className="pb-2">
            {PREVIEW_ROWS.map((row, i) => (
              <div
                key={row.title}
                className={`flex items-center gap-2 py-[5px] pr-3 ${row.selected ? "bg-accent" : ""}`}
                style={{ paddingLeft: `${0.5 + (row.depth ?? 0) * 1.4}rem` }}
              >
                <span className="flex w-4 shrink-0 justify-center text-muted-foreground">
                  {row.open && <ChevronDown className="h-3.5 w-3.5" />}
                </span>
                <span className="w-4 shrink-0 text-right tabular-nums text-muted-foreground">{i + 1}</span>
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: row.status }} />
                {row.due && <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{row.due}</span>}
                <span className="min-w-0 truncate">{row.title}</span>
                {row.label && (
                  <span className="shrink-0 rounded-sm bg-muted px-1.5 text-[11px] text-muted-foreground">{row.label}</span>
                )}
                <span className="ml-auto shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
                  {row.points}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** A section's heading row: the heading on the left, what it is about beside it. */
function SectionHead({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="grid gap-4 md:grid-cols-12">
      <h2 className="text-3xl font-bold leading-tight tracking-tight sm:text-4xl md:col-span-5">{title}</h2>
      {children && <div className="max-w-xl text-muted-foreground md:col-span-6 md:col-start-7 md:pt-2">{children}</div>}
    </div>
  );
}

export default function Landing() {
  useWebAnalytics();
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b bg-background">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
          <Logo />
          <nav className="flex items-center gap-1 text-sm sm:gap-5">
            <a href="#features" className="hidden text-muted-foreground hover:text-foreground sm:inline">
              Features
            </a>
            <a href="#pricing" className="hidden text-muted-foreground hover:text-foreground sm:inline">
              Pricing
            </a>
            <Link to="/user-guide" className="hidden text-muted-foreground hover:text-foreground md:inline">
              User guide
            </Link>
            <Link to="/auth" className="rounded-md px-3 py-1.5 font-medium hover:bg-muted">
              Sign in
            </Link>
            <Link
              to="/auth/sign-up"
              className="rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground hover:bg-primary/90"
            >
              Get started
            </Link>
          </nav>
        </div>
      </header>

      <main>
        <section className="mx-auto max-w-6xl px-4 pb-20 pt-14 sm:px-6 sm:pt-24">
          <h1 className="max-w-4xl text-balance text-5xl font-bold leading-[1.05] tracking-tight sm:text-6xl">
            Every list you have, in one app.
          </h1>
          <div className="mt-8 grid gap-8 lg:grid-cols-12 lg:items-end">
            <p className="max-w-xl text-lg leading-relaxed text-muted-foreground lg:col-span-7">
              Agilefant scales from one person's to-do list to an enterprise's whole portfolio of initiatives,
              products, projects and backlogs. Nest lists as deep as your work needs, keep the same item on several
              lists, share lists with other organizations and the public, and do nearly all of it from the keyboard.
            </p>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3 lg:col-span-5 lg:justify-end">
              <Link
                to="/auth/sign-up"
                className="rounded-md bg-primary px-5 py-2.5 font-medium text-primary-foreground hover:bg-primary/90"
              >
                Start free
              </Link>
              {/* Sign in stays in the header; here, a way to look before signing
                  up. A plain link: the try-out starts in a page of its own. */}
              <a href="/try" className="font-medium underline decoration-foreground/30 underline-offset-4 hover:decoration-foreground">
                Try it without signing up →
              </a>
            </div>
          </div>

          <div className="mt-14">
            <ProductPicture />
            {/* Keys mean nothing on a phone, so the caption shows from tablet width up. */}
            <p className="mt-4 hidden text-sm leading-8 text-muted-foreground sm:block">
              Type <Key>4</Key> to select row 4, <Key>I</Key> to start it, <Key>D</Key> when it is done,{" "}
              <Key>Tab</Key> to nest it under the row above.
            </p>
          </div>
        </section>

        <section className="border-t">
          <div className="mx-auto grid max-w-6xl md:grid-cols-3">
            {SCALES.map(({ who, body }, i) => (
              <div
                key={who}
                className={`px-4 py-10 sm:px-6 ${i > 0 ? "border-t md:border-l md:border-t-0" : ""}`}
              >
                <h2 className="text-xl font-semibold tracking-tight">{who}</h2>
                <p className="mt-2 text-muted-foreground">{body}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="features" className="scroll-mt-14 border-t">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-24">
            <SectionHead title="Small to start, and it grows with the work.">
              A new account has trees of lists, lists, and work items. Everything else (points, statuses, labels, time,
              ratings and more) is a switch you turn on when your work needs it.
            </SectionHead>

            <div className="mt-14">
              {FEATURE_GROUPS.map(({ name, lead, features }) => (
                <div key={name} className="grid gap-6 border-t py-10 md:grid-cols-12">
                  <div className="md:col-span-4">
                    <h3 className="text-lg font-semibold">{name}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">{lead}</p>
                  </div>
                  <dl className="grid gap-x-8 gap-y-6 sm:grid-cols-3 md:col-span-8">
                    {features.map(({ title, body, keys }) => (
                      <div key={title}>
                        <dt className="font-semibold">{title}</dt>
                        <dd className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{body}</dd>
                        {keys && (
                          <dd className="mt-3 flex flex-wrap gap-1">
                            {keys.map((k) => (
                              <Key key={k}>{k}</Key>
                            ))}
                          </dd>
                        )}
                      </div>
                    ))}
                  </dl>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-foreground text-background">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-24">
            <div className="grid gap-4 md:grid-cols-12">
              <h2 className="text-3xl font-bold leading-tight tracking-tight sm:text-4xl md:col-span-5">
                Work comes in from where it starts.
              </h2>
              <p className="max-w-xl text-background/70 md:col-span-6 md:col-start-7 md:pt-2">
                Connect the places work begins, and it shows up in the right list without anyone retyping it.
              </p>
            </div>
            <dl className="mt-14">
              {INTEGRATIONS.map(({ title, body }) => (
                <div key={title} className="grid gap-2 border-t border-background/15 py-6 md:grid-cols-12">
                  <dt className="text-xl font-semibold md:col-span-4">{title}</dt>
                  <dd className="max-w-2xl leading-relaxed text-background/75 md:col-span-8">{body}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section id="pricing" className="scroll-mt-14">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-24">
            <SectionHead title="Free means free.">
              The free plan is the whole product, not a trial. Pay only when you need dedicated support and help with
              onboarding.
            </SectionHead>
            <div className="mt-14 grid border-y md:grid-cols-2">
              {PLANS.map((plan, i) => (
                <div
                  key={plan.name}
                  className={`flex flex-col py-8 md:px-8 ${i === 0 ? "md:pl-0" : "border-t md:border-l md:border-t-0 md:pr-0"}`}
                >
                  <div className="flex items-baseline justify-between gap-4">
                    <h3 className="text-2xl font-bold">{plan.name}</h3>
                    <p className="text-sm text-muted-foreground">{plan.tagline}</p>
                  </div>
                  <p className="mt-2 text-muted-foreground">{plan.body}</p>
                  <ul className="mt-6 flex-1 space-y-2">
                    {plan.points.map((p) => (
                      <li key={p} className="flex gap-3">
                        <span className="text-primary" aria-hidden="true">
                          ✓
                        </span>
                        {p}
                      </li>
                    ))}
                  </ul>
                  {"to" in plan.cta ? (
                    <Link
                      to={plan.cta.to}
                      className="mt-8 self-start rounded-md bg-primary px-5 py-2.5 font-medium text-primary-foreground hover:bg-primary/90"
                    >
                      {plan.cta.label}
                    </Link>
                  ) : (
                    <a
                      href={plan.cta.href}
                      className="mt-8 self-start rounded-md border border-foreground/20 px-5 py-2.5 font-medium hover:bg-muted"
                    >
                      {plan.cta.label}
                    </a>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="border-t">
          <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-20 sm:px-6 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Plant your first tree.</h2>
              <p className="mt-3 max-w-lg text-muted-foreground">
                Sign up with Google or an email address and you are in your own organization in under a minute.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
              <Link
                to="/auth/sign-up"
                className="rounded-md bg-primary px-5 py-2.5 font-medium text-primary-foreground hover:bg-primary/90"
              >
                Get started
              </Link>
              <a href="/try" className="font-medium underline decoration-foreground/30 underline-offset-4 hover:decoration-foreground">
                Try it here first →
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <Logo />
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            <Link to="/user-guide" className="hover:text-foreground">
              User guide
            </Link>
            <Link to="/terms" className="hover:text-foreground">
              Terms and privacy
            </Link>
            <a href="mailto:jvahanii@gmail.com" className="hover:text-foreground">
              Support: jvahanii@gmail.com
            </a>
            <Link to="/auth" className="hover:text-foreground">
              Sign in
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
