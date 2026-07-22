// Focus an input/textarea for editing.
// On desktop, select all so typing replaces the value.
// On mobile, place caret at the end so the current value is preserved and easy to append to.
export function focusForEdit(
  el: HTMLInputElement | HTMLTextAreaElement | null | undefined,
  isMobile: boolean,
) {
  if (!el) return;
  el.focus();
  if (isMobile) {
    const len = el.value.length;
    try {
      el.setSelectionRange(len, len);
    } catch {
      // Some input types don't support selection range; ignore.
    }
  } else {
    el.select();
  }
}
