import { useEffect, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";

interface PopoutWindowProps {
  /** The React element to render inside the new window. */
  content: React.ReactElement;
  title?: string;
  /** Called when the new window is closed (by the user or programmatically). */
  onClose: () => void;
  windowFeatures?: string;
}

/**
 * Opens a new browser window and renders `content` into it via a fresh React
 * root.  Because Zustand stores are module-level singletons the new root shares
 * live store data with the parent window automatically, so `content` only needs
 * to be rendered once – subsequent store-driven updates are handled inside the
 * popout's own React tree without re-passing props.  Stylesheets and the
 * dark-mode class are copied from the parent document so the UI looks correct.
 *
 * `title` and `windowFeatures` are intentionally applied only on mount.
 * Changing them after the window opens has no effect (the window is already
 * open and the props are stable in all current call sites).
 *
 * Returns null (renders nothing in the parent DOM).
 */
export function PopoutWindow({
  content,
  title = "Chart",
  onClose,
  windowFeatures = "width=960,height=640,resizable=yes,scrollbars=yes",
}: PopoutWindowProps) {
  const winRef = useRef<Window | null>(null);
  const rootRef = useRef<Root | null>(null);
  // Keep a stable ref so the beforeunload handler always calls the latest callback.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const win = window.open("", "_blank", windowFeatures);
    if (!win) {
      // Popup was blocked – revert immediately.
      onCloseRef.current();
      return;
    }
    winRef.current = win;
    win.document.title = title;

    // ── Copy stylesheets from the parent document ────────────────────────────
    // <link rel="stylesheet"> elements (production bundles + dev imports)
    document.querySelectorAll('link[rel="stylesheet"]').forEach((node) => {
      const src = node as HTMLLinkElement;
      const el = win.document.createElement("link");
      el.rel = "stylesheet";
      el.href = src.href;
      win.document.head.appendChild(el);
    });
    // <style> elements (Vite dev-mode injection + CSS-in-JS)
    document.querySelectorAll("style").forEach((node) => {
      win.document.head.appendChild(node.cloneNode(true) as Node);
    });

    // ── Sync dark / light mode ───────────────────────────────────────────────
    win.document.documentElement.className = document.documentElement.className;
    win.document.body.style.margin = "0";
    win.document.body.style.padding = "16px";

    // Watch for theme class changes in the parent and mirror them.
    const themeObserver = new MutationObserver(() => {
      if (winRef.current && !winRef.current.closed) {
        winRef.current.document.documentElement.className =
          document.documentElement.className;
      }
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    // ── Mount React root ─────────────────────────────────────────────────────
    const container = win.document.createElement("div");
    win.document.body.appendChild(container);
    const root = createRoot(container);
    rootRef.current = root;
    root.render(content);

    // ── Cleanup when the new window is closed by the user ───────────────────
    const handleBeforeUnload = () => {
      rootRef.current?.unmount();
      rootRef.current = null;
      winRef.current = null;
      themeObserver.disconnect();
      onCloseRef.current();
    };
    win.addEventListener("beforeunload", handleBeforeUnload);

    // ── Cleanup when this component unmounts (e.g. parent navigates away) ───
    return () => {
      themeObserver.disconnect();
      win.removeEventListener("beforeunload", handleBeforeUnload);
      rootRef.current?.unmount();
      rootRef.current = null;
      if (!win.closed) win.close();
      winRef.current = null;
    };
    // Intentionally run only once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
