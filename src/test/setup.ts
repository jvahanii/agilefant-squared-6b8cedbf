import "@testing-library/jest-dom";
// jsdom ships no IndexedDB, which is where the app-data cache lives. Without
// this the cache silently no-ops under test and its behaviour goes uncovered.
import "fake-indexeddb/auto";
import { beforeEach } from "vitest";
import { clearAllCachedAppData } from "@/store/appDataCache";

// Unlike localStorage, the cache survives between tests in a file, so without
// this one test's snapshot sends the next one down the cached load path.
beforeEach(async () => {
  await clearAllCachedAppData();
});

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});
