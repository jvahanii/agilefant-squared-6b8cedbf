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
  Clock,
  Moon,
  Tag,
  Search,
  SlidersHorizontal,
  Archive,
  Eye,
  Shield,
  TrendingUp,
  LayoutGrid,
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
    <span className="text-sm text-muted-foreground mr-2">{description}</span>
    <div className="flex items-center gap-1 shrink-0">
      {keys.map((k, i) => (
        <span key={i} className="flex items-center gap-1">
          {i > 0 && <span className="text-muted-foreground/50 text-xs">+</span>}
          <KbdKey>{k}</KbdKey>
        </span>
      ))}
    </div>
  </div>
);

const ActionRow = ({ action, how, labelWidth = "sm:w-36" }: { action: string; how: string; labelWidth?: string }) => (
  <div className="flex flex-col sm:flex-row gap-0.5 sm:gap-2 text-sm border-b border-border/40 pb-2 last:border-0">
    <span className={`font-medium text-foreground sm:shrink-0 ${labelWidth}`}>{action}</span>
    <span className="text-muted-foreground">{how}</span>
  </div>
);

const Tip = ({ children }: { children: React.ReactNode }) => (
  <div className="flex gap-2 p-3 rounded-lg bg-primary/5 border border-primary/10 text-sm text-muted-foreground">
    <Star className="w-4 h-4 text-primary shrink-0 mt-0.5" />
    <span>{children}</span>
  </div>
);

