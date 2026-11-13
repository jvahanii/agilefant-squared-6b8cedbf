/**
 * Every open app costs the database one realtime subscription per listener,
 * so the shares table is listened to in one place (Index.tsx), and that one
 * listener also refreshes the tree panel's share icons.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const src = join(__dirname, "..");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "test" ? [] : sources(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe("the backlog_tree_shares table", () => {
  it("is listened to in one place only", () => {
    const listeners = sources(src)
      .filter((p) => /table:\s*['"]backlog_tree_shares['"]/.test(readFileSync(p, "utf8")))
      .map((p) => relative(src, p).split("\\").join("/"));
    expect(listeners).toEqual(["pages/Index.tsx"]);
  });

  it("refreshes the share icons from that listener", () => {
    const index = readFileSync(join(src, "pages", "Index.tsx"), "utf8");
    const handler = index.slice(index.indexOf("table: 'backlog_tree_shares'"));
    expect(handler.slice(0, 400)).toContain("useTreeSharesStore.getState().refresh()");
  });
});
