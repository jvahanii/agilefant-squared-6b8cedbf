/**
 * What a start costs, and what holds edits back while an old copy is shown.
 *
 * - The server hands rows out a thousand at a time. They were read a page
 *   after a page; they are now read side by side once the first page has said
 *   how many there are.
 * - While the app shows a copy kept from an earlier visit, old enough that it
 *   must not be edited, taps and keys do not reach it — but a finger still
 *   scrolls the page.
 * - A dialog nobody has opened must not bring its code along at start-up.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { loadPagesSideBySide } from "@/store/supabaseSync";
import { CatchingUpGuard } from "@/components/CatchingUpGuard";
import { useAppStore } from "@/store/appStore";

describe("reading every row of a long table", () => {
  const rows = (from: number, to: number, total: number) =>
    Array.from({ length: Math.max(0, Math.min(to, total - 1) - from + 1) }, (_, i) => ({ id: from + i }));

  /** A table of `total` rows, answering each page after `delay` and noting the order of the asking. */
  function table(total: number, withCount = true) {
    const asked: string[] = [];
    let inFlight = 0;
    let mostAtOnce = 0;
    const page = async (from: number, to: number, counted: boolean) => {
      asked.push(`${from}-${to}${counted ? " counted" : ""}`);
      inFlight += 1;
      mostAtOnce = Math.max(mostAtOnce, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      return { data: rows(from, to, total), error: null, count: counted && withCount ? total : null };
    };
    return { page, asked, mostAtOnce: () => mostAtOnce };
  }

  it("asks the first page how many there are, and fetches the rest side by side", async () => {
    const t = table(3396);
    const res = await loadPagesSideBySide(t.page);
    expect(res.error).toBeNull();
    expect(res.data).toHaveLength(3396);
    expect(res.data!.map((r) => r.id)).toEqual(Array.from({ length: 3396 }, (_, i) => i));
    expect(t.asked).toEqual(["0-999 counted", "1000-1999", "2000-2999", "3000-3999"]);
    // Three at once, where it used to be one after another.
    expect(t.mostAtOnce()).toBe(3);
  });

  it("makes one request for a table that fits a page", async () => {
    const t = table(412);
    const res = await loadPagesSideBySide(t.page);
    expect(res.data).toHaveLength(412);
    expect(t.asked).toEqual(["0-999 counted"]);
  });

  it("asks once more after a single full page, as it always did", async () => {
    const t = table(1000);
    const res = await loadPagesSideBySide(t.page);
    expect(res.data).toHaveLength(1000);
    // One more is asked, as it always was: a full page may have more behind it.
    expect(t.asked).toEqual(["0-999 counted", "1000-1999"]);
  });

  it("reads page after page where no total comes back", async () => {
    const t = table(2300, false);
    const res = await loadPagesSideBySide(t.page);
    expect(res.data).toHaveLength(2300);
    expect(t.asked).toEqual(["0-999 counted", "1000-1999", "2000-2999"]);
    expect(t.mostAtOnce()).toBe(1);
  });

  it("follows a table that grew while it was being read", async () => {
    // The first page said 2000; by the time the second was read there were 2500.
    const asked: string[] = [];
    const res = await loadPagesSideBySide(async (from, to, counted) => {
      asked.push(`${from}-${to}`);
      return { data: rows(from, to, 2500), error: null, count: counted ? 2000 : null };
    });
    expect(res.data).toHaveLength(2500);
    expect(asked).toEqual(["0-999", "1000-1999", "2000-2999"]);
  });

  it("gives up whole when a page fails, rather than handing back part of the table", async () => {
    const res = await loadPagesSideBySide(async (from, to, counted) =>
      from === 2000
        ? { data: null, error: { message: "timeout" } }
        : { data: rows(from, to, 3396), error: null, count: counted ? 3396 : null },
    );
    expect(res.data).toBeNull();
    expect(res.error).toEqual({ message: "timeout" });
  });
});

describe("while an old copy is shown", () => {
  beforeEach(() => {
    useAppStore.setState({ catchingUp: false });
  });

  const page = (onClick: () => void, onKeyDown: () => void, onTouchStart: () => void) =>
    render(
      <div>
        <button onClick={onClick} onKeyDown={onKeyDown} onTouchStart={onTouchStart} onDoubleClick={onClick} onContextMenu={onClick}>
          Mark done
        </button>
        <CatchingUpGuard />
      </div>,
    );

  it("holds taps and keys back, and says it is updating", () => {
    const onClick = vi.fn();
    const onKeyDown = vi.fn();
    page(onClick, onKeyDown, vi.fn());
    act(() => useAppStore.setState({ catchingUp: true }));

    expect(screen.getByRole("status")).toHaveTextContent("Updating…");
    const button = screen.getByText("Mark done");
    fireEvent.click(button);
    fireEvent.doubleClick(button);
    fireEvent.contextMenu(button);
    fireEvent.keyDown(button, { key: "Enter" });
    expect(onClick).not.toHaveBeenCalled();
    expect(onKeyDown).not.toHaveBeenCalled();
  });

  it("keeps a touch from the app but leaves it to the browser, so the page still scrolls", () => {
    const onTouchStart = vi.fn();
    page(vi.fn(), vi.fn(), onTouchStart);
    act(() => useAppStore.setState({ catchingUp: true }));

    const touch = new Event("touchstart", { bubbles: true, cancelable: true });
    screen.getByText("Mark done").dispatchEvent(touch);
    expect(onTouchStart).not.toHaveBeenCalled();
    // Not cancelled: cancelling a touch is what would stop the scroll.
    expect(touch.defaultPrevented).toBe(false);

    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    screen.getByText("Mark done").dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
  });

  it("lets everything through again once the fresh data has landed", () => {
    const onClick = vi.fn();
    page(onClick, vi.fn(), vi.fn());
    act(() => useAppStore.setState({ catchingUp: true }));
    fireEvent.click(screen.getByText("Mark done"));
    expect(onClick).not.toHaveBeenCalled();

    act(() => useAppStore.setState({ catchingUp: false }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Mark done"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("is nothing at all otherwise", () => {
    const onClick = vi.fn();
    page(onClick, vi.fn(), vi.fn());
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Mark done"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe("what a start does not fetch", () => {
  const source = (file: string) => readFileSync(join(process.cwd(), "src", "components", file), "utf8").replace(/\s+/g, " ");

  it("leaves the burnup chart, and the charting library with it, until a chart is asked for", () => {
    const layout = source("AppLayout.tsx");
    const host = layout.slice(layout.indexOf("function BurnupDialogHost()"), layout.indexOf("function AppLayoutInner()"));
    // Rendered closed it still fetched its chunk; it must not be rendered at all.
    expect(host).toContain("if (!scope) return null;");
    expect(host.indexOf("if (!scope) return null;")).toBeLessThan(host.indexOf("<BurnupChartDialog"));
    expect(layout).toContain('const BurnupChartDialog = lazy(() => import("@/components/BurnupChartDialog")');
  });

  it("leaves the job-ad picker until a search is run", () => {
    const button = source("JobSearchRunButton.tsx");
    expect(button).not.toContain('import { SavedSearchPicker } from "@/components/SavedSearchPicker"');
    expect(button).toContain('const SavedSearchPicker = lazy(() => import("@/components/SavedSearchPicker")');
  });
});
