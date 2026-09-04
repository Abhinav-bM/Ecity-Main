import { defineConfig, devices } from '@playwright/test'

/**
 * The app is used on a counter phone, a shop tablet and a back-office desktop,
 * so every suite runs at all three sizes. A layout that only works at 1440px
 * is not done.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'mobile',
      use: { ...devices['Pixel 7'] },
    },
    {
      name: 'mobile-small',
      // 320 CSS px - the narrowest screen still in real use. If it works
      // here it works everywhere.
      use: { ...devices['Pixel 7'], viewport: { width: 320, height: 658 } },
    },
    {
      // iPad dimensions and touch, but on Chromium. The purpose here is
      // layout at ~810px with a coarse pointer, and running it on Chromium
      // keeps CI to a single browser download.
      // GAP: real iPad Safari is not covered. Worth adding a WebKit project
      // before go-live, since the shop tablet may well be an iPad.
      name: 'tablet',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 810, height: 1080 },
        hasTouch: true,
        isMobile: false,
      },
    },
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
  ],
})
