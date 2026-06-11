import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { readFileSync } from "node:fs";

// Read the app version from package.json so we can surface it in the UI footer.
const pkg = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf-8"),
) as { version: string };

// The build writes straight into the Go binary's embed directory so the
// frontend ships inside the single backend binary. During `npm run dev`, API
// calls are proxied to the Go server on :8787.
export default defineConfig({
  plugins: [react()],
  define: {
    // Compile-time constant, referenced as __APP_VERSION__ in the app.
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    outDir: "../internal/web/dist",
    emptyOutDir: true,
  },
  server: {
    proxy: {
      "/api": "http://localhost:8787",
    },
  },
});
