import { ChangeLogEntry } from "./appStore";

export const triggerCsvDownload = (logs: ChangeLogEntry[]) => {
  if (!logs || logs.length === 0) {
    console.warn("No changes to export");
    return;
  }

  const headers = ["Timestamp", "Action", "Type", "ID", "Name", "Details"];

  const rows = logs.map((entry) => [
    entry.timestamp,
    `"${(entry.action || "").replace(/"/g, '""')}"`,
    `"${(entry.entityType || "").replace(/"/g, '""')}"`,
    `"${(entry.entityId || "").replace(/"/g, '""')}"`,
    `"${(entry.entityName || "").replace(/"/g, '""')}"`,
    `"${(entry.details || "").replace(/"/g, '""')}"`,
  ]);

  const csvContent = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.setAttribute("href", url);
  link.setAttribute("download", `changelog_${Date.now()}.csv`);
  link.style.visibility = "hidden";

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};
