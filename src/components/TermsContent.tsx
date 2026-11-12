/**
 * The terms of service, privacy included — shown in Team settings and, to
 * anyone, at /terms. One text in one place, so the two cannot drift apart.
 *
 * The privacy part has to stay true to what the app does. When something
 * here changes — a new outside service, a different retention period — the
 * text changes with it, and "Last updated" too. The retention periods are
 * enforced by apply_retention() (migration 20261112120000) and account
 * deletion by delete_my_account().
 */
import type { ReactNode } from "react";

export const TERMS_LAST_UPDATED = "12 November 2026";
export const PRIVACY_CONTACT = "jvahanii@gmail.com";

/** The outside services that handle personal data for Agilefant², and where. */
export const SERVICES: ReadonlyArray<{ name: string; does: string; where: string; when?: string }> = [
  { name: "Supabase", does: "Database, file storage and server functions: where your data is kept", where: "EU (Stockholm, Sweden)" },
  { name: "Clerk", does: "Sign-in: your name, email address, profile picture and how you sign in", where: "USA" },
  { name: "Cloudflare", does: "Delivers the web app to your browser", where: "Worldwide network" },
  { name: "Stripe", does: "Payments; we never see your card details", where: "USA and EU", when: "if you subscribe" },
  { name: "Google", does: "Gmail import, and signing in with Google", where: "USA", when: "if you use them" },
  { name: "Lovable", does: "Passes the Gmail import's requests to Google", where: "EU (Sweden)", when: "if you use Gmail import" },
  { name: "Atlassian", does: "Jira synchronisation", where: "USA and EU", when: "if your organisation connects Jira" },
  { name: "GitHub", does: "Marks items done when pull requests merge", where: "USA", when: "if your organisation connects GitHub" },
];

/** How long what is kept, as apply_retention() enforces it. */
export const RETENTION: ReadonlyArray<{ what: string; kept: string }> = [
  { what: "Your account", kept: "Until you delete it" },
  { what: "Your organisation's content: items, lists, logged time", kept: "Until the organisation deletes it, or is deleted" },
  { what: "Change history (who changed what)", kept: "90 days" },
  { what: "Deleted items, kept so you can undo", kept: "7 days" },
  { what: "Backups", kept: "14 days; an organisation that no longer changes keeps its newest one" },
  { what: "A deleted organisation's remaining data and backups", kept: "14 days after deletion" },
  { what: "Server logs (IP address, browser)", kept: "About a week" },
];

const link = "text-primary underline underline-offset-2";

function Heading({ children }: { children: ReactNode }) {
  return <h3 className="pt-2 font-semibold text-foreground">{children}</h3>;
}

export function TermsContent() {
  return (
    <div className="space-y-3">
      <p>
        Welcome to <strong>Agilefant²</strong>. By creating an account you agree to these terms of service, which
        include how we handle personal data. Last updated {TERMS_LAST_UPDATED}.
      </p>
      <p>
        We will do our best to provide a reliable and useful service, but we cannot accept responsibility for any loss
        of data, interruption of service, or other damages.
      </p>
      <p>
        <strong>You can export your data</strong> at any time using the <em>Export Data</em> button.
      </p>
      <p>
        Agilefant² is licensed under the <strong>GNU General Public License v3 (GPLv3)</strong>. The source code is
        available on GitHub:{" "}
        <a href="https://github.com/agilefant/agilefant-squared" target="_blank" rel="noopener noreferrer" className={link}>
          github.com/agilefant/agilefant-squared
        </a>
        .
      </p>

      <Heading>Privacy</Heading>
      <p>
        Agilefant² is run by its maintainer, who is responsible for the personal data described here (the
        &ldquo;controller&rdquo; in the EU&rsquo;s General Data Protection Regulation). For anything about your data,
        write to{" "}
        <a href={`mailto:${PRIVACY_CONTACT}`} className={link}>
          {PRIVACY_CONTACT}
        </a>
        .
      </p>

      <Heading>What we keep</Heading>
      <ul className="list-disc space-y-1 pl-5">
        <li>
          <strong>Your account:</strong> your name, email address and profile picture, and which organisations and
          teams you belong to.
        </li>
        <li>
          <strong>What you and your organisation put in:</strong> trees, lists and items, their descriptions, labels
          and links, and the time you log with its notes.
        </li>
        <li>
          <strong>What changed and who changed it</strong>, so your organisation can follow its work, and the history
          of items its charts are drawn from.
        </li>
        <li>
          <strong>What you choose to connect:</strong> links found in the Gmail messages your import searches for,
          issues of a connected Jira, merged pull requests of a connected GitHub repository, and messages forwarded
          from WhatsApp.
        </li>
        <li>
          <strong>Server logs</strong> with your IP address and browser, kept by our hosting providers.
        </li>
        <li>
          <strong>In your browser:</strong> the sign-in cookies Clerk needs, and a copy of your data so the app opens
          quickly. There is no analytics, advertising or tracking.
        </li>
      </ul>

      <Heading>Why, and on what grounds</Heading>
      <p>
        To provide the service you signed up for (GDPR article 6(1)(b), a contract), and to keep it secure and
        working, with logs and backups (article 6(1)(f), legitimate interests). We do not sell your data or use it for
        advertising.
      </p>
      <p>
        What an organisation puts into Agilefant² is the organisation&rsquo;s. For that data we act on its behalf;
        ask your organisation&rsquo;s owner about it first, and we will help them.
      </p>

      <Heading>Who handles it for us</Heading>
      <ul className="list-disc space-y-1 pl-5">
        {SERVICES.map((s) => (
          <li key={s.name}>
            <strong>{s.name}</strong> — {s.does}
            {s.when ? `, ${s.when}` : ""}. {s.where}.
          </li>
        ))}
      </ul>
      <p>
        Where data goes outside the EU, it is protected by the European Commission&rsquo;s standard contractual
        clauses or the EU–US Data Privacy Framework.
      </p>

      <Heading>How long</Heading>
      <ul className="list-disc space-y-1 pl-5">
        {RETENTION.map((r) => (
          <li key={r.what}>
            <strong>{r.what}:</strong> {r.kept}.
          </li>
        ))}
      </ul>

      <Heading>Your rights</Heading>
      <p>
        You can ask for a copy of your data, have it corrected, restrict or object to how it is used, or take it
        elsewhere: write to us, and we answer within a month. You can delete your account yourself, under{" "}
        <em>Delete account</em> in Team settings. That deletes your name, email address and sign-in, and any
        organisation no one else belongs to; in organisations that carry on, the items you made and the time you
        logged stay theirs, no longer tied to your name.
      </p>
      <p>
        If you think we handle your data wrongly, you can complain to the Finnish Data Protection Ombudsman,{" "}
        <a href="https://tietosuoja.fi/en" target="_blank" rel="noopener noreferrer" className={link}>
          tietosuoja.fi
        </a>
        , or to the authority where you live.
      </p>

      <Heading>Changes</Heading>
      <p>
        We may update these terms; the date above says when they last changed. Continued use of the service
        constitutes acceptance of any changes.
      </p>
    </div>
  );
}
