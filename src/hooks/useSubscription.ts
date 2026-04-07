import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useOrgStore } from "@/store/orgStore";

// Stripe product/price mapping
export const PLANS = {
  free: {
    name: "Free",
    price: "$0",
    product_id: null,
    price_id: null,
    features: ["Free forever", "Community support"],
  },
  starter: {
    name: "Supporter",
    price: "$9 / month",
    product_id: "prod_UHs01l5M3TFxGQ",
    price_id: "price_1TJIGCBRMLkyTCtAKXA3imQq",
    features: ["Support the further development of Agilefant"],
  },
} as const;

export type PlanKey = keyof typeof PLANS;

export function getPlanByProductId(productId: string | null): PlanKey {
  if (!productId) return "free";
  for (const [key, plan] of Object.entries(PLANS)) {
    if (plan.product_id === productId) return key as PlanKey;
  }
  return "free";
}

interface SubscriptionState {
  loading: boolean;
  subscribed: boolean;
  plan: PlanKey;
  subscriptionEnd: string | null;
}

export function useSubscription() {
  const { user } = useAuth();
  const activeOrg = useOrgStore((s) => s.activeOrgId);
  const [state, setState] = useState<SubscriptionState>({
    loading: true,
    subscribed: false,
    plan: "free",
    subscriptionEnd: null,
  });

  const checkSubscription = useCallback(async () => {
    if (!user?.id || !activeOrg) {
      setState({ loading: false, subscribed: false, plan: "free", subscriptionEnd: null });
      return;
    }

    try {
      const { data, error } = await supabase.functions.invoke("check-subscription", {
        body: { organization_id: activeOrg },
      });

      if (error) throw error;

      const plan = getPlanByProductId(data?.product_id ?? null);
      setState({
        loading: false,
        subscribed: data?.subscribed ?? false,
        plan,
        subscriptionEnd: data?.subscription_end ?? null,
      });
    } catch (err) {
      console.error("Error checking subscription:", err);
      setState({ loading: false, subscribed: false, plan: "free", subscriptionEnd: null });
    }
  }, [user?.id, activeOrg]);

  useEffect(() => {
    checkSubscription();
    const interval = setInterval(checkSubscription, 60_000);
    return () => clearInterval(interval);
  }, [checkSubscription]);

  const startCheckout = async (priceId: string) => {
    if (!activeOrg) return;
    const { data, error } = await supabase.functions.invoke("create-checkout", {
      body: { price_id: priceId, organization_id: activeOrg },
    });
    if (error) throw error;
    if (data?.url) window.open(data.url, "_blank");
  };

  const openPortal = async () => {
    if (!activeOrg) return;
    const { data, error } = await supabase.functions.invoke("customer-portal", {
      body: { organization_id: activeOrg },
    });
    if (error) throw error;
    if (data?.url) window.open(data.url, "_blank");
  };

  return { ...state, checkSubscription, startCheckout, openPortal };
}
