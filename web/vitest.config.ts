import { defineConfig } from "vitest/config";
import { fileURLToPath, URL } from "node:url";

// Vitest config kept separate from vite.config.ts so the app build and the test
// runner don't share unrelated settings. The "@" alias mirrors the app so tests
// can import modules the same way components do.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    // The logic under test is pure (no DOM), so the fast Node environment is
    // enough. Switch to "jsdom" later if we add component tests.
    environment: "node",
  },
});
