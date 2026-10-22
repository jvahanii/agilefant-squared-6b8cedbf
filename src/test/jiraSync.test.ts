/**
 * Agilefant ↔ Jira, both ways (workshop, 2026-10-22).
 *
 * One Agilefant list and one Jira project kept in step: name, description,
 * status, points and hierarchy. The rules are pinned first; then the engine,
 * run against an in-memory Jira and an in-memory Agilefant, through the three
 * ways a sync starts — an item changed, an issue changed, "Sync now".
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  adfToText,
  agilefantStatusFor,
  jiraStatusFor,
  jiraTypeForNewItem,
  normalizeText,
  reconcile,
  textToAdf,
  toSummary,
  type SyncState,
  type SyncedField,
} from "../../supabase/functions/_shared/jiraMapping";
import {
  JiraSync,
  type AgilefantItem,
  type AgilefantPort,
  type ItemFields,
  type JiraIssue,
  type JiraPort,
  type Link,
} from "../../supabase/functions/_shared/jiraEngine";

// ─── The rules ───────────────────────────────────────────────────────────────

describe("a description between Jira's format and plain text", () => {
  it("reads Jira's paragraphs, line breaks, lists and headings as text", () => {
    const adf = {
      type: "doc",
      version: 1,
      content: [
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Goal" }] },
        { type: "paragraph", content: [{ type: "text", text: "Sync " }, { type: "text", text: "both", marks: [{ type: "strong" }] }, { type: "text", text: " ways." }] },
        { type: "paragraph", content: [{ type: "text", text: "Line one" }, { type: "hardBreak" }, { type: "text", text: "line two" }] },
        {
          type: "bulletList",
          content: [
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "titles" }] }] },
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "statuses" }] }] },
          ],
        },
      ],
    };
    expect(adfToText(adf)).toBe("Goal\n\nSync both ways.\n\nLine one\nline two\n\n- titles\n- statuses");
  });

  it("goes there and back without changing — or every save would look like a new edit", () => {
    for (const text of [
      "Just one line",
      "First paragraph.\n\nSecond, with\na line break.",
      "Intro\n\n- one\n- two\n\nOutro",
      "",
    ]) {
      expect(adfToText(textToAdf(text))).toBe(normalizeText(text));
    }
    expect(textToAdf("   ")).toBeNull();
    expect(adfToText(null)).toBe("");
  });

  it("is compared the same whatever the line endings and trailing space", () => {
    expect(normalizeText("a  \r\nb\r\n\r\n\r\n\r\nc  ")).toBe("a\nb\n\nc");
  });

  it("keeps a Jira summary to one line of at most 255 characters", () => {
    expect(toSummary("  Two\nlines  ")).toBe("Two lines");
    expect(toSummary("x".repeat(300))).toHaveLength(255);
    expect(toSummary("   ")).toBe("(untitled)");
  });
});

describe("statuses", () => {
  it("map Agilefant's onto Jira's four", () => {
    expect(["not_started", "in_progress", "pending", "blocked", "done", "no_go", "something_custom"].map(jiraStatusFor)).toEqual([
      "To Do", "In Progress", "In Review", "In Progress", "Done", "Done", "To Do",
    ]);
  });

  it("map Jira's back, and leave Agilefant's finer ones alone where they mean the same", () => {
    expect(agilefantStatusFor("In Progress", "indeterminate", "not_started")).toBe("in_progress");
    expect(agilefantStatusFor("In Progress", "indeterminate", "blocked")).toBe("blocked");
    expect(agilefantStatusFor("Done", "done", "no_go")).toBe("no_go");
    expect(agilefantStatusFor("In Review", "indeterminate", null)).toBe("pending");
    // A status of a workflow we do not know, by its category.
    expect(agilefantStatusFor("QA", "indeterminate", null)).toBe("in_progress");
    expect(agilefantStatusFor("Shipped", "done", "in_progress")).toBe("done");
  });
});

describe("the issue type of a new item", () => {
  it("follows its parent: none an epic, under an epic a task, under a task a subtask, below that nothing", () => {
    expect([null, "Epic", "Task", "Story", "Subtask"].map(jiraTypeForNewItem)).toEqual(["Epic", "Task", "Subtask", "Subtask", null]);
  });
});

describe("which side wins, field by field", () => {
  const base: SyncState = { title: "A", description: "", status: "To Do", points: 1, parent: null };

  it("takes each field from the side that changed it", () => {
    const r = reconcile(base, { ...base, points: 5 }, { ...base, title: "B" }, null, null);
    expect(r.state).toEqual({ ...base, title: "B", points: 5 });
    expect(r.toJira).toEqual(["points"]);
    expect(r.toAgilefant).toEqual(["title"]);
  });

  it("takes a field changed on both sides from the later change", () => {
    expect(reconcile(base, { ...base, title: "Mine" }, { ...base, title: "Theirs" }, 2_000, 1_000).state.title).toBe("Mine");
    expect(reconcile(base, { ...base, title: "Mine" }, { ...base, title: "Theirs" }, 1_000, 2_000).state.title).toBe("Theirs");
  });

  it("changes nothing when the sides agree", () => {
    const r = reconcile(base, { ...base, title: "Same" }, { ...base, title: "Same" }, null, null);
    expect(r.toJira).toEqual([]);
    expect(r.toAgilefant).toEqual([]);
  });
});

// ─── The engine, against stand-ins ───────────────────────────────────────────

class FakeJira implements JiraPort {
  issues = new Map<string, JiraIssue>();
  calls: string[] = [];
  failUpdates = false;
  private next = 100;
  private clock = 1_000;

  add(key: string, type: string, state: Partial<SyncState> = {}): JiraIssue {
    const id = String(this.next++);
    const issue: JiraIssue = {
      id,
      key,
      type,
      statusCategory: "new",
      updatedAt: this.clock++,
      state: { title: key, description: "", status: "To Do", points: null, parent: null, ...state },
    };
    this.issues.set(id, issue);
    return issue;
  }
  /** A change made by someone in Jira. */
  edit(id: string, change: Partial<SyncState>) {
    const issue = this.issues.get(id)!;
    this.issues.set(id, { ...issue, state: { ...issue.state, ...change }, updatedAt: this.clock++ });
  }
  byTitle(title: string) {
    return [...this.issues.values()].find((i) => i.state.title === title);
  }

  async listIssues() {
    return [...this.issues.values()];
  }
  async getIssue(id: string) {
    return this.issues.get(id) ?? null;
  }
  async createIssue(type: string, state: SyncState) {
    this.calls.push(`create ${type} ${state.title}`);
    const issue = this.add(`INT-${this.next}`, type, state);
    return { id: issue.id, key: issue.key };
  }
  async updateIssue(id: string, fields: SyncedField[], state: SyncState) {
    if (this.failUpdates) throw new Error("Jira answered 400: nope");
    this.calls.push(`update ${this.issues.get(id)!.key} ${fields.join(",")}`);
    const change: Partial<SyncState> = {};
    for (const f of fields) (change as Record<string, unknown>)[f] = state[f];
    this.edit(id, change);
  }
  async deleteIssue(id: string) {
    this.calls.push(`delete ${this.issues.get(id)?.key}`);
    this.issues.delete(id);
  }
}

