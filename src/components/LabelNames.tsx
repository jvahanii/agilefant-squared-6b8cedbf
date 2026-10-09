import { useMemo } from "react";
import { useLabelsStore, type Label } from "@/store/labelsStore";
import { useOrgStore } from "@/store/orgStore";
import { useOrgSettingsStore } from "@/store/orgSettingsStore";

/**
 * Labels written out after a name, each in its own colour: one label as it
 * is, several in brackets — "[Applied, Urgent]". The same wherever a name
 * carries its labels, an item's row and a list's heading alike.
 */
export function LabelNames({ labels, className = "ml-1" }: { labels: readonly Label[]; className?: string }) {
  if (labels.length === 0) return null;
  return (
    <span className={className}>
      {labels.length === 1 ? (
        <span style={{ color: labels[0].color }}>{labels[0].name}</span>
      ) : (
        <>
          {"["}
          {labels.map((label, i) => (
            <span key={label.id}>
              {i > 0 && ", "}
              <span style={{ color: label.color }}>{label.name}</span>
            </span>
          ))}
          {"]"}
        </>
      )}
    </span>
  );
}

/**
 * A list's labels, for the heading over its items. A list could be given
 * labels — from its row in the tree, or its menu — but only the tree showed
 * them, as dots; open the list and there was no sign of them.
 *
 * Shown where the organization has labels on, by name, as on an item's row.
 */
export function ListHeadingLabels({ backlogId }: { backlogId: string }) {
  const activeOrgId = useOrgStore((s) => s.activeOrgId);
  const labelsEnabled = useOrgSettingsStore((s) => s.settings[activeOrgId ?? ""]?.labelsEnabled ?? false);
  const labelsMap = useLabelsStore((s) => s.labels);
  const assigned = useLabelsStore((s) => s.byEntity[`backlog:${backlogId}`]);
  const labels = useMemo(
    () =>
      (assigned ?? [])
        .map((id) => labelsMap[id])
        .filter(Boolean)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [assigned, labelsMap],
  );
  if (!labelsEnabled) return null;
  // Smaller and lighter than the name it follows: it describes the list, it
  // is not part of what the list is called.
  return <LabelNames labels={labels} className="ml-2 text-sm font-medium" />;
}
