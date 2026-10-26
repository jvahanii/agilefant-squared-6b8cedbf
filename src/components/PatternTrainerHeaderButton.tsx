import { Puzzle } from "lucide-react";
import { useOrgStore } from "@/store/orgStore";

/** The trainer is a static page in `public/`, so it opens as its own tab. */
export const PATTERN_TRAINER_URL = "/kuviotreeni.html";

/**
 * "Kuviotreeni" in the app header: practice for number series, letter series
 * and pattern-completion tests. Shown only while the active organization is
 * the one called agilefant, matched on its slug or its name.
 */
export function PatternTrainerHeaderButton() {
  const isAgilefantOrg = useOrgStore((s) => {
    const m = s.memberships.find((x) => x.organization_id === s.activeOrgId);
    if (!m) return false;
    return (
      (m.organization_slug ?? "").trim().toLowerCase() === "agilefant" ||
      (m.organization_name ?? "").trim().toLowerCase() === "agilefant"
    );
  });
  if (!isAgilefantOrg) return null;

  return (
    <a
      className="hidden sm:flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md border bg-background hover:bg-accent transition-colors"
      href={PATTERN_TRAINER_URL}
      target="_blank"
      rel="noopener noreferrer"
      title="Kuviotreeni: practice number series, letter series and pattern completions"
    >
      <Puzzle className="w-3.5 h-3.5 text-primary" />
      <span className="hidden md:inline">Kuviotreeni</span>
    </a>
  );
}
