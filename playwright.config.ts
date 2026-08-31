import { defineConfig, devices } from '@playwright/test';

// Headless only: development happens on a Linux box with no display server.
// Screenshots land in test-results/ and are reviewed as part of the change.
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 2 : 0,
  ...(process.env['CI'] ? { workers: 1 } : {}),
  reporter: [['list']],
  outputDir: './test-results',
  // Booting PDFium means compiling a 4.6 MB WASM module before anything can be
  // drawn, which takes tens of seconds on a headless CI-grade machine. The
  // default 30s expires while the viewer is still legitimately starting up.
  timeout: 120_000,
  expect: { timeout: 30_000 },
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // Test the real static build, since that is what gets packaged by Tauri.
    command: 'npm run build && npm run preview',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env['CI'],
    timeout: 180_000,
  },
});
