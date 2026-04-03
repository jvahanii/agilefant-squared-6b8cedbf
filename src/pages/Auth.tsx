import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/hooks/use-toast";

export default function Auth() {
  const [loading, setLoading] = useState(false);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">
            Agilefant<sup className="text-primary">2</sup>
          </CardTitle>
          <CardDescription>Sign in to your account or create a new one</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="login">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="login">Sign In</TabsTrigger>
              <TabsTrigger value="signup">Sign Up</TabsTrigger>
            </TabsList>
            <TabsContent value="login">
              <LoginForm loading={loading} setLoading={setLoading} />
            </TabsContent>
            <TabsContent value="signup">
              <SignupForm loading={loading} setLoading={setLoading} />
            </TabsContent>
          </Tabs>
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
                const { error } = await supabase.auth.signInWithOAuth({
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
        </CardContent>
      </Card>
    </div>
  );
}

function LoginForm({ loading, setLoading }: { loading: boolean; setLoading: (v: boolean) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
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
          const { error } = await supabase.auth.resetPasswordForEmail(email, {
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

function SignupForm({ loading, setLoading }: { loading: boolean; setLoading: (v: boolean) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName },
        emailRedirectTo: window.location.origin,
      },
    });
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Check your email", description: "We sent you a confirmation link." });
    }
    setLoading(false);
  };

  return (
    <form onSubmit={handleSignup} className="space-y-4 mt-4">
      <div className="space-y-2">
        <Label htmlFor="signup-name">Full Name</Label>
        <Input id="signup-name" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="signup-email">Email</Label>
        <Input id="signup-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="signup-password">Password</Label>
        <Input
          id="signup-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={6}
        />
      </div>
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? "Creating account..." : "Sign Up"}
      </Button>
    </form>
  );
}
