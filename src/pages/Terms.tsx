import { FileText } from "lucide-react";
import { Link } from "react-router-dom";
import { TermsContent } from "@/components/TermsContent";

/** The terms and privacy notice, readable before signing up. Public, like the user guide. */
export default function Terms() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b px-4 sm:px-6 py-4 flex items-center justify-between shrink-0">
        <Link to="/" className="flex items-center gap-2">
          <FileText className="w-5 h-5 text-primary" />
          <span className="font-semibold text-base">
            Agilefant<sup className="text-primary">2</sup> — Terms and privacy
          </span>
        </Link>
        <Link to="/auth" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
          Sign in →
        </Link>
      </header>
      <main className="max-w-3xl w-full mx-auto px-4 sm:px-6 py-6 text-sm text-muted-foreground">
        <h1 className="mb-4 text-xl font-semibold text-foreground">Terms of Service</h1>
        <TermsContent />
      </main>
    </div>
  );
}
