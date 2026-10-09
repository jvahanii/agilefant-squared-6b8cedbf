/**
 * The database scrambles names too: what is put into a scrambled list is
 * scrambled by trigger before it is stored, so the real name never reaches
 * the table or the change feed. For that the app's scrambleName() is written
 * out again in SQL (scramble_name), and the two must use the same words —
 * a word added here and not there would give one name two scrambles.
 *
 * That the SQL picks the same word for the same name was checked against a
 * real Postgres when the migration was written; this holds the lists together
 * from then on.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MOOMIN_WORDS } from "@/lib/scramble";

const migration = readFileSync(
  join(process.cwd(), "supabase", "migrations", "20261009160000_scramble_what_enters_a_scrambled_list.sql"),
  "utf8",
);

describe("the database's scramble", () => {
  it("uses the app's words, in the app's order", () => {
    const body = migration.slice(migration.indexOf("FUNCTION public.scramble_name"));
    const list = /_words constant text\[\] := ARRAY\[([^\]]+)\]/.exec(body);
    expect(list).not.toBeNull();
    const words = [...list![1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(words).toEqual([...MOOMIN_WORDS]);
  });

  it("scrambles a new item before it is stored, and only after the rename guard has run", () => {
    // Triggers of one kind run in name order. The guard that keeps a scrambled
    // title would undo a scramble made before it.
    expect(migration).toContain("BEFORE INSERT ON public.work_items");
    const entering = /CREATE TRIGGER (\w+)\s+BEFORE UPDATE ON public\.work_items/.exec(migration);
    expect(entering).not.toBeNull();
    expect(entering![1] > "trg_work_items_block_scrambled_title").toBe(true);
  });
});
