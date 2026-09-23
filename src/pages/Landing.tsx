import { Link } from "react-router-dom";
import {
  ArrowRight,
  BarChart3,
  Building2,
  CalendarClock,
  Check,
  Clock,
  GitMerge,
  GitBranch,
  Globe,
  Keyboard,
  KanbanSquare,
  ListTree,
  Mail,
  MessageCircle,
  Radio,
  Star,
  Tags,
  Undo2,
  User,
  Users,
} from "lucide-react";

/**
 * What a signed-out visitor sees at agilefant.org.
 *
 * It used to be the sign-in form, which told a newcomer nothing about what they
 * would be signing in to. Every claim here is a feature that exists in the app
 * today — the copy is lifted from the user guide and the Bells & Whistles
 * settings, not written ahead of them — so keep the two in step when either
 * changes.
 *
 * The product picture in the hero is plain markup rather than a screenshot: it
 * stays sharp at any width, costs no download, and cannot drift into showing
 * somebody's real backlog.
 */

const FEATURES = [
  {
    icon: ListTree,
    title: "Backlogs inside backlogs",
    body: "Nest backlogs as deep as your work goes — product, release, sprint, or home, garden, shed. Items nest too.",
  },
  {
    icon: GitBranch,
    title: "One item, many trees",
    body: "Mirror an item into another backlog tree and it is the same item in both, with its own place in each.",
  },
  {
    icon: KanbanSquare,
    title: "Lists and boards",
    body: "Rank items in a list, or drag cards across status columns. Each backlog remembers which view it prefers.",
  },
  {
    icon: Keyboard,
    title: "Keyboard-first",
    body: "Almost every action has a shortcut: add, indent, move, change status. Press ? to see them all.",
  },
  {
    icon: Undo2,
    title: "Undo and redo",
    body: "Moved the wrong thing? Undo it. Deleted, reparented, renamed — all of it steps back.",
  },
  {
    icon: CalendarClock,
    title: "Recurring items",
    body: "Items that come back by themselves every few days, at the hour you choose. Chores, reviews, check-ins.",
  },
  {
    icon: BarChart3,
    title: "Points and burnups",
    body: "Story points roll up through the tree, and burnup charts show whether scope or progress is winning.",
  },
  {
    icon: Tags,
    title: "Your statuses, your labels",
    body: "Keep the five built-in statuses or define your own workflow. Label items across every tree.",
  },
  {
    icon: Clock,
    title: "Time logging",
    body: "Log time against work items and move entries between items if they landed in the wrong place. More versatile than any other time logging app you'll find",
  },
  {
    icon: Star,
    title: "Star ratings",
    body: "Rate items one to five stars and sort a backlog best first — for backlogs where taste matters more than order.",
  },
  {
    icon: Globe,
    title: "Publish a backlog",
    body: "Share a read-only web page of any backlog with people who have no account. Choose which fields show.",
  },
  {
    icon: Radio,
    title: "Live changes",
    body: "Changes appear for your whole team as they happen — no refresh, no stale boards.",
  },
] as const;

const SCALES = [
  {
    icon: User,
    who: "For one",
    body: "A to-do list that grows with you: recurring chores, a reading list rated by stars, monthly savings and income charted over time.",
  },
  {
    icon: Users,
    who: "For a team",
    body: "Sprints on a board, points that add up smartly, burnups, and everyone looking at the same live backlog.",
  },
  {
    icon: Building2,
    who: "For an organisation",
    body: "Share trees across organisations, allow each team its own statuses and labels, see the whole, and sign in through an enterprise-grade identity provider.",
  },
] as const;

const INTEGRATIONS = [
  {
    icon: GitMerge,
    title: "GitHub",
    body: "Every merged pull request becomes a Done item at the top of the backlog you choose.",
  },
  {
    icon: MessageCircle,
    title: "WhatsApp",
    body: "Send a message to a connected chat and it lands as an In Progress item, ready to be ranked.",
  },
  {
    icon: Mail,
    title: "Gmail import",
    body: "A powerful job-alert mail import from the major Finnish and international boards turns postings into work items with employer, city, deadline and the link to the actual job add",
  },
] as const;

