import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, ExternalLink, Loader2 } from "lucide-react";
import { useSubscription, PLANS, type PlanKey } from "@/hooks/useSubscription";
import { toast } from "@/hooks/use-toast";

export function PricingCards() {
  const { plan: currentPlan, loading, startCheckout, openPortal, subscribed, subscriptionEnd } =
    useSubscription();

  const handleUpgrade = async (planKey: PlanKey) => {
    const plan = PLANS[planKey];
    if (!plan.price_id) return;
    try {
      await startCheckout(plan.price_id);
    } catch (err: any) {
      toast({ title: "Checkout error", description: err.message, variant: "destructive" });
    }
  };

  const handleManage = async () => {
    try {
      await openPortal();
    } catch (err: any) {
      toast({ title: "Portal error", description: err.message, variant: "destructive" });
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const planKeys: PlanKey[] = ["free", "starter", "pro", "enterprise"];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {planKeys.map((key) => {
          const plan = PLANS[key];
          const isCurrent = currentPlan === key;
          const isHighlighted = key === "supporter";

          return (
            <Card
              key={key}
              className={`relative ${isCurrent ? "border-primary ring-2 ring-primary/20" : ""} ${isHighlighted && !isCurrent ? "border-primary/50" : ""}`}
            >
              {isCurrent && (
                <Badge className="absolute -top-2.5 left-4 text-xs">Current Plan</Badge>
              )}
              {isHighlighted && !isCurrent && (
                <Badge variant="secondary" className="absolute -top-2.5 left-4 text-xs">
                  Popular
                </Badge>
              )}
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{plan.name}</CardTitle>
                <p className="text-2xl font-bold">{plan.price}</p>
              </CardHeader>
              <CardContent className="space-y-3">
                <ul className="space-y-1.5">
                  {plan.features.map((f) => (
                    <li key={f} className="text-sm text-muted-foreground flex items-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5 text-green-500 shrink-0" />
                      {f}
                    </li>
                  ))}
                </ul>

                {isCurrent ? (
                  subscribed ? (
                    <Button variant="outline" size="sm" className="w-full" onClick={handleManage}>
                      <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
                      Manage
                    </Button>
                  ) : (
                    <Button variant="outline" size="sm" className="w-full" disabled>
                      Current
                    </Button>
                  )
                ) : key === "free" ? null : key === "enterprise" ? (
                  <Button
                    size="sm"
                    className="w-full"
                    variant="outline"
                    onClick={() => { window.location.href = "mailto:contact@agilefant.com"; }}
                  >
                    Contact us
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    className="w-full"
                    variant={isHighlighted ? "default" : "outline"}
                    onClick={() => handleUpgrade(key)}
                  >
                    {subscribed ? "Switch" : "Upgrade"}
                  </Button>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {subscribed && subscriptionEnd && (
        <p className="text-xs text-muted-foreground">
          Current period ends: {new Date(subscriptionEnd).toLocaleDateString()}
        </p>
      )}
    </div>
  );
}
