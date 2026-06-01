import { useEffect } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAppStore } from "@/store/appStore";

const BUCKET = "work-item-attachments";

const extFromType = (type: string) => {
  const m = /^image\/([a-zA-Z0-9+.-]+)$/.exec(type);
  if (!m) return "png";
  const sub = m[1].toLowerCase();
  if (sub === "jpeg") return "jpg";
  if (sub === "svg+xml") return "svg";
  return sub;
};

const isEditableTarget = (t: EventTarget | null) => {
  if (!(t instanceof HTMLElement)) return false;
  const tag = t.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (t.isContentEditable) return true;
  return false;
};

/**
 * Global paste handler: when an image is on the clipboard and exactly one
 * work item is selected, upload it to Supabase Storage and attach it to that
 * item as a hyperlink. Skipped when the paste target is an editable field
 * (so paste-into-textbox keeps working normally).
 */
export function usePasteImageOnSelected() {
  useEffect(() => {
    const handler = async (e: ClipboardEvent) => {
      if (isEditableTarget(e.target)) return;
      const items = e.clipboardData?.items;
      if (!items || items.length === 0) return;

      let file: File | null = null;
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (it.kind === "file" && it.type.startsWith("image/")) {
          file = it.getAsFile();
          if (file) break;
        }
      }
      if (!file) return;

      const state = useAppStore.getState();
      const selected = state.selectedWorkItemIds;
      if (selected.length === 0) {
        toast.error("Select a work item before pasting an image");
        return;
      }
      if (selected.length > 1) {
        toast.error("Select exactly one work item to attach a pasted image");
        return;
      }
      const workItemId = selected[0];
      const item = state.workItems[workItemId];
      if (!item) return;

      const orgId = item.organizationId ?? state.organizationId;
      if (!orgId) {
        toast.error("No organization available for upload");
        return;
      }

      e.preventDefault();
      const ext = extFromType(file.type);
      const filename = `${orgId}/${workItemId.replace(/[^a-zA-Z0-9_-]/g, "_")}/${crypto.randomUUID()}.${ext}`;

      const toastId = toast.loading("Uploading pasted image…");
      try {
        const { error: upErr } = await supabase.storage
          .from(BUCKET)
          .upload(filename, file, {
            contentType: file.type || "image/png",
            upsert: false,
          });
        if (upErr) throw upErr;

        // Bucket is private — store a stable signed URL reference. Consumers
        // re-sign at open time via resolveOpenableHref().
        const { data: signed, error: signErr } = await supabase.storage
          .from(BUCKET)
          .createSignedUrl(filename, 60 * 60);
        if (signErr || !signed?.signedUrl) throw signErr ?? new Error("Failed to sign URL");
        const publicUrl = signed.signedUrl;

        const altText = `Pasted image ${new Date().toLocaleString()}`;
        useAppStore.getState().addHyperlink(workItemId, publicUrl, altText);

        toast.success("Image attached to work item", {
          id: toastId,
          description: item.title,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Upload failed";
        toast.error("Could not attach pasted image", { id: toastId, description: msg });
      }
    };

    window.addEventListener("paste", handler);
    return () => window.removeEventListener("paste", handler);
  }, []);
}
