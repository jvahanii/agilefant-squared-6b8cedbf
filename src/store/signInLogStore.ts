const STORAGE_KEY = "sign_in_log";

export interface SignInEntry {
  id: string;
  fullName: string | null;
  email: string | null;
  timestamp: number; // Date.now()
}

function readLog(): SignInEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e: any) => e?.timestamp && typeof e.timestamp === "number",
    );
  } catch {
    return [];
  }
}

function writeLog(entries: SignInEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Storage full — discard oldest entries
    if (entries.length > 10) {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(entries.slice(-10)),
      );
    }
  }
}

/** Register a sign-in. Called from the auth hook. */
export function recordSignIn(
  userId: string,
  fullName: string | null,
  email: string | null,
): void {
  const log = readLog();
  log.push({ id: userId, fullName, email, timestamp: Date.now() });
  // Keep last 200 entries
  if (log.length > 200) {
    log.splice(0, log.length - 200);
  }
  writeLog(log);
}

/** Get all sign-in entries, newest first. */
export function getSignInLog(): SignInEntry[] {
  return readLog().reverse();
}