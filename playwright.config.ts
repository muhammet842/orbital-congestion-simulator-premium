import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  // The globe renders in software (SwiftShader) on CI runners, so a page can take
  // ~20 s to become interactive on a busy runner. 30 s left no headroom and
  // made the mobile specs fail whenever the runner was slower than usual.
  timeout: 60_000,
  retries: 1,
  reporter: [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL: 'http://localhost:4173',
    viewport: { width: 1280, height: 720 },
    // No screenshots/videos by default — enable on CI if needed
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: /mobile\.spec\.ts/,
    },
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 7'] },
      testMatch: /mobile\.spec\.ts/,
    },
  ],

  // Automatically build + preview before running E2E tests.
  // reuseExistingServer: true locally so devs don't wait for a rebuild
  // every single run if the preview server is already up.
  webServer: {
    command: 'npm run build && npm run preview',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});