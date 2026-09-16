/**
 * Setting up an organization's own Google OAuth client, from the app's side.
 *
 * Organizations other than those allowed the shared connector cannot connect
 * Gmail without one, so what matters is that a manager is shown exactly what
 * to register and can save it, that everyone else is told who can, and that the
 * secret is sent and never displayed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => invoke(...args) } },
}));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));

import { GoogleOAuthClientSection } from "@/components/GoogleOAuthClientSection";
import { canConnectGmail, explainGmailError, gmailCallbackUrl } from "@/lib/gmailOAuth";

const CLIENT_ID = "1234567890-abc.apps.googleusercontent.com";

beforeEach(() => invoke.mockReset());

describe("canConnectGmail", () => {
  it("allows the shared connector, and an own client once one exists", () => {
    expect(canConnectGmail({ mode: "shared" })).toBe(true);
    expect(canConnectGmail({ mode: "own", configured: true, clientId: CLIENT_ID, updatedAt: null, canManage: false })).toBe(true);
    expect(canConnectGmail({ mode: "own", configured: false, clientId: null, updatedAt: null, canManage: true })).toBe(false);
    expect(canConnectGmail(null)).toBe(false);
  });
});

describe("explainGmailError", () => {
  it("reads a code whether it arrives bare or as a JSON body", () => {
    expect(explainGmailError("oauth_client_not_configured")).toMatch(/owner or admin needs to add one/);
    expect(explainGmailError('{"error":"oauth_state_expired"}')).toMatch(/took too long/);
  });

  it("names the fix for a redirect URI Google does not recognise", () => {
    expect(explainGmailError("Error 400: redirect_uri_mismatch")).toMatch(/authorized redirect URI/);
  });

  it("passes anything else through unchanged", () => {
    expect(explainGmailError("Something else went wrong")).toBe("Something else went wrong");
  });
});

describe("GoogleOAuthClientSection", () => {
  it("shows a manager the redirect URI to register, and saves the client", async () => {
    invoke.mockResolvedValue({ data: { configured: true, clientId: CLIENT_ID }, error: null });
    const onChanged = vi.fn();
    render(
      <GoogleOAuthClientSection
        organizationId="org-1"
        status={{ mode: "own", configured: false, clientId: null, updatedAt: null, canManage: true }}
        onChanged={onChanged}
      />,
    );

    expect(screen.getByLabelText("Authorized redirect URI")).toHaveValue(gmailCallbackUrl(window.location.origin));

    fireEvent.change(screen.getByLabelText("Client ID"), { target: { value: CLIENT_ID } });
    fireEvent.change(screen.getByLabelText("Client secret"), { target: { value: "GOCSPX-secret" } });
    fireEvent.click(screen.getByRole("button", { name: /Save client/ }));

    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(invoke).toHaveBeenCalledWith("gmail-connector", {
      body: { action: "set_oauth_client", organizationId: "org-1", clientId: CLIENT_ID, clientSecret: "GOCSPX-secret" },
    });
  });

  it("keeps the secret out of sight while it is typed", () => {
    render(
      <GoogleOAuthClientSection
        organizationId="org-1"
        status={{ mode: "own", configured: false, clientId: null, updatedAt: null, canManage: true }}
        onChanged={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Client secret")).toHaveAttribute("type", "password");
  });

  it("tells a member who is not a manager who can set it up, and offers no form", () => {
    render(
      <GoogleOAuthClientSection
        organizationId="org-1"
        status={{ mode: "own", configured: false, clientId: null, updatedAt: null, canManage: false }}
        onChanged={vi.fn()}
      />,
    );
    expect(screen.getByText(/An owner or admin of this organization needs to add/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Client secret")).toBeNull();
  });

  it("shows the configured client by its ID, with changes offered only to a manager", () => {
    const { rerender } = render(
      <GoogleOAuthClientSection
        organizationId="org-1"
        status={{ mode: "own", configured: true, clientId: CLIENT_ID, updatedAt: null, canManage: true }}
        onChanged={vi.fn()}
      />,
    );
    expect(screen.getByText(CLIENT_ID)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Replace" })).toBeInTheDocument();

    rerender(
      <GoogleOAuthClientSection
        organizationId="org-1"
        status={{ mode: "own", configured: true, clientId: CLIENT_ID, updatedAt: null, canManage: false }}
        onChanged={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: "Replace" })).toBeNull();
  });
});
