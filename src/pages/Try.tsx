import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, IndentDecrease, IndentIncrease, Plus, Redo2, Trash2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { itemLines } from "@/components/listPanel/itemLines";
import { useWebAnalytics } from "@/lib/webAnalytics";
import {
  addTitles,
  exampleItems,
  indent,
  loadTryList,
  MAX_TRY_ITEMS,
  outdent,
  remove,
  saveTryList,
  statusOf,
  toggleDone,
  type TryItem,
} from "@/lib/tryList";
import type { WorkItemStatus } from "@/types/models";

/**
 * /try: a working list for a visitor without an account (2026-11-16). The
 * front page showed a picture of the app; this lets someone use the part
 * every account starts with (adding, nesting, marking done, undo) before
 * deciding to sign up. The list stays in this browser (src/lib/tryList.ts)
 * and moves into the new account's first list after sign-up.
 *
 * Tab and Shift+Tab nest, double-click marks done, Delete deletes with
 * sub-items, Ctrl+Z and Ctrl+Y undo and redo, as in the app. Space also marks
 * done here, since the dot is not in the Tab order.
 */

const DOT: Record<WorkItemStatus, string> = {
  not_started: "var(--status-not-started)",
  in_progress: "var(--status-in-progress)",
  pending: "var(--status-pending)",
  blocked: "var(--status-blocked)",
  done: "var(--status-done)",
};
const HISTORY = 50;

function Logo() {
  return (
    <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight">
      <img src="/agilefant-shield.png" alt="" width={32} height={32} className="h-8 w-8 object-contain" />
      <span>
        Agilefant<sup className="text-primary">2</sup>
      </span>
    </Link>
  );
}

