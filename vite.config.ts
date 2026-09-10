import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
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