class FakeAgilefant implements AgilefantPort {
  items = new Map<string, AgilefantItem>();
  linkRows = new Map<string, Link>();
  writes: string[] = [];
  private next = 1;

  add(title: string, fields: Partial<AgilefantItem> = {}): AgilefantItem {
    const item: AgilefantItem = { id: `wi-${this.next++}`, title, description: null, status: "not_started", points: null, parentId: null, inList: true, ...fields };
    this.items.set(item.id, item);
    return item;
  }
  byTitle(title: string) {
    return [...this.items.values()].find((i) => i.title === title);
  }

  async listItems() {
    return [...this.items.values()].filter((i) => i.inList);
  }
  async getItem(id: string) {
    return this.items.get(id) ?? null;
  }
  async createItem(fields: Required<ItemFields>) {
    const item = this.add(fields.title, { description: fields.description, status: fields.status, points: fields.points, parentId: fields.parentId });
    this.writes.push(`create ${item.title}`);
    return item.id;
  }
  async updateItem(id: string, fields: ItemFields) {
    this.writes.push(`update ${this.items.get(id)!.title} ${Object.keys(fields).join(",")}`);
    this.items.set(id, { ...this.items.get(id)!, ...fields });
  }
  async deleteItem(id: string) {
    for (const child of this.items.values()) if (child.parentId === id) child.parentId = null;
    this.writes.push(`delete ${this.items.get(id)?.title}`);
    this.items.delete(id);
  }
  async links() {
    return [...this.linkRows.values()];
  }
  async saveLink(link: Link) {
    this.linkRows.set(link.workItemId, link);
  }
  async dropLink(workItemId: string) {
    this.linkRows.delete(workItemId);
  }
}

