/**
 * /try, a list to use before signing up (2026-11-16): it works with the app's
 * keys, keeps the visitor's changes in this browser only once there are
 * changes, and the front page leads to it.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Try from "@/pages/Try";
import { loadTryList, saveTryList, TRY_LIST_KEY } from "@/lib/tryList";

const renderTry = () =>
  render(
    <MemoryRouter>
      <Try />
    </MemoryRouter>,
  );
const rows = () => screen.getAllByRole("treeitem").map((r) => `${r.getAttribute("aria-level")} ${r.textContent}`);
const tree = () => screen.getByRole("tree", { name: "Your list" });
const stored = () => loadTryList()?.map((it) => `${it.depth}${it.done ? "x" : ""} ${it.title}`);

beforeEach(() => localStorage.clear());

describe("the try-out page", () => {
  it("starts with the examples and stores nothing until the visitor changes something", () => {
    renderTry();
    expect(rows()[0]).toBe("1 Plan the team kick-off");
    expect(rows()).toContain("2 Book a room");
    expect(localStorage.getItem(TRY_LIST_KEY)).toBeNull();
    expect(screen.getAllByRole("link", { name: /Sign up to keep it/ })[0].getAttribute("href")).toBe("/auth/sign-up");
  });

  it("nests with Tab and Shift+Tab on the selected item, and stores the change", () => {
    renderTry();
    fireEvent.click(screen.getByText("Renew my passport"));
    fireEvent.keyDown(tree(), { key: "Tab" });
    expect(rows()).toContain("2 Renew my passport");
    expect(stored()).toContain("1 Renew my passport");
    fireEvent.keyDown(tree(), { key: "Tab", shiftKey: true });
    expect(rows()).toContain("1 Renew my passport");
  });

  it("marks done by double-click, the dot or Space, and the parent shows in progress", () => {
    renderTry();
    fireEvent.doubleClick(screen.getByText("Fix the bike's back light"));
    expect(stored()).toContain("0x Fix the bike's back light");
    fireEvent.click(screen.getByRole("button", { name: 'Mark "Fix the bike\'s back light" not done' }));
    expect(stored()).toContain("0 Fix the bike's back light");
    fireEvent.click(screen.getByText("Renew my passport"));
    fireEvent.keyDown(tree(), { key: " " });
    expect(stored()).toContain("0x Renew my passport");
  });

  it("Delete takes the sub-items too, and Ctrl+Z and Ctrl+Y undo and redo", () => {
    renderTry();
    fireEvent.click(screen.getByText("Plan the team kick-off"));
    fireEvent.keyDown(tree(), { key: "Delete" });
    expect(rows()).toEqual(["1 Renew my passport", "1 Fix the bike's back light"]);
    fireEvent.keyDown(tree(), { key: "z", ctrlKey: true });
    expect(rows()).toHaveLength(6);
    fireEvent.keyDown(tree(), { key: "y", ctrlKey: true });
    expect(rows()).toHaveLength(2);
    expect(stored()).toEqual(["0 Renew my passport", "0 Fix the bike's back light"]);
  });

  it("arrow keys move the selection, and Escape lets Tab go on to the next control", () => {
    renderTry();
    fireEvent.keyDown(tree(), { key: "ArrowDown" });
    fireEvent.keyDown(tree(), { key: "ArrowDown" });
    expect(screen.getAllByRole("treeitem")[1].getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(tree(), { key: "Escape" });
    fireEvent.keyDown(tree(), { key: "Tab" });
    expect(localStorage.getItem(TRY_LIST_KEY)).toBeNull();
  });

  it("adds a typed item with Enter, and a pasted list one line each", () => {
    renderTry();
    const box = screen.getByRole("textbox", { name: "New item" });
    fireEvent.change(box, { target: { value: "- Call the bank\n- Water the plants\n\n" } });
    expect(screen.getByRole("button", { name: "Add 2" })).toBeTruthy();
    fireEvent.keyDown(box, { key: "Enter" });
    expect(rows().slice(-2)).toEqual(["1 Call the bank", "1 Water the plants"]);
    expect((box as HTMLTextAreaElement).value).toBe("");
    expect(stored()).toHaveLength(8);
  });

  it("an emptied list can have the examples back", () => {
    renderTry();
    for (let i = 0; i < 3; i++) {
      fireEvent.click(screen.getAllByRole("treeitem")[0]);
      fireEvent.keyDown(tree(), { key: "Delete" });
    }
    expect(screen.getByText("The list is empty. Add something below.")).toBeTruthy();
    expect(localStorage.getItem(TRY_LIST_KEY)).toBeNull();
    act(() => fireEvent.click(screen.getByRole("button", { name: "Put the examples back" })));
    expect(rows()).toHaveLength(6);
  });

  it("opens with the visitor's own list when there is one", () => {
    saveTryList([{ id: "a", title: "Mine", depth: 0, done: false }]);
    renderTry();
    expect(rows()).toEqual(["1 Mine"]);
    expect(screen.getByText(/this item is waiting in your new account/)).toBeTruthy();
  });
});

describe("the way there", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

  it("the front page offers it next to signing up, and again at the end", () => {
    const landing = read("src/pages/Landing.tsx");
    expect(landing.match(/to="\/try"/g)).toHaveLength(2);
  });

  it("is a public route, outside the signed-in routes", () => {
    const app = read("src/App.tsx");
    expect(app.indexOf('path="/try"')).toBeGreaterThan(-1);
    expect(app.indexOf('path="/try"')).toBeLessThan(app.indexOf("<AppRoutes />"));
  });

  it("the terms say where the list is kept", () => {
    expect(read("src/components/TermsContent.tsx")).toContain("try-out page");
  });
});
