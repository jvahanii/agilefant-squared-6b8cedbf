import { describe, expect, it } from "vitest";
import { looksSignedIn } from "@/lib/storedSession";

describe("looksSignedIn", () => {
  it("counts a live sign-in once the minute-long token has lapsed", () => {
    expect(looksSignedIn("theme=dark; __client_uat=1790000000")).toBe(true);
    expect(looksSignedIn("__client_uat_Ab3dE=1790000000; theme=dark")).toBe(true);
  });

  it("counts the short-lived token when it is there", () => {
    expect(looksSignedIn("__session=eyJhbGciOi")).toBe(true);
  });

  it("does not count a signed-out browser", () => {
    expect(looksSignedIn("")).toBe(false);
    expect(looksSignedIn("__client_uat=0")).toBe(false);
    expect(looksSignedIn("__client_uat_Ab3dE=0; theme=dark")).toBe(false);
    expect(looksSignedIn("my__session_note=1")).toBe(false);
  });
});
