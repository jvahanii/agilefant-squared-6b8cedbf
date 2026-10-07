import { useState } from "react";
import { Globe, Plus, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";
import {
  CAREER_PAGE_SOURCES,
  careerPageAddress,
  careerPageFor,
  MAX_CAREER_PAGES,
} from "../../supabase/functions/_shared/careerPages";

/**
 * The company career pages a saved job search reads beside the mail.
 *
 * Each page is read by a profile written for that site, so only the pages
 * listed here as readable can be added — anything else is refused with the
 * list, rather than saved and silently never read.
 */
export function CareerPagesEditor({
  queryId,
  pages,
  onChanged,
}: {
  queryId: string;
  pages: string[];
  /** Called after a change has been saved, to load the search again. */
  onChanged: () => void;
}) {
  const [address, setAddress] = useState("");
  const [refused, setRefused] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async (next: string[]) => {
    setSaving(true);
    const { error } = await supabase.from("gmail_import_queries").update({ career_pages: next }).eq("id", queryId);
    setSaving(false);
    if (error) {
      toast({ title: "Could not save the career pages", description: error.message, variant: "destructive" });
      return false;
    }
    onChanged();
    return true;
  };

  const add = async () => {
    const page = careerPageAddress(address);
    if (!page) {
      setRefused(
        `Agilefant cannot read that page yet. It reads: ${CAREER_PAGE_SOURCES.map(
          (s) => `${s.company} (${s.example})`,
        ).join(", ")}.`,
      );
      return;
    }
    if (pages.includes(page)) {
      setRefused("This search already reads that page.");
      return;
    }
    if (pages.length >= MAX_CAREER_PAGES) {
      setRefused(`A search reads at most ${MAX_CAREER_PAGES} career pages.`);
      return;
    }
    setRefused(null);
    if (await save([...pages, page])) setAddress("");
  };

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium">Career pages</p>
      <p className="text-xs text-muted-foreground">
        Company pages listing open positions, read every time this search runs. Positions new since the last run are
        offered beside the jobs from email.
      </p>
      {pages.length > 0 && (
        <ul className="space-y-1">
          {pages.map((page) => (
            <li key={page} className="flex items-center gap-2 text-xs">
              <Globe className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <a href={page} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate underline">
                {careerPageFor(page)?.company ?? "Not readable"} · {page}
              </a>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 w-6 shrink-0 p-0"
                disabled={saving}
                onClick={() => void save(pages.filter((p) => p !== page))}
                aria-label={`Stop reading ${page}`}
                title="Stop reading this page"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-2">
        <Input
          value={address}
          onChange={(e) => {
            setAddress(e.target.value);
            setRefused(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") void add();
          }}
          placeholder={CAREER_PAGE_SOURCES[0]?.example}
          aria-label="Career page address"
          className="h-8 flex-1 text-xs"
        />
        <Button size="sm" variant="outline" className="h-8" onClick={() => void add()} disabled={saving || !address.trim()}>
          <Plus className="mr-1 h-3.5 w-3.5" /> Add page
        </Button>
      </div>
      {refused && (
        <p className="text-xs text-destructive" role="alert">
          {refused}
        </p>
      )}
    </div>
  );
}
