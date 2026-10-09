import { ScramblePinDialog } from "@/components/ScramblePinDialog";
import { useAppStore } from "@/store/appStore";
import { useListScrambleStore } from "@/store/listScrambleStore";
import { releaseOverlayLock } from "@/lib/overlayLock";

/**
 * The PIN dialog for scrambling a list, mounted once for the whole app: a
 * list's menu opens it from the tree and from the header over its items, and
 * neither should have to carry it.
 */
export function ListScrambleDialogHost() {
  const prompt = useListScrambleStore((s) => s.prompt);
  const close = useListScrambleStore((s) => s.close);
  const confirm = useListScrambleStore((s) => s.confirm);
  const name = useAppStore((s) => (prompt ? s.backlogs[prompt.backlogId]?.name : undefined));

  if (!prompt) return null;
  return (
    <ScramblePinDialog
      open
      onOpenChange={(open) => {
        if (open) return;
        close();
        // Opened from a right-click menu: see overlayLock.
        releaseOverlayLock();
      }}
      mode={prompt.mode}
      action={prompt.kind === "scramble" ? "Scramble" : prompt.kind === "reveal" ? "Show name" : "Unscramble"}
      heading={
        prompt.kind === "scramble"
          ? "Scramble this list"
          : prompt.kind === "reveal"
            ? "Show this list's name"
            : "Unscramble this list"
      }
      itemTitle={name ?? ""}
      onConfirm={confirm}
    />
  );
}
