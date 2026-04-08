import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CheckCircle2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { PLANS, type PlanKey } from "@/hooks/useSubscription";

export default function Auth() {
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [tosOpen, setTosOpen] = useState(false);
  const [pendingSignupFn, setPendingSignupFn] = useState<(() => Promise<void>) | null>(null);

  const handleTosAccept = async () => {
    setTosOpen(false);
    if (pendingSignupFn) {
      await pendingSignupFn();
      setPendingSignupFn(null);
    }
  };

  const handleTosCancel = () => {
    setTosOpen(false);
    setPendingSignupFn(null);
    window.location.href = "https://www.agilefant.org";
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <TermsOfServiceDialog
        open={tosOpen}
        onAccept={handleTosAccept}
        onCancel={handleTosCancel}
      />
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
              <LoginForm loading={loading} setLoading={setLoading} email={email} setEmail={setEmail} />
            </TabsContent>
            <TabsContent value="signup">
              <SignupForm
                loading={loading}
                setLoading={setLoading}
                email={email}
                setEmail={setEmail}
                onShowTos={(signupFn) => {
                  setPendingSignupFn(() => signupFn);
                  setTosOpen(true);
                }}
              />
              <StaticPricingCards />
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

function LoginForm({ loading, setLoading, email, setEmail }: { loading: boolean; setLoading: (v: boolean) => void; email: string; setEmail: (v: string) => void }) {
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

function SignupForm({ loading, setLoading, email, setEmail, onShowTos }: { loading: boolean; setLoading: (v: boolean) => void; email: string; setEmail: (v: string) => void; onShowTos: (signupFn: () => Promise<void>) => void }) {
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    const doSignup = async () => {
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
    onShowTos(doSignup);
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

function StaticPricingCards() {
  const planKeys: PlanKey[] = ["free", "starter"];

  return (
    <div className="mt-6 space-y-3">
      <p className="text-sm font-medium text-center text-muted-foreground">Plans &amp; Pricing</p>
      <div className="grid grid-cols-2 gap-3">
        {planKeys.map((key) => {
          const plan = PLANS[key];
          const isHighlighted = key === "starter";

          return (
            <Card
              key={key}
              className={`relative ${isHighlighted ? "border-primary/50" : ""}`}
            >
              {isHighlighted && (
                <Badge variant="secondary" className="absolute -top-2.5 left-4 text-xs">
                  Popular
                </Badge>
              )}
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-sm">{plan.name}</CardTitle>
                <p className="text-lg font-bold">{plan.price}</p>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <ul className="space-y-1">
                  {plan.features.map((f) => (
                    <li key={f} className="text-xs text-muted-foreground flex items-center gap-1.5">
                      <CheckCircle2 className="w-3 h-3 text-green-500 shrink-0" />
                      {f}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function TermsOfServiceDialog({
  open,
  onAccept,
  onCancel,
}: {
  open: boolean;
  onAccept: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onCancel(); }}>
      <DialogContent className="max-w-lg" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Terms of Service</DialogTitle>
          <DialogDescription>
            Please read and accept our terms before continuing.
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="h-72 rounded-md border p-4 text-sm text-muted-foreground space-y-3">
          <div className="space-y-3">
            <p>
              Welcome to <strong>Agilefant²</strong>. By creating an account you agree to these
              simple terms of service.
            </p>
            <p>
              We will do our best to provide a reliable and useful service, but we cannot accept
              responsibility for any loss of data, interruption of service, or other damages that
              may arise from your use of Agilefant².
            </p>
            <p>
              <strong>Your data belongs to you.</strong> You can export all your data at any time
              using the <em>Export Data</em> button available in the application settings.
            </p>
            <p>
              Agilefant² is free and open-source software licensed under the{" "}
              <strong>GNU General Public License v3 (GPLv3)</strong>. The source code is publicly
              available on GitHub:{" "}
              <a
                href="https://github.com/agilefant/agilefant-squared"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline underline-offset-2"
              >
                github.com/agilefant/agilefant-squared
              </a>
              . You are free to inspect, modify, and self-host your own instance at any time.
            </p>
            <p>
              We reserve the right to update these terms. Continued use of the service constitutes
              acceptance of any changes.
            </p>
          </div>
        </ScrollArea>
        <DialogFooter className="flex gap-2 sm:justify-end">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={onAccept}>Accept</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
