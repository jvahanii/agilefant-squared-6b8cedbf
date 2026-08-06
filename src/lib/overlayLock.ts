/**
 * Radix overlays (Dialog / ContextMenu / Popover) disable pointer events on
 * `document.body` while a modal layer is open and restore them on close.  When
 * two layers overlap in time — e.g. a context menu closing while the dialog it
 * opened is mounting, which is exactly what happens when a work-item dialog is
 * launched from a right-click menu — the restore can run in the wrong order and
 * leave `body { pointer-events: none }` behind.  The UI then looks frozen
 * ("hangs") until some unrelated re-render clears it.
 *
 * `releaseOverlayLock()` clears that stray lock once no Radix modal layer is
 * left in the DOM.  It is safe to call unconditionally after closing a dialog.
 */
export function releaseOverlayLock(): void {
  if (typeof document === "undefined") return;

  const clear = () => {
    const stillOpen = document.querySelector(
      '[data-radix-popper-content-wrapper], [role="dialog"][data-state="open"], [data-state="open"][data-radix-menu-content]',
    );
    if (stillOpen) return;
    if (document.body.style.pointerEvents === "none") {
      document.body.style.removeProperty("pointer-events");
    }
  };

  // Two frames: one after Radix' own cleanup, one after any exit animation.
  requestAnimationFrame(clear);
  setTimeout(clear, 350);
}
