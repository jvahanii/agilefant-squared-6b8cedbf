import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { MailX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

type State = "ready" | "working" | "done" | "failed";

/**
 * Where the link in the day-after-sign-up email leads. It asks before
 * unsubscribing, so a mail scanner that opens every link does not unsubscribe
 * anyone. Public: the link carries its own signature, not a sign-in.
 */
export default function Unsubscribe() {
  const [params] = useSearchParams();
  const u = params.get("u");
  const s = params.get("s");
  const [state, setState] = useState<State>(u && s ? "ready" : "failed");
  const [message, setMessage] = useState(u && s ? "" : "This unsubscribe link is incomplete. Copy the whole link from the email.");

  const unsubscribe = async () => {
    setState("working");
    const { error } = await supabase.functions.invoke("onboarding-reminder", { body: { unsubscribe: { u, s } } });
    if (error) {
      let text = "Could not unsubscribe. Please try again.";
      try {
        const body = await (error as { context?: Response }).context?.json();
        if (body?.error) text = body.error;
      } catch {
        // Keep the general message.
      }
      setMessage(text);
      setState("failed");
      return;
    }
    setState("done");
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <main className="w-full max-w-md space-y-4 text-center">
        <MailX className="w-10 h-10 mx-auto text-muted-foreground/60" aria-hidden="true" />
        {state === "done" ? (
          <>
            <h1 className="text-xl font-semibold">You're unsubscribed</h1>
            <p className="text-sm text-muted-foreground">Agilefant won't send you emails like this again.</p>
          </>
        ) : (
          <>
            <h1 className="text-xl font-semibold">Unsubscribe from Agilefant emails?</h1>
            <p className="text-sm text-muted-foreground">
              This stops the getting-started email and any like it. Sign-in emails still arrive.
            </p>
            {state === "failed" && message ? (
              <p role="alert" className="text-sm text-destructive">
                {message}
              </p>
            ) : null}
            {u && s ? (
              <Button onClick={unsubscribe} disabled={state === "working"}>
                {state === "working" ? "Unsubscribing…" : "Unsubscribe"}
              </Button>
            ) : null}
          </>
        )}
        <p className="text-sm">
          <Link to="/" className="text-primary underline underline-offset-2">
            Go to Agilefant
          </Link>
        </p>
      </main>
    </div>
  );
}
