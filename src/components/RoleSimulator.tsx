import { useScramble } from "@/contexts/ScrambleContext";
import { useOrgStore } from "@/store/orgStore";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Check } from "lucide-react";
import { toast } from "@/hooks/use-toast";

/**
 * "Illuminati" eye-in-pyramid icon (no Lucide equivalent).
 * Stroke-based so it inherits currentColor and matches Lucide sizing.
 */
function IlluminatiIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {/* Outer triangle */}
      <path d="M12 3 L22 21 L2 21 Z" />
      {/* Eye almond */}
      <path d="M7.5 15 C 9 13 15 13 16.5 15 C 15 17 9 17 7.5 15 Z" />
      {/* Pupil */}
      <circle cx="12" cy="15" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  );
}

const ROLES: Array<{ value: 'owner' | 'admin' | 'member'; label: string; hint: string }> = [
  { value: 'owner', label: 'Owner', hint: 'Full control of the organization' },
  { value: 'admin', label: 'Admin', hint: 'Can manage members and settings' },
  { value: 'member', label: 'Member', hint: 'Standard collaborator' },
];

export function RoleSimulator() {
  const { isSuperuser } = useScramble();
  const roleOverride = useOrgStore((s) => s.roleOverride);
  const setRoleOverride = useOrgStore((s) => s.setRoleOverride);

  if (!isSuperuser) return null;

  const handleSelect = (role: 'owner' | 'admin' | 'member' | null) => {
    setRoleOverride(role);
    toast({
      title: role ? `Simulating: ${role}` : 'Role simulation cleared',
      description: role
        ? 'You now see the app as a member with this role. Superuser bypasses are disabled.'
        : 'Restored to your real superuser permissions.',
    });
  };

  const activeLabel = roleOverride
    ? roleOverride.charAt(0).toUpperCase() + roleOverride.slice(1)
    : null;

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={`px-1.5 md:px-2 py-1 rounded-md border transition-colors flex items-center gap-1.5 text-xs font-medium ${
                roleOverride
                  ? 'bg-primary/10 border-primary/40 text-primary hover:bg-primary/15'
                  : 'bg-background hover:bg-accent border-border text-foreground'
              }`}
              aria-label="Simulate role"
            >
              <IlluminatiIcon className="w-4 h-4" />
              {activeLabel && (
                <span className="hidden md:inline leading-none">{activeLabel}</span>
              )}
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>
          {roleOverride ? `Simulating ${activeLabel}` : 'Simulate role (superuser only)'}
        </TooltipContent>
      </Tooltip>

      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="flex items-center gap-2">
          <IlluminatiIcon className="w-4 h-4" />
          Simulate role
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => handleSelect(null)}
          className={!roleOverride ? 'bg-accent' : ''}
        >
          <span className="flex-1">
            <div className="text-sm">Superuser (real)</div>
            <div className="text-[11px] text-muted-foreground">No simulation</div>
          </span>
          {!roleOverride && <Check className="w-4 h-4 ml-2" />}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {ROLES.map((r) => (
          <DropdownMenuItem
            key={r.value}
            onClick={() => handleSelect(r.value)}
            className={roleOverride === r.value ? 'bg-accent' : ''}
          >
            <span className="flex-1">
              <div className="text-sm capitalize">{r.label}</div>
              <div className="text-[11px] text-muted-foreground">{r.hint}</div>
            </span>
            {roleOverride === r.value && <Check className="w-4 h-4 ml-2" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
