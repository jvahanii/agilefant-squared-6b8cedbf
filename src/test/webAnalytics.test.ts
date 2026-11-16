/**
 * Cookieless visitor counts on the public pages (Cloudflare Web Analytics,
 * 2026-11-16): where the counter loads, where it never does, and that the
 * security policy and the terms both allow for it.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BEACON_SRC, loadWebAnalytics } from "@/lib/webAnalytics";

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");
const beacons = () => document.querySelectorAll(`script[src="${BEACON_SRC}"]`);

describe("loading the counter", () => {
  beforeEach(() => beacons().forEach((s) => s.remove()));

  it("stays off without a site token, and off anywhere but agilefant.org", () => {
    // An empty token, not undefined: undefined falls back to the real one in .env.
    expect(loadWebAnalytics("", "agilefant.org")).toBe(false);
    expect(loadWebAnalytics("tok", "localhost")).toBe(false);
    expect(loadWebAnalytics("tok", "preview.agilefant-squared.pages.dev")).toBe(false);
    expect(beacons()).toHaveLength(0);
  });

  it("adds Cloudflare's script once, with the token and page changes counted", () => {
    expect(loadWebAnalytics("tok", "agilefant.org")).toBe(true);
    expect(loadWebAnalytics("tok", "agilefant.org")).toBe(true);
    expect(beacons()).toHaveLength(1);
    const script = beacons()[0] as HTMLScriptElement;
    expect(script.type).toBe("module");
    expect(JSON.parse(script.getAttribute("data-cf-beacon")!)).toEqual({ token: "tok", spa: true });
  });
});

describe("the pages that count", () => {
  const uses = (page: string) => read(`src/pages/${page}.tsx`).includes("useWebAnalytics()");

  it("are the ways in: front page, the try-out, sign-in and sign-up, a new account's first page, terms and guides", () => {
    for (const page of ["Landing", "Try", "Auth", "Onboarding", "Terms", "UserGuide", "JobAdsGuide", "JiraGuide"]) {
      expect(uses(page), page).toBe(true);
    }
  });

  it("never include a public backlog, whose address is its secret, or the unsubscribe page, whose address names a person", () => {
    for (const page of ["PublicBacklog", "Unsubscribe", "Index"]) expect(uses(page), page).toBe(false);
  });
});

describe("what allows it", () => {
  const headers = read("public/_headers");
  const directive = (name: string) => new RegExp(`${name} [^;]*`).exec(headers)?.[0].split(/\s+/) ?? [];

  it("the security policy lets the script load and report", () => {
    expect(directive("script-src")).toContain("https://static.cloudflareinsights.com");
    expect(directive("connect-src")).toContain("https://cloudflareinsights.com");
  });

  it("the terms say what is counted and that it uses no cookies", () => {
    const terms = read("src/components/TermsContent.tsx");
    expect(terms).toContain("Cloudflare Web Analytics");
    expect(terms).toContain("It uses no cookies");
    expect(terms).not.toContain("There is no analytics");
  });
});
