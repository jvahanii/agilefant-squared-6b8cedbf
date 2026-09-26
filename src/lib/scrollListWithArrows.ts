import type { KeyboardEvent } from "react";

/** How far one press moves the list: about a row. */
export const ARROW_SCROLL_PX = 48;

/**
 * Up and down arrows scroll the list marked `data-scroll-with-arrows` inside
 * the element the handler is on.
 *
 * In the job picker dialog focus sits on a checkbox, the keyword filter or the
 * dialog itself — never on the list, which is its own scrolling box — so the
 * arrows went nowhere. Handled on the dialog, they reach the list wherever focus
 * is. Anything that uses the arrows itself keeps them: a dropdown, an open menu
 * or listbox, a text area; a single-line field has no use for up and down.
 */
export function scrollListWithArrows(e: KeyboardEvent<HTMLElement>): void {
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
  if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
  const target = e.target as HTMLElement;
  if (
    target.isContentEditable ||
    target.closest("select, textarea, [role='listbox'], [role='menu'], [role='combobox'], [role='radiogroup']")
  ) {
    return;
  }
  const list = e.currentTarget.querySelector<HTMLElement>("[data-scroll-with-arrows]");
  if (!list) return;
  e.preventDefault();
  list.scrollBy({ top: e.key === "ArrowDown" ? ARROW_SCROLL_PX : -ARROW_SCROLL_PX });
}
