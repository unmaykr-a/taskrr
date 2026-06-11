import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { readFileSync } from "node:fs";

// Read the app version from package.json so we can surface it in the UI footer.
const pkg = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf-8"),
) as { version: string };

// Demo mode (VITE_DEMO=1): a static, server-less build for GitHub Pages. The API
// layer is swapped for an in-browser mock (see src/lib/api.demo.ts) and assets
// are served from the project subpath (https://<user>.github.io/taskrr/).
const demo = process.env.VITE_DEMO === "1";

// The normal build writes straight into the Go binary's embed directory so the
// frontend ships inside the single backend binary. During `npm run dev`, API
// calls are proxied to the Go server on :8787. The demo build instead emits to
// web/dist-demo (it is never embedded in the binary).
export default defineConfig({
  base: demo ? "/taskrr/" : "/",
  plugins: [react()],
  define: {
    // Compile-time constant, referenced as __APP_VERSION__ in the app.
    __APP_VERSION__: JSON.stringify(pkg.version),
    // True only in the GitHub Pages demo build; gates the in-browser mock API.
    __DEMO__: JSON.stringify(demo),
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    outDir: demo ? "dist-demo" : "../internal/web/dist",
    emptyOutDir: true,
  },
  server: {
    proxy: {
      "/api": "http://localhost:8787",
    },
  },
});
