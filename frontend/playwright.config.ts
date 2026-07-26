import { defineConfig, devices } from "@playwright/test";

// The production API explicitly allows the normal local storefront origin.
// Keep browser-direct E2E requests on that origin so CORS is exercised instead
// of silently falling back to preview data.
const port = 3000;
const externalBaseUrl = process.env.E2E_BASE_URL?.replace(/\/$/, "");
const baseURL = externalBaseUrl ?? `http://localhost:${port}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [["list"]],
  timeout: 120_000,
  expect: { timeout: 30_000 },
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
  ],
  webServer: externalBaseUrl ? undefined : {
    command: `npm run dev -- --hostname localhost --port ${port}`,
    url: `http://localhost:${port}/products`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      ...process.env,
      NEXT_PUBLIC_API_BASE_URL: "/api/v1",
    },
  },
});
