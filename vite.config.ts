import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { execSync } from "node:child_process";
import { componentTagger } from "lovable-tagger";

/**
 * Emits `version.json` next to the bundle, naming the commit it was built from.
 *
 * Without it there is no way to ask the live site what it is running, short of
 * grepping its JavaScript for a string you know only the newest code contains.
 * Cloudflare Pages passes the commit as CF_PAGES_COMMIT_SHA; a local build
 * falls back to git.
 */
function emitVersionFile(): Plugin {
  return {
    name: "emit-version-json",
    apply: "build",
    generateBundle() {
      let commit = process.env.CF_PAGES_COMMIT_SHA ?? "";
      if (!commit) {
        try {
          commit = execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
        } catch {
          commit = "unknown";
        }
      }
      this.emitFile({
        type: "asset",
        fileName: "version.json",
        source: `${JSON.stringify({ commit, builtAt: new Date().toISOString() }, null, 2)}\n`,
      });
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react(), emitVersionFile(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Only list packages the entry chunk itself needs. Naming a package
        // here forces it into the entry graph and gets it modulepreloaded on
        // every cold start — that is why recharts (charts, lazy) and dnd-kit
        // (app shell, lazy) are deliberately absent: they ride along with the
        // lazy chunks that actually use them instead.
        manualChunks: {
          "vendor": [
            "react",
            "react-dom",
            "react-router-dom",
            "@tanstack/react-query",
          ],
          "vendor-supabase": ["@supabase/supabase-js"],
          "vendor-clerk": ["@clerk/clerk-react"],
        },
      },
    },
  },
}));
