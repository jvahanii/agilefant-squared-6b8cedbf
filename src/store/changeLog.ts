export interface ChangeLogEntry {
  timestamp: string;
  action: string;
  entityType: string;
  entityId?: string;
  entityName?: string;
  details?: string;
}

let changeLog: ChangeLogEntry[] = [];

/**
 * Records a new action in the local change log.
 */
export const logChange = (entry: Omit<ChangeLogEntry, "timestamp">) => {
  const newEntry = {
    ...entry,
    timestamp: new Date().toISOString(),
  };
  changeLog.push(newEntry);
  console.log("Change logged:", newEntry);
};

/**
 * Returns the current list of logged changes.
 */
export const getChangeLog = () => changeLog;

/**
 * Clears the history.
 */
export const clearChangeLog = () => {
  changeLog = [];
};

/**
 * Converts the current log to a CSV string and triggers a browser download.
 */
export const exportChangeLogAsCsv = () => {
  if (changeLog.length === 0) {
    console.warn("Change log is empty, nothing to export.");
    return;
  }

  // 1. Define Column Headers
  const headers = ["Timestamp", "Action", "Entity Type", "ID", "Name", "Details"];

  // 2. Format rows (wrapping in quotes to handle commas within titles/details)
  const rows = changeLog.map((entry) => [
    entry.timestamp,
    `"${(entry.action || "").replace(/"/g, '""')}"`,
    `"${(entry.entityType || "").replace(/"/g, '""')}"`,
    `"${(entry.entityId || "").replace(/"/g, '""')}"`,
    `"${(entry.entityName || "").replace(/"/g, '""')}"`,
    `"${(entry.details || "").replace(/"/g, '""')}"`,
  ]);

  // 3. Assemble CSV Content
  const csvContent = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");

  // 4. Create a Blob and trigger a "click" download
  try {
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    // Set filename with a unique timestamp
    const fileName = `changelog_${new Date().toISOString().split("T")[0]}_${Date.now()}.csv`;

    link.setAttribute("href", url);
    link.setAttribute("download", fileName);
    link.style.visibility = "hidden";

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    // Clean up memory
    URL.revokeObjectURL(url);

    console.log(`Successfully exported ${changeLog.length} entries to ${fileName}`);
  } catch (error) {
    console.error("Failed to export CSV:", error);
  }
};
