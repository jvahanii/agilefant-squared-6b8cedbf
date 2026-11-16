import { useEffect } from "react";

/**
 * Cloudflare Web Analytics: counts page views on the public pages, so we can
 * see how many visitors reach sign-up and how many make an account. It sets
 * no cookies, keeps nothing in the browser, does not log query strings and
 * does not follow anyone across sites. The terms say so (TermsContent.tsx).
 *
 * Loaded by the pages a visitor passes on the way in: the landing page,
 * sign-in and sign-up, the first page of a new account (Onboarding), the
 * terms and the guides. Never by a public backlog (/p/…, its address is the
 * link's secret) or the unsubscribe page (its address names a person). Once
 * loaded it also counts the pages the visitor moves to within the app.
 *
 * Off until VITE_CF_ANALYTICS_TOKEN is set (the site token from Cloudflare,
 * Web Analytics → Manage site; it is public, it ends up in the page anyway),
 * and only on agilefant.org: development and previews are not counted.
 */
export const BEACON_SRC = "https://static.cloudflareinsights.com/beacon.min.js";
const LIVE_HOST = "agilefant.org";

export function loadWebAnalytics(
  token: string | undefined = import.meta.env.VITE_CF_ANALYTICS_TOKEN,
  host: string = typeof location === "undefined" ? "" : location.hostname,
): boolean {
  if (!token || host !== LIVE_HOST || typeof document === "undefined") return false;
  if (document.querySelector(`script[src="${BEACON_SRC}"]`)) return true;
  const script = document.createElement("script");
  script.type = "module";
  script.defer = true;
  script.src = BEACON_SRC;
  script.setAttribute("data-cf-beacon", JSON.stringify({ token, spa: true }));
  document.body.appendChild(script);
  return true;
}

/** For a page that counts towards the visitor numbers. */
export function useWebAnalytics(): void {
  useEffect(() => {
    loadWebAnalytics();
  }, []);
}
