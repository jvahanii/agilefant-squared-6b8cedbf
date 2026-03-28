import { useCallback } from "react";

const STORAGE_KEY = "autoIntegrityCheck";

function getSettings(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

export function isAutoCheckEnabled(orgId: string | null): boolean {
  if (!orgId) return false;
  return getSettings()[orgId] ?? false;
}

export function setAutoCheckEnabled(orgId: string, enabled: boolean) {
  const settings = getSettings();
  settings[orgId] = enabled;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}
