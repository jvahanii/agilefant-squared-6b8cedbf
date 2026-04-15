import { BookOpen, LogIn, UserPlus } from "lucide-react";
import { Link } from "react-router-dom";
import { UserGuideContent } from "@/components/UserGuideDialog";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";

export default function UserGuide() {
  const { user } = useAuth();

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b px-6 py-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <BookOpen className="w-5 h-5 text-primary" />
          <span className="font-semibold text-base">
            Agilefant<sup className="text-primary">2</sup> — User Guide
          </span>
        </div>
        {!user && (
          <Link
            to="/auth"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Sign in →
          </Link>
        )}
      </header>

      {!user && (
        <div className="bg-primary/5 border-b px-6 py-4">
          <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <p className="font-medium text-sm">Get started with Agilefant<sup className="text-primary">2</sup></p>
              <p className="text-sm text-muted-foreground mt-0.5">
                Sign in to your existing account or create a free account to start managing your projects.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button asChild variant="outline" size="sm">
                <Link to="/auth">
                  <LogIn className="w-4 h-4 mr-1.5" />
                  Sign In
                </Link>
              </Button>
              <Button asChild size="sm">
                <Link to="/auth?tab=signup">
                  <UserPlus className="w-4 h-4 mr-1.5" />
                  Sign Up Free
                </Link>
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-1 min-h-0 max-w-4xl w-full mx-auto border-x">
        <UserGuideContent />
      </div>
    </div>
  );
}