const PLANS = [
  {
    name: "Free",
    tagline: "No time limit",
    body: "Fully functional, from personal to enterprise use.",
    points: ["All features\u00a0", "Unlimited everything", "", "Data export always included"],
    cta: { label: "Start free", to: "/auth/sign-up" },
    featured: true,
  },
  {
    name: "Enterprise",
    tagline: "Tailored",
    body: "For organisations that need it shaped around them.",
    points: ["Request features\u00a0", "Dedicated support", "Tailored onboarding"],
    cta: { label: "Contact sales", href: "mailto:jvahanii@gmail.com" },
    featured: false,
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
      <img src="/agilefant-shield.png" alt="" width={32} height={32} className="h-8 w-8 object-contain" />
      <span>
        Agilefant<sup className="text-primary">2</sup>
      </span>
    </span>
  );
}

/** A still of the app: a tree on the left, its backlog on the right. */
function ProductPreview() {
  const tree = [
    { name: "Product", depth: 0 },
    { name: "Release 4.2", depth: 1, active: true },
    { name: "Sprint 18", depth: 2 },
    { name: "Ideas", depth: 1 },
    { name: "Home", depth: 0 },
    { name: "Garden", depth: 1 },
  ];
  const items = [
    { title: "Checkout in one step", status: "var(--status-done)", points: 5, stars: 5 },
    { title: "Offline drafts", status: "var(--status-in-progress)", points: 8, stars: 4, depth: 0 },
    { title: "Save to device", status: "var(--status-in-progress)", points: 3, stars: 0, depth: 1 },
    { title: "Sync on reconnect", status: "var(--status-pending)", points: 5, stars: 0, depth: 1 },
    { title: "Dark mode", status: "var(--status-not-started)", points: 3, stars: 3 },
    { title: "Faster search", status: "var(--status-blocked)", points: 2, stars: 4 },
  ];
  return (
    <div
      className="overflow-hidden rounded-xl border bg-card text-left shadow-2xl shadow-primary/10"
      aria-hidden="true"
    >
      <div className="flex items-center gap-1.5 border-b bg-muted/60 px-3 py-2">
        <span className="h-2.5 w-2.5 rounded-full bg-border" />
        <span className="h-2.5 w-2.5 rounded-full bg-border" />
        <span className="h-2.5 w-2.5 rounded-full bg-border" />
      </div>
      <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,5fr)] text-xs sm:text-sm">
        <div className="space-y-0.5 border-r bg-muted/30 p-2 sm:p-3">
          {tree.map((b) => (
            <div
              key={b.name}
              className={`truncate rounded px-2 py-1 ${b.active ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground"}`}
              style={{ paddingLeft: `${0.5 + b.depth * 0.75}rem` }}
            >
              {b.name}
            </div>
          ))}
        </div>
        <div className="divide-y">
          {items.map((it) => (
            <div
              key={it.title}
              className="flex items-center gap-2 px-2 py-2 sm:px-3"
              style={{ paddingLeft: `${0.75 + (it.depth ?? 0) * 1.25}rem` }}
            >
              <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: it.status }} />
              <span className="min-w-0 flex-1 truncate">{it.title}</span>
              <span className="hidden shrink-0 text-amber-500 sm:inline">
                {it.stars > 0 ? "★".repeat(it.stars) : ""}
              </span>
              <span className="shrink-0 rounded bg-muted px-1.5 text-[11px] tabular-nums text-muted-foreground">
                {it.points}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function Landing() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4">
          <Logo />
          <nav className="flex items-center gap-1 text-sm sm:gap-4">
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
        <section className="relative overflow-hidden">
          <div
            className="pointer-events-none absolute inset-x-0 -top-40 h-[32rem] bg-[radial-gradient(ellipse_at_top,hsl(var(--primary)/0.14),transparent_65%)]"
            aria-hidden="true"
          />
          <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 pb-16 pt-14 sm:pt-20 lg:grid-cols-2">
            <div>
              <h1 className="text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
                Every backlog you have, <span className="text-primary">in one app.</span>
              </h1>
              <p className="mt-5 max-w-xl text-lg text-muted-foreground">
                Agilefant² is a backlog tool that scales from one person's to-do list to an enterprise's whole portfolio.
                Nest backlogs as deep as your work needs, keep item in multiple lists, share backlogs with
                other organizations and the public, and do nearly all of it from the keyboard.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link
                  to="/auth/sign-up"
                  className="inline-flex items-center gap-2 rounded-md bg-primary px-5 py-2.5 font-medium text-primary-foreground shadow-sm hover:bg-primary/90"
                >
                  Free forever <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
                <Link to="/auth" className="inline-flex items-center rounded-md border bg-card px-5 py-2.5 font-medium hover:bg-muted">
                  Sign in
                </Link>
              </div>
            </div>
            <ProductPreview />
          </div>
        </section>

        <section className="border-y bg-card/60">
          <div className="mx-auto grid max-w-6xl gap-8 px-4 py-14 md:grid-cols-3">
            {SCALES.map(({ icon: Icon, who, body }) => (
              <div key={who}>
                <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </div>
                <h2 className="text-lg font-semibold">{who}</h2>
                <p className="mt-1.5 text-muted-foreground">{body}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="features" className="mx-auto max-w-6xl scroll-mt-16 px-4 py-20">
          <div className="max-w-2xl">
            <h2 className="text-3xl font-bold tracking-tight">Simple to start. Powerful when you need it.</h2>
            <p className="mt-3 text-muted-foreground">
              A new account is composed of backlog trees, backlogs and work items. Everything else — points,
              statuses, labels, time, ratings and so on — is a switch you turn on when your work needs it.
            </p>
          </div>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ icon: Icon, title, body }) => (
              <div key={title} className="rounded-xl border bg-card p-5 transition-shadow hover:shadow-md">
                <Icon className="h-5 w-5 text-primary" aria-hidden="true" />
                <h3 className="mt-3 font-semibold">{title}</h3>
                <p className="mt-1.5 text-sm text-muted-foreground">{body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="bg-muted/50">
          <div className="mx-auto max-w-6xl px-4 py-20">
            <div className="max-w-2xl">
              <h2 className="text-3xl font-bold tracking-tight">Work arrives from everywhere.</h2>
              <p className="mt-3 text-muted-foreground">
                Connect the places work starts, and it shows up in the right backlog without anyone retyping it.
              </p>
            </div>
            <div className="mt-10 grid gap-4 md:grid-cols-3">
              {INTEGRATIONS.map(({ icon: Icon, title, body }) => (
                <div key={title} className="flex gap-4 rounded-xl border bg-card p-5">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <div>
                    <h3 className="font-semibold">{title}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">{body}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="pricing" className="mx-auto max-w-6xl scroll-mt-16 px-4 py-20">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight">Free means free.</h2>
            <p className="mt-3 text-muted-foreground">
              The free plan is the whole product, not a trial. Pay only when your team needs more room.
            </p>
          </div>
          <div className="mx-auto mt-10 grid max-w-3xl gap-4 md:grid-cols-2">
            {PLANS.map((plan) => (
              <div
                key={plan.name}
                className={`flex flex-col rounded-xl border bg-card p-6 ${plan.featured ? "border-primary ring-1 ring-primary" : ""}`}
              >
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{plan.tagline}</p>
                <h3 className="mt-1 text-2xl font-bold">{plan.name}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{plan.body}</p>
                <ul className="mt-5 flex-1 space-y-2 text-sm">
                  {plan.points.map((p) => (
                    <li key={p} className="flex items-start gap-2">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                      {p}
                    </li>
                  ))}
                </ul>
                {"to" in plan.cta ? (
                  <Link
                    to={plan.cta.to}
                    className={`mt-6 rounded-md px-4 py-2 text-center font-medium ${plan.featured ? "bg-primary text-primary-foreground hover:bg-primary/90" : "border hover:bg-muted"}`}
                  >
                    {plan.cta.label}
                  </Link>
                ) : (
                  <a href={plan.cta.href} className="mt-6 rounded-md border px-4 py-2 text-center font-medium hover:bg-muted">
                    {plan.cta.label}
                  </a>
                )}
              </div>
            ))}
          </div>
        </section>

        <section className="px-4 pb-20">
          <div className="mx-auto max-w-6xl rounded-2xl bg-primary px-6 py-12 text-center text-primary-foreground sm:px-12">
            <h2 className="text-3xl font-bold tracking-tight">Plant your first backlog tree</h2>
            <p className="mx-auto mt-3 max-w-xl text-primary-foreground/85">
              Sign up with Google or an email address and you are in your own organization in under a minute.
            </p>
            <Link
              to="/auth/sign-up"
              className="mt-7 inline-flex items-center gap-2 rounded-md bg-background px-5 py-2.5 font-medium text-foreground hover:bg-background/90"
            >
              Get started <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <Logo />
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            <Link to="/user-guide" className="hover:text-foreground">
              User guide
            </Link>
            <a href="mailto:jvahanii@gmail.com" className="hover:text-foreground">
              sales@agilefant.org
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
