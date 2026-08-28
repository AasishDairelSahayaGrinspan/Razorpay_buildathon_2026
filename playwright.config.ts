import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  // Default to 2 workers: balances speed against shared dev server / SQLite /
  // Razorpay TEST API contention. Override with --workers=N. CI gets retries
  // for any residual infra flakes.
  fullyParallel: true,
  workers: process.env.CI ? 2 : 2,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000/shop",
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
    {
      name: "mobile",
      use: { ...devices["Pixel 7"], viewport: { width: 375, height: 800 } },
    },
  ],
});
