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
  },
  resolve: {
    alias: {
      // Stub Supabase in unit tests so pure modules behind a transitive client
      // import can load without the real (network-bound) package.
      "@supabase/supabase-js": path.resolve(__dirname, "./src/test/mocks/supabaseClient.ts"),
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
