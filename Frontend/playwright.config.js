import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5188',
    trace: 'on-first-retry',
    headless: true,
  },
  webServer: {
    command: 'npx vite --port 5188',
    url: 'http://localhost:5188',
    reuseExistingServer: false,
    timeout: 20000,
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
});
