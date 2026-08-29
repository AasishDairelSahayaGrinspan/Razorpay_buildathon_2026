import { defineConfig } from "vite";

// GitHub Pages project-site friendly: all asset URLs are emitted relative,
// so the site works under /Razorpay_buildathon_2026/ without knowing the
// exact repository path in advance.
export default defineConfig({
  base: "./",
  build: {
    outDir: "dist",
    assetsDir: "assets",
    sourcemap: false,
  },
});
