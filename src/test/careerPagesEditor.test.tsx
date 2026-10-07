/**
 * The list of career pages on a saved job search.
 *
 * Pinned here: a page that can be read is saved on the search in a tidy form,
 * one that cannot is refused with the list of those that can — rather than
 * saved and silently never read — and a page can be taken off again.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const updates: { values: Record<string, unknown>; id: unknown }[] = [];
let updateError: { message: string } | null = null;
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      update: (values: Record<string, unknown>) => ({
        eq: (_column: string, id: unknown) => {
          updates.push({ values, id });
          return Promise.resolve({ error: updateError });
        },
      }),
    }),
  },
}));
const toast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({ toast: (...args: unknown[]) => toast(...args) }));

import { CareerPagesEditor } from "@/components/CareerPagesEditor";

const REAKTOR = "https://www.reaktor.com/careers/all-open-positions";

beforeEach(() => {
  updates.length = 0;
  updateError = null;
  toast.mockReset();
});

const type = (text: string) =>
  fireEvent.change(screen.getByLabelText("Career page address"), { target: { value: text } });

describe("CareerPagesEditor", () => {
  it("adds a page it can read, tidied, and asks for the search to be loaded again", async () => {
    const onChanged = vi.fn();
    render(<CareerPagesEditor queryId="q-1" pages={[]} onChanged={onChanged} />);
    type(`${REAKTOR}/?utm_source=x`);
    fireEvent.click(screen.getByRole("button", { name: /Add page/ }));

    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(updates).toEqual([{ values: { career_pages: [REAKTOR] }, id: "q-1" }]);
    expect(screen.getByLabelText("Career page address")).toHaveValue("");
  });

  it("refuses a page it cannot read, naming the ones it can", () => {
    render(<CareerPagesEditor queryId="q-1" pages={[]} onChanged={vi.fn()} />);
    type("https://example.com/careers");
    fireEvent.click(screen.getByRole("button", { name: /Add page/ }));

    expect(screen.getByRole("alert")).toHaveTextContent("cannot read that page yet");
    expect(screen.getByRole("alert")).toHaveTextContent(`Reaktor (${REAKTOR})`);
    expect(updates).toEqual([]);
  });

  it("does not add the same page twice", () => {
    render(<CareerPagesEditor queryId="q-1" pages={[REAKTOR]} onChanged={vi.fn()} />);
    type(REAKTOR);
    fireEvent.click(screen.getByRole("button", { name: /Add page/ }));
    expect(screen.getByRole("alert")).toHaveTextContent("already reads that page");
    expect(updates).toEqual([]);
  });

  it("lists the pages it reads by company, and takes one off", async () => {
    const onChanged = vi.fn();
    render(<CareerPagesEditor queryId="q-1" pages={[REAKTOR]} onChanged={onChanged} />);
    expect(screen.getByRole("link", { name: `Reaktor · ${REAKTOR}` })).toHaveAttribute("href", REAKTOR);

    fireEvent.click(screen.getByRole("button", { name: `Stop reading ${REAKTOR}` }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(updates).toEqual([{ values: { career_pages: [] }, id: "q-1" }]);
  });

  it("says so when the change cannot be saved, and keeps what was typed", async () => {
    updateError = { message: "not allowed" };
    const onChanged = vi.fn();
    render(<CareerPagesEditor queryId="q-1" pages={[]} onChanged={onChanged} />);
    type(REAKTOR);
    fireEvent.click(screen.getByRole("button", { name: /Add page/ }));

    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Could not save the career pages" })));
    expect(onChanged).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Career page address")).toHaveValue(REAKTOR);
  });
});
