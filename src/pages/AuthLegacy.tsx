import { useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { supabaseAuth } from "@/integrations/supabase/authClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Info } from "lucide-react";
import { toast } from "@/hooks/use-toast";

export default function AuthLegacy() {
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">

      <div className="w-full max-w-md space-y-4">
        <div
          role="status"
          className="flex items-start gap-3 rounded-md border bg-muted/60 px-4 py-3 text-sm"
        >
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <p>
            This is the previous sign-in, and it is going away. Please use the{" "}
            <Link to="/auth" className="underline underline-offset-4 hover:text-foreground">
              new sign-in page
            </Link>{" "}
            instead — the same email address carries your account over. This page is only here in
            case that one does not work for you.
          </p>
        </div>
      <Card className="w-full">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">
            Agilefant<sup className="text-primary">2</sup>
          </CardTitle>
          <CardDescription>Sign in with your existing Agilefant password</CardDescription>
        </CardHeader>
        <CardContent>
          <LoginForm loading={loading} setLoading={setLoading} email={email} setEmail={setEmail} />
          <div className="mt-4">
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 text-muted-foreground">Or</span>
              </div>
            </div>
            <Button
              variant="outline"
              className="w-full mt-4"
              disabled={loading}
              onClick={async () => {
                setLoading(true);
                const { error } = await supabaseAuth.auth.signInWithOAuth({
                  provider: "google",
                  options: { redirectTo: window.location.origin },
                });
                if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
                setLoading(false);
              }}
            >
              Continue with Google
            </Button>
          </div>
          <p className="mt-4 text-center text-xs text-muted-foreground space-x-3">
            <Link to="/auth" className="hover:text-foreground underline underline-offset-4 transition-colors">
              Use the new sign-in
            </Link>
            <Link to="/user-guide" className="hover:text-foreground underline underline-offset-4 transition-colors">
              View User Guide
            </Link>
          </p>
        </CardContent>
      </Card>
      </div>
    </div>
  );
}

function LoginForm({
  loading,
  setLoading,
  email,
  setEmail,
}: {
  loading: boolean;
  setLoading: (v: boolean) => void;
  email: string;
  setEmail: (v: string) => void;
}) {
  const [password, setPassword] = useState("");

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabaseAuth.auth.signInWithPassword({ email, password });
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    setLoading(false);
  };

  return (
    <form onSubmit={handleLogin} className="space-y-4 mt-4">
      <div className="space-y-2">
        <Label htmlFor="login-email">Email</Label>
        <Input id="login-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="login-password">Password</Label>
        <Input
          id="login-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </div>
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? "Signing in..." : "Sign In"}
      </Button>
      <button
        type="button"
        className="w-full text-sm text-muted-foreground hover:text-foreground transition-colors mt-2"
        onClick={async () => {
          if (!email) {
            toast({
              title: "Enter your email",
              description: "Please enter your email address first.",
              variant: "destructive",
            });
            return;
          }
          setLoading(true);
          const { error } = await supabaseAuth.auth.resetPasswordForEmail(email, {
            redirectTo: `${window.location.origin}/reset-password`,
          });
          if (error) {
            toast({ title: "Error", description: error.message, variant: "destructive" });
          } else {
            toast({ title: "Check your email", description: "We sent you a password reset link." });
          }
          setLoading(false);
        }}
      >
        Forgot password?
      </button>
    </form>
  );
}
