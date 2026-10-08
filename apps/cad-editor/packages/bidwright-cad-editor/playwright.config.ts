import { defineConfig, devices } from '@playwright/test'
export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL ?? 'chrome',
    viewport: { width: 1500, height: 1000 },
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  webServer: {
    command: 'pnpm preview --port 4854 --strictPort',
    url: 'http://127.0.0.1:4854',
    reuseExistingServer: false,
    timeout: 30_000
  }
})