let jira: FakeJira;
let af: FakeAgilefant;
/** A fresh engine, as each call to the edge function makes. */
const engine = () => new JiraSync(jira, af);

beforeEach(() => {
  jira = new FakeJira();
  af = new FakeAgilefant();
});

describe("the first sync", () => {
  it("brings each side's items to the other, hierarchy and all", async () => {
    const epic = jira.add("INT-5", "Epic", { title: "Sync epics" });
    jira.add("INT-6", "Story", { title: "Sync work items", parent: epic.id, status: "In Progress", points: 3 });
    const mine = af.add("Agilefant epic");
    af.add("Agilefant task", { parentId: mine.id, status: "done", description: "Line one\n\nLine two" });

    const report = await engine().fullSync();
    expect(report).toMatchObject({ createdInAgilefant: 2, createdInJira: 2, errors: [], skipped: [] });

    // Jira's story under Jira's epic, in Agilefant.
    const story = af.byTitle("Sync work items")!;
    expect(story).toMatchObject({ status: "in_progress", points: 3, parentId: af.byTitle("Sync epics")!.id });
    // Agilefant's task under Agilefant's epic, in Jira, as the right types.
    const epicIssue = jira.byTitle("Agilefant epic")!;
    const taskIssue = jira.byTitle("Agilefant task")!;
    expect(epicIssue.type).toBe("Epic");
    expect(taskIssue).toMatchObject({ type: "Task", state: { parent: epicIssue.id, status: "Done", description: "Line one\n\nLine two" } });
    expect(af.linkRows.size).toBe(4);
  });

  it("changes nothing on a second sync with nothing changed — no echo either way", async () => {
    jira.add("INT-5", "Epic", { title: "Sync epics" });
    af.add("Agilefant epic");
    await engine().fullSync();
    jira.calls = [];
    af.writes = [];

    const report = await engine().fullSync();
    expect(report).toMatchObject({ createdInAgilefant: 0, createdInJira: 0, updatedInAgilefant: 0, updatedInJira: 0 });
    expect(jira.calls).toEqual([]);
    expect(af.writes).toEqual([]);
  });
});

describe("a change in Agilefant", () => {
  beforeEach(async () => {
    af.add("Epic one");
    await engine().fullSync();
    jira.calls = [];
    af.writes = [];
  });

  it("goes to Jira at once, and Jira's webhook about it changes nothing back", async () => {
    const item = af.byTitle("Epic one")!;
    await af.updateItem(item.id, { title: "Epic one, renamed", status: "in_progress", points: 8 });
    af.writes = [];

    await engine().syncItem(item.id);
    expect(jira.calls).toEqual([`update ${af.linkRows.get(item.id)!.jiraKey} title,status,points`]);
    const issue = jira.byTitle("Epic one, renamed")!;
    expect(issue.state).toMatchObject({ status: "In Progress", points: 8 });

    // Jira now tells us about the very change we made.
    await engine().syncIssue(issue.id);
    expect(af.writes).toEqual([]);
  });

  it("deletes the Jira issue when the item is deleted, or leaves the list", async () => {
    const item = af.byTitle("Epic one")!;
    const issueId = af.linkRows.get(item.id)!.jiraId;
    af.items.set(item.id, { ...item, inList: false });

    await engine().syncItem(item.id);
    expect(jira.issues.has(issueId)).toBe(false);
    expect(af.linkRows.has(item.id)).toBe(false);
  });

  it("brings a new item to Jira under its parent, the parent first if it has no issue yet", async () => {
    const parent = af.add("New epic");
    const child = af.add("New task", { parentId: parent.id });
    const grandchild = af.add("New subtask", { parentId: child.id });
    const tooDeep = af.add("Too deep", { parentId: grandchild.id });

    await engine().syncItem(tooDeep.id);
    const epic = jira.byTitle("New epic")!;
    const task = jira.byTitle("New task")!;
    expect(epic.type).toBe("Epic");
    expect(task).toMatchObject({ type: "Task", state: { parent: epic.id } });
    expect(jira.byTitle("New subtask")).toMatchObject({ type: "Subtask", state: { parent: task.id } });
    // Jira has nothing below a subtask.
    expect(jira.byTitle("Too deep")).toBeUndefined();
  });

  it("keeps the change for next time when Jira refuses it, and says so", async () => {
    const item = af.byTitle("Epic one")!;
    await af.updateItem(item.id, { title: "Refused rename" });
    jira.failUpdates = true;
    const sync = engine();
    await sync.syncItem(item.id);
    expect(sync.report.errors[0]).toBe(`${af.linkRows.get(item.id)!.jiraKey}: Jira answered 400: nope`);
    expect(af.linkRows.get(item.id)!.error).toMatch(/400/);

    jira.failUpdates = false;
    await engine().syncItem(item.id);
    expect(jira.byTitle("Refused rename")).toBeDefined();
  });
});

