/**
 * A part of the app that fails to load is asked for again, under an address
 * of its own — the browser remembers the failed one — before the error page.
 */
import { describe, it, expect, vi } from "vitest";
import { failedModuleUrl, importWithRetry } from "@/lib/importWithRetry";

const chromeError = new TypeError("Failed to fetch dynamically imported module: https://agilefant.org/assets/Index-D8-hwuWG.js");

describe("loading a part of the app", () => {
  it("reads the file a failed load named, in Chrome's words and Firefox's", () => {
    expect(failedModuleUrl(chromeError)).toBe("https://agilefant.org/assets/Index-D8-hwuWG.js");
    expect(failedModuleUrl(new TypeError("error loading dynamically imported module: https://x.org/a.js"))).toBe("https://x.org/a.js");
    expect(failedModuleUrl(new Error("something else"))).toBeNull();
  });

  it("asks again under a fresh address when the load fails, and gives the module", async () => {
    const load = vi.fn(async (url: string) => ({ default: url }));
    const result = await importWithRetry(() => Promise.reject(chromeError), load, [0])();
    expect(load).toHaveBeenCalledTimes(1);
    expect(result.default).toMatch(/^https:\/\/agilefant\.org\/assets\/Index-D8-hwuWG\.js\?retry=\d+$/);
  });

  it("tries a few times, then lets the error through for the error page", async () => {
    const load = vi.fn(async () => {
      throw chromeError;
    });
    await expect(importWithRetry(() => Promise.reject(chromeError), load, [0, 0, 0])()).rejects.toBe(chromeError);
    expect(load).toHaveBeenCalledTimes(3);
  });

  it("first fetches again the files the browser cached as something else", async () => {
    const order: string[] = [];
    const repair = vi.fn(async (url: string) => { order.push(`repair ${url}`); });
    const load = vi.fn(async (url: string) => { order.push("load"); return { default: url }; });
    await importWithRetry(() => Promise.reject(chromeError), load, [0, 0], repair)();
    expect(order).toEqual(["repair https://agilefant.org/assets/Index-D8-hwuWG.js", "load"]);
  });

  it("does not look at the cache when nothing fails", async () => {
    const repair = vi.fn(async () => {});
    await importWithRetry(async () => ({ default: "ok" }), vi.fn(), [0], repair)();
    expect(repair).not.toHaveBeenCalled();
  });

  it("does not retry other errors", async () => {
    const load = vi.fn();
    const other = new Error("render failed");
    await expect(importWithRetry(() => Promise.reject(other), load, [0])()).rejects.toBe(other);
    expect(load).not.toHaveBeenCalled();
  });

  it("loads straight away when nothing fails", async () => {
    const load = vi.fn();
    await expect(importWithRetry(async () => ({ default: "ok" }), load)()).resolves.toEqual({ default: "ok" });
    expect(load).not.toHaveBeenCalled();
  });
});
