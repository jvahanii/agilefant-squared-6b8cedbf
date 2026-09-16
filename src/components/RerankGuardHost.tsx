import { ActionPrompt } from "@/components/ActionPrompt";
import { useRerankGuardStore } from "@/store/rerankGuardStore";

/**
 * The question asked before a top-level move in a list sorted by something other
 * than rank. Mounted once; requestTopLevelRerank decides when it appears.
 */
export function RerankGuardHost() {
  const pending = useRerankGuardStore((s) => s.pending);
  const confirm = useRerankGuardStore((s) => s.confirm);
  const cancel = useRerankGuardStore((s) => s.cancel);

  if (!pending) return null;

  return (
    <ActionPrompt
      title="Changing rank will save the current order. Are you sure?"
      options={[
        {
          label: "Yes",
          description: "Saves the order shown as rank, makes the move, and switches the list back to rank order.",
          value: "yes",
          isDefault: true,
        },
        {
          label: "Cancel",
          description: "Nothing is moved or saved.",
          value: "cancel",
        },
      ]}
      onSelect={(value) => (value === "yes" ? confirm() : cancel())}
      onCancel={cancel}
    />
  );
}