function buildSections(): Section[] {
  return [
    {
      id: "overview",
      icon: <BookOpen className="w-4 h-4" />,
      label: "Overview",
      content: (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground leading-relaxed">
            <strong className="text-foreground">Agilefant²</strong> is a free, simple and powerful tool for backlog and
            work item management. It scales from the individual to the enterprise. Organise your work into nested
            backlogs, track item status, collaborate across organisations, and move fast with keyboard-first
            interactions.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[
              {
                icon: <ListTree className="w-4 h-4 text-primary" />,
                title: "Backlog Trees",
                body: "Organise work into hierarchical backlog trees shown in the left panel.",
              },
              {
                icon: <Layers className="w-4 h-4 text-primary" />,
                title: "Work Items",
                body: "Create and manage work items within any backlog node in the right panel.",
              },
              {
                icon: <Keyboard className="w-4 h-4 text-primary" />,
                title: "Keyboard-first",
                body: "Almost every action has a keyboard shortcut. Press ? to see the list.",
              },
              {
                icon: <Users className="w-4 h-4 text-primary" />,
                title: "Team Collaboration",
                body: "Assign team members to items, share trees across organisations.",
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
            New here? Start by creating a <strong>backlog tree</strong> in the left panel, then add a{" "}
            <strong>work item</strong> by selecting a backlog node and pressing <KbdKey>Enter</KbdKey>.
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
              {
                action: "Add a backlog node",
                how: "Select an existing node and press Shift+Enter, or hover the node row and click the + icon.",
              },
              {
                action: "Rename a node",
                how: "Double-click the node name to edit it in-place. Tree headers can also be renamed by double-clicking their name.",
              },
              {
                action: "Select a backlog",
                how: "Click anywhere on a backlog row to select it and load its work items in the right panel.",
              },
              { action: "Delete a node", how: "Select the node and press Delete / Backspace." },
              { action: "Reorder nodes", how: "Drag and drop nodes within the tree to reorder them." },
              { action: "Expand / collapse", how: "Click the expand arrow or press → to open a branch." },
            ].map((row) => (
              <ActionRow key={row.action} action={row.action} how={row.how} />
            ))}
          </div>
          <Tip>
            You can have multiple top-level backlog trees. Use them to separate unrelated workstreams (e.g. "Product",
            "Engineering", "Marketing").
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
            The <strong className="text-foreground">right panel</strong> shows work items for the selected backlog.
            Items can be nested into child items for fine-grained breakdown.
          </p>
          <div className="space-y-2">
            {[
              {
                action: "New root item",
                how: "Select a backlog and press Enter, or click the + button in the panel header.",
              },
              {
                action: "New child item",
                how: "Select a parent item and press Shift+Enter, or click the + icon on the item row.",
              },
              { action: "Select an item", how: "Click anywhere on the item row to select it." },
              { action: "Rename an item", how: "Double-click the item title to edit it directly in-place." },
              {
                action: "Toggle done",
                how: "Double-click (desktop) or double-tap (mobile) the empty space on an item row — anywhere that is not the title text — to toggle its status to Done.",
              },
              {
                action: "Delete item(s)",
                how: "Select item(s) and press Delete or Backspace, or click the trash icon on the row.",
              },
              {
                action: "Multi-select",
                how: "Shift+Click to select a range, or Ctrl+Click (Cmd+Click on Mac) to toggle individual items.",
              },
              { action: "Set story points", how: "Click the story-points value on the item row. When an item has children its points badge shows completed/total (e.g. 3/8) — the total rolls up from child items automatically." },
              {
                action: "Paste items",
                how: "Copy a list of titles (one per line) then click the clipboard icon in the panel header to bulk-add.",
              },
              { action: "Add hyperlinks", how: "Press H or Ctrl/Cmd+K to open the hyperlinks dialog." },
              {
                action: "Set recurring",
                how: "Click the settings icon on the item row to open respawn settings and configure the schedule.",
              },
              {
                action: "Reparent item(s)",
                how: "Select item(s) and press R, or right-click and choose Reparent, to open the Move to Parent dialog. Search for a new parent item or choose \"Move to root (no parent)\".",
              },
              {
                action: "Move to backlog",
                how: "Select item(s) and press M, or right-click and choose Move to Backlog, to move items to a different backlog within the same tree.",
              },
              {
                action: "Indent (make child)",
                how: "Select an item and press Tab to make it a child of the item directly above it.",
              },
              {
                action: "Outdent (elevate)",
                how: "Select an item and press Shift+Tab to move it up to its parent's level (becomes a sibling of its current parent).",
              },
            ].map((row) => (
              <ActionRow key={row.action} action={row.action} how={row.how} />
            ))}
          </div>
          <div>
            <p className="text-sm font-medium mb-2">Item Statuses</p>
            <div className="flex flex-wrap gap-2">
              <StatusBadge color="bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300" label="Not Started" />
              <StatusBadge
                color="bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
                label="In Progress"
              />
              <StatusBadge
                color="bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300"
                label="Pending"
              />
              <StatusBadge color="bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" label="Blocked" />
              <StatusBadge color="bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300" label="Done" />
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              When you set a child item to <strong>In Progress</strong> or <strong>Done</strong>, its ancestors are
              automatically promoted to <strong>In Progress</strong> so the hierarchy reflects active work.
            </p>
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
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              Creating & Deleting
            </p>
            <ShortcutRow keys={["Enter"]} description="New root work item" />
            <ShortcutRow keys={["Shift", "Enter"]} description="New child item under selection" />
            <ShortcutRow keys={["Del / Bksp"]} description="Delete selected item(s)" />
          </div>
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Reordering</p>
            <ShortcutRow keys={["T"]} description="Move selection to Top" />
            <ShortcutRow keys={["Shift", "B"]} description="Move selection to Bottom" />
            <ShortcutRow keys={["O"]} description="Move item down one position" />
            <ShortcutRow keys={["U"]} description="Move item up one position" />
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
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Reparenting & Moving</p>
            <ShortcutRow keys={["R"]} description="Reparent: open Move to Parent dialog" />
            <ShortcutRow keys={["M"]} description="Move to Backlog dialog" />
            <ShortcutRow keys={["Tab"]} description="Indent: make child of item above" />
            <ShortcutRow keys={["Shift", "Tab"]} description="Outdent: elevate to parent's level" />
          </div>
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Other</p>
            <ShortcutRow keys={["Ctrl", "Z"]} description="Undo" />
            <ShortcutRow keys={["Ctrl", "Y"]} description="Redo (also Ctrl+Shift+Z)" />
            <ShortcutRow keys={["H"]} description="Edit hyperlinks" />
            <ShortcutRow keys={["Ctrl", "K"]} description="Edit hyperlinks (alternative)" />
            <ShortcutRow keys={["L"]} description="Log spent time" />
            <ShortcutRow keys={["/"]} description="Focus search bar" />
            <ShortcutRow keys={["?"]} description="Toggle shortcuts overlay" />
          </div>
        </div>
      ),
    },
    {
      id: "boardview",
      icon: <LayoutGrid className="w-4 h-4" />,
      label: "Board View",
      content: (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground leading-relaxed">
            The <strong className="text-foreground">Board View</strong> shows leaf (non-parent) work items as
            cards grouped by status column. Each status becomes a column where you can see and manage items at
            a glance.
          </p>
          <div className="space-y-2">
            {[
              {
                action: "Switch to Board",
                how: 'Click the "Board" tab in the toolbar above the work items panel. The List / Board toggle appears when boards are enabled in Settings.',
              },
              {
                action: "Switch back to List",
                how: 'Click "List" in the same toolbar toggle. Your preference is remembered globally.',
              },
              {
                action: "Change item status",
                how: (
                  <>
                    Drag a card from one column to another to change its status instantly, or right-click the
                    card and choose <strong>Status</strong> → pick a status.
                  </>
                ),
              },
              {
                action: "Add item to a column",
                how: 'Click the "+" button in any column header to add a new item directly with that status.',
              },
              {
                action: "Reorder within a column",
                how: "Drag a card up or down within a column to reorder it. Drop zones appear between cards.",
              },
              {
                action: "Board cards show",
                how: "Cards display the item title, story points (if enabled), assigned labels, and team badges.",
              },
              {
                action: "Hidden columns",
                how: (
                  <>
                    Click the <strong>Columns</strong> dropdown above the board to toggle column visibility. 
                    Hidden columns disappear from the board but items in those statuses remain intact. 
                    Visibility is per-tree and persisted to the database — everyone sharing the tree sees 
                    the same column layout. A badge shows the count of visible columns (e.g. 3/5).
                  </>
                ),
              },
              {
                action: "All hidden state",
                how: "If every column is hidden, a message appears suggesting you use the Columns dropdown to show them.",
              },
            ].map((row) => (
              <ActionRow key={row.action} action={row.action} how={row.how} labelWidth="sm:w-40" />
            ))}
          </div>
          <Tip>
            Board view is ideal for kanban-style workflows — drag an item from "Not Started" to "In Progress"
            to "Done" as it moves through your pipeline.
          </Tip>
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
                title: "Reparent by dropping on an item",
                body: "Drag a work item and drop it directly onto another work item to make it a child of that item.",
              },
              {
                icon: <Share2 className="w-4 h-4 text-primary" />,
                title: "Move items across trees",
                body: "Drag a work item from one backlog tree and drop it onto a node in a different tree. A prompt will ask whether to Move or Mirror the item.",
              },
              {
                icon: <Share2 className="w-4 h-4 text-primary" />,
                title: "Move to root",
                body: "Drag a work item and drop it onto a backlog node (in the left panel) to move it to root level in that backlog.",
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
            On mobile, press and hold an item briefly to start dragging it. Long-press any item to move it to the top of
            its backlog. Swipe left to deselect, swipe right to expand the selected branch.
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
              {
                action: "Switch organisation",
                how: "Click the organisation name next to the logo to open the switcher.",
              },
              { action: "Create organisation", how: 'Open the org switcher and choose "New Organisation".' },
              { action: "Invite team members", how: "Go to Settings → Team and use the invite field." },
              {
                action: "Assign item to member",
                how: "Click the avatar slot on a work item row to pick a team member.",
              },
              { action: "Manage roles", how: "Owners can manage member roles from the Team Settings page." },
            ].map((row) => (
              <ActionRow key={row.action} action={row.action} how={row.how} labelWidth="sm:w-44" />
            ))}
          </div>
          <Tip>Team members must accept an invitation before they appear as assignable in your workspace.</Tip>
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
              {
                action: "Share a tree",
                how: "Hover the tree header in the left panel to reveal the share icon (↗), then enter the target organisation's ID.",
              },
              {
                action: "Mirror work items",
                how: "When drag-dropping across trees, choose Mirror to keep the item visible in both views.",
              },
              { action: "Revoke access", how: "Return to the Share dialog and remove the organisation from the list." },
            ].map((row) => (
              <ActionRow key={row.action} action={row.action} how={row.how} />
            ))}
          </div>
          <div className="flex gap-3 p-3 rounded-lg border bg-card text-sm">
            <Link className="w-4 h-4 text-primary shrink-0 mt-0.5" />
            <div>
              <p className="font-medium">Hyperlinks on work items</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Attach external URLs (tickets, docs, PRs) to any work item with the <strong>H</strong> shortcut or the
                link icon on the row. Links open in a new tab.
              </p>
            </div>
          </div>
        </div>
      ),
    },
    {
      id: "timelogging",
      icon: <Clock className="w-4 h-4" />,
      label: "Time Logging",
      content: (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground leading-relaxed">
            <strong className="text-foreground">Time logging</strong> lets team members record time spent on work items.
            The feature is off by default and must be enabled by a superuser in{" "}
            <strong className="text-foreground">Settings → Time Logging</strong>.
          </p>
          <div className="space-y-2">
            {[
              {
                action: "Enable time logging",
                how: "A superuser opens Settings and toggles the Time Logging switch on. The setting is per-organisation.",
              },
              {
                action: "Log time on an item",
                how: "Hover a work item row and click the clock icon (🕐) to open the Time Log dialog, then enter duration, date, and an optional note.",
              },
              {
                action: "Duration format",
                how: 'Accepts "30m", "1h", "1h 30m", or a plain number (interpreted as minutes).',
              },
              {
                action: "View logged time",
                how: "Open the Time Log dialog on any item to see all entries, their dates, durations, notes, and who logged them.",
              },
              {
                action: "Delete an entry",
                how: "Hover an entry you created and click the trash icon. Only the person who logged the entry can delete it.",
              },
            ].map((row) => (
              <ActionRow key={row.action} action={row.action} how={row.how} labelWidth="sm:w-44" />
            ))}
          </div>
          <Tip>Time entries are synced in real time — your teammates will see logged time as soon as it is saved.</Tip>
        </div>
      ),
    },
    {
      id: "snooze",
      icon: <Moon className="w-4 h-4" />,
      label: "Snooze",
      content: (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground leading-relaxed">
            <strong className="text-foreground">Snooze</strong> temporarily hides a work item until a future date and
            time. Snoozed items disappear from the backlog view and automatically reappear when the snooze expires.
            Snoozes are per-user — your teammates see items at all times.
          </p>
          <div className="space-y-2">
            {[
              {
                action: "Snooze an item",
                how: "Right-click the item row to open the context menu, hover Snooze, then pick a quick option or choose \"More options\u2026\" to open the full snooze dialog.",
              },
              {
                action: "Quick options",
                how: "Later Today (3 hrs), Tomorrow Morning (7 AM), This Weekend (Sat 7 AM), Next Week (Mon 7 AM), One Week from Now (7 days), Next Month, Next Year.",
              },
              {
                action: "Custom date / time",
                how: "Open \"More options\u2026\" from the context menu or click \"Snooze\" on an item to open the dialog, then use the date-time picker and click \"Snooze until selected time\".",
              },
              {
                action: "Unsnooze early",
                how: "Click the snooze indicator (moon badge) shown on the item row, or right-click the item and choose Unsnooze.",
              },
              {
                action: "Unsnooze All",
                how: "When there are snoozed items in the current backlog a bell-off badge appears in the work items panel header showing the count. Click it to instantly wake all snoozed items in that backlog.",
              },
              {
                action: "Automatic wake-up",
                how: "When the snooze time passes the item reappears automatically without any action needed.",
              },
            ].map((row) => (
              <ActionRow key={row.action} action={row.action} how={row.how} labelWidth="sm:w-40" />
            ))}
          </div>
          <Tip>
            Snooze is useful for items you cannot act on right now but don't want to lose — for example, items blocked
            by an external dependency that resolves next week.
          </Tip>
        </div>
      ),
    },
    {
      id: "labels",
      icon: <Tag className="w-4 h-4" />,
      label: "Labels",
      content: (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground leading-relaxed">
            <strong className="text-foreground">Labels</strong> let you tag work items with colored badges for
            categorization and filtering. The feature is off by default and must be enabled by a superuser in{" "}
            <strong className="text-foreground">Settings → Labels</strong>.
          </p>
          <div className="space-y-2">
            {[
              {
                action: "Enable labels",
                how: "A superuser opens Settings and toggles the Labels switch on. The setting is per-organisation.",
              },
              {
                action: "Create a label",
                how: "Go to Settings → Labels, enter a name, pick a color, and click Add.",
              },
              {
                action: "Edit / delete a label",
                how: "In Settings → Labels, click the pencil icon to rename or recolor a label, or the trash icon to remove it.",
              },
              {
                action: "Assign a label",
                how: "Right-click any work item and choose Labels, then click the label to toggle it on the item. On mobile, open the attributes sheet and tap the Labels row.",
              },
              {
                action: "Bulk assign",
                how: "Select multiple items, then right-click and choose Labels. Each label shows how many selected items already have it.",
              },
              {
                action: "Filter by label",
                how: "When labels are enabled a chip bar appears above the work item list. Click a label chip to filter the list to only items with that label (ancestors are shown for context).",
              },
              {
                action: "Clear label filter",
                how: "Click the × button at the right of the chip bar, or click the active chip again to deselect it.",
              },
            ].map((row) => (
              <ActionRow key={row.action} action={row.action} how={row.how} labelWidth="sm:w-40" />
            ))}
          </div>
          <Tip>
            Label chips in the filter bar are only shown for labels that appear on at least one item in the currently
            selected backlog, keeping the bar compact.
          </Tip>
        </div>
      ),
    },
    {
      id: "search",
      icon: <Search className="w-4 h-4" />,
      label: "Search",
      content: (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground leading-relaxed">
            The <strong className="text-foreground">search bar</strong> at the top of the left panel lets you find work
            items by name across all backlog trees in your organisation. Results are shown in the right panel with full
            context so you can navigate directly to any item.
          </p>
          <div className="space-y-2">
            {[
              {
                action: "Open search",
                how: 'Click inside the search bar at the top of the left panel, or press "/" from anywhere (when no text input is focused) to jump to it.',
              },
              {
                action: "Find items",
                how: "Type any part of the work item title. Results update as you type and are sorted alphabetically.",
              },
              {
                action: "Result context",
                how: "Each result shows the matching title with the search term highlighted, the backlog tree and full backlog hierarchy path, and any parent work item ancestors — so you can tell apart items with the same name.",
              },
              {
                action: "Navigate to an item",
                how: "Click a search result to navigate directly to it: the left panel expands to the correct backlog, the right panel opens and selects the matching item.",
              },
              {
                action: "Clear search",
                how: 'Press Escape, click the × button in the search bar, or click a result — the search field clears and the normal backlog view returns.',
              },
            ].map((row) => (
              <ActionRow key={row.action} action={row.action} how={row.how} labelWidth="sm:w-40" />
            ))}
          </div>
          <Tip>
            Search is scoped to the current organisation. Switching organisations clears the search.
          </Tip>
        </div>
      ),
    },
    {
      id: "statuses",
      icon: <SlidersHorizontal className="w-4 h-4" />,
      label: "Custom Statuses",
      content: (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground leading-relaxed">
            <strong className="text-foreground">Custom statuses</strong> let each backlog tree define its own set of
            colored work item statuses, replacing the default Not Started / In Progress / Pending / Blocked / Done
            labels with names and colors that match your team's workflow. The feature is enabled by a superuser in{" "}
            <strong className="text-foreground">Settings → Custom Statuses</strong>.
          </p>
          <div className="space-y-2">
            {[
              {
                action: "Enable",
                how: "A superuser opens Settings and toggles the \"Enable per-tree statuses\" switch on. A gear (⚙) icon will then appear on each backlog tree header.",
              },
              {
                action: "Open the editor",
                how: "Hover a tree header in the left panel and click the ⚙ gear icon to open the Statuses dialog for that tree.",
              },
              {
                action: "Add a status",
                how: "Pick a color with the color picker, type a name, and press Enter or click Add.",
              },
              {
                action: "Edit a status",
                how: "Click the color swatch to change the color, or click the name field and type a new label.",
              },
              {
                action: "Reorder statuses",
                how: "Use the ↑ / ↓ arrow buttons to move a status up or down in the list.",
              },
              {
                action: "Delete a status",
                how: "Click the trash icon on the status row. At least one status must remain in the tree.",
              },
              {
                action: "Locked statuses",
                how: 'Statuses marked with a lock icon are required (e.g. "Not Started" and "Done") and cannot be renamed, recolored, or removed.',
              },
            ].map((row) => (
              <ActionRow key={row.action} action={row.action} how={row.how} labelWidth="sm:w-40" />
            ))}
          </div>
          <Tip>
            Custom statuses are per-tree and visible to everyone with access to that tree. Changes take effect
            immediately without a page reload.
          </Tip>
        </div>
      ),
    },
    {
      id: "backups",
      icon: <Archive className="w-4 h-4" />,
      label: "Backups",
      content: (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground leading-relaxed">
            Agilefant² takes <strong className="text-foreground">automatic daily snapshots</strong> of your entire
            organisation and keeps them for 30 days. You can also create manual backups at any time and restore from
            any snapshot — either the whole org, selected trees, or individual backlogs.
          </p>
          <div className="space-y-2">
            {[
              {
                action: "Open Backups",
                how: "Go to Settings → Team and scroll to the Backups & Restore card.",
              },
              {
                action: "Create a manual backup",
                how: 'Click "Backup now". A snapshot is created immediately and appears in the list.',
              },
              {
                action: "Restore from a snapshot",
                how: 'Click the "Restore" button on any backup row to open the Restore dialog.',
              },
              {
                action: "Restore scope",
                how: "Choose Everything in the snapshot to restore the whole org, Selected backlog trees to pick one or more trees, or Selected backlogs to restore individual backlog nodes.",
              },
              {
                action: "Restore mode",
                how: "Restores run as a merge: items present in the snapshot are brought back to their saved state, while items that exist today but were absent from the snapshot are left untouched.",
              },
              {
                action: "Delete a backup",
                how: "Click the trash icon on a backup row. Automatic backups can also be deleted manually if storage is a concern.",
              },
            ].map((row) => (
              <ActionRow key={row.action} action={row.action} how={row.how} labelWidth="sm:w-40" />
            ))}
          </div>
          <Tip>
            Restore is non-destructive by default — it merges the snapshot back in rather than wiping your current
            data. Use "Everything in the snapshot" only when you want a full rollback.
          </Tip>
        </div>
      ),
    },
    {
      id: "financials",
      icon: <TrendingUp className="w-4 h-4" />,
      label: "Savings & Income",
      content: (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground leading-relaxed">
            <strong className="text-foreground">Savings &amp; Income</strong> lets you attach monthly financial
            projections to work items and track how actuals compare to your plan. The feature is off by default and must
            be enabled by a superuser in{" "}
            <strong className="text-foreground">Settings → Savings &amp; Income</strong>.
          </p>
          <div className="space-y-2">
            {[
              {
                action: "Enable the feature",
                how: "A superuser opens Settings and toggles the \"Enable savings & income\" switch on. The setting is per-organisation.",
              },
              {
                action: "Open the dialog",
                how: "Right-click any work item and choose \"Savings & Income\" from the context menu to open the financial entry dialog.",
              },
              {
                action: "Plan rows",
                how: "Enter projected savings and income month-by-month for the selected year. Plan values are always editable for any month.",
              },
              {
                action: "Actual rows",
                how: "Record realised amounts. Actual cells are editable only for months that have already ended — current and future month cells are disabled with a tooltip explaining why.",
              },
              {
                action: "Pre-populated actuals",
                how: "When you open the dialog, past-month Actual cells are pre-filled from the corresponding Plan values if no actual has been entered yet, eliminating the need to manually copy Plan values to Actual fields.",
              },
              {
                action: "Year total",
                how: "Type a total in the Year column and press Enter (or tab away) to distribute it evenly across the year. For Plan rows it spreads across all 12 months; for Actual rows it spreads only across past months. The column is disabled for Actual rows when the selected year has no past months yet.",
              },
              {
                action: "Navigate years",
                how: "Use the ← / → arrows at the top of the dialog to switch between years. Click Today to jump back to the current year.",
              },
              {
                action: "Currency",
                how: "Each entry has its own currency. Changing the currency in the dialog converts all four maps (Savings Plan, Savings Actual, Income Plan, Income Actual) using daily ECB rates. Totals shown elsewhere in the app convert to your chosen display currency automatically.",
              },
              {
                action: "Save / Clear",
                how: "Click Save to persist all four maps. \"Clear all\" removes the entire financial entry for the item.",
              },
            ].map((row) => (
              <ActionRow key={row.action} action={row.action} how={row.how} labelWidth="sm:w-44" />
            ))}
          </div>
          <div className="flex gap-3 p-3 rounded-lg border bg-card text-sm">
            <TrendingUp className="w-4 h-4 text-primary shrink-0 mt-0.5" />
            <div>
              <p className="font-medium">Cumulative Flow Chart</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Click the chart icon on any backlog tree header to open the Cumulative Flow Chart. It overlays{" "}
                <strong>Plan</strong> (dashed, translucent) and <strong>Actual</strong> (solid) series side-by-side so
                you can spot variances at a glance. A vertical <strong>today</strong> reference line marks the boundary
                between realised and projected months. Use the Group&nbsp;By selector to view financials broken down by
                type (savings vs income), by work item, by item status, or by backlog list.
              </p>
            </div>
          </div>
          <Tip>
            Actual data is sourced from past months only — the chart never shows actuals for the current or future months
            so your projections and reality remain clearly separated.
          </Tip>
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
              {
                icon: <Eye className="w-4 h-4 text-primary" />,
                title: "Role Simulator (superusers only)",
                body: 'Click the role-switcher pyramid icon in the header to simulate Owner, Admin, or Member. The UI hides superuser-only controls so you see exactly what your team members see. Click again and select "Superuser (real)" to restore your full permissions.',
              },
              {
                icon: <Shield className="w-4 h-4 text-primary" />,
                title: "Manager Screen (superusers only)",
                body: "Open from the org switcher → Manager Screen. Browse every organisation, user, and team across the platform, jump straight into any org, review per-org billing plans, and see an Actions column showing how many tracked changes each organisation has accumulated — a quick health/activity signal.",
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
}

export function UserGuideContent() {
  const [activeSection, setActiveSection] = useState("overview");
  const sections = buildSections();
  const active = sections.find((s) => s.id === activeSection) ?? sections[0];

  return (
    <div className="flex flex-col sm:flex-row flex-1 min-h-0">
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
      <div className="sm:hidden flex overflow-x-auto gap-1 px-3 py-2 border-b shrink-0">
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
      <div className="flex-1 min-w-0 overflow-y-auto px-4 sm:px-6 py-4 sm:py-5">
        <h2 className="text-sm font-semibold mb-4 flex items-center gap-2">
          {active.icon}
          {active.label}
        </h2>
        {active.content}
      </div>
    </div>
  );
}

export function UserGuideDialog({ open, onOpenChange }: UserGuideDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col p-0 gap-0" onClick={(e) => e.stopPropagation()}>
        <DialogHeader className="px-6 py-4 border-b shrink-0">
          <DialogTitle className="flex items-center gap-2 text-base">
            <BookOpen className="w-4 h-4 text-primary" />
            User Guide
          </DialogTitle>
        </DialogHeader>

        <UserGuideContent />
      </DialogContent>
    </Dialog>
  );
}
