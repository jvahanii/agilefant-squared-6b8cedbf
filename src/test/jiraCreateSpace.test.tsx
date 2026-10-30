/**
 * An Agilefant list moved to Jira: a new space made for it, its key proposed
 * from the list's name, and the list kept in step with it from then on.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PROJECT_KEY, renameToFreeName, suggestProjectKey, uniqueProjectName } from "../../supabase/functions/_shared/jiraProjectKey";
import { jiraPort } from "../../supabase/functions/_shared/jiraApi";

const callJira = vi.fn();
vi.mock("@/lib/jiraSync", () => ({ callJira: (body: Record<string, unknown>) => callJira(body) }));
const toast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({ toast: (t: unknown) => toast(t), useToast: () => ({ toasts: [], toast }) }));

import { JiraCreateSpaceForm } from "@/components/JiraCreateSpaceForm";
import { useOrgStore } from "@/store/orgStore";
import { useAppStore } from "@/store/appStore";
import { useJiraIssuesStore } from "@/store/jiraIssuesStore";

describe("a key for a space made for a list", () => {
  it("is the initials of a name of several words, the first letters of one of one word", () => {
    expect(suggestProjectKey("Fitness input")).toBe("FI");
    expect(suggestProjectKey("Backlog")).toBe("BACK");
    expect(suggestProjectKey("Työpaikkalistaukset ja haut")).toBe("TJH");
  });

  it("is never one already on the site, and always one Jira takes", () => {
    expect(suggestProjectKey("Fitness input", ["FI", "FI2"])).toBe("FI3");
    for (const name of ["2026 goals", "Ä", "", "a b c d e f g h i j k l", "Up next", "x"]) {
      expect(suggestProjectKey(name)).toMatch(PROJECT_KEY);
    }
  });

  it("comes with a name not on the site either", () => {
    expect(uniqueProjectName("Backlog", ["backlog", "Backlog (2)"])).toBe("Backlog (3)");
    expect(uniqueProjectName("Ideas", ["Backlog"])).toBe("Ideas");
  });
});

describe("making the space in Jira", () => {
  beforeAll(() => vi.stubGlobal("AbortSignal", { timeout: () => new AbortController().signal }));
  afterAll(() => vi.unstubAllGlobals());

  it("asks for a company-managed Scrum space led by the account", async () => {
    const sent: Array<{ url: string; body: unknown }> = [];
    const port = jiraPort({ baseUrl: "https://x.atlassian.net", email: "me@x.org", token: "t", projectKey: "", pointsField: null }, async (url, init) => {
      sent.push({ url, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ id: 10050, key: "FI" }), { status: 201 });
    });
    await expect(port.createProject({ key: "FI", name: "Fitness input", leadAccountId: "acc-1" })).resolves.toEqual({ id: "10050", key: "FI" });
    expect(sent[0].url).toBe("https://x.atlassian.net/rest/api/3/project");
    expect(sent[0].body).toMatchObject({
      key: "FI",
      name: "Fitness input",
      leadAccountId: "acc-1",
      projectTypeKey: "software",
      projectTemplateKey: "com.pyxis.greenhopper.jira:gh-simplified-scrum-classic",
    });
  });

  it("says which permission is missing when Jira will not make it", async () => {
    const port = jiraPort({ baseUrl: "https://x.atlassian.net", email: "me@x.org", token: "t", projectKey: "", pointsField: null }, async () =>
      new Response("{}", { status: 403 }),
    );
    await expect(port.createProject({ key: "FI", name: "F", leadAccountId: "a" })).rejects.toThrow(/Administer Jira/);
  });
});

describe("the form moving a list to Jira", () => {
  beforeEach(() => {
    callJira.mockReset();
    toast.mockReset();
    useOrgStore.setState({ activeOrgId: "org-1" } as never);
    useAppStore.setState({
      backlogs: { "bl-1": { id: "bl-1", name: "Fitness input", treeId: "tree-1", parentId: null } },
      backlogTrees: { "tree-1": { id: "tree-1", name: "TODO" } },
    } as never);
    useJiraIssuesStore.setState({ byList: new Map(), load: vi.fn(async () => undefined) } as never);
  });

  it("proposes the list's name and a key from it, and leaves the key to the sync when it is not changed", async () => {
    callJira.mockResolvedValue({ connected: true, tokenConfigured: true, spaces: [], created: { key: "FI", name: "Fitness input" }, report: { createdInJira: 4 } });
    const onDone = vi.fn();
    render(<JiraCreateSpaceForm backlogId="bl-1" onDone={onDone} />);
    expect(screen.getByLabelText("Jira space name")).toHaveValue("Fitness input");
    expect(screen.getByLabelText("Key")).toHaveValue("FI");
    fireEvent.click(screen.getByRole("button", { name: "Create space in Jira" }));
    await waitFor(() =>
      expect(callJira).toHaveBeenCalledWith({ action: "createSpaceFromList", organizationId: "org-1", backlogId: "bl-1", projectName: "Fitness input" }),
    );
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "FI made in Jira", description: expect.stringContaining("4 item(s) sent to Jira") }));
  });

  it("sends a key that was typed, in capitals, and will not send one Jira would not take", async () => {
    callJira.mockResolvedValue({ connected: true, tokenConfigured: true, spaces: [] });
    render(<JiraCreateSpaceForm backlogId="bl-1" />);
    const key = screen.getByLabelText("Key");
    fireEvent.change(key, { target: { value: "9x" } });
    expect(screen.getByRole("button", { name: "Create space in Jira" })).toBeDisabled();
    fireEvent.change(key, { target: { value: "fit-2" } });
    expect(key).toHaveValue("FIT2");
    fireEvent.click(screen.getByRole("button", { name: "Create space in Jira" }));
    await waitFor(() => expect(callJira).toHaveBeenCalledWith(expect.objectContaining({ projectKey: "FIT2" })));
  });
});

describe("a space renamed after its list", () => {
  const refusing = (...names: string[]) => {
    const tried: string[] = [];
    const rename = async (name: string) => {
      tried.push(name);
      if (names.includes(name)) throw new Error("Jira answered 400: projectName: A project with that name already exists.");
    };
    return { tried, rename };
  };

  it("takes the next free name when Jira refuses one it did not show", async () => {
    const { tried, rename } = refusing("Roadmap", "Roadmap (2)");
    await expect(renameToFreeName(rename, "Roadmap", [], null)).resolves.toBe("Roadmap (3)");
    expect(tried).toEqual(["Roadmap", "Roadmap (2)", "Roadmap (3)"]);
  });

  it("skips a name it can see is taken, without asking", async () => {
    const { tried, rename } = refusing();
    await expect(renameToFreeName(rename, "Roadmap", ["Roadmap"], null)).resolves.toBe("Roadmap (2)");
    expect(tried).toEqual(["Roadmap (2)"]);
  });

  it("does nothing where the space has the name already", async () => {
    const { tried, rename } = refusing("Roadmap");
    await expect(renameToFreeName(rename, "Roadmap", [], "Roadmap (2)")).resolves.toBeNull();
    expect(tried).toEqual(["Roadmap"]);
  });

  it("passes on any other refusal", async () => {
    const rename = async () => {
      throw new Error("Jira did not allow renaming the space");
    };
    await expect(renameToFreeName(rename, "Roadmap", [], null)).rejects.toThrow("did not allow");
  });
});
