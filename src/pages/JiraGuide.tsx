import { PublicGuide, Section, SubHeading, P, Ul, Em, Code, Dl, Callout } from "@/components/PublicGuide";

/**
 * A public guide to the Jira integration, readable without an account.
 *
 * Written against the code as it stands, not as it was planned: every label
 * quoted here is one the app actually shows. When a behaviour described below
 * changes — in supabase/functions/_shared/jiraEngine.ts, the jira-sync
 * function or the Jira card — this page is part of the change.
 */

const SECTIONS = [
  { id: "what-it-does", title: "What it does" },
  { id: "before-you-start", title: "Before you start" },
  { id: "connecting", title: "Connecting Jira spaces" },
  { id: "list-to-jira", title: "Moving a list to Jira" },
  { id: "what-syncs", title: "What is kept in step" },
  { id: "hierarchy", title: "Hierarchy and issue types" },
  { id: "tag", title: "The Jira tag on an item" },
  { id: "moving", title: "Moving items and lists" },
  { id: "stopping", title: "Stopping one item's sync" },
  { id: "deleting", title: "Deleting" },
  { id: "timing", title: "When changes travel" },
  { id: "sharing", title: "Shared lists" },
  { id: "troubleshooting", title: "Troubleshooting" },
] as const;

const STATUSES: [string, string][] = [
  ["Not Started", "To Do"],
  ["In Progress", "In Progress"],
  ["Blocked", "In Progress"],
  ["Pending", "In Review"],
  ["Done", "Done"],
  ["No Go", "Done"],
];

