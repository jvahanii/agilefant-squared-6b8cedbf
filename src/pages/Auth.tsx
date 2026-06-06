import { useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { PLANS, type PlanKey } from "@/hooks/useSubscription";
import { TermsOfServiceDialog } from "@/components/TermsOfServiceDialog";

export default function Auth() {
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [tosOpen, setTosOpen] = useState(false);
  const [planDialogOpen, setPlanDialogOpen] = useState(false);
  const [pendingSignupFn, setPendingSignupFn] = useState<(() => Promise<void>) | null>(null);

  const handleTosAccept = () => {
    setTosOpen(false);
    setPlanDialogOpen(true);
  };

  const handleTosCancel = () => {
    setTosOpen(false);
    setPendingSignupFn(null);
    window.location.href = "https://www.agilefant.org";
  };

  const handlePlanChosen = async (planKey: PlanKey) => {
    setPlanDialogOpen(false);
    if (planKey !== "free") {
      localStorage.setItem("pendingPlan", planKey);
    }
    if (pendingSignupFn) {
      await pendingSignupFn();
      setPendingSignupFn(null);
    }
  };

  const handlePlanCancel = () => {
    setPlanDialogOpen(false);
    setPendingSignupFn(null);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <TermsOfServiceDialog open={tosOpen} onAccept={handleTosAccept} onCancel={handleTosCancel} />
      <PlanChoosingDialog open={planDialogOpen} onPlanChosen={handlePlanChosen} onCancel={handlePlanCancel} />
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
          <p className="mt-4 text-center text-xs text-muted-foreground">
            <Link to="/user-guide" className="hover:text-foreground underline underline-offset-4 transition-colors">
              View User Guide
            </Link>
          </p>
        </CardContent>
      </Card>
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

function SignupForm({
  loading,
  setLoading,
  email,
  setEmail,
  onShowTos,
}: {
  loading: boolean;
  setLoading: (v: boolean) => void;
  email: string;
  setEmail: (v: string) => void;
  onShowTos: (signupFn: () => Promise<void>) => void;
}) {
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
      <div className="flex justify-center mb-2">
        <img src={agilefantLogo} alt="Agilefant heraldic logo" className="h-24 w-auto" />
      </div>
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

function PlanChoosingDialog({
  open,
  onPlanChosen,
  onCancel,
}: {
  open: boolean;
  onPlanChosen: (planKey: PlanKey) => void;
  onCancel: () => void;
}) {
  const planKeys: PlanKey[] = ["free", "starter", "enterprise"];

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) onCancel();
      }}
    >
      <DialogContent className="max-w-2xl" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Choose your plan</DialogTitle>
          <DialogDescription>Select a plan to continue. You can change it later.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-3 gap-3 py-2">
          {planKeys.map((key) => {
            const plan = PLANS[key];
            const isHighlighted = key === "starter";

            return (
              <Card
                key={key}
                className={`relative cursor-pointer hover:border-primary transition-colors ${isHighlighted ? "border-primary/50" : ""}`}
                onClick={() => onPlanChosen(key)}
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
      </DialogContent>
    </Dialog>
  );
}
