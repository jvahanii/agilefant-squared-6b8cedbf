const STORAGE_KEY = "autoIntegrityCheck";
const AUTO_TEST_KEY = "autoTestOnCommit";

function getSettings(key: string): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(key) || "{}");
  } catch {
    return {};
  }
}

export function isAutoCheckEnabled(orgId: string | null): boolean {
  if (!orgId) return false;
  return getSettings(STORAGE_KEY)[orgId] ?? false;
}

export function setAutoCheckEnabled(orgId: string, enabled: boolean) {
  const settings = getSettings(STORAGE_KEY);
  settings[orgId] = enabled;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function isAutoTestEnabled(orgId: string | null): boolean {
  if (!orgId) return false;
  return getSettings(AUTO_TEST_KEY)[orgId] ?? false;
}

export function setAutoTestEnabled(orgId: string, enabled: boolean) {
  const settings = getSettings(AUTO_TEST_KEY);
  settings[orgId] = enabled;
  localStorage.setItem(AUTO_TEST_KEY, JSON.stringify(settings));
}
