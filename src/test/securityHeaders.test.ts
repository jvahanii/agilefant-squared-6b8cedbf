/**
 * public/_headers is where the site's Content-Security-Policy lives, and the
 * browser blocks anything it does not list. Something new the app talks to —
 * a fetch to another service, a font, a different Supabase project — works in
 * development (no policy there) and fails only on the live site. These checks
 * read the source for the addresses it uses and ask the policy about each.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const headersFile = readFileSync(join(root, "public", "_headers"), "utf8");

/** The headers of one rule in _headers, by its path line. */
function rule(path: string): Map<string, string> {
  const lines = headersFile.split(/\r?\n/);
  const start = lines.findIndex((l) => l === path);
  expect(start, `a rule for ${path}`).toBeGreaterThanOrEqual(0);
  const headers = new Map<string, string>();
  for (const line of lines.slice(start + 1)) {
    if (!/^\s+\S/.test(line)) break;
    const m = /^\s+(!?\s*[\w-]+)(?::\s*(.*))?$/.exec(line);
    if (m) headers.set(m[1].replace(/\s+/g, " "), m[2] ?? "");
  }
  return headers;
}

const site = rule("/*");
const policy = site.get("Content-Security-Policy") ?? site.get("Content-Security-Policy-Report-Only") ?? "";
const directive = (name: string) =>
  policy
    .split(";")
    .map((d) => d.trim().split(/\s+/))
    .find(([n]) => n === name)
    ?.slice(1) ?? [];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === "test" ? [] : sourceFiles(p);
    return /\.(tsx?|css)$/.test(name) ? [p] : [];
  });
}
const source = sourceFiles(join(root, "src")).map((p) => readFileSync(p, "utf8"));

describe("the site's security headers", () => {
  it("has a policy, and the site cannot be framed or downgraded to http", () => {
    expect(policy).not.toBe("");
    expect(directive("frame-ancestors")).toEqual(["'none'"]);
    expect(directive("object-src")).toEqual(["'none'"]);
    expect(site.get("X-Frame-Options")).toBe("DENY");
    expect(site.get("Strict-Transport-Security")).toMatch(/max-age=\d{7,}/);
  });

  it("runs no script but the app's own and sign-in's", () => {
    const scripts = directive("script-src");
    expect(scripts).not.toContain("'unsafe-inline'");
    expect(scripts).not.toContain("'unsafe-eval'");
    expect(scripts.filter((s) => s.includes("*"))).toEqual([]);
  });

  it("lets the app reach every address it fetches", () => {
    const connect = directive("connect-src");
    const fetched = source.flatMap((s) => [...s.matchAll(/fetch\(\s*[`"'](https:\/\/[^/`"'$]+)/g)].map((m) => m[1]));
    expect(fetched.length).toBeGreaterThan(0);
    for (const origin of fetched) expect(connect, origin).toContain(origin);
  });

  it("lets the app reach the database it is built against, live updates included", () => {
    const env = readFileSync(join(root, ".env"), "utf8");
    const url = /^VITE_SUPABASE_URL="?([^"\s]+)/m.exec(env)?.[1] ?? "";
    expect(url).toMatch(/^https:\/\//);
    const origin = new URL(url).origin;
    expect(directive("connect-src")).toContain(origin);
    expect(directive("connect-src")).toContain(origin.replace(/^https/, "wss"));
  });

  it("allows what index.html opens a connection to ahead of time", () => {
    const html = readFileSync(join(root, "index.html"), "utf8");
    const preconnects = [...html.matchAll(/rel="preconnect" href="([^"]+)"/g)].map((m) => m[1]);
    expect(preconnects.length).toBeGreaterThan(0);
    for (const origin of preconnects) expect(directive("connect-src"), origin).toContain(origin);
  });

  it("allows the stylesheets the CSS imports", () => {
    const imports = source.flatMap((s) => [...s.matchAll(/@import url\(['"]?(https:\/\/[^/'")]+)/g)].map((m) => m[1]));
    for (const origin of imports) expect(directive("style-src"), origin).toContain(origin);
  });

  it("runs the Gmail callback under the app's policy: no script written into the page", () => {
    // Google sends the person back here after they allow Gmail access. Script
    // inside the page would be blocked, the window would sit on "Finishing
    // Gmail connection…" forever, and the connection would never complete.
    const html = readFileSync(join(root, "public", "gmail-callback.html"), "utf8");
    expect(html).toContain('<script src="/gmail-callback.js"></script>');
    expect(html).not.toMatch(/<script>|<script(?![^>]*\bsrc=)[^>]*>|\son[a-z]+=/i);
    expect(readFileSync(join(root, "public", "gmail-callback.js"), "utf8")).toContain("gmail-oauth");
    expect(headersFile).not.toMatch(/^\/gmail-callback/m);
  });

  it("lifts the policy only from the stand-alone pages that need script inside the page", () => {
    const pages = readdirSync(join(root, "public")).filter((f) => f.endsWith(".html") && f !== "gmail-callback.html");
    for (const page of pages) {
      const html = readFileSync(join(root, "public", page), "utf8");
      const path = `/${page.replace(/\.html$/, "")}*`;
      if (/<script>|\son[a-z]+=/i.test(html)) expect(rule(path).has("! Content-Security-Policy"), path).toBe(true);
    }
  });
});
