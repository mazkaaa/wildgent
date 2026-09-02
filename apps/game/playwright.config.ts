import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./src/tests/e2e",
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  // Keep local and CI runs to one browser process; Three.js scenes are resource-intensive.
  fullyParallel: false,
  workers: 1,
  reporter: "line",
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "on-first-retry",
  },
  webServer: {
    command: "npm run dev -- --host 127.0.0.1",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: true,
  },
  projects: [{ name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } }],
});
