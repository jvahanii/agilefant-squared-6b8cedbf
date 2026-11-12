import { useOrgStore, Membership } from "@/store/orgStore";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Building2, ChevronDown, Settings, LogOut, Plus, Shield } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { fetchIsSuperuser } from "@/lib/superuser";

/** Why a superuser sees no superuser tools, and how to get them back. */
export const SECOND_FACTOR_NOTICE =
  "They need a sign-in with a second factor. Sign out and sign in with Google, or with your password and an authenticator-app code.";

/** The notice is shown once per user per page load, not on every remount. */
let noticeShownFor: string | null = null;

export function OrgSwitcher() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const { memberships, activeOrgId, activeOrgName, setActiveOrg, createOrganization, loadMemberships } = useOrgStore();
  const activeOrg = memberships.find((m) => m.organization_id === activeOrgId);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newSlug, setNewSlug] = useState("");
  const [creating, setCreating] = useState(false);
  const [isSuperuser, setIsSuperuser] = useState(false);

  useEffect(() => {
    if (!user?.id) return;
    // Shared with the scramble setting: one read for both (superuser.ts).
    fetchIsSuperuser(user.id).then(({ isSuperuser, needsSecondFactor }) => {
      setIsSuperuser(isSuperuser);
      if (needsSecondFactor && noticeShownFor !== user.id) {
        noticeShownFor = user.id;
        toast({
          title: "Superuser rights are off in this session",
          description: SECOND_FACTOR_NOTICE,
          duration: 15000,
        });
      }
    });
  }, [user?.id]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setCreating(true);
    try {
      const orgId = await createOrganization(newName, newSlug, user.id);
      await loadMemberships(user.id);
      setActiveOrg(orgId);
      setShowCreate(false);
      setNewName("");
      setNewSlug("");
      toast({ title: "Organization created!" });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
    setCreating(false);
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="gap-1.5 text-sm font-medium max-w-48 truncate">
            <Building2 className="w-4 h-4 shrink-0" />
            <span className="truncate">{activeOrg?.organization_name ?? activeOrgName ?? "Select org"}</span>
            <ChevronDown className="w-3 h-3 shrink-0 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          {memberships.map((m) => (
            <DropdownMenuItem
              key={m.organization_id}
              onClick={() => setActiveOrg(m.organization_id)}
              className={m.organization_id === activeOrgId ? "bg-accent" : ""}
            >
              <Building2 className="w-4 h-4 mr-2" />
              <span className="truncate">{m.organization_name}</span>
              <span className="ml-auto text-xs text-muted-foreground">{m.role}</span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setShowCreate(true)}>
            <Plus className="w-4 h-4 mr-2" /> New Organization
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => navigate("/settings/team")}>
            <Settings className="w-4 h-4 mr-2" /> Org Settings
          </DropdownMenuItem>
          {isSuperuser && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => navigate("/manager")}>
                <Shield className="w-4 h-4 mr-2" /> Manager Screen
              </DropdownMenuItem>
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={signOut} className="text-destructive">
            <LogOut className="w-4 h-4 mr-2" /> Sign Out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Organization</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input
                value={newName}
                onChange={(e) => {
                  setNewName(e.target.value);
                  setNewSlug(
                    e.target.value
                      .toLowerCase()
                      .replace(/[^a-z0-9]+/g, "-")
                      .replace(/^-|-$/g, ""),
                  );
                }}
                required
                placeholder="Acme Inc."
              />
            </div>
            <div className="space-y-2">
              <Label>Slug</Label>
              <Input value={newSlug} onChange={(e) => setNewSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} required pattern="[a-z0-9\-]+" />
            </div>
            <Button type="submit" className="w-full" disabled={creating}>
              {creating ? "Creating..." : "Create"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
