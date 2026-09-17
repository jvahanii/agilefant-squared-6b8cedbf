import { useEffect, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { BookOpen } from "lucide-react";

/**
 * A public guide to job ad import, readable without an account.
 *
 * Written against the code as it stands, not as it was planned: every label
 * quoted here is one the app actually shows. When a behaviour described below
 * changes, this page is part of the change.
 */

const SECTIONS = [
  { id: "what-it-does", title: "What it does" },
  { id: "job-boards", title: "Supported job boards" },
  { id: "google-oauth", title: "Your organization's Google OAuth client" },
  { id: "getting-started", title: "Getting started" },
  { id: "importing", title: "Importing postings" },
  { id: "deadlines", title: "Application deadlines" },
  { id: "scheduling", title: "Scheduled imports" },
  { id: "closed-ads", title: "Checking for closed ads" },
  { id: "troubleshooting", title: "Troubleshooting" },
] as const;

const BOARDS: { name: string; searched: string; note?: string }[] = [
  { name: "LinkedIn", searched: "Yes", note: "Job alert and saved-job emails." },
  { name: "Duunitori", searched: "Yes", note: "Duunivahti alerts." },
  { name: "Jobly", searched: "Yes" },
  { name: "The Hub", searched: "Yes" },
  { name: "Työmarkkinatori", searched: "Yes" },
  {
    name: "SuccessFactors career sites",
    searched: "Yes",
    note: "Employers whose alerts come from jobs2web, such as Nordea, Wärtsilä and Outokumpu.",
  },
  {
    name: "Teamtailor",
    searched: "Yes",
    note: "“New jobs matching your profile” emails from any employer on Teamtailor, such as NestAI, Verda and Sofigate — including postings on the employer's own career site.",
  },
];

export default function JobAdsGuide() {
  useEffect(() => {
    document.title = "Job ad import guide – Agilefant²";
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b px-4 py-4 sm:px-6">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-primary" aria-hidden="true" />
            <span className="text-base font-semibold">
              Agilefant<sup className="text-primary">2</sup> — Job ad import guide
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
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Job ad import</h1>
        <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
          Job ad import turns the job alert emails in your Gmail into backlog items — one item per job posting —
          so a job search can be tracked like any other work: prioritised, moved between lists, and cleared away
          when an ad closes.
        </p>

        <nav aria-label="On this page" className="mt-8 rounded-lg border p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">On this page</p>
          <ol className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className="text-primary underline-offset-2 hover:underline">
                  {s.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <Section id="what-it-does" title="What it does">
          <P>For every job posting it finds in a matching email, job ad import creates one work item:</P>
          <Ul>
            <li>
              <strong>Named after the employer and the role</strong> — for example <Code>Fennia — Product owner</Code>.
            </li>
            <li>
              <strong>Prefixed with the closing date</strong> when one can be found, as month and day:{" "}
              <Code>0930 Fennia — Product owner</Code> closes on 30 September. Sorting a backlog by name then puts the
              soonest deadlines first.
            </li>
            <li>
              <strong>With the posting attached as a hyperlink</strong>, and a description recording when applications
              close, which email it came from, the sender and when it arrived.
            </li>
          </Ul>
          <P>
            Job alert emails carry a lot besides the postings. Site navigation, editorial articles and the
            &ldquo;jobs you have already seen&rdquo; section of a digest are left out. When the same posting arrives
            in several alerts — LinkedIn can send one role several times a day — a single import creates it once.
          </P>
        </Section>

        <Section id="job-boards" title="Supported job boards">
          <P>
            Postings are recognised in emails from these job boards. &ldquo;Searched by default&rdquo; means the
            search a new saved search starts with already looks for them.
          </P>
          <div className="mt-4 overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[32rem] text-left text-sm">
              <thead className="border-b bg-muted/40">
                <tr>
                  <th scope="col" className="px-4 py-2 font-medium">Job board</th>
                  <th scope="col" className="px-4 py-2 font-medium">Searched by default</th>
                  <th scope="col" className="px-4 py-2 font-medium">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {BOARDS.map((b) => (
                  <tr key={b.name}>
                    <td className="px-4 py-2 font-medium">{b.name}</td>
                    <td className="px-4 py-2">{b.searched}</td>
                    <td className="px-4 py-2 text-muted-foreground">{b.note ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <P>
            The search only looks for these job boards unless you change it. If you widen it to other senders, their
            emails are not recognised as job alerts, and every link in them is offered as if it were a posting.
          </P>
        </Section>

        <Section id="google-oauth" title="Your organization's Google OAuth client">
          <P>
            Gmail is connected through your organization&apos;s own Google OAuth client, so your mail is read under an
            app your organization controls. Until an owner or admin adds one, nobody in the organization can connect
            Gmail. If <Em>Job ad import</Em> shows no <Em>Google OAuth client</Em> section, your organization is
            already set up and you can skip this.
          </P>
          <P>An owner or admin creates the client once, in Google Cloud Console:</P>
          <Ol>
            <li>Create a project, or choose an existing one.</li>
            <li>
              Enable the <Em>Gmail API</Em> for the project.
            </li>
            <li>
              Configure the OAuth consent screen: an app name, a support email, and who may use it (see the notes
              below). Add these scopes: <Code>gmail.readonly</Code>, <Code>userinfo.email</Code> and{" "}
              <Code>userinfo.profile</Code>.
            </li>
            <li>
              Create an OAuth client ID of type <Em>Web application</Em>. Under <Em>Authorized redirect URIs</Em>, add
              the address shown in Agilefant under <Em>Authorized redirect URI</Em> — normally{" "}
              <Code>https://agilefant.org/gmail-callback.html</Code>. It must match exactly.
            </li>
            <li>
              Copy the <Em>Client ID</Em> and <Em>Client secret</Em> into the <Em>Google OAuth client</Em> section of{" "}
              <Em>Job ad import</Em>, and choose <Em>Save client</Em>.
            </li>
          </Ol>
          <P>
            The secret is encrypted when it is saved and is never shown again. Replacing the secret for the same
            client keeps everyone&apos;s Gmail connections; switching to a different client ID, or removing the
            client, disconnects everyone, who then connect again.
          </P>
          <Callout tone="warning">
            <strong>Who can connect depends on how the Google app is set up.</strong> Read-only Gmail access is a
            restricted permission, and Google limits apps that use it:
            <Ul>
              <li>
                <strong>Internal</strong> — available if your organization uses Google Workspace. Anyone in your
                Workspace domain can connect, with no approval from Google needed.
              </li>
              <li>
                <strong>External, in testing</strong> — only people you add as test users can connect, up to 100.
                Their connections expire after seven days, after which they connect again; scheduled imports stop
                until they do.
              </li>
              <li>
                <strong>External, published</strong> — anyone with a Google account can connect, but Google must
                verify the app first, including a security assessment.
              </li>
            </Ul>
          </Callout>
        </Section>

        <Section id="getting-started" title="Getting started">
          <Ol>
            <li>
              Sign in and open <Em>Bells &amp; Whistles</Em> from the button next to the organization name at the top
              of the app — or, on a small screen, choose the organization name and then <Em>Org Settings</Em>. Scroll
              to <Em>Job ad import</Em>.
            </li>
            <li>
              If there is a <Em>Google OAuth client</Em> section with no client in it, an owner or admin needs to{" "}
              <a href="#google-oauth" className="text-primary underline-offset-2 hover:underline">
                add your organization&apos;s client
              </a>{" "}
              first.
            </li>
            <li>
              Under <Em>Your Gmail account</Em>, choose <Em>Connect Gmail</Em> and sign in to Google in the window that
              opens. The connection is to your own Gmail account, for this organization, and is used only for the
              searches you save. You can choose <Em>Disconnect</Em> at any time.
            </li>
            <li>
              Under <Em>Add a saved search</Em>, fill in:
              <Ul>
                <li>
                  <Em>Name (optional)</Em> — something to recognise the search by.
                </li>
                <li>
                  <Em>Gmail search query for job alerts</Em> — this starts out searching every supported job board. It
                  is an ordinary Gmail search, so you can narrow it, for example to a label.
                </li>
                <li>
                  <Em>How far back to look</Em> — from the last 12 hours to the last year. Last 30 days is the default.
                </li>
                <li>
                  <Em>Only unread</Em> — to skip emails you have already opened.
                </li>
                <li>
                  <Em>Backlog tree</Em> and <Em>Backlog</Em> — where the imported postings go.
                </li>
              </Ul>
            </li>
            <li>
              Choose <Em>Save search</Em>.
            </li>
          </Ol>
        </Section>

        <Section id="importing" title="Importing postings">
          <P>
            Choose <Em>Run now</Em> on a saved search. This does not import anything yet: it searches your Gmail and
            opens a picker listing the postings it found, so you choose what becomes work. Running a search this way
            never changes its schedule.
          </P>
          <P>In the picker:</P>
          <Ul>
            <li>
              Postings are grouped under the email they came from, with its subject, sender and date.{" "}
              <Em>Open in Gmail</Em> opens that email.
            </li>
            <li>
              <Em>Filter by keyword…</Em> narrows the list, for example to a job title or an employer.
            </li>
            <li>Tick the postings to import, individually or a whole email at a time.</li>
          </Ul>
          <P>Some postings start out unticked, so the ones worth a new item are already selected:</P>
          <Dl
            items={[
              [
                "already in …",
                "The posting is already an item somewhere in the same backlog tree — not only in the backlog you are importing into — and the label says which backlog it is in.",
              ],
              [
                "no longer accepting applications",
                "The posting says it has closed. There is little point tracking it as work.",
              ],
            ]}
          />
          <P>
            Both can still be ticked and imported if you want them. Each posting also shows what is known about its
            deadline: <Code>closes</Code> with a date, <Code>open until further notice</Code>, or{" "}
            <Code>deadline unknown</Code>.
          </P>
          <P>
            Choose <Em>Import selected</Em> to create the items.
          </P>
        </Section>

        <Section id="deadlines" title="Application deadlines">
          <P>
            A deadline is read from the alert email where the job board states one, and otherwise from the posting
            itself, which is opened to look. Deadlines are recognised in Finnish, Swedish and English, written in the
            ways postings actually write them, for example:
          </P>
          <ul className="mt-3 space-y-1.5 text-sm">
            {[
              "haku päättyy 20.9.",
              "Hae viimeistään keskiviikkona 30.9.2026",
              "jätä hakemuksesi 30.9.2026 klo 16 mennessä",
              "Julkaistu 15.9. (Päättyy 4.10. klo 00:00)",
              "Ansök senast 4.10.2026",
              "Submit your application … no later than Sunday, 4 October 2026",
              "Application deadline is September 30th",
            ].map((example) => (
              <li key={example}>
                <Code>{example}</Code>
              </li>
            ))}
          </ul>
          <P>
            When a date is written without a year, the next occurrence of it is assumed. When no deadline can be
            found, the item is created without a date prefix rather than with a guess — a wrong date in an item name
            is worse than none.
          </P>
          <P>
            Jobly refuses to show its postings to Agilefant's servers, so their deadlines cannot be read there.
            Superusers can install the <Em>Agilefant posting reader</Em> browser extension, which reads Jobly postings
            through your own browser instead: the picker then fills in their deadlines while you look at it.
            <Em> Fill deadlines</Em>, in the header of a backlog, does the same for items already imported — it reads
            the postings of job ads whose name has no date yet and puts the deadline in front of the name. One Ctrl+Z
            undoes the whole run.
          </P>
        </Section>

        <Section id="scheduling" title="Scheduled imports">
          <P>
            Turn on <Em>Run on a schedule</Em> to import automatically, and choose <Em>Hourly</Em> or <Em>Daily</Em>.
            A daily search can be given a time of day: runs happen seven minutes past the chosen hour, in the time
            zone you chose it in, and keep that local time when the clocks change. Leave it at <Em>Any time</Em> and it
            runs once a day at whatever hour it last ran.
          </P>
          <P>The saved search shows when it last ran and how many items that run created.</P>
          <Callout tone="warning">
            <strong>A scheduled run imports every posting it finds.</strong> There is no picker, and postings already
            in your backlog are imported again. Give a scheduled search a short look-back that matches how often it
            runs — for a daily search, <Em>Last 24 hours</Em> with <Em>Only unread</Em> — so each run brings in only
            what is new.
          </Callout>
        </Section>

        <Section id="closed-ads" title="Checking for closed ads">
          <P>
            Job boards often leave a posting up after it has stopped taking applications, so an item can look live
            long after its chance has passed. <Em>Check for closed ads</Em>, in the header of a backlog, checks every
            item in that backlog and the backlogs beneath it that has a link.
          </P>
          <Callout>This check is currently available to superusers only.</Callout>
          <P>An item is marked as closed when:</P>
          <Ul>
            <li>the closing date in its name has already passed — this needs no checking online at all;</li>
            <li>
              the posting says so, for example &ldquo;No longer accepting applications&rdquo;, &ldquo;Hakuaika on
              päättynyt&rdquo; or &ldquo;Job is not open for applying&rdquo;;
            </li>
            <li>the deadline the posting states has passed; or</li>
            <li>the posting has been removed from the job board.</li>
          </Ul>
          <P>
            Closed items get a red <Code>Closed</Code> label and the button shows the count. When it finishes, a
            summary says how many ads are closed, how many are still open, and how many could not be reached.
          </P>
          <P>
            Job boards sometimes refuse automated checks, LinkedIn especially. A posting that could not be reached is
            marked <Code>?</Code> — not counted as open, because nothing was learnt about it. Pressing the button again
            later often gets through: postings already found closed are remembered and not checked again, so each
            check asks the job boards less.
          </P>
          <P>
            The check changes nothing. Items are not renamed, moved or deleted — what to do about a closed ad is up to
            you. The marks disappear when you reload the page or open another backlog.
          </P>
        </Section>

        <Section id="troubleshooting" title="Troubleshooting">
          <Dl
            items={[
              [
                "Popup blocked",
                "Connecting Gmail opens a Google sign-in window. Allow popups for this site and choose Connect Gmail again.",
              ],
              [
                "Connect Gmail first",
                "The search needs a connected Gmail account. Connect one under Your Gmail account.",
              ],
              [
                "Waiting for a Google OAuth client",
                "Your organization has no Google OAuth client yet. An owner or admin needs to add one — see Your organization's Google OAuth client.",
              ],
              [
                "Google refused the redirect address",
                "The OAuth client in Google Cloud does not list the authorized redirect URI shown in Agilefant. Add it exactly as shown.",
              ],
              [
                "Gmail keeps disconnecting every week",
                "The Google app is External and still in testing, where connections expire after seven days. Publish the app, or use an Internal app if your organization is on Google Workspace.",
              ],
              [
                "No links found for that query",
                "Nothing matched. Check the search in Gmail itself, or widen How far back to look.",
              ],
              [
                "A posting has no deadline",
                "Neither the email nor the posting stated one in a form that could be recognised, or the job board would not let the posting be opened. For Jobly, install the posting reader extension (superusers) and use Fill deadlines.",
              ],
              [
                "The same posting was imported twice",
                "A scheduled search imports everything it finds. Shorten its look-back and turn on Only unread — see Scheduled imports.",
              ],
            ]}
          />
        </Section>

        <footer className="mt-16 border-t pt-6 text-sm text-muted-foreground">
          <Link to="/user-guide" className="text-primary underline-offset-2 hover:underline">
            Read the full Agilefant² user guide →
          </Link>
        </footer>
      </main>
    </div>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="mt-12 scroll-mt-6" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="text-2xl font-semibold tracking-tight">
        {title}
      </h2>
      {children}
    </section>
  );
}

function P({ children }: { children: ReactNode }) {
  return <p className="mt-3 leading-relaxed">{children}</p>;
}

function Ul({ children }: { children: ReactNode }) {
  return <ul className="mt-3 list-disc space-y-2 pl-6 leading-relaxed marker:text-muted-foreground">{children}</ul>;
}

function Ol({ children }: { children: ReactNode }) {
  return <ol className="mt-3 list-decimal space-y-3 pl-6 leading-relaxed marker:text-muted-foreground">{children}</ol>;
}

/** A label the app shows, set apart from the prose around it. */
function Em({ children }: { children: ReactNode }) {
  return <span className="font-medium">{children}</span>;
}

function Code({ children }: { children: ReactNode }) {
  return <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em]">{children}</code>;
}

function Dl({ items }: { items: [string, string][] }) {
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

function Callout({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "warning" }) {
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
