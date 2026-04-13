import { BookOpen } from "lucide-react";
import { Link } from "react-router-dom";
import { UserGuideContent } from "@/components/UserGuideDialog";

export default function UserGuide() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b px-6 py-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <BookOpen className="w-5 h-5 text-primary" />
          <span className="font-semibold text-base">
            Agilefant<sup className="text-primary">2</sup> — User Guide
          </span>
        </div>
        <Link
          to="/auth"
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          Sign in →
        </Link>
      </header>
      <div className="flex flex-1 min-h-0 max-w-4xl w-full mx-auto border-x">
        <UserGuideContent />
      </div>
    </div>
  );
}
