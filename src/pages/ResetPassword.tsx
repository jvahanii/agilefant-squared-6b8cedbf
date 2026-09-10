import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { supabaseAuth } from "@/integrations/supabase/authClient";
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from '@/hooks/use-toast';

export default function ResetPassword() {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<'checking' | 'ready' | 'invalid'>('checking');
  const mountedRef = useRef(true);

  const safeSetStatus = (s: 'checking' | 'ready' | 'invalid') => {
    if (mountedRef.current) setStatus(s);
  };

  useEffect(() => {
    mountedRef.current = true;
    const hash = window.location.hash || '';
    const search = window.location.search || '';
    const hasRecoveryMarker =
      hash.includes('type=recovery') ||
      search.includes('type=recovery') ||
      hash.includes('access_token=');

    // Primary path: if Supabase already established a session (recovery link
    // consumed the hash before we mounted), or the URL still carries recovery
    // markers, show the form immediately.
    supabaseAuth.auth.getSession().then(({ data: { session } }) => {
      if (session || hasRecoveryMarker) {
        safeSetStatus('ready');
      }
    }).catch(() => {});

    // Backup: handle PASSWORD_RECOVERY if it arrives after mount.
    const { data: { subscription } } = supabaseAuth.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' || (event === 'SIGNED_IN' && session)) {
        safeSetStatus('ready');
      }
    });

    // Only declare the link invalid after a grace period with neither
    // a session nor recovery markers present.
    const timeout = setTimeout(async () => {
      const { data: { session } } = await supabaseAuth.auth.getSession();
      if (!session && !hasRecoveryMarker) {
        safeSetStatus('invalid');
      } else {
        safeSetStatus('ready');
      }
    }, 2000);

    return () => {
      mountedRef.current = false;
      subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, []);

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      toast({ title: 'Error', description: 'Passwords do not match.', variant: 'destructive' });
      return;
    }
    if (password.length < 6) {
      toast({ title: 'Error', description: 'Password must be at least 6 characters.', variant: 'destructive' });
      return;
    }
    setLoading(true);
    const { error } = await supabaseAuth.auth.updateUser({ password });
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      setLoading(false);
      return;
    }
    toast({ title: 'Password updated', description: 'Please sign in with your new password.' });
    // Sign out the temporary recovery session so the user explicitly signs
    // in again. Use a real navigation (not SPA navigate) so all in-memory
    // recovery/org/app store state is discarded before the next sign-in.
    await supabaseAuth.auth.signOut();
    window.location.replace('/auth');
  };

  if (status === 'checking') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (status === 'invalid') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CardTitle>Invalid Link</CardTitle>
            <CardDescription>This password reset link is invalid or has expired.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              className="w-full"
              onClick={async () => {
                await supabaseAuth.auth.signOut().catch(() => {});
                window.location.assign('/auth');
              }}
            >
              Back to Sign In
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Reset Password</CardTitle>
          <CardDescription>Enter your new password below</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleReset} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new-password">New Password</Label>
              <Input id="new-password" type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={6} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">Confirm Password</Label>
              <Input id="confirm-password" type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required minLength={6} />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Updating...' : 'Update Password'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
