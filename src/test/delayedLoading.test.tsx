/**
 * Public pages say "Loading…" while a part of the app is still coming, but
 * only after a second, so a quick load never flashes it (2026-11-16).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DelayedLoading } from "@/components/DelayedLoading";

afterEach(() => vi.useRealTimers());

describe("loading a public page", () => {
  it("shows nothing for the first second, then says it is loading", () => {
    vi.useFakeTimers();
    render(<DelayedLoading />);
    expect(screen.queryByRole("status")).toBeNull();
    act(() => vi.advanceTimersByTime(1_000));
    expect(screen.getByRole("status").textContent).toBe("Loading…");
  });

  it("is what every public route shows while it loads", () => {
    const app = readFileSync(join(process.cwd(), "src/App.tsx"), "utf8");
    expect(app).not.toContain("fallback={null}");
    expect(app.match(/fallback=\{<DelayedLoading \/>\}/g)?.length).toBe(8);
  });
});
