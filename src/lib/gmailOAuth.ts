/**
 * How an organization connects Gmail, as the gmail-connector function reports it.
 *
 * `shared` organizations use the shared connector and need nothing set up.
 * Every other organization must bring its own Google OAuth client, and nobody
 * in it can connect Gmail until an owner or admin has added one.
 */
export type OAuthStatus =
  | { mode: "shared" }
  | {
      mode: "own";
      configured: boolean;
      /** Public, safe to show. The secret never leaves the server. */
      clientId: string | null;
      updatedAt: string | null;
      /** Whether this user may add, replace or remove the client. */
      canManage: boolean;
    };

/** The path Google must be allowed to redirect to, on whatever host the app is. */
export const GMAIL_CALLBACK_PATH = "/gmail-callback.html";

export function gmailCallbackUrl(origin: string): string {
  return `${origin}${GMAIL_CALLBACK_PATH}`;
}

/** Whether Gmail can be connected at all in this organization right now. */
export function canConnectGmail(status: OAuthStatus | null): boolean {
  if (!status) return false;
  return status.mode === "shared" || status.configured;
}

const MESSAGES: Record<string, string> = {
  oauth_client_not_configured:
    "This organization has no Google OAuth client set up yet. An owner or admin needs to add one first.",
  oauth_client_rejected:
    "Google rejected the organization's OAuth client ID or secret. An owner or admin should check them, and replace them if needed.",
  oauth_state_invalid:
    "That sign-in could not be verified as the one you started. Choose Connect Gmail and try again.",
  oauth_state_expired: "That sign-in took too long to finish. Choose Connect Gmail and try again.",
  gmail_not_connected: "Gmail is not connected, or the connection has expired. Connect Gmail again.",
};

/**
 * A readable explanation of a gmail-connector failure.
 *
 * The function answers with codes, and a failed call reaches the app as the raw
 * response body — often JSON — so both a bare code and a JSON body are read.
 */
export function explainGmailError(message: string): string {
  let code = message.trim();
  try {
    const parsed = JSON.parse(code) as { error?: unknown };
    if (typeof parsed?.error === "string") code = parsed.error;
  } catch {
    // Not JSON; use the text as it is.
  }
  if (MESSAGES[code]) return MESSAGES[code];
  // A Google redirect_uri_mismatch arrives as Google's own words. Name the fix.
  if (/redirect_uri_mismatch/i.test(code)) {
    return "Google refused the redirect address. Add the authorized redirect URI shown here to the OAuth client in Google Cloud.";
  }
  return code;
}
