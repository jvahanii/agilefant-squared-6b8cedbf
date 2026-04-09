import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/hooks/useAuth';
import { useOrgStore } from '@/store/orgStore';
import { supabase } from '@/integrations/supabase/client';
import { PLANS, type PlanKey } from '@/hooks/useSubscription';
import { toast } from '@/hooks/use-toast';

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

const DUPLICATE_KEY_CODE = '23505';

export default function Onboarding() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { createOrganization, loadMemberships } = useOrgStore();
  const [error, setError] = useState<string | null>(null);
  const attempted = useRef(false);

  useEffect(() => {
    if (!user || attempted.current) return;
    attempted.current = true;

    const currentUser = user;

    async function autoCreateOrg() {
      const fullName: string = currentUser.user_metadata?.full_name ?? '';
      const email: string = currentUser.email ?? '';
      const emailLocal = email.includes('@') ? email.split('@')[0] : email;

      const attempts: Array<{ name: string; slug: string }> = [];

      const fullNameSlug = slugify(fullName);
      if (fullName && fullNameSlug) {
        attempts.push({ name: fullName, slug: fullNameSlug });
      }

      const emailSlug = slugify(emailLocal);
      if (emailSlug) {
        attempts.push({ name: email, slug: emailSlug });
      }

      // Final fallback: guarantee uniqueness with a user-id suffix
      const baseSlug = emailSlug || slugify(currentUser.id);
      attempts.push({ name: email, slug: `${baseSlug}-${currentUser.id.slice(0, 8)}` });

      for (const attempt of attempts) {
        try {
          const orgId = await createOrganization(attempt.name, attempt.slug, currentUser.id);
          await loadMemberships(currentUser.id);

          const pendingPlan = localStorage.getItem('pendingPlan') as PlanKey | null;
          localStorage.removeItem('pendingPlan');

          if (pendingPlan && pendingPlan !== 'free' && PLANS[pendingPlan]?.price_id) {
            try {
              const { data, error } = await supabase.functions.invoke('create-checkout', {
                body: { price_id: PLANS[pendingPlan].price_id, organization_id: orgId },
              });
              if (error) throw error;
              if (data?.url) {
                const win = window.open(data.url, '_blank');
                if (!win) {
                  toast({ title: 'Popup blocked', description: 'Please allow popups to complete your plan upgrade, or visit the billing settings later.', variant: 'destructive' });
                }
              }
            } catch (err: any) {
              toast({ title: 'Checkout error', description: err.message, variant: 'destructive' });
            }
          }

          navigate('/', { replace: true });
          return;
        } catch (err: any) {
          if (err?.code !== DUPLICATE_KEY_CODE) {
            setError(err?.message ?? 'Failed to create organization. Please try again.');
            return;
          }
          // Duplicate slug — try the next candidate
        }
      }

      setError('Could not create an organization. Please contact support.');
    }

    autoCreateOrg();
  }, [user, createOrganization, loadMemberships, navigate]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CardTitle>Something went wrong</CardTitle>
          </CardHeader>
          <CardContent className="text-center text-muted-foreground text-sm">
            <p>{error}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle>Setting up your organization…</CardTitle>
        </CardHeader>
        <CardContent className="flex justify-center py-8">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </CardContent>
      </Card>
    </div>
  );
}
