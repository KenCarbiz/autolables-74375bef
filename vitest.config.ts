import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: [
      "src/**/*.{test,spec}.{ts,tsx}",
      // Deno-free shared edge-function modules are unit-tested here too.
      "supabase/functions/_shared/**/*.{test,spec}.ts",
    ],
  },
  resolve: {
    alias: {
      // Stub Supabase in unit tests so pure modules behind a transitive client
      // import can load without the real (network-bound) package.
      "@supabase/supabase-js": path.resolve(__dirname, "./src/test/mocks/supabaseClient.ts"),
      // Edge functions pin pdf-lib by URL (Deno has no node_modules). Point the
      // URL at the same version already in the lockfile so the page-1 cover
      // extraction can be tested against the library that actually runs there.
      "https://esm.sh/pdf-lib@1.17.1": "pdf-lib",
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