export default function JiraGuide() {
  return (
    <PublicGuide
      documentTitle="Jira integration guide – Agilefant²"
      name="Jira integration guide"
      heading="Jira integration"
      intro={
        <>
          Keep Agilefant lists and Jira Cloud spaces in step, both ways: each synced list is one Jira space, each
          item in it one Jira issue, and a change made on either side reaches the other within seconds.
        </>
      }
      sections={SECTIONS}
    >
      <Section id="what-it-does" title="What it does">
        <P>
          An organization can keep several Jira spaces in step, each with a list of its own. For every item in a
          synced list there is one issue in the space, and the two are kept the same:
        </P>
        <Ul>
          <li>
            <strong>Both ways.</strong> An item added, edited, moved or deleted in Agilefant changes its issue in
            Jira, and an issue added, edited, moved or deleted in Jira changes its item in Agilefant.
          </li>
          <li>
            <strong>Field by field.</strong> Changes to different fields on the two sides are combined, not
            overwritten.
          </li>
          <li>
            <strong>With the hierarchy.</strong> Agilefant's nesting of items becomes Jira's hierarchy of issue
            types — epics, tasks, subtasks, and any levels your Jira adds above the epic.
          </li>
        </Ul>
        <P>Each synced item shows its Jira key and issue type after its name, wherever it is in Agilefant.</P>
      </Section>

      <Section id="before-you-start" title="Before you start">
        <Ul>
          <li>
            <strong>A Jira Cloud site</strong>, such as <Code>https://yoursite.atlassian.net</Code>.
          </li>
          <li>
            <strong>An Atlassian API token</strong> for the account the sync will act as. It is not entered in
            Agilefant: the person managing your Agilefant installation's Supabase project saves it under Edge
            Functions → Secrets as <Code>JIRA_API_TOKEN</Code>.
          </li>
          <li>
            <strong>Permissions for that account</strong> in each space: browse, create and edit work items, and{" "}
            <Em>Delete work items</Em> so that deletions in Agilefant reach Jira. Creating a new space for a list, and
            renaming a space when its list is renamed, also need the global <Em>Administer Jira</Em> permission.
          </li>
          <li>
            <strong>An owner or admin</strong> of your Agilefant organization to connect the spaces.
          </li>
        </Ul>
        <Callout>
          A team-managed space has Jira's three levels: epic, task and subtask. For levels above the epic — a theme
          or an initiative — use a company-managed space and add the levels in Jira's settings; the sync reads them
          from the space.
        </Callout>
      </Section>

      <Section id="connecting" title="Connecting Jira spaces">
        <P>
          Open <Em>Settings → Bells &amp; Whistles</Em> and find the <Em>Jira</Em> card.
        </P>
        <Ul>
          <li>
            Enter the <Em>Jira address</Em> and the <Em>Atlassian account email</Em> of the API token's owner.
          </li>
          <li>
            Choose <Em>Choose spaces</Em> (<Em>Choose more spaces</Em> once one is connected). The spaces on the site
            are listed; pick a tree for a space and choose its <Em>Sync now</Em>.
          </li>
          <li>
            The space gets a new list named after it in that tree, and its issues are brought in before the card
            answers. From then on the list and the space are kept in step.
          </li>
        </Ul>
        <P>
          The card lists every synced space with its items paired, changes waiting, last sync and last error.{" "}
          <Em>Disconnect</Em> stops one space's sync and <Em>Disconnect all</Em> every space's. Items and issues stay
          on both sides; they are simply no longer kept in step.
        </P>
        <P>
          A synced list is marked in the sidebar with a blue T-rex.
        </P>
      </Section>

      <Section id="list-to-jira" title="Moving a list to Jira">
        <P>An existing Agilefant list can be given a new Jira space of its own, and its items sent there.</P>
        <Ul>
          <li>
            Right-click the list in the sidebar and choose <Em>Sync with Jira…</Em>, or use{" "}
            <Em>Move a list to Jira</Em> on the Jira card. The organization must already have Jira connected, and
            the list must be its own, not one shared from another organization.
          </li>
          <li>
            Give the <Em>Jira space name</Em> (the list's name, by default) and a <Em>Key</Em> (one is suggested),
            then choose <Em>Create space in Jira</Em>.
          </li>
          <li>
            A company-managed Scrum space is made, and the list's items go to it at once, hierarchy and all.
          </li>
        </Ul>
        <P>
          Making a space needs the <Em>Administer Jira</Em> permission; without it, Jira refuses and the card says so.
        </P>
      </Section>

      <Section id="what-syncs" title="What is kept in step">
        <Ul>
          <li>
            <strong>Name</strong> and Jira's summary. Jira takes one line of at most 255 characters.
          </li>
          <li>
            <strong>Description</strong>, as plain text: Jira's rich formatting is not kept.
          </li>
          <li>
            <strong>Status</strong> — see the table below.
          </li>
          <li>
            <strong>Points</strong>, where the space has a <Em>Story point estimate</Em> or <Em>Story points</Em>{" "}
            field.
          </li>
          <li>
            <strong>Parent</strong> and issue type — see <a href="#hierarchy" className="text-primary underline-offset-2 hover:underline">Hierarchy and issue types</a>.
          </li>
          <li>
            <strong>Web links.</strong> An item's hyperlinks and the issue's web links are kept the same. Links that
            Jira's own apps add, such as Confluence pages, are left alone.
          </li>
          <li>
            <strong>Links between issues</strong> — "blocks", "relates to" and the like — come into Agilefant as
            hyperlinks to the other issue, named by the link and the other issue's key: <Code>blocks INT-12</Code>,
            or <Code>is blocked by INT-5</Code> from the other end. They come from Jira one way: they are not sent
            back as web links, and one edited or removed in Agilefant is put back the next time the issue changes.
          </li>
        </Ul>

        <SubHeading>Statuses</SubHeading>
        <div className="mt-3 overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="px-4 py-2 font-medium">Agilefant</th>
                <th className="px-4 py-2 font-medium">Jira</th>
              </tr>
            </thead>
            <tbody>
              {STATUSES.map(([agilefant, jira]) => (
                <tr key={agilefant} className="border-t">
                  <td className="px-4 py-2">{agilefant}</td>
                  <td className="px-4 py-2">{jira}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <P>
          Agilefant's finer statuses survive the round trip: a blocked item stays blocked when Jira says In
          Progress. A Jira status that Agilefant does not have is added to the list's statuses. A status of the
          list's own that Jira does not have is added to the space where Jira allows it; where it does not, the
          issue goes to In Progress and the item keeps its status.
        </P>
      </Section>

      <Section id="hierarchy" title="Hierarchy and issue types">
        <P>
          Agilefant items have no types; Jira issues do, and the type decides what an issue may be under. The sync
          gives each issue the type its place in Agilefant's hierarchy calls for, using the levels the space has:
        </P>
        <Ul>
          <li>A new item at the top of the list is an epic, an item under it a task (or story), and an item under that a subtask.</li>
          <li>
            Where the space has levels above the epic, such as a theme or an initiative, a tree that grows deeper
            than three levels is raised into them.
          </li>
          <li>
            Moving an item in Agilefant changes its type in Jira to suit: an epic moved under another epic becomes a
            story, and the items under it its subtasks; a subtask moved to the top becomes a task.
          </li>
          <li>
            Moving an item under a subtask raises the tree above it a level where the space has a level to spare,
            so the moved item can be the subtask.
          </li>
        </Ul>
        <SubHeading>Deeper than Jira goes</SubHeading>
        <P>
          Agilefant nests as deep as you like; Jira has as many levels as the space has. An item deeper than that is
          put in Jira one level flatter — a subtask beside its parent — and keeps its place in Agilefant. Its tag
          carries a red warning triangle saying so.
        </P>
        <P>
          When the space's levels change in Jira's settings, the sync notices within the hour and puts every
          synced tree to the new levels.
        </P>
      </Section>

      <Section id="tag" title="The Jira tag on an item">
        <P>
          After a synced item's name: its key and type, such as <Code>INT-8 · Subtask</Code>, opening the issue in
          Jira.
        </P>
        <Dl
          items={[
            ["Faded and slanted", "The type a move will give the issue, shown at once, before Jira has it. It turns plain when Jira has made the change, a few seconds later."],
            ["AF-… · Task", "A new item, with the type it will be created as, before the sync has created its issue."],
            ["Red with a warning sign", "The sync could not send the item's last change to Jira — Jira refused it. Hover the tag for Jira's words. It clears when the next sync of the item goes through."],
            ["Red triangle", "The item is deeper than the space's levels and is one level flatter in Jira."],
            ["Struck through", "The item's sync is stopped — see Stopping one item's sync."],
          ]}
        />
        <P>
          The tag shows wherever the item is: in any list it is moved or mirrored to, on boards and on the timeline.
        </P>
      </Section>

      <Section id="moving" title="Moving items and lists">
        <SubHeading>Items</SubHeading>
        <Ul>
          <li>
            <strong>An item moved out of a synced list</strong> keeps its issue and keeps syncing, both ways, from
            wherever it is now.
          </li>
          <li>
            <strong>A mirrored item</strong> is the same item in both trees, and the same issue.
          </li>
          <li>
            <strong>An item put under a synced item</strong> is synced too, whichever list it is in: it is made in
            Jira under its parent, with the items under it.
          </li>
          <li>
            <strong>An item put in a synced list</strong> is made in Jira, under its parent if it has one.
          </li>
        </Ul>
        <SubHeading>Lists</SubHeading>
        <Ul>
          <li>
            <strong>Moved to another tree, or under another list</strong>, a synced list stays synced with its
            space, and so do its items.
          </li>
          <li>
            <strong>Renamed</strong>, a synced list renames its Jira space to match, made unique on the site where
            another space has the name. This needs the <Em>Administer Jira</Em> permission; without it, the space keeps
            its name and the card shows why.
          </li>
          <li>
            <strong>Deleted with its tree</strong>, a synced list's space is no longer synced. Its issues stay in
            Jira.
          </li>
        </Ul>
      </Section>

      <Section id="stopping" title="Stopping one item's sync">
        <P>
          Right-click a synced item and choose <Em>Stop syncing with Jira</Em>. The item and its issue stay, and stay
          paired, but nothing travels between them: changes on either side stay where they were made, and deleting
          one leaves the other. Its tag stays, struck through.
        </P>
        <P>
          <Em>Resume syncing with Jira</Em>, in the same menu, brings the two in step again, field by field, from
          where they last agreed. If the issue was deleted meanwhile, the item gets a new one.
        </P>
        <P>
          The option is offered to members of the organization whose Jira the item is synced with.
        </P>
      </Section>

      <Section id="deleting" title="Deleting">
        <Ul>
          <li>
            <strong>Deleting a synced item in Agilefant</strong> deletes its issue in Jira, and the issues of the
            items under it. Jira's deletion is permanent: an item restored in Agilefant gets a new issue, without the
            old one's comments or history.
          </li>
          <li>
            <strong>Where Jira refuses</strong> — the account lacks <Em>Delete work items</Em> — the issue stays, the
            item's pairing is kept with Jira's reason as its error, and the deletion is tried again on the next sync.
          </li>
          <li>
            <strong>Deleting an issue in Jira</strong> deletes its item in Agilefant. The items under it are kept,
            moved to the top of the list, as Jira keeps an epic's stories.
          </li>
        </Ul>
      </Section>

      <Section id="timing" title="When changes travel">
        <Ul>
          <li>
            <strong>Agilefant's changes</strong> reach Jira within seconds.
          </li>
          <li>
            <strong>Jira's changes</strong> reach Agilefant within seconds through the space's webhook. If the Jira
            card says the webhook is not registered, Jira's changes come in only on Sync now.
          </li>
          <li>
            <strong>Web links added or removed in Jira</strong> are not announced by Jira on their own. They come in
            with the issue's next change, or on Sync now.
          </li>
          <li>
            <strong>Sync now</strong>, on the Jira card or the <Em>Sync Jira</Em> button in the header, goes through
            every space both ways and reports what changed.
          </li>
        </Ul>
        <P>
          A field changed on both sides at once goes to the later change. In Sync now, where Agilefant's time of a
          change is not known, Jira's is taken.
        </P>
        <Callout>
          Jira's page does not always show a change the moment it is made. If an issue in an open Jira tab looks out
          of date, reload the page.
        </Callout>
      </Section>

      <Section id="sharing" title="Shared lists">
        <P>
          A synced list can be shared with another organization like any other. The partner sees the items' Jira
          tags, and their changes — edits, new items, deletions — go to the owning organization's Jira space. The key
          shows as plain text where the Jira address is not visible to the partner. Moving a list to a Jira space, and
          stopping an item's sync, are for the owning organization.
        </P>
      </Section>

      <Section id="troubleshooting" title="Troubleshooting">
        <Dl
          items={[
            ["The Jira API token is not set yet", "The JIRA_API_TOKEN secret is missing. Create a token at id.atlassian.com → Security → API tokens and add it in Supabase under Edge Functions → Secrets; it is never entered in Agilefant."],
            ["Jira did not allow making a space", "The sync's Jira account needs the Administer Jira permission to create a space for a list, and to rename one."],
            ["An item's tag is red", "Jira refused the item's last change. Hover the tag for the reason — often a field the space's screen does not have, or a missing permission. The tag clears when the next sync of the item goes through."],
            ["A deleted item's issue is still in Jira", "The sync's account lacks Delete work items in that space. Grant it; the deletion is tried again on the next sync."],
            ["Jira's changes arrive only on Sync now", "The space's webhook is not registered — the card says so under the space. Until it is, Sync now brings Jira's changes in."],
            ["Levels added in Jira don't show", "Only company-managed spaces can have levels above the epic. Add them in Jira's settings; the sync picks them up within the hour."],
            ["An item has a red triangle", "It is deeper than the space's levels and sits one level flatter in Jira. Agilefant keeps its place."],
          ]}
        />
      </Section>
    </PublicGuide>
  );
}
