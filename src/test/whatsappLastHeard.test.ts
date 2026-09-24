/**
 * When the WhatsApp forwarding phone last sent anything, as the integration
 * card says it. The phone was switched off for nine days and nothing showed.
 */
import { describe, it, expect } from "vitest";
import { whatsappLastHeard } from "@/lib/whatsappLastHeard";

const NOW = new Date("2026-09-24T18:00:00Z");

describe("whatsappLastHeard", () => {
  it("says the phone has not been heard from before its first request", () => {
    expect(whatsappLastHeard(null, NOW)).toBe("Not heard from the phone yet");
    expect(whatsappLastHeard(undefined, NOW)).toBe("Not heard from the phone yet");
    expect(whatsappLastHeard("not a date", NOW)).toBe("Not heard from the phone yet");
  });

  it("says how long ago, in plain words", () => {
    expect(whatsappLastHeard("2026-09-24T16:00:00Z", NOW)).toBe("Last heard from the phone 2 hours ago");
    expect(whatsappLastHeard("2026-09-15T18:00:00Z", NOW)).toBe("Last heard from the phone 9 days ago");
  });

  it("calls anything within the last minute just now, clock skew included", () => {
    expect(whatsappLastHeard("2026-09-24T17:59:30Z", NOW)).toBe("Last heard from the phone just now");
    // The phone's or the server's clock a little ahead of this browser's.
    expect(whatsappLastHeard("2026-09-24T18:00:20Z", NOW)).toBe("Last heard from the phone just now");
  });
});