export default function Try() {
  useWebAnalytics();
  const [saved] = useState(() => loadTryList());
  const [items, setItems] = useState<TryItem[]>(() => saved ?? exampleItems());
  // The examples are not stored until the visitor changes something.
  const changed = useRef(saved !== null);
  const [past, setPast] = useState<TryItem[][]>([]);
  const [future, setFuture] = useState<TryItem[][]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [text, setText] = useState("");
  const treeRef = useRef<HTMLUListElement>(null);

  const selected = items.findIndex((it) => it.id === selectedId);

  useEffect(() => {
    if (changed.current) saveTryList(items);
  }, [items]);

  const change = (next: TryItem[]) => {
    if (next === items) return;
    changed.current = true;
    setPast((p) => [...p.slice(-(HISTORY - 1)), items]);
    setFuture([]);
    setItems(next);
  };
  const undo = () => {
    if (past.length === 0) return;
    changed.current = true;
    setFuture((f) => [items, ...f]);
    setItems(past[past.length - 1]);
    setPast((p) => p.slice(0, -1));
  };
  const redo = () => {
    if (future.length === 0) return;
    changed.current = true;
    setPast((p) => [...p, items]);
    setItems(future[0]);
    setFuture((f) => f.slice(1));
  };
  const removeAt = (i: number) => {
    const next = remove(items, i);
    change(next);
    setSelectedId(next[Math.min(i, next.length - 1)]?.id ?? null);
  };

  const lines = itemLines(text);
  const room = MAX_TRY_ITEMS - items.length;
  const add = () => {
    if (lines.length === 0 || room <= 0) return;
    change(addTitles(items, lines));
    setText("");
  };

  const onTreeKey = (e: KeyboardEvent<HTMLUListElement>) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "z" && !e.shiftKey) {
      e.preventDefault();
      undo();
      return;
    }
    if (mod && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))) {
      e.preventDefault();
      redo();
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (items.length === 0) return;
      const step = e.key === "ArrowDown" ? 1 : -1;
      const next = selected === -1 ? (step === 1 ? 0 : items.length - 1) : Math.min(Math.max(selected + step, 0), items.length - 1);
      setSelectedId(items[next].id);
      return;
    }
    if (selected === -1) return;
    if (e.key === "Tab") {
      // Only while an item is selected; Escape lets Tab move on again.
      e.preventDefault();
      change(e.shiftKey ? outdent(items, selected) : indent(items, selected));
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      removeAt(selected);
    } else if (e.key === " ") {
      e.preventDefault();
      change(toggleDone(items, selected));
    } else if (e.key === "Escape") {
      setSelectedId(null);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <Logo />
          <nav className="flex items-center gap-1 text-sm sm:gap-2">
            <Link to="/auth" className="whitespace-nowrap rounded-md px-2 py-1.5 font-medium hover:bg-muted sm:px-3">
              Sign in
            </Link>
            {/* Short on the narrowest phones, where the full label wrapped. */}
            <Link
              to="/auth/sign-up"
              aria-label="Sign up to keep it"
              className="whitespace-nowrap rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground hover:bg-primary/90"
            >
              <span className="min-[400px]:hidden">Sign up</span>
              <span className="hidden min-[400px]:inline">Sign up to keep it</span>
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-8 px-4 py-8 sm:py-12 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section aria-labelledby="try-heading" className="min-w-0 space-y-4">
          <div className="space-y-2">
            <h1 id="try-heading" className="text-2xl font-bold tracking-tight sm:text-3xl">
              Try it, no account needed
            </h1>
            <p className="max-w-2xl text-muted-foreground">
              This list is yours to change. It stays in this browser and is not sent anywhere. Sign up, and it moves
              into your new account.
            </p>
          </div>

          <div className="rounded-lg border bg-card shadow-sm">
            <div className="flex items-center gap-1 border-b px-2 py-1.5">
              <span className="px-2 text-sm font-semibold">My work › Now</span>
              <span className="ml-auto" />
              <Button variant="ghost" size="sm" onClick={undo} disabled={past.length === 0} aria-label="Undo">
                <Undo2 className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="sm" onClick={redo} disabled={future.length === 0} aria-label="Redo">
                <Redo2 className="h-4 w-4" />
              </Button>
            </div>

            {items.length === 0 ? (
              <div className="space-y-2 px-4 py-8 text-center text-sm text-muted-foreground">
                <p>The list is empty. Add something below.</p>
                <Button variant="link" size="sm" onClick={() => change(exampleItems())}>
                  Put the examples back
                </Button>
              </div>
            ) : (
              <ul
                ref={treeRef}
                role="tree"
                aria-label="Your list"
                aria-activedescendant={selected === -1 ? undefined : `try-row-${items[selected].id}`}
                tabIndex={0}
                onKeyDown={onTreeKey}
                className="py-1 outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {items.map((it, i) => {
                  const status = statusOf(items, i);
                  const isSelected = i === selected;
                  return (
                    <li
                      key={it.id}
                      id={`try-row-${it.id}`}
                      role="treeitem"
                      aria-level={it.depth + 1}
                      aria-selected={isSelected}
                      onClick={() => {
                        setSelectedId(it.id);
                        treeRef.current?.focus();
                      }}
                      onDoubleClick={() => change(toggleDone(items, i))}
                      className={`flex min-h-10 cursor-default select-none items-center gap-2 pr-2 text-sm ${
                        isSelected ? "bg-primary/10" : "hover:bg-muted/60"
                      }`}
                      style={{ paddingLeft: `${0.75 + it.depth * 1.5}rem` }}
                    >
                      <button
                        type="button"
                        tabIndex={-1}
                        aria-label={it.done ? `Mark "${it.title}" not done` : `Mark "${it.title}" done`}
                        onClick={(e) => {
                          e.stopPropagation();
                          change(toggleDone(items, i));
                        }}
                        onDoubleClick={(e) => e.stopPropagation()}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full hover:bg-muted"
                      >
                        <span className="h-3 w-3 rounded-full" style={{ backgroundColor: DOT[status] }} />
                      </button>
                      <span className={`min-w-0 flex-1 break-words ${it.done ? "text-muted-foreground line-through" : ""}`}>
                        {it.title}
                      </span>
                      {isSelected && (
                        <span className="flex shrink-0 items-center" onDoubleClick={(e) => e.stopPropagation()}>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            tabIndex={-1}
                            aria-label="Take out one level (Shift+Tab)"
                            disabled={it.depth === 0}
                            onClick={(e) => {
                              e.stopPropagation();
                              change(outdent(items, i));
                            }}
                          >
                            <IndentDecrease className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            tabIndex={-1}
                            aria-label="Put under the item above (Tab)"
                            disabled={i === 0 || items[i - 1].depth < it.depth}
                            onClick={(e) => {
                              e.stopPropagation();
                              change(indent(items, i));
                            }}
                          >
                            <IndentIncrease className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            tabIndex={-1}
                            aria-label="Delete, with what is under it (Delete)"
                            onClick={(e) => {
                              e.stopPropagation();
                              removeAt(i);
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

            <form
              className="flex items-start gap-2 border-t p-2"
              onSubmit={(e) => {
                e.preventDefault();
                add();
              }}
            >
              <Textarea
                aria-label="New item"
                aria-describedby="try-add-hint"
                placeholder="Add an item, or paste a list"
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    add();
                  }
                }}
                rows={Math.min(Math.max(text.split("\n").length, 1), 6)}
                className="min-h-0 resize-none"
                autoComplete="off"
                disabled={room <= 0}
              />
              <Button type="submit" disabled={lines.length === 0 || room <= 0} className="shrink-0">
                <Plus className="mr-1 h-4 w-4" />
                {lines.length > 1 ? `Add ${Math.min(lines.length, room)}` : "Add"}
              </Button>
            </form>
            <p id="try-add-hint" className="px-3 pb-2 text-xs text-muted-foreground">
              {room <= 0
                ? `That's ${MAX_TRY_ITEMS} items, as many as the try-out holds. Sign up for as many as you like.`
                : "Enter adds. Pasting several lines adds one item per line."}
            </p>
          </div>
        </section>

        <aside className="space-y-6 text-sm">
          <section aria-labelledby="try-tips" className="space-y-2">
            <h2 id="try-tips" className="font-semibold">
              Things to try
            </h2>
            <ul className="list-disc space-y-1.5 pl-5 text-muted-foreground">
              <li>
                Click an item and press <kbd className="rounded border px-1">Tab</kbd> to put it under the item above;{" "}
                <kbd className="rounded border px-1">Shift</kbd>+<kbd className="rounded border px-1">Tab</kbd> takes it
                back out. The buttons on the item do the same.
              </li>
              <li>
                Double-click an item, or click its dot, to mark it done. When part of an item is done, its dot turns
                orange.
              </li>
              <li>Paste a list into the box: each line becomes an item.</li>
              <li>
                <kbd className="rounded border px-1">Ctrl</kbd>+<kbd className="rounded border px-1">Z</kbd> undoes,{" "}
                <kbd className="rounded border px-1">Ctrl</kbd>+<kbd className="rounded border px-1">Y</kbd> redoes.
              </li>
            </ul>
          </section>

          <section aria-labelledby="try-keep" className="space-y-3 rounded-lg border bg-muted/40 p-4">
            <h2 id="try-keep" className="font-semibold">
              Keep this list
            </h2>
            <p className="text-muted-foreground">
              Sign up free and{" "}
              {items.length === 0
                ? "start your own list"
                : items.length === 1
                  ? "this item is waiting"
                  : `these ${items.length} items are waiting`}{" "}
              in
              your new account. There you can also drag items into order, put lists inside lists, and switch on boards,
              story points, deadlines and time logging.
            </p>
            <Link
              to="/auth/sign-up"
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground shadow-sm hover:bg-primary/90"
            >
              Sign up to keep it <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </section>
        </aside>
      </main>
    </div>
  );
}
