import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './live-tests',
  outputDir: 'live-test-results',
  timeout: 60000,
  expect: { timeout: 15000 },
  workers: 2,
  use: {
    baseURL: 'http://127.0.0.1:4174/volleyball-scorekeeper/',
    trace: 'retain-on-failure',
    ...devices['iPhone 13'],
  },
  webServer: {
    command: 'node scripts/preview-live.mjs',
    url: 'http://127.0.0.1:4174/volleyball-scorekeeper/',
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
});
