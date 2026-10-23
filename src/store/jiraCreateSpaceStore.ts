import { create } from "zustand";

/**
 * The list whose "Sync with Jira…" dialog is open, from its right-click menu.
 * The menu is the same wherever a list is right-clicked, so the one dialog is
 * mounted once (JiraCreateSpaceDialogHost) and opened through here.
 */
interface JiraCreateSpaceState {
  backlogId: string | null;
  open: (backlogId: string) => void;
  close: () => void;
}

export const useJiraCreateSpaceStore = create<JiraCreateSpaceState>((set) => ({
  backlogId: null,
  open: (backlogId) => set({ backlogId }),
  close: () => set({ backlogId: null }),
}));
