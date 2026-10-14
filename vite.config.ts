import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { execSync } from "node:child_process";
import { componentTagger } from "lovable-tagger";

/**
 * The build's identity: which commit it came from, and when it was made.
 *
 * Two places need exactly this value — the `version.json` published next to the
 * bundle, and the `__APP_BUILD__` constant baked into the code — because the app
 * spots a newer deployment by comparing what it was built from with what the
 * site now serves. Resolving it once here is what keeps the two from drifting
 * apart.
 *
 * Cloudflare Pages passes the commit as CF_PAGES_COMMIT_SHA; a local build falls
 * back to git. The timestamp is what the comparison actually uses: an environment
 * with no git still gets a value that differs between builds.
 */
function resolveBuild() {
  let commit = process.env.CF_PAGES_COMMIT_SHA ?? "";
  if (!commit) {
    try {
      commit = execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    } catch {
      commit = "unknown";
    }
  }
  return { commit: commit || "unknown", builtAt: new Date().toISOString() };
}

/**
 * Emits `version.json` next to the bundle, naming the build it was made from.
 *
 * Without it there is no way to ask the live site what it is running, short of
 * grepping its JavaScript for a string you know only the newest code contains.
 */
function emitVersionFile(build: ReturnType<typeof resolveBuild>): Plugin {
  return {
    name: "emit-version-json",
    apply: "build",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "version.json",
        source: `${JSON.stringify(build, null, 2)}\n`,
      });
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const build = resolveBuild();

  return {
    server: {
      host: "::",
      port: 8080,
      hmr: {
        overlay: false,
      },
    },
    // The bundle has to know which build it is, or it can only guess by looking
    // for a string it happens to know the newest code contains.
    define: {
      __APP_BUILD__: JSON.stringify(build),
    },
    plugins: [react(), emitVersionFile(build), mode === "development" && componentTagger()].filter(Boolean),
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
  };
});
