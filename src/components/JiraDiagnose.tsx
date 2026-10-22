import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Loader2, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

/** Owners and admins describe a slow or failed sync; Lovable AI names the cause and the fix. */
export function JiraDiagnose({ organizationId }: { organizationId: string }) {
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    setAnswer(null);
    try {
      const { data, error: err } = await supabase.functions.invoke("jira-diagnose", { body: { organizationId, details } });
      if (err) {
        const ctx = (err as { context?: Response }).context;
        const body = ctx ? await ctx.json().catch(() => null) : null;
        throw new Error(body?.error ?? err.message);
      }
      setAnswer(String(data?.diagnosis ?? ""));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2 border-t pt-3">
      <Label htmlFor="jira-diagnose">Diagnose a sync problem (AI-powered)</Label>
      <Textarea
        id="jira-diagnose"
        value={details}
        onChange={(e) => setDetails(e.target.value)}
        placeholder="Esim. INT-42 muutettu Jirassa klo 11.40, näkyi Agilefantissa vasta 11.48. Liitä virheilmoitus, jos sellainen tuli."
        rows={3}
        maxLength={8000}
      />
      <Button size="sm" variant="outline" onClick={run} disabled={busy || !details.trim()}>
        {busy ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 mr-1" />}
        Diagnose
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {answer && <div className="text-sm whitespace-pre-wrap rounded-md bg-muted p-3">{answer}</div>}
    </div>
  );
}
