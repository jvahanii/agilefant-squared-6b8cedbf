import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  BookOpen,
  Layers,
  ListTree,
  Keyboard,
  Users,
  Share2,
  Settings,
  MousePointer,
  MoveVertical,
  Undo2,
  Star,
  Link,
  RefreshCw,
  CheckCircle2,
} from "lucide-react";

interface UserGuideDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface Section {
  id: string;
  icon: React.ReactNode;
  label: string;
  content: React.ReactNode;
}

const StatusBadge = ({ color, label }: { color: string; label: string }) => (
  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${color}`}>
    {label}
  </span>
);

const KbdKey = ({ children }: { children: React.ReactNode }) => (
  <kbd className="px-1.5 py-0.5 rounded border bg-muted text-[10px] font-mono shadow-sm min-w-[24px] text-center inline-block">
    {children}
  </kbd>
);

const ShortcutRow = ({ keys, description }: { keys: string[]; description: string }) => (
  <div className="flex items-center justify-between py-1.5 border-b border-border/50 last:border-0">
    <span className="text-sm text-muted-foreground">{description}</span>
    <div className="flex items-center gap-1 ml-4 shrink-0">
      {keys.map((k, i) => (
        <span key={i} className="flex items-center gap-1">
          {i > 0 && <span className="text-muted-foreground/50 text-xs">+</span>}
          <KbdKey>{k}</KbdKey>
        </span>
      ))}
    </div>
  </div>
);

const Tip = ({ children }: { children: React.ReactNode }) => (
  <div className="flex gap-2 p-3 rounded-lg bg-primary/5 border border-primary/10 text-sm text-muted-foreground">
    <Star className="w-4 h-4 text-primary shrink-0 mt-0.5" />
    <span>{children}</span>
  </div>
);

export function UserGuideDialog({ open, onOpenChange }: UserGuideDialogProps) {
  const [activeSection, setActiveSection] = useState("overview");

  const sections: Section[] = [
    {
      id: "overview",
      icon: <BookOpen className="w-4 h-4" />,
      label: "Overview",
      content: (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground leading-relaxed">
            <strong className="text-foreground">Agilefant²</strong> is a hierarchical work management tool designed for
            teams that think in trees. Organise your work into nested backlogs, track item status, collaborate across
            organisations, and move fast with keyboard-first interactions.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[
              { icon: <ListTree className="w-4 h-4 text-primary" />, title: "Backlog Trees", body: "Organise work into hierarchical backlog trees shown in the left panel." },
              { icon: <Layers className="w-4 h-4 text-primary" />, title: "Work Items", body: "Create and manage work items within any backlog node in the right panel." },
              { icon: <Keyboard className="w-4 h-4 text-primary" />, title: "Keyboard-first", body: "Almost every action has a keyboard shortcut. Press ? to see the list." },
              { icon: <Users className="w-4 h-4 text-primary" />, title: "Team Collaboration", body: "Assign team members to items, share trees across organisations." },
            ].map((card) => (
              <div key={card.title} className="flex gap-3 p-3 rounded-lg border bg-card">
                <div className="mt-0.5 shrink-0">{card.icon}</div>
                <div>
                  <p className="text-sm font-medium">{card.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{card.body}</p>
                </div>
              </div>
            ))}
          </div>
          <Tip>
            New here? Start by creating a <strong>backlog tree</strong> in the left panel, then add a
            {" "}<strong>work item</strong> by selecting a backlog node and pressing{" "}
            <KbdKey>Enter</KbdKey>.
          </Tip>
        </div>
      ),
    },
    {
      id: "backlogs",
      icon: <ListTree className="w-4 h-4" />,
      label: "Backlog Trees",
      content: (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground leading-relaxed">
            The <strong className="text-foreground">left panel</strong> contains your backlog trees — hierarchical
            containers that organise work. Each tree can have multiple nested backlog nodes.
          </p>
          <div className="space-y-2">
            {[
              { action: "Create a tree", how: 'Click the "+" button at the top of the left panel.' },
              { action: "Add a backlog node", how: "Select an existing node and press Shift+Enter, or hover the node row and click the + icon." },
              { action: "Rename a node", how: "Double-click the node name to edit it in-place. Tree headers can also be renamed by double-clicking their name." },
              { action: "Select a backlog", how: "Click anywhere on a backlog row to select it and load its work items in the right panel." },
              { action: "Delete a node", how: "Select the node and press Delete / Backspace." },
              { action: "Reorder nodes", how: "Drag and drop nodes within the tree to reorder them." },
              { action: "Expand / collapse", how: "Click the expand arrow or press → to open a branch." },
            ].map((row) => (
              <div key={row.action} className="flex gap-2 text-sm border-b border-border/40 pb-2 last:border-0">
                <span className="font-medium text-foreground shrink-0 w-36">{row.action}</span>
                <span className="text-muted-foreground">{row.how}</span>
              </div>
            ))}
          </div>
          <Tip>
            You can have multiple top-level backlog trees. Use them to separate unrelated workstreams
            (e.g. "Product", "Engineering", "Marketing").
          </Tip>
        </div>
      ),
    },
    {
      id: "workitems",
      icon: <Layers className="w-4 h-4" />,
      label: "Work Items",
      content: (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground leading-relaxed">
            The <strong className="text-foreground">right panel</strong> shows work items for the selected backlog. Items
            can be nested into child items for fine-grained breakdown.
          </p>
          <div className="space-y-2">
            {[
              { action: "New root item", how: "Select a backlog and press Enter, or click the + button in the panel header." },
              { action: "New child item", how: "Select a parent item and press Shift+Enter, or click the + icon on the item row." },
              { action: "Select an item", how: "Click anywhere on the item row to select it." },
              { action: "Rename an item", how: "Double-click the item title to edit it directly in-place." },
              { action: "Delete item(s)", how: "Select item(s) and press Delete or Backspace, or click the trash icon on the row." },
              { action: "Multi-select", how: "Shift+Click to select a range, or Ctrl+Click (Cmd+Click on Mac) to toggle individual items." },
              { action: "Set story points", how: "Click the story-points value on the item row." },
              { action: "Paste items", how: "Copy a list of titles (one per line) then click the clipboard icon in the panel header to bulk-add." },
              { action: "Add hyperlinks", how: "Press H or Ctrl/Cmd+K to open the hyperlinks dialog." },
              { action: "Set recurring", how: "Click the settings icon on the item row to open respawn settings and configure the schedule." },
            ].map((row) => (
              <div key={row.action} className="flex gap-2 text-sm border-b border-border/40 pb-2 last:border-0">
                <span className="font-medium text-foreground shrink-0 w-36">{row.action}</span>
                <span className="text-muted-foreground">{row.how}</span>
              </div>
            ))}
          </div>
          <div>
            <p className="text-sm font-medium mb-2">Item Statuses</p>
            <div className="flex flex-wrap gap-2">
              <StatusBadge color="bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300" label="Not Started" />
              <StatusBadge color="bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" label="In Progress" />
              <StatusBadge color="bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300" label="Pending" />
              <StatusBadge color="bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" label="Blocked" />
              <StatusBadge color="bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300" label="Done" />
            </div>
          </div>
          <Tip>
            Select multiple items then press a status key (<KbdKey>D</KbdKey>, <KbdKey>I</KbdKey>, …) to bulk-update
            their status in one keystroke.
          </Tip>
        </div>
      ),
    },
    {
      id: "keyboard",
      icon: <Keyboard className="w-4 h-4" />,
      label: "Keyboard Shortcuts",
      content: (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Agilefant² is designed to be controlled entirely from the keyboard. Shortcuts only fire when no text input
            is focused.
          </p>
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Navigation</p>
            <ShortcutRow keys={["↑", "↓"]} description="Move selection up / down" />
            <ShortcutRow keys={["→"]} description="Expand selected item or backlog branch" />
            <ShortcutRow keys={["←"]} description="Collapse selected item or backlog branch" />
            <ShortcutRow keys={["Esc"]} description="Deselect all items" />
          </div>
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Creating & Deleting</p>
            <ShortcutRow keys={["Enter"]} description="New root work item" />
            <ShortcutRow keys={["Shift", "Enter"]} description="New child item under selection" />
            <ShortcutRow keys={["Del / Bksp"]} description="Delete selected item(s)" />
          </div>
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Reordering</p>
            <ShortcutRow keys={["T"]} description="Move selection to Top" />
            <ShortcutRow keys={["Shift", "B"]} description="Move selection to Bottom" />
          </div>
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Status</p>
            <ShortcutRow keys={["D"]} description="Set status: Done" />
            <ShortcutRow keys={["I"]} description="Set status: In Progress" />
            <ShortcutRow keys={["P"]} description="Set status: Pending" />
            <ShortcutRow keys={["B"]} description="Set status: Blocked" />
            <ShortcutRow keys={["N"]} description="Set status: Not Started" />
          </div>
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Other</p>
            <ShortcutRow keys={["Ctrl", "Z"]} description="Undo" />
            <ShortcutRow keys={["Ctrl", "Y"]} description="Redo (also Ctrl+Shift+Z)" />
            <ShortcutRow keys={["H"]} description="Edit hyperlinks" />
            <ShortcutRow keys={["Ctrl", "K"]} description="Edit hyperlinks (alternative)" />
            <ShortcutRow keys={["?"]} description="Toggle shortcuts overlay" />
          </div>
        </div>
      ),
    },
    {
      id: "dragdrop",
      icon: <MousePointer className="w-4 h-4" />,
      label: "Drag & Drop",
      content: (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground leading-relaxed">
            Drag and drop lets you restructure your backlogs and work items without leaving the mouse.
          </p>
          <div className="space-y-3">
            {[
              {
                icon: <MoveVertical className="w-4 h-4 text-primary" />,
                title: "Reorder work items",
                body: "Grab any work item row and drag it up or down to reorder within the same backlog.",
              },
              {
                icon: <ListTree className="w-4 h-4 text-primary" />,
                title: "Reorder backlog nodes",
                body: "Drag backlog nodes in the left panel to reorder siblings or change hierarchy.",
              },
              {
                icon: <Share2 className="w-4 h-4 text-primary" />,
                title: "Move items across trees",
                body: "Drag a work item from one backlog tree and drop it onto a node in a different tree. A prompt will ask whether to Move or Mirror the item.",
              },
            ].map((card) => (
              <div key={card.title} className="flex gap-3 p-3 rounded-lg border bg-card">
                <div className="mt-0.5 shrink-0">{card.icon}</div>
                <div>
                  <p className="text-sm font-medium">{card.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{card.body}</p>
                </div>
              </div>
            ))}
          </div>
          <Tip>
            On mobile, press and hold an item briefly to start dragging it. Long-press any item to move it
            to the top of its backlog. Swipe left to deselect, swipe
            right to expand the selected branch.
          </Tip>
        </div>
      ),
    },
    {
      id: "team",
      icon: <Users className="w-4 h-4" />,
      label: "Team & Orgs",
      content: (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground leading-relaxed">
            Agilefant² is multi-tenant. Each <strong className="text-foreground">organisation</strong> has its own
            backlog trees, work items, and team members. You can belong to multiple organisations.
          </p>
          <div className="space-y-2">
            {[
              { action: "Switch organisation", how: "Click the organisation name next to the logo to open the switcher." },
              { action: "Create organisation", how: 'Open the org switcher and choose "New Organisation".' },
              { action: "Invite team members", how: 'Go to Settings → Team and use the invite field.' },
              { action: "Assign item to member", how: "Click the avatar slot on a work item row to pick a team member." },
              { action: "Manage roles", how: "Owners can manage member roles from the Team Settings page." },
            ].map((row) => (
              <div key={row.action} className="flex gap-2 text-sm border-b border-border/40 pb-2 last:border-0">
                <span className="font-medium text-foreground shrink-0 w-44">{row.action}</span>
                <span className="text-muted-foreground">{row.how}</span>
              </div>
            ))}
          </div>
          <Tip>
            Team members must accept an invitation before they appear as assignable in your workspace.
          </Tip>
        </div>
      ),
    },
    {
      id: "sharing",
      icon: <Share2 className="w-4 h-4" />,
      label: "Sharing",
      content: (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground leading-relaxed">
            Backlog trees can be shared with other organisations so multiple teams can view and work with the same
            structure.
          </p>
          <div className="space-y-2">
            {[
              { action: "Share a tree", how: "Hover the tree header in the left panel to reveal the share icon (↗), then enter the target organisation's ID." },
              { action: "Mirror work items", how: "When drag-dropping across trees, choose Mirror to keep the item visible in both views." },
              { action: "Revoke access", how: "Return to the Share dialog and remove the organisation from the list." },
            ].map((row) => (
              <div key={row.action} className="flex gap-2 text-sm border-b border-border/40 pb-2 last:border-0">
                <span className="font-medium text-foreground shrink-0 w-36">{row.action}</span>
                <span className="text-muted-foreground">{row.how}</span>
              </div>
            ))}
          </div>
          <div className="flex gap-3 p-3 rounded-lg border bg-card text-sm">
            <Link className="w-4 h-4 text-primary shrink-0 mt-0.5" />
            <div>
              <p className="font-medium">Hyperlinks on work items</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Attach external URLs (tickets, docs, PRs) to any work item with the{" "}
                <strong>H</strong> shortcut or the link icon on the row. Links open in a new tab.
              </p>
            </div>
          </div>
        </div>
      ),
    },
    {
      id: "advanced",
      icon: <Settings className="w-4 h-4" />,
      label: "Advanced",
      content: (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground leading-relaxed">
            Agilefant² includes several power-user features for reliability and productivity.
          </p>
          <div className="space-y-3">
            {[
              {
                icon: <Undo2 className="w-4 h-4 text-primary" />,
                title: "Undo / Redo",
                body: "Every action is recorded. Use Ctrl+Z / Ctrl+Y (or the header buttons) to travel through history.",
              },
              {
                icon: <RefreshCw className="w-4 h-4 text-primary" />,
                title: "Recurring (Respawn) Items",
                body: "Mark a work item as recurring and configure its schedule. When it is marked Done it will automatically re-appear for the next cycle.",
              },
              {
                icon: <CheckCircle2 className="w-4 h-4 text-primary" />,
                title: "Data Integrity",
                body: 'Use the "Check Data" button in the header to run automated integrity checks on your data. The report is copied to your clipboard.',
              },
              {
                icon: <Settings className="w-4 h-4 text-primary" />,
                title: "Cleanse Data",
                body: 'The "Cleanse Data" header button removes orphaned records that no longer belong to any tree or backlog.',
              },
              {
                icon: <CheckCircle2 className="w-4 h-4 text-primary" />,
                title: "Run Tests",
                body: 'The "Run Tests" header button runs structured pass/fail data integrity tests and copies the full report to your clipboard.',
              },
            ].map((card) => (
              <div key={card.title} className="flex gap-3 p-3 rounded-lg border bg-card">
                <div className="mt-0.5 shrink-0">{card.icon}</div>
                <div>
                  <p className="text-sm font-medium">{card.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{card.body}</p>
                </div>
              </div>
            ))}
          </div>
          <Tip>
            Use <strong>Export data</strong> to copy the current data snapshot to the clipboard, or{" "}
            <strong>Export history</strong> to copy a CSV of all recorded changes.
          </Tip>
        </div>
      ),
    },
  ];

  const active = sections.find((s) => s.id === activeSection) ?? sections[0];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-2xl max-h-[85vh] flex flex-col p-0 gap-0"
        onClick={(e) => e.stopPropagation()}
      >
        <DialogHeader className="px-6 py-4 border-b shrink-0">
          <DialogTitle className="flex items-center gap-2 text-base">
            <BookOpen className="w-4 h-4 text-primary" />
            User Guide
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-1 min-h-0">
          {/* Sidebar nav */}
          <nav className="hidden sm:flex flex-col w-44 shrink-0 border-r py-3 gap-0.5 px-2">
            {sections.map((section) => (
              <button
                key={section.id}
                onClick={() => setActiveSection(section.id)}
                className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors text-left w-full ${
                  activeSection === section.id
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent"
                }`}
              >
                {section.icon}
                {section.label}
              </button>
            ))}
          </nav>

          {/* Mobile: horizontal pill tabs */}
          <div className="sm:hidden flex overflow-x-auto gap-1 px-3 py-2 border-b shrink-0 w-full">
            {sections.map((section) => (
              <button
                key={section.id}
                onClick={() => setActiveSection(section.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs whitespace-nowrap transition-colors shrink-0 ${
                  activeSection === section.id
                    ? "bg-primary text-primary-foreground font-medium"
                    : "bg-muted text-muted-foreground hover:bg-accent hover:text-foreground"
                }`}
              >
                {section.icon}
                {section.label}
              </button>
            ))}
          </div>

          {/* Content area */}
          <div className="flex-1 min-w-0 overflow-y-auto px-6 py-5">
            <h2 className="text-sm font-semibold mb-4 flex items-center gap-2">
              {active.icon}
              {active.label}
            </h2>
            {active.content}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
