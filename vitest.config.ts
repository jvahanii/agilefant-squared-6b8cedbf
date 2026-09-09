import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    // appStore.performance.test.ts asserts wall-clock budgets, which are only
    // meaningful when the run has the CPU to itself. Sharing cores with other
    // test files inflated those timings 5-9x and made them fail regardless of
    // whether anything had actually regressed. The suite is small enough that
    // running files one at a time costs little.
    fileParallelism: false,
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
