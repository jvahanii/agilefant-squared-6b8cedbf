/**
 * The terms promise how long data is kept; apply_retention() in the database
 * is what keeps the promise. Read from the migration, so a period changed in
 * one place and not the other fails here.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { RETENTION, SERVICES, TermsContent } from "@/components/TermsContent";
import Terms from "@/pages/Terms";

const migration = readFileSync(
  join(process.cwd(), "supabase", "migrations", "20261112120000_account_deletion_and_retention.sql"),
  "utf8",
);
const retention = migration.slice(migration.indexOf("FUNCTION public.apply_retention"), migration.indexOf("FUNCTION public.delete_my_account"));

/** The period the function deletes the given table's rows after. */
function deletedAfter(table: string): string | null {
  const m = new RegExp(`DELETE FROM ${table}[\\s\\S]*?interval '(\\d+ days)'`).exec(retention);
  return m ? m[1] : null;
}
const promised = (what: string) => RETENTION.find((r) => r.what.startsWith(what))?.kept ?? "";

describe("what the terms promise about keeping data", () => {
  it("matches what the database deletes, and when", () => {
    expect(deletedAfter("change_log")).toBe("90 days");
    expect(promised("Change history")).toBe("90 days");

    expect(deletedAfter("deleted_work_items")).toBe("7 days");
    expect(promised("Deleted items")).toBe("7 days");

    expect(deletedAfter("organization_backups")).toBe("14 days");
    expect(promised("Backups")).toMatch(/^14 days/);
    expect(promised("A deleted organisation")).toBe("14 days after deletion");
  });

  it("is run every day", () => {
    expect(migration).toMatch(/cron\.schedule\('apply-retention', '\d+ \d+ \* \* \*', 'SELECT public\.apply_retention\(\)'\)/);
  });
});

describe("the terms", () => {
  it("name every outside service and every period, and how to complain", () => {
    render(<TermsContent />);
    for (const s of SERVICES) expect(screen.getByText(s.name)).toBeInTheDocument();
    for (const r of RETENTION) expect(screen.getAllByText(`${r.what}:`).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "tietosuoja.fi" })).toHaveAttribute("href", "https://tietosuoja.fi/en");
    expect(screen.getAllByText(/Delete account/).length).toBeGreaterThan(0);
  });

  it("can be read without signing in, at /terms", () => {
    render(
      <MemoryRouter>
        <Terms />
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { name: "Terms of Service" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Privacy" })).toBeInTheDocument();
  });
});
