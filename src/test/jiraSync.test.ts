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
  expectedTypes,
  Levels,
  DEFAULT_ISSUE_TYPES,
  type IssueTypeLevel,
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
import { JiraError } from "../../supabase/functions/_shared/jiraApi";

// ─── The rules ───────────────────────────────────────────────────────────────

describe("a description between Jira's format and plain text", () => {
  it("writes Jira's required document version at the top level, not in attrs", () => {
    expect(textToAdf("Kyllä näkyy\nToinen rivi")).toEqual({
      type: "doc",
      version: 1,
      content: [{ type: "paragraph", content: [
        { type: "text", text: "Kyllä näkyy" },
        { type: "hardBreak" },
        { type: "text", text: "Toinen rivi" },
      ] }],
    });
  });

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
    expect([null, "Epic", "Task", "Story", "Subtask"].map((parent) => jiraTypeForNewItem(parent))).toEqual(["Epic", "Task", "Subtask", "Subtask", null]);
  });
});

describe("the levels of Jira's hierarchy", () => {
  it("are Jira's three where nothing is added above the epic", () => {
    const levels = new Levels();
    expect([levels.bottom, levels.top, levels.count]).toEqual([-1, 1, 3]);
    expect(levels.describe()).toBe("Epic, Story/Task/Bug, Subtask");
  });

  it("are read from the project's types, levels above the epic included", () => {
    const levels = new Levels([...DEFAULT_ISSUE_TYPES, { name: "Initiative", level: 2 }, { name: "Theme", level: 3 }]);
    expect(levels.count).toBe(5);
    expect(levels.describe()).toBe("Theme, Initiative, Epic, Story/Task/Bug, Subtask");
    expect(jiraTypeForNewItem("Theme", levels)).toBe("Initiative");
    expect(jiraTypeForNewItem("Initiative", levels)).toBe("Epic");
  });

  it("name a type for a new level: an epic lowered a story, a subtask raised a task", () => {
    const levels = new Levels();
    expect(levels.typeAt(0, "Epic")).toBe("Story");
    expect(levels.typeAt(0, "Subtask")).toBe("Task");
    expect(levels.typeAt(-1, "Task")).toBe("Subtask");
    expect(levels.typeAt(1, "Task")).toBe("Epic");
    expect(levels.typeAt(0, "Bug")).toBe("Bug");
  });

  it("take a company-managed project's sub-task type by its own name", () => {
    const levels = new Levels([{ name: "Epic", level: 1 }, { name: "Task", level: 0 }, { name: "Sub-task", level: -1 }]);
    expect(jiraTypeForNewItem("Task", levels)).toBe("Sub-task");
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
  /** The project's issue types, as Jira lists them with their levels. */
  types: IssueTypeLevel[] = DEFAULT_ISSUE_TYPES;
  async issueTypes() {
    return this.types;
  }
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
    // As Jira does: a parent of the wrong kind for the issue's type is refused.
    if (fields.includes("parent")) this.mustFit(this.issues.get(id)!.type, state.parent);
    this.calls.push(`update ${this.issues.get(id)!.key} ${fields.join(",")}`);
    const change: Partial<SyncState> = {};
    for (const f of fields) (change as Record<string, unknown>)[f] = state[f];
    this.edit(id, change);
  }
  async deleteIssue(id: string) {
    this.calls.push(`delete ${this.issues.get(id)?.key}`);
    this.issues.delete(id);
  }
  async changeType(id: string, type: string, parent: string | null) {
    const issue = this.issues.get(id)!;
    const target = this.levelOf(type) === -1 ? parent : null;
    this.mustFit(type, target);
    // Nor may it change into a type its own children cannot sit under.
    for (const child of this.issues.values()) {
      if (child.state.parent === id && this.levelOf(child.type) !== this.levelOf(type) - 1) {
        throw new Error(`Jira answered 400: ${child.key} cannot be under a ${type}`);
      }
    }
    this.calls.push(`retype ${issue.key} ${type}`);
    this.issues.set(id, { ...issue, type, state: { ...issue.state, parent: target }, updatedAt: this.clock++ });
  }
  projectStatuses = ["To Do", "In Progress", "In Review", "Done"];
  refuseNewStatuses = false;
  async ensureStatus(name: string) {
    const found = this.projectStatuses.find((s) => s.toLowerCase() === name.toLowerCase());
    if (found) return found;
    if (this.refuseNewStatuses) throw new Error("Jira answered 403: no permission");
    this.projectStatuses.push(name);
    this.calls.push(`status ${name}`);
    return name;
  }
  private levelOf(type: string) {
    return this.types.find((t) => t.name === type)?.level ?? 0;
  }
  /** As Jira checks: a child exactly one level below its parent, and nothing without a parent below a task. */
  private mustFit(type: string, parent: string | null) {
    const parentType = parent ? this.issues.get(parent)?.type : null;
    const fits = parentType ? this.levelOf(type) === this.levelOf(parentType) - 1 : this.levelOf(type) >= 0;
    if (!fits) throw new Error("Jira answered 400: pid: Issues with this Issue Type must be created in the same project as the parent.");
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
  statusRows = [
    { key: "not_started", label: "Not Started" },
    { key: "in_progress", label: "In Progress" },
    { key: "done", label: "Done" },
  ];
  async statuses() {
    return [...this.statusRows];
  }
  async createStatus(label: string) {
    const key = `jira_${label.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
    this.statusRows.push({ key, label });
    this.writes.push(`status ${label}`);
    return key;
  }
}

let jira: FakeJira;
let af: FakeAgilefant;
/** A fresh engine, as each call to the edge function makes. */
const engine = () => new JiraSync(jira, af);
/** One item synced, and what that sync reported. */
async function syncItemReport(id: string) {
  const sync = engine();
  await sync.syncItem(id);
  return sync.report;
}

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

describe("a move in Agilefant that Jira needs another issue type for", () => {
  /** An epic with two tasks under it, synced. */
  async function synced() {
    const epic = jira.add("INT-1", "Epic", { title: "Epic" });
    const one = jira.add("INT-2", "Task", { title: "Task one", parent: epic.id });
    const two = jira.add("INT-3", "Task", { title: "Task two", parent: epic.id });
    await engine().fullSync();
    jira.calls = [];
    return { epic, one, two, item: (title: string) => af.byTitle(title)! };
  }

  it("makes a task moved under another task a subtask", async () => {
    const { one, two, item } = await synced();
    await af.updateItem(item("Task two").id, { parentId: item("Task one").id });
    const report = await syncItemReport(item("Task two").id);

    expect(report.errors).toEqual([]);
    expect(jira.issues.get(two.id)).toMatchObject({ type: "Subtask", state: { parent: one.id } });
    expect(jira.calls).toEqual(["retype INT-3 Subtask"]);
    expect(af.linkRows.get(item("Task two").id)).toMatchObject({ jiraType: "Subtask", error: null });
    // Synced again, nothing more to do.
    await engine().fullSync();
    expect(jira.calls).toEqual(["retype INT-3 Subtask"]);
  });

  it("makes a subtask moved back under the epic a task again, then gives it its parent", async () => {
    const { epic, two, item } = await synced();
    await af.updateItem(item("Task two").id, { parentId: item("Task one").id });
    await engine().syncItem(item("Task two").id);
    await af.updateItem(item("Task two").id, { parentId: item("Epic").id });
    const report = await syncItemReport(item("Task two").id);

    expect(report.errors).toEqual([]);
    expect(jira.issues.get(two.id)).toMatchObject({ type: "Task", state: { parent: epic.id } });
    expect(jira.calls.slice(1)).toEqual(["retype INT-3 Task", "update INT-3 parent"]);
  });

  it("makes a subtask moved to the top level a task", async () => {
    const { two, item } = await synced();
    await af.updateItem(item("Task two").id, { parentId: item("Task one").id });
    await engine().syncItem(item("Task two").id);
    await af.updateItem(item("Task two").id, { parentId: null });
    await engine().syncItem(item("Task two").id);

    expect(jira.issues.get(two.id)).toMatchObject({ type: "Task", state: { parent: null } });
  });

  it("raises the task it goes under to an epic when the item brings a third level with it", async () => {
    const { one, two, item } = await synced();
    await af.updateItem(item("Task two").id, { parentId: item("Task one").id });
    await engine().syncItem(item("Task two").id);
    // Task one has a subtask now; under a task of its own it makes three levels.
    const three = jira.add("INT-4", "Task", { title: "Task three", parent: null });
    await engine().fullSync();
    jira.calls = [];
    await af.updateItem(item("Task one").id, { parentId: item("Task three").id });
    const report = await syncItemReport(item("Task one").id);

    expect(report.errors).toEqual([]);
    expect(jira.issues.get(three.id)).toMatchObject({ type: "Epic", state: { parent: null } });
    expect(jira.issues.get(one.id)).toMatchObject({ type: "Task", state: { parent: three.id } });
    expect(jira.issues.get(two.id)).toMatchObject({ type: "Subtask", state: { parent: one.id } });
    expect(af.linkRows.get(item("Task three").id)!.jiraType).toBe("Epic");
    jira.calls = [];
    expect((await engine().fullSync()).errors).toEqual([]);
    expect(jira.calls).toEqual([]);
  });

  it("refuses a move under a subtask, which Jira has no level for", async () => {
    const { item } = await synced();
    await af.updateItem(item("Task two").id, { parentId: item("Task one").id });
    await engine().syncItem(item("Task two").id);
    const sub = af.add("Below a subtask", { parentId: item("Task one").id });
    await engine().syncItem(sub.id);
    await af.updateItem(sub.id, { parentId: item("Task two").id });
    const report = await syncItemReport(sub.id);

    expect(report.errors).toEqual([expect.stringMatching(/Jira has 3 levels .* this would make 4/)]);
  });
});

describe("an epic moved under another epic in Agilefant", () => {
  it("becomes a story in Jira, and the items under it its subtasks", async () => {
    const target = jira.add("INT-1", "Epic", { title: "Target epic" });
    const epic = jira.add("INT-2", "Epic", { title: "Moved epic" });
    const task = jira.add("INT-3", "Task", { title: "Its task", parent: epic.id });
    const story = jira.add("INT-4", "Story", { title: "Its story", parent: epic.id });
    await engine().fullSync();
    jira.calls = [];

    const moved = af.byTitle("Moved epic")!;
    await af.updateItem(moved.id, { parentId: af.byTitle("Target epic")!.id });
    const report = await syncItemReport(moved.id);

    expect(report.errors).toEqual([]);
    expect(jira.issues.get(epic.id)).toMatchObject({ type: "Story", state: { parent: target.id } });
    expect(jira.issues.get(task.id)).toMatchObject({ type: "Subtask", state: { parent: epic.id } });
    expect(jira.issues.get(story.id)).toMatchObject({ type: "Subtask", state: { parent: epic.id } });
    expect(af.linkRows.get(moved.id)).toMatchObject({ jiraType: "Story", error: null });
    expect(af.linkRows.get(af.byTitle("Its task")!.id)!.jiraType).toBe("Subtask");
    // Agilefant's hierarchy is as it was; nothing more to do on the next sync.
    expect(af.byTitle("Its task")!.parentId).toBe(moved.id);
    jira.calls = [];
    const again = await engine().fullSync();
    expect(again.errors).toEqual([]);
    expect(jira.calls).toEqual([]);
    expect(af.byTitle("Its task")!.parentId).toBe(moved.id);
  });

  it("says why, and leaves Jira as it was, when its items have items of their own", async () => {
    jira.add("INT-1", "Epic", { title: "Target epic" });
    const epic = jira.add("INT-2", "Epic", { title: "Moved epic" });
    const task = jira.add("INT-3", "Task", { title: "Its task", parent: epic.id });
    jira.add("INT-4", "Subtask", { title: "Its task's subtask", parent: task.id });
    await engine().fullSync();
    jira.calls = [];

    const moved = af.byTitle("Moved epic")!;
    await af.updateItem(moved.id, { parentId: af.byTitle("Target epic")!.id });
    const report = await syncItemReport(moved.id);

    expect(report.errors).toEqual([expect.stringMatching(/^INT-2: Jira has 3 levels .* this would make 4/)]);
    expect(jira.calls).toEqual([]);
    expect(jira.issues.get(epic.id)!.type).toBe("Epic");
  });
});

describe("an item moved under a subtask in Agilefant", () => {
  /** A task on its own with a subtask, and a task to move. */
  async function synced() {
    const parent = jira.add("INT-1", "Task", { title: "Parent task" });
    const sub = jira.add("INT-2", "Subtask", { title: "Its subtask", parent: parent.id });
    const other = jira.add("INT-3", "Subtask", { title: "Its other subtask", parent: parent.id });
    const moved = jira.add("INT-4", "Task", { title: "Moved task" });
    await engine().fullSync();
    jira.calls = [];
    return { parent, sub, other, moved, item: (title: string) => af.byTitle(title)! };
  }

  it("raises the tree above it a level: the task an epic, its subtasks tasks, the item their subtask", async () => {
    const { parent, sub, other, moved, item } = await synced();
    await af.updateItem(item("Moved task").id, { parentId: item("Its subtask").id });
    const report = await syncItemReport(item("Moved task").id);

    expect(report.errors).toEqual([]);
    expect(jira.issues.get(parent.id)).toMatchObject({ type: "Epic", state: { parent: null } });
    expect(jira.issues.get(sub.id)).toMatchObject({ type: "Task", state: { parent: parent.id } });
    expect(jira.issues.get(other.id)).toMatchObject({ type: "Task", state: { parent: parent.id } });
    expect(jira.issues.get(moved.id)).toMatchObject({ type: "Subtask", state: { parent: sub.id } });
    // Agilefant's hierarchy is what was asked for, untouched by the moves.
    expect(item("Its other subtask").parentId).toBe(item("Parent task").id);
    expect(af.linkRows.get(item("Moved task").id)).toMatchObject({ jiraType: "Subtask", error: null });
    jira.calls = [];
    expect((await engine().fullSync()).errors).toEqual([]);
    expect(jira.calls).toEqual([]);
  });

  it("keeps each new type the moment Jira has made it, before the moved item is done", async () => {
    const { item } = await synced();
    const saved: string[] = [];
    const save = af.saveLink.bind(af);
    af.saveLink = async (link: Link) => {
      saved.push(`${link.jiraKey} ${link.jiraType}`);
      return save(link);
    };
    await af.updateItem(item("Moved task").id, { parentId: item("Its subtask").id });
    await syncItemReport(item("Moved task").id);

    // The raised subtasks and the raised task, each as soon as it is made; the moved item last.
    expect(saved.slice(0, 3).sort()).toEqual(["INT-1 Epic", "INT-2 Task", "INT-3 Task"]);
    expect(saved.at(-1)).toBe("INT-4 Subtask");
  });

  it("brings a new item made under a subtask to Jira the same way", async () => {
    const { parent, sub, item } = await synced();
    const fresh = af.add("New under subtask", { parentId: item("Its subtask").id });
    const report = await syncItemReport(fresh.id);

    expect(report).toMatchObject({ errors: [], skipped: [], createdInJira: 1 });
    expect(jira.issues.get(parent.id)!.type).toBe("Epic");
    expect(jira.issues.get(sub.id)!.type).toBe("Task");
    expect(jira.byTitle("New under subtask")).toMatchObject({ type: "Subtask", state: { parent: sub.id } });
  });

  it("says so, changing nothing, where it would make a fourth level", async () => {
    const { item } = await synced();
    const epic = jira.add("INT-5", "Epic", { title: "Epic" });
    await engine().fullSync();
    await af.updateItem(item("Parent task").id, { parentId: af.byTitle("Epic")!.id });
    await engine().syncItem(item("Parent task").id);
    jira.calls = [];
    await af.updateItem(item("Moved task").id, { parentId: item("Its subtask").id });
    const report = await syncItemReport(item("Moved task").id);

    expect(report.errors).toEqual([expect.stringMatching(/^INT-4: Jira has 3 levels .* this would make 4/)]);
    expect(jira.calls).toEqual([]);
    expect(jira.issues.get(epic.id)!.type).toBe("Epic");
  });
});

describe("Jira's refusals, in words", () => {
  it("reads the bulk move's objects as well as plain messages", () => {
    const body = JSON.stringify({ errors: { "0": { message: "Subtask needs a parent" } }, errorMessages: ["Not allowed"] });
    expect(new JiraError(400, body).message).toBe(`Jira answered 400: Not allowed; 0: {"message":"Subtask needs a parent"}`);
  });
});

describe("a Jira status Agilefant does not have", () => {
  it("is added to the list's statuses and given to the item", async () => {
    jira.add("INT-7", "Epic", { title: "Waiting", status: "Waiting for customer" });
    await engine().fullSync();
    expect(af.statusRows.at(-1)).toEqual({ key: "jira_waiting_for_customer", label: "Waiting for customer" });
    expect(af.byTitle("Waiting")!.status).toBe("jira_waiting_for_customer");
  });

  it("is added once, and goes back to Jira under its own name", async () => {
    jira.add("INT-7", "Epic", { title: "A", status: "QA" });
    jira.add("INT-8", "Epic", { title: "B", status: "QA" });
    await engine().fullSync();
    expect(af.writes.filter((w) => w.startsWith("status"))).toEqual(["status QA"]);
    const mine = af.add("Mine", { status: "jira_qa" });
    await engine().syncItem(mine.id);
    expect(jira.byTitle("Mine")!.state.status).toBe("QA");
  });
});

describe("an Agilefant status Jira does not have", () => {
  it("is added to the Jira project, and the issue gets it", async () => {
    af.statusRows.push({ key: "review_by_cfo", label: "CFO review" });
    const mine = af.add("Budget", { status: "review_by_cfo" });
    await engine().syncItem(mine.id);
    expect(jira.calls).toContain("status CFO review");
    expect(jira.byTitle("Budget")!.state.status).toBe("CFO review");
  });

  it("goes as In Progress where Jira refuses to add it, and stays as it is in Agilefant", async () => {
    jira.refuseNewStatuses = true;
    af.statusRows.push({ key: "review_by_cfo", label: "CFO review" });
    const mine = af.add("Budget", { status: "review_by_cfo" });
    const report = await syncItemReport(mine.id);
    expect(report.errors[0]).toContain("CFO review");
    expect(jira.byTitle("Budget")!.state.status).toBe("In Progress");
    await engine().fullSync();
    expect(af.byTitle("Budget")!.status).toBe("review_by_cfo");
  });
});

describe("a site with levels added above the epic", () => {
  beforeEach(() => {
    jira.types = [...DEFAULT_ISSUE_TYPES, { name: "Initiative", level: 2 }, { name: "Theme", level: 3 }];
  });

  it("raises the tree into them when a move makes it deeper than three", async () => {
    // An epic with a story with a subtask: three levels, all Jira's own.
    const epic = jira.add("INT-1", "Epic", { title: "Epic" });
    const story = jira.add("INT-2", "Story", { title: "Story", parent: epic.id });
    const sub = jira.add("INT-3", "Subtask", { title: "Subtask", parent: story.id });
    const other = jira.add("INT-4", "Task", { title: "Other" });
    await engine().fullSync();
    jira.calls = [];

    // A task under the subtask makes four: the epic becomes an initiative.
    await af.updateItem(af.byTitle("Other")!.id, { parentId: af.byTitle("Subtask")!.id });
    const report = await syncItemReport(af.byTitle("Other")!.id);

    expect(report.errors).toEqual([]);
    expect(jira.issues.get(epic.id)).toMatchObject({ type: "Initiative", state: { parent: null } });
    expect(jira.issues.get(story.id)).toMatchObject({ type: "Epic", state: { parent: epic.id } });
    expect(jira.issues.get(sub.id)).toMatchObject({ type: "Task", state: { parent: story.id } });
    expect(jira.issues.get(other.id)).toMatchObject({ type: "Subtask", state: { parent: sub.id } });
    jira.calls = [];
    expect((await engine().fullSync()).errors).toEqual([]);
    expect(jira.calls).toEqual([]);
  });

  it("takes five levels, and says so naming them all when a sixth is asked for", async () => {
    const theme = jira.add("INT-1", "Theme", { title: "Theme" });
    const initiative = jira.add("INT-2", "Initiative", { title: "Initiative", parent: theme.id });
    const epic = jira.add("INT-3", "Epic", { title: "Epic", parent: initiative.id });
    const story = jira.add("INT-4", "Story", { title: "Story", parent: epic.id });
    jira.add("INT-5", "Subtask", { title: "Subtask", parent: story.id });
    jira.add("INT-6", "Task", { title: "Loose" });
    await engine().fullSync();
    jira.calls = [];

    await af.updateItem(af.byTitle("Loose")!.id, { parentId: af.byTitle("Subtask")!.id });
    const report = await syncItemReport(af.byTitle("Loose")!.id);

    expect(report.errors).toEqual([
      expect.stringMatching(/^INT-6: Jira has 5 levels — Theme, Initiative, Epic, Story\/Task\/Bug, Subtask — and this would make 6/),
    ]);
    expect(jira.calls).toEqual([]);
  });
});

describe("the types the app shows at once after a move", () => {
  const levels5 = new Levels([...DEFAULT_ISSUE_TYPES, { name: "Initiative", level: 2 }, { name: "Theme", level: 3 }]);

  /** Agilefant's hierarchy with each item's Jira type, as the app sees them. */
  const appView = () =>
    new Map(
      [...af.items.values()].map((item) => [item.id, { type: af.linkRows.get(item.id)?.jiraType ?? null, parent: item.parentId }]),
    );

  /** Each item's type in Jira after the sync, by item. */
  const jiraTypes = () =>
    new Map([...af.linkRows.values()].map((link) => [link.workItemId, jira.issues.get(link.jiraId)!.type]));

  it("are the types the sync then gives them in Jira — a move under a subtask", async () => {
    const parent = jira.add("INT-1", "Task", { title: "Parent task" });
    jira.add("INT-2", "Subtask", { title: "Its subtask", parent: parent.id });
    jira.add("INT-3", "Subtask", { title: "Its other subtask", parent: parent.id });
    jira.add("INT-4", "Task", { title: "Moved task" });
    await engine().fullSync();

    await af.updateItem(af.byTitle("Moved task")!.id, { parentId: af.byTitle("Its subtask")!.id });
    const shown = expectedTypes(appView());
    await engine().syncItem(af.byTitle("Moved task")!.id);
    expect(shown).toEqual(jiraTypes());
    expect(shown.get(af.byTitle("Parent task")!.id)).toBe("Epic");
  });

  it("are the types the sync then gives them — an epic under an epic, on five levels", async () => {
    jira.types = [...DEFAULT_ISSUE_TYPES, { name: "Initiative", level: 2 }, { name: "Theme", level: 3 }];
    const top = jira.add("INT-1", "Epic", { title: "Top epic" });
    jira.add("INT-2", "Task", { title: "Its task", parent: top.id });
    const moved = jira.add("INT-3", "Epic", { title: "Moved epic" });
    const story = jira.add("INT-4", "Story", { title: "Its story", parent: moved.id });
    jira.add("INT-5", "Subtask", { title: "Its subtask", parent: story.id });
    await engine().fullSync();

    await af.updateItem(af.byTitle("Moved epic")!.id, { parentId: af.byTitle("Top epic")!.id });
    const shown = expectedTypes(appView(), levels5);
    await engine().syncItem(af.byTitle("Moved epic")!.id);
    expect(shown).toEqual(jiraTypes());
    expect(shown.get(af.byTitle("Top epic")!.id)).toBe("Initiative");
  });

  it("keep the types a tree too deep for Jira has, as the sync does", () => {
    const view = new Map<string, { type: string | null; parent: string | null }>([
      ["a", { type: "Epic", parent: null }],
      ["b", { type: "Task", parent: "a" }],
      ["c", { type: "Subtask", parent: "b" }],
      ["d", { type: "Task", parent: "c" }],
    ]);
    expect([...expectedTypes(view).values()]).toEqual(["Epic", "Task", "Subtask", "Task"]);
  });

  it("name the type an item not yet in Jira will be made, raising the tree where it must", () => {
    const view = new Map<string, { type: string | null; parent: string | null }>([
      ["a", { type: "Task", parent: null }],
      ["b", { type: "Subtask", parent: "a" }],
      ["new", { type: null, parent: "b" }],
    ]);
    const shown = expectedTypes(view);
    expect(shown.get("a")).toBe("Epic");
    expect(shown.get("b")).toBe("Task");
    expect(shown.get("new")).toBe("Subtask");
  });

  it("name for new items the types the sync then creates them as, wherever they are put", async () => {
    jira.types = [...DEFAULT_ISSUE_TYPES, { name: "Initiative", level: 2 }];
    const levels = new Levels(jira.types);
    const epic = jira.add("INT-1", "Epic", { title: "Epic" });
    const task = jira.add("INT-2", "Task", { title: "Task", parent: epic.id });
    jira.add("INT-3", "Subtask", { title: "Subtask", parent: task.id });
    await engine().fullSync();

    const top = af.add("New at the top");
    const underTop = af.add("New under the new one", { parentId: top.id });
    const underEpic = af.add("New under the epic", { parentId: af.byTitle("Epic")!.id });
    const underSubtask = af.add("New under the subtask", { parentId: af.byTitle("Subtask")!.id });
    const view = () =>
      new Map([...af.items.values()].map((item) => [item.id, { type: af.linkRows.get(item.id)?.jiraType ?? null, parent: item.parentId }]));
    const shown = expectedTypes(view(), levels);
    expect(shown.get(top.id)).toBe("Epic");
    expect(shown.get(underTop.id)).toBe("Task");
    // The new item under the subtask raises that tree, the epic to an initiative: beside its tasks, now epics.
    expect(shown.get(underEpic.id)).toBe("Epic");
    expect(shown.get(underSubtask.id)).toBe("Subtask");

    for (const item of [underTop, underEpic, underSubtask]) await engine().syncItem(item.id);
    const made = new Map([...af.linkRows.values()].map((link) => [link.workItemId, jira.issues.get(link.jiraId)!.type]));
    expect(made).toEqual(shown);
  });
});

describe("a change to Jira's hierarchy", () => {
  it("is followed by a full sync: every tree levelled to the levels as they are now", async () => {
    jira.types = [...DEFAULT_ISSUE_TYPES, { name: "Initiative", level: 2 }];
    const initiative = jira.add("INT-1", "Initiative", { title: "Initiative" });
    const epic = jira.add("INT-2", "Epic", { title: "Epic", parent: initiative.id });
    const task = jira.add("INT-3", "Task", { title: "Task", parent: epic.id });
    await engine().fullSync();

    // The level above the epic taken away in Jira's settings.
    jira.types = DEFAULT_ISSUE_TYPES;
    const report = await engine().fullSync();

    expect(report.errors).toEqual([]);
    expect(jira.issues.get(initiative.id)).toMatchObject({ type: "Epic", state: { parent: null } });
    expect(jira.issues.get(epic.id)).toMatchObject({ type: "Story", state: { parent: initiative.id } });
    expect(jira.issues.get(task.id)).toMatchObject({ type: "Subtask", state: { parent: epic.id } });
    // What the app shows ahead of Jira is what Jira now has, and a second sync changes nothing.
    const view = new Map([...af.items.values()].map((item) => [item.id, { type: af.linkRows.get(item.id)!.jiraType, parent: item.parentId }]));
    expect([...expectedTypes(view).entries()].every(([id, type]) => af.linkRows.get(id)!.jiraType === type)).toBe(true);
    jira.calls = [];
    await engine().fullSync();
    expect(jira.calls).toEqual([]);
  });

  it("leaves trees alone that already fit", async () => {
    const epic = jira.add("INT-1", "Epic", { title: "Epic" });
    jira.add("INT-2", "Task", { title: "Task", parent: epic.id });
    await engine().fullSync();
    jira.calls = [];
    jira.types = [...DEFAULT_ISSUE_TYPES, { name: "Initiative", level: 2 }];
    await engine().fullSync();
    expect(jira.calls).toEqual([]);
  });
});
