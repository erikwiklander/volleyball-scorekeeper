import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  use: {
    baseURL: 'http://127.0.0.1:4173/volleyball-scorekeeper/',
    trace: 'retain-on-failure',
    ...devices['iPhone 13'],
    defaultBrowserType: 'chromium',
  },
  webServer: {
    command: 'npm run preview -- --port 4173 --base /volleyball-scorekeeper/',
    url: 'http://127.0.0.1:4173/volleyball-scorekeeper/',
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
});
