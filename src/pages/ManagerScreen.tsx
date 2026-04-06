import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useOrgStore } from "@/store/orgStore";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ArrowLeft,
  Building2,
  Users,
  Shield,
  CreditCard,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";

interface OrgRow {
  id: string;
  name: string;
  slug: string;
  created_at: string;
  memberCount?: number;
}

interface UserRow {
  id: string;
  email: string | null;
  full_name: string | null;
  is_superuser: boolean;
  created_at: string;
}

interface TeamRow {
  id: string;
  name: string;
  organization_id: string;
  organization_name: string;
  created_at: string;
}

const MOCK_PLANS = [
  { orgId: "1", plan: "Pro", status: "active", nextBilling: "2026-05-01", amount: "$49/mo" },
  { orgId: "2", plan: "Starter", status: "active", nextBilling: "2026-05-15", amount: "$9/mo" },
  { orgId: "3", plan: "Enterprise", status: "past_due", nextBilling: "2026-04-10", amount: "$199/mo" },
];

export default function ManagerScreen() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { setActiveOrg, loadMemberships, memberships } = useOrgStore();

  const [isSuperuser, setIsSuperuser] = useState<boolean | null>(null);
  const [orgs, setOrgs] = useState<OrgRow[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [loading, setLoading] = useState(true);

  // Check superuser status
  useEffect(() => {
    if (!user?.id) return;
    supabase
      .from("profiles")
      .select("is_superuser")
      .eq("id", user.id)
      .single()
      .then(({ data }) => {
        const su = data?.is_superuser ?? false;
        setIsSuperuser(su);
        if (!su) navigate("/");
      });
  }, [user?.id]);

  // Load all data once superuser confirmed
  useEffect(() => {
    if (!isSuperuser) return;
    loadData();
  }, [isSuperuser]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [orgsRes, usersRes, teamsRes, membershipsRes] = await Promise.all([
        supabase.from("organizations").select("id, name, slug, created_at").order("created_at"),
        supabase.from("profiles").select("id, email, full_name, is_superuser, created_at").order("created_at"),
        supabase.from("teams").select("id, name, organization_id, created_at").order("name"),
        supabase.from("memberships").select("organization_id"),
      ]);

      if (orgsRes.error) throw orgsRes.error;
      if (usersRes.error) throw usersRes.error;
      if (teamsRes.error) throw teamsRes.error;

      // Count members per org
      const memberCounts: Record<string, number> = {};
      for (const m of membershipsRes.data ?? []) {
        memberCounts[m.organization_id] = (memberCounts[m.organization_id] ?? 0) + 1;
      }

      const orgMap: Record<string, string> = {};
      for (const o of orgsRes.data ?? []) {
        orgMap[o.id] = o.name;
      }

      setOrgs(
        (orgsRes.data ?? []).map((o) => ({
          ...o,
          memberCount: memberCounts[o.id] ?? 0,
        })),
      );
      setUsers(usersRes.data ?? []);
      setTeams(
        (teamsRes.data ?? []).map((t) => ({
          ...t,
          organization_name: orgMap[t.organization_id] ?? t.organization_id,
        })),
      );
    } catch (err: any) {
      toast({ title: "Error loading data", description: err.message, variant: "destructive" });
    }
    setLoading(false);
  };

  const handleNavigateToOrg = async (orgId: string) => {
    // Switch active org and navigate to main app
    const isMember = memberships.some((m) => m.organization_id === orgId);
    if (isMember) {
      setActiveOrg(orgId);
      navigate("/");
    } else {
      // Superuser may not be a member; reload memberships first
      if (user?.id) await loadMemberships(user.id);
      setActiveOrg(orgId);
      navigate("/");
    }
  };

  // Still checking superuser status
  if (isSuperuser === null) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate("/")}>
            <ArrowLeft className="w-4 h-4 mr-1" /> Back
          </Button>
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-primary" />
            <h1 className="text-xl font-bold">Manager Screen</h1>
          </div>
          <Badge variant="secondary" className="ml-auto">
            Superuser
          </Badge>
        </div>

        {/* Stats summary */}
        <div className="grid grid-cols-3 gap-4">
          <Card>
            <CardContent className="pt-4 flex items-center gap-3">
              <Building2 className="w-8 h-8 text-muted-foreground" />
              <div>
                <p className="text-2xl font-bold">{orgs.length}</p>
                <p className="text-sm text-muted-foreground">Organizations</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 flex items-center gap-3">
              <Users className="w-8 h-8 text-muted-foreground" />
              <div>
                <p className="text-2xl font-bold">{users.length}</p>
                <p className="text-sm text-muted-foreground">Users</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 flex items-center gap-3">
              <Shield className="w-8 h-8 text-muted-foreground" />
              <div>
                <p className="text-2xl font-bold">{teams.length}</p>
                <p className="text-sm text-muted-foreground">Teams</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="organizations">
          <TabsList className="grid grid-cols-4 w-full">
            <TabsTrigger value="organizations">
              <Building2 className="w-4 h-4 mr-1.5" /> Organizations
            </TabsTrigger>
            <TabsTrigger value="users">
              <Users className="w-4 h-4 mr-1.5" /> Users
            </TabsTrigger>
            <TabsTrigger value="teams">
              <Shield className="w-4 h-4 mr-1.5" /> Teams
            </TabsTrigger>
            <TabsTrigger value="billing">
              <CreditCard className="w-4 h-4 mr-1.5" /> Billing
            </TabsTrigger>
          </TabsList>

          {/* Organizations */}
          <TabsContent value="organizations">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">All Organizations</CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <p className="text-sm text-muted-foreground">Loading...</p>
                ) : orgs.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No organizations found.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Slug</TableHead>
                        <TableHead>Members</TableHead>
                        <TableHead>Created</TableHead>
                        <TableHead className="text-right">Navigate</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {orgs.map((org) => (
                        <TableRow key={org.id}>
                          <TableCell className="font-medium">{org.name}</TableCell>
                          <TableCell className="text-muted-foreground">{org.slug}</TableCell>
                          <TableCell>{org.memberCount}</TableCell>
                          <TableCell className="text-muted-foreground text-sm">
                            {new Date(org.created_at).toLocaleDateString()}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleNavigateToOrg(org.id)}
                            >
                              <ExternalLink className="w-3.5 h-3.5 mr-1" /> Open
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Users */}
          <TabsContent value="users">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">All Users</CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <p className="text-sm text-muted-foreground">Loading...</p>
                ) : users.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No users found.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Role</TableHead>
                        <TableHead>Joined</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {users.map((u) => (
                        <TableRow key={u.id}>
                          <TableCell className="font-medium">
                            {u.full_name || <span className="text-muted-foreground italic">—</span>}
                          </TableCell>
                          <TableCell>{u.email || <span className="text-muted-foreground italic">—</span>}</TableCell>
                          <TableCell>
                            {u.is_superuser ? (
                              <Badge variant="default">Superuser</Badge>
                            ) : (
                              <Badge variant="outline">User</Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-muted-foreground text-sm">
                            {new Date(u.created_at).toLocaleDateString()}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Teams */}
          <TabsContent value="teams">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">All Teams</CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <p className="text-sm text-muted-foreground">Loading...</p>
                ) : teams.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No teams found.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Team Name</TableHead>
                        <TableHead>Organization</TableHead>
                        <TableHead>Created</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {teams.map((team) => (
                        <TableRow key={team.id}>
                          <TableCell className="font-medium">{team.name}</TableCell>
                          <TableCell>
                            <span className="flex items-center gap-1.5">
                              <Building2 className="w-3.5 h-3.5 text-muted-foreground" />
                              {team.organization_name}
                            </span>
                          </TableCell>
                          <TableCell className="text-muted-foreground text-sm">
                            {new Date(team.created_at).toLocaleDateString()}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Billing */}
          <TabsContent value="billing">
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <CreditCard className="w-4 h-4" /> Subscription Plans
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-3 gap-4 mb-6">
                    {[
                      { name: "Starter", price: "$9/mo", features: ["Up to 5 users", "3 teams", "Basic support"] },
                      {
                        name: "Pro",
                        price: "$49/mo",
                        features: ["Up to 50 users", "Unlimited teams", "Priority support"],
                        highlighted: true,
                      },
                      {
                        name: "Enterprise",
                        price: "$199/mo",
                        features: ["Unlimited users", "Unlimited teams", "Dedicated support"],
                      },
                    ].map((plan) => (
                      <div
                        key={plan.name}
                        className={`rounded-lg border p-4 space-y-3 ${plan.highlighted ? "border-primary bg-primary/5" : ""}`}
                      >
                        <div className="flex items-center justify-between">
                          <p className="font-semibold">{plan.name}</p>
                          {plan.highlighted && <Badge>Popular</Badge>}
                        </div>
                        <p className="text-2xl font-bold">{plan.price}</p>
                        <ul className="space-y-1">
                          {plan.features.map((f) => (
                            <li key={f} className="text-sm text-muted-foreground flex items-center gap-1.5">
                              <CheckCircle2 className="w-3.5 h-3.5 text-green-500 shrink-0" />
                              {f}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Organization Billing Status</CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Organization</TableHead>
                        <TableHead>Plan</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Amount</TableHead>
                        <TableHead>Next Billing</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {orgs.slice(0, 5).map((org, idx) => {
                        const billing = MOCK_PLANS[idx % MOCK_PLANS.length];
                        const isPastDue = billing.status === "past_due";
                        return (
                          <TableRow key={org.id}>
                            <TableCell className="font-medium">{org.name}</TableCell>
                            <TableCell>{billing.plan}</TableCell>
                            <TableCell>
                              {isPastDue ? (
                                <Badge variant="destructive" className="flex items-center gap-1 w-fit">
                                  <AlertCircle className="w-3 h-3" /> Past Due
                                </Badge>
                              ) : (
                                <Badge variant="secondary" className="flex items-center gap-1 w-fit">
                                  <CheckCircle2 className="w-3 h-3" /> Active
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell>{billing.amount}</TableCell>
                            <TableCell className="text-muted-foreground text-sm">{billing.nextBilling}</TableCell>
                            <TableCell className="text-right">
                              <Button variant="outline" size="sm" disabled>
                                Manage
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                  <p className="text-xs text-muted-foreground mt-3 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" />
                    Billing data shown above is mock. Connect a payment provider (e.g. Stripe) to enable live billing
                    management.
                  </p>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