describe("a change in Jira", () => {
  beforeEach(async () => {
    const epic = jira.add("INT-5", "Epic", { title: "Epic" });
    jira.add("INT-6", "Story", { title: "Story", parent: epic.id });
    af.add("Blocked one", { status: "blocked" });
    await engine().fullSync();
    jira.calls = [];
    af.writes = [];
  });

  it("comes into Agilefant, and the item's own change event about it sends nothing back", async () => {
    const story = jira.byTitle("Story")!;
    jira.edit(story.id, { title: "Story, renamed in Jira", status: "Done", description: "Written in Jira" });

    await engine().syncIssue(story.id);
    const item = af.byTitle("Story, renamed in Jira")!;
    expect(item).toMatchObject({ status: "done", description: "Written in Jira" });

    // The database trigger now queues the item Agilefant just changed.
    await engine().syncItem(item.id);
    expect(jira.calls).toEqual([]);
  });

  it("does not flatten Agilefant's finer statuses: blocked stays blocked when Jira says In Progress", async () => {
    const issue = jira.byTitle("Blocked one")!;
    expect(issue.state.status).toBe("In Progress");
    jira.edit(issue.id, { title: "Blocked one, renamed" });
    await engine().syncIssue(issue.id);
    expect(af.byTitle("Blocked one, renamed")!.status).toBe("blocked");
  });

  it("moves the item when its parent changes in Jira", async () => {
    const story = jira.byTitle("Story")!;
    jira.edit(story.id, { parent: null });
    await engine().syncIssue(story.id);
    expect(af.byTitle("Story")!.parentId).toBeNull();
  });

  it("deletes the item when the issue is deleted, keeping its children as Jira does", async () => {
    const epic = jira.byTitle("Epic")!;
    jira.issues.delete(epic.id);
    await engine().syncIssue(epic.id);
    expect(af.byTitle("Epic")).toBeUndefined();
    expect(af.byTitle("Story")!.parentId).toBeNull();
  });

  it("brings a new issue in, with its parent", async () => {
    const epic = jira.byTitle("Epic")!;
    const task = jira.add("INT-20", "Task", { title: "New in Jira", parent: epic.id, points: 2 });
    await engine().syncIssue(task.id);
    expect(af.byTitle("New in Jira")).toMatchObject({ points: 2, parentId: af.byTitle("Epic")!.id });
  });
});

describe("Sync now, after both sides changed", () => {
  it("takes each field from the side that changed it, and Jira's where both did", async () => {
    af.add("Shared");
    await engine().fullSync();
    const item = af.byTitle("Shared")!;
    const issue = jira.byTitle("Shared")!;

    await af.updateItem(item.id, { points: 13, title: "Agilefant's title" });
    jira.edit(issue.id, { status: "In Review", title: "Jira's title" });
    await engine().fullSync();

    expect(af.items.get(item.id)).toMatchObject({ title: "Jira's title", points: 13, status: "pending" });
    expect(jira.issues.get(issue.id)!.state).toMatchObject({ title: "Jira's title", points: 13, status: "In Review" });
  });
});
