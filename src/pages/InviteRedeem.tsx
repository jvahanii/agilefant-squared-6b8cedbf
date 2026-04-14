import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useOrgStore } from "@/store/orgStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/hooks/use-toast";
import { UserPlus } from "lucide-react";

export default function InviteRedeem() {
  const { token } = useParams<{ token: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const loadMemberships = useOrgStore((s) => s.loadMemberships);
  const [redeeming, setRedeeming] = useState(false);
  const attempted = useRef(false);

  useEffect(() => {
    if (!user || !token || attempted.current) return;
    attempted.current = true;
    setRedeeming(true);
    supabase
      .rpc("redeem_invite", { _token: token })
      .then(async ({ error }) => {
        setRedeeming(false);
        if (error) {
          toast({ title: "Could not accept invitation", description: error.message, variant: "destructive" });
        } else {
          await loadMemberships(user.id);
          toast({ title: "Welcome!", description: "You have successfully joined the organization." });
        }
        navigate("/");
      });
  }, [user, token]);

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="flex justify-center mb-2">
              <UserPlus className="w-8 h-8 text-primary" />
            </div>
            <CardTitle className="text-xl">You've been invited</CardTitle>
            <CardDescription>Sign in or create an account to accept this invitation.</CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="login">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="login">Sign In</TabsTrigger>
                <TabsTrigger value="signup">Sign Up</TabsTrigger>
              </TabsList>
              <TabsContent value="login">
                <InlineLoginForm />
              </TabsContent>
              <TabsContent value="signup">
                <InlineSignupForm />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <p className="text-muted-foreground">{redeeming ? "Accepting invitation…" : "Redirecting…"}</p>
    </div>
  );
}

function InlineLoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

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
        <Label htmlFor="invite-login-email">Email</Label>
        <Input
          id="invite-login-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="invite-login-password">Password</Label>
        <Input
          id="invite-login-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </div>
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? "Signing in…" : "Sign In & Accept"}
      </Button>
    </form>
  );
}

function InlineSignupForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName },
        emailRedirectTo: window.location.href,
      },
    });
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Check your email", description: "We sent you a confirmation link. After confirming, return to this invite link to join." });
    }
    setLoading(false);
  };

  return (
    <form onSubmit={handleSignup} className="space-y-4 mt-4">
      <div className="space-y-2">
        <Label htmlFor="invite-signup-name">Full Name</Label>
        <Input
          id="invite-signup-name"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="invite-signup-email">Email</Label>
        <Input
          id="invite-signup-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="invite-signup-password">Password</Label>
        <Input
          id="invite-signup-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={6}
        />
      </div>
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? "Creating account…" : "Sign Up & Accept"}
      </Button>
    </form>
  );
}
