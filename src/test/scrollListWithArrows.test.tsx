/**
 * Up and down scroll a marked list from anywhere around it — except where the
 * arrows already mean something.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { scrollListWithArrows } from "@/lib/scrollListWithArrows";

const setup = () => {
  render(
    <div onKeyDown={scrollListWithArrows}>
      <input aria-label="filter" />
      <select aria-label="backlog"><option>a</option></select>
      <div role="listbox" aria-label="menu"><div tabIndex={0}>option</div></div>
      <div data-scroll-with-arrows>
        <button>row</button>
      </div>
    </div>,
  );
  const list = document.querySelector("[data-scroll-with-arrows]") as HTMLElement;
  list.scrollBy = vi.fn() as never;
  return list.scrollBy as unknown as ReturnType<typeof vi.fn>;
};

describe("scrollListWithArrows", () => {
  it("scrolls down and up a row at a time from a row or the filter", () => {
    const scrollBy = setup();
    fireEvent.keyDown(screen.getByText("row"), { key: "ArrowDown" });
    fireEvent.keyDown(screen.getByLabelText("filter"), { key: "ArrowUp" });
    expect(scrollBy.mock.calls).toEqual([[{ top: 48 }], [{ top: -48 }]]);
  });

  it("leaves the arrows to a dropdown and an open listbox", () => {
    const scrollBy = setup();
    fireEvent.keyDown(screen.getByLabelText("backlog"), { key: "ArrowDown" });
    fireEvent.keyDown(screen.getByText("option"), { key: "ArrowDown" });
    expect(scrollBy).not.toHaveBeenCalled();
  });

  it("ignores other keys and arrows held with a modifier", () => {
    const scrollBy = setup();
    fireEvent.keyDown(screen.getByText("row"), { key: "Enter" });
    fireEvent.keyDown(screen.getByText("row"), { key: "ArrowDown", shiftKey: true });
    expect(scrollBy).not.toHaveBeenCalled();
  });
});
