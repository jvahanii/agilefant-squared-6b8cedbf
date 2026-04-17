import ExcelJS from "exceljs";
import { TimeEntry } from "@/store/timeEntryStore";
import { WorkItem, Backlog } from "@/types/models";
import { supabase } from "@/integrations/supabase/client";

export async function exportTimesheets(
  entries: TimeEntry[],
  workItems: Record<string, WorkItem>,
  backlogs: Record<string, Backlog>,
  orgName: string,
): Promise<void> {
  // Sort: latest first (spentDate desc, then createdAt desc)
  const sorted = [...entries].sort(
    (a, b) =>
      b.spentDate.localeCompare(a.spentDate) ||
      b.createdAt.localeCompare(a.createdAt),
  );

  // Fetch display names for all users that appear in entries
  const userIds = [...new Set(sorted.map((e) => e.userId))];
  const userNames: Record<string, string> = {};
  if (userIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, email, full_name")
      .in("id", userIds);
    for (const p of profiles ?? []) {
      userNames[p.id] = (p.full_name as string | null) || (p.email as string) || p.id;
    }
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Agilefant";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("Timesheets");

  // Header row
  sheet.columns = [
    { header: "Date", key: "date", width: 14 },
    { header: "User", key: "user", width: 28 },
    { header: "Work Item / Backlog", key: "subject", width: 40 },
    { header: "Duration (min)", key: "durationMin", width: 16 },
    { header: "Duration", key: "duration", width: 12 },
    { header: "Note", key: "note", width: 40 },
  ];

  // Style header
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFE2E8F0" },
  };
  headerRow.alignment = { vertical: "middle" };

  for (const entry of sorted) {
    const userName = userNames[entry.userId] ?? entry.userId.slice(0, 8);

    let subject = "(unlinked)";
    if (entry.workItemId && workItems[entry.workItemId]) {
      subject = workItems[entry.workItemId].title;
    } else if (entry.backlogId && backlogs[entry.backlogId]) {
      subject = backlogs[entry.backlogId].name;
    }

    const totalMinutes = entry.durationMinutes;
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    const durationFormatted = h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`;

    sheet.addRow({
      date: entry.spentDate,
      user: userName,
      subject,
      durationMin: totalMinutes,
      duration: durationFormatted,
      note: entry.note ?? "",
    });
  }

  // Trigger browser download
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const safeOrgName = orgName.replace(/[^a-zA-Z0-9_-]/g, "_");
  const date = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `timesheets_${safeOrgName}_${date}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
