// Demo mode flag.
//
// `__DEMO__` is a compile-time boolean injected by Vite (see vite.config.ts):
// true only for the static GitHub Pages build (`VITE_DEMO=1`), false otherwise.
// Because it's a literal at build time, the bundler tree-shakes the demo data
// layer out of normal (server-backed) builds entirely.
declare const __DEMO__: boolean;

export const DEMO: boolean = __DEMO__;
